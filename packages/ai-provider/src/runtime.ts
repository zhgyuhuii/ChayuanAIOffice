import { chatResolved } from './chat'
import { discoverModels, type DiscoveryTarget } from './discovery'
import { generateImageWithModel, type ImageGenRequest } from './imagegen'
import { isAiNetworkError } from './network-error'
import { isAiOverloadedError } from './overload-error'
import {
  findProfile,
  migrateSettingsV2,
  pickImageModel,
  resolveCurrentModel,
  resolveModelCall,
  type ResolvedModelCall,
} from './settings-v2'
import type { AiSettingsSource } from './settings-source'
import { streamResolved, AiCreditsError, type StreamCallbacks } from './stream'
import { AiTimeoutError } from './watchdog'
import type {
  AiChatResponse,
  AiModelSelection,
  AiProviderProfile,
  AiSettingsV2,
  AiStreamChunk,
  AiStreamRequestV2,
  GenSparkAccountStatus,
} from './types'

/**
 * Backend runtime shared by the Electron mains and the BFF: one place that
 * owns the settings source, secret resolution (inline key / gsk session),
 * the stream loop with keepalive + error mapping, discovery, and BYOK-first
 * image generation. Hosts wire their transport (IPC or HTTP) on top.
 */

/** sentinel replacing a stored key in renderer-facing views; save merges it back */
export const KEEP_KEY = '__keep__'

export interface AiRuntimeGsk {
  apiKey(): string
  hasAuth(): boolean
  status(withEmail: boolean): Promise<GenSparkAccountStatus>
  /** returns a downloadable/insertable image URL or throws; the fallback when no BYOK image model exists */
  generateImage(req: ImageGenRequest): Promise<{ url: string }>
}

export interface AiRuntimeDeps {
  source: AiSettingsSource
  gsk: AiRuntimeGsk
  translate: (key: string, params?: Record<string, unknown>) => string
}

function redact(settings: AiSettingsV2): AiSettingsV2 {
  return {
    ...settings,
    profiles: settings.profiles.map((p) =>
      p.apiKey ? { ...p, apiKey: KEEP_KEY } : { ...p, apiKey: '' },
    ),
  }
}

/** merge a redacted view back: KEEP_KEY restores the stored key */
function mergeKeys(view: AiSettingsV2, stored: AiSettingsV2): AiSettingsV2 {
  const storedById = new Map(stored.profiles.map((p) => [p.id, p]))
  return {
    ...view,
    profiles: view.profiles.map((p: AiProviderProfile) => {
      if (p.apiKey !== KEEP_KEY) return p
      const prev = storedById.get(p.id)
      return { ...p, apiKey: prev?.apiKey ?? '' }
    }),
  }
}

export function createAiRuntime(deps: AiRuntimeDeps) {
  const { source, gsk, translate } = deps

  const readRaw = async (): Promise<AiSettingsV2> => {
    const settings = await source.read()
    // v1 healing carried over: the login-backed default with cloud tools opted
    // out is a pre-lock combination; keep tools on for the genspark profile
    if (settings.gskToolsEnabled === false && settings.currentModel?.profileId === 'genspark') {
      const healed = { ...settings, gskToolsEnabled: true }
      await source.write(healed)
      return healed
    }
    return settings
  }

  /** renderer-facing settings: keys redacted, selection normalized */
  const getSettingsView = async (): Promise<AiSettingsV2> => {
    const settings = await readRaw()
    const current = resolveCurrentModel(settings)
    return redact(current ? { ...settings, currentModel: current } : settings)
  }

  /** persist a redacted view (KEEP_KEY merges the stored key back); migrates + normalizes */
  const saveSettings = async (view: AiSettingsV2): Promise<void> => {
    const stored = await readRaw()
    await source.write(migrateSettingsV2(mergeKeys(view, stored)))
  }

  const setCurrentModel = async (selection: AiModelSelection): Promise<void> => {
    const settings = await readRaw()
    await source.write({ ...settings, currentModel: selection })
  }

  /** resolve one run: profile + secret (gsk session for genspark) → wire call */
  const resolveForRun = async (selection: AiModelSelection): Promise<ResolvedModelCall> => {
    const settings = await readRaw()
    const profile = findProfile(settings, selection.profileId)
    if (!profile) throw new Error(translate('errNoModel'))
    if (profile.auth === 'gsk-login') {
      if (!gsk.hasAuth() || !gsk.apiKey()) throw new Error(translate('errGskNotLoggedIn'))
      return resolveModelCall(settings, selection, gsk.apiKey())
    }
    const key = profile.apiKey || (profile.ollamaLike ? 'local' : '')
    if (!key) throw new Error(translate('errNoApiKey', { provider: profile.displayName }))
    return resolveModelCall(settings, selection, key)
  }

  /** the full stream loop: resolve, stream, map errors to typed chunks */
  const runStream = async (
    request: AiStreamRequestV2,
    send: (chunk: AiStreamChunk) => void,
  ): Promise<void> => {
    const { requestId, system, messages } = request
    const tools = request.tools ?? []
    const maxTokens = request.maxTokens ?? 8192
    let call: ResolvedModelCall
    try {
      call = await resolveForRun(request.selection)
    } catch (err) {
      send({ requestId, type: 'error', error: err instanceof Error ? err.message : String(err) })
      return
    }
    // wire-activity keepalive: lets the renderer's silence watchdog tell a slow turn from a dead one
    let lastPing = 0
    const cb: StreamCallbacks = {
      signal: request.signal ?? new AbortController().signal,
      onDelta: (text) => send({ requestId, type: 'delta', text }),
      onReasoningDelta: (text) => send({ requestId, type: 'reasoning', text }),
      onToolCall: (toolCall) => send({ requestId, type: 'tool-call', toolCall }),
      onActivity: () => {
        const now = Date.now()
        if (now - lastPing < 5_000) return
        lastPing = now
        send({ requestId, type: 'ping' })
      },
    }
    let stopReason: string | undefined
    try {
      await streamResolved(call, system, messages, tools, maxTokens, {
        ...cb,
        onStopReason: (reason) => {
          stopReason = reason
        },
      })
      send({ requestId, type: 'done', ...(stopReason !== undefined ? { stopReason } : {}) })
    } catch (err) {
      if (cb.signal.aborted) {
        send({ requestId, type: 'done' })
        return
      }
      send({
        requestId,
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
        ...(err instanceof AiTimeoutError
          ? { errorCode: 'timeout' as const }
          : err instanceof AiCreditsError
            ? { errorCode: 'credits' as const }
            : isAiNetworkError(err)
              ? { errorCode: 'network' as const }
              : isAiOverloadedError(err)
                ? { errorCode: 'overloaded' as const }
                : {}),
      })
    }
  }

  /** one-shot chat on a selection */
  const runChat = async (
    selection: AiModelSelection,
    system: string,
    user: string,
  ): Promise<AiChatResponse> => {
    try {
      const call = await resolveForRun(selection)
      return await chatResolved(call, system, user)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** model list fetch + connection test for the settings UI; a bare profileId
   *  resolves the stored key server-side (the renderer only holds sentinels) */
  const discover = async (
    target: DiscoveryTarget,
  ): Promise<{ models: Array<{ id: string; name?: string }> }> => {
    if (!target.apiKey && target.profileId) {
      const settings = await readRaw()
      const profile = findProfile(settings, target.profileId)
      if (profile?.apiKey) target = { ...target, apiKey: profile.apiKey }
    }
    const models = await discoverModels(target)
    return { models }
  }

  /** BYOK image model first; gsk backend as fallback; error when neither exists.
   * If the user configured an image model, its failure is the answer — silent
   * fallbacks would hide broken keys. */
  const generateImage = async (
    req: ImageGenRequest,
  ): Promise<{ url?: string; error?: string }> => {
    const settings = await readRaw()
    const imageSelection = pickImageModel(settings)
    if (imageSelection) {
      try {
        const call = await resolveForRun(imageSelection)
        const result = await generateImageWithModel(call, req)
        return { url: result.url }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
    if (gsk.hasAuth()) {
      try {
        const r = await gsk.generateImage(req)
        return { url: r.url }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
    return { error: translate('errNoImageModel') }
  }

  return {
    getSettingsView,
    saveSettings,
    setCurrentModel,
    resolveForRun,
    runStream,
    runChat,
    discover,
    generateImage,
  }
}

export type AiRuntime = ReturnType<typeof createAiRuntime>
