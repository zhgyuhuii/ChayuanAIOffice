import { chatResolved } from './chat'
import { discoverModels, type DiscoveryTarget } from './discovery'
import { generateImageWithModel, type ImageGenRequest } from './imagegen'
import { isAiNetworkError } from './network-error'
import { isAiOverloadedError } from './overload-error'
import { runMediaJob, type MediaJobResult } from './media-jobs'
import {
  enabledChatModels,
  findProfile,
  isImageGenModel,
  isVideoGenModel,
  migrateSettingsV2,
  pickImageModel,
  resolveCurrentModel,
  resolveModelCall,
  type ResolvedModelCall,
} from './settings-v2'
import { resolveCapabilityDefault } from './capability-tree'
import type { AiSettingsSource } from './settings-source'
import { streamResolved, AiCreditsError, type StreamCallbacks } from './stream'
import { AiTimeoutError } from './watchdog'
import { IMAGE_GEN_VENDOR_IDS, VIDEO_GEN_VENDOR_IDS, maxOutputTokensFor } from './capabilities'
import { clampMaxOutputTokens } from './providers'
import { imageParamSpec, videoParamSpec, type MediaParamSpec } from './media-params'
import type {
  AiChatResponse,
  AiModelSelection,
  AiProviderProfile,
  AiSettingsV2,
  AiStreamChunk,
  AiStreamRequestV2,
  ChatOfficeAccountStatus,
} from './types'

/**
 * Backend runtime shared by the Electron mains and the BFF: one place that
 * owns the settings source, secret resolution (inline key / chatoffice session),
 * the stream loop with keepalive + error mapping, discovery, and BYOK-first
 * image generation. Hosts wire their transport (IPC or HTTP) on top.
 */

/** sentinel replacing a stored key in renderer-facing views; save merges it back */
export const KEEP_KEY = '__keep__'

export interface AiRuntimeChatOffice {
  apiKey(): string
  hasAuth(): boolean
  status(withEmail: boolean): Promise<ChatOfficeAccountStatus>
  /** returns a downloadable/insertable image URL or throws; the fallback when no BYOK image model exists */
  generateImage(req: ImageGenRequest): Promise<{ url: string }>
}

export interface AiRuntimeDeps {
  source: AiSettingsSource
  chatoffice: AiRuntimeChatOffice
  translate: (key: string, params?: Record<string, unknown>) => string
  /**
   * server-side secret resolution for profiles that only carry a key reference
   * (harness source: the key lives in dsh's credentials store). Called at run
   * time so credential rotations take effect on the next request; the resolved
   * secret never enters settings views.
   */
  resolveSecret?: (profile: AiProviderProfile) => Promise<string>
}

function redact(settings: AiSettingsV2): AiSettingsV2 {
  return {
    ...settings,
    profiles: settings.profiles.map((p) =>
      p.apiKey ? { ...p, apiKey: KEEP_KEY } : { ...p, apiKey: '' },
    ),
    ...(settings.stockApiKeys
      ? {
          stockApiKeys: {
            pexels: settings.stockApiKeys.pexels ? KEEP_KEY : '',
            pixabay: settings.stockApiKeys.pixabay ? KEEP_KEY : '',
            ...(settings.stockApiKeys.unsplash !== undefined
              ? { unsplash: settings.stockApiKeys.unsplash ? KEEP_KEY : '' }
              : {}),
          },
        }
      : {}),
    ...(settings.searchApiKeys
      ? { searchApiKeys: { serper: settings.searchApiKeys.serper ? KEEP_KEY : '' } }
      : {}),
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
    ...(view.stockApiKeys
      ? {
          stockApiKeys: {
            pexels:
              view.stockApiKeys.pexels === KEEP_KEY
                ? (stored.stockApiKeys?.pexels ?? '')
                : (view.stockApiKeys.pexels ?? ''),
            pixabay:
              view.stockApiKeys.pixabay === KEEP_KEY
                ? (stored.stockApiKeys?.pixabay ?? '')
                : (view.stockApiKeys.pixabay ?? ''),
            unsplash:
              view.stockApiKeys.unsplash === KEEP_KEY
                ? (stored.stockApiKeys?.unsplash ?? '')
                : (view.stockApiKeys.unsplash ?? ''),
          },
        }
      : {}),
    ...(view.searchApiKeys
      ? {
          searchApiKeys: {
            serper:
              view.searchApiKeys.serper === KEEP_KEY
                ? (stored.searchApiKeys?.serper ?? '')
                : (view.searchApiKeys.serper ?? ''),
          },
        }
      : {}),
  }
}

export function createAiRuntime(deps: AiRuntimeDeps) {
  const { source, chatoffice, translate, resolveSecret } = deps

  /** inline key, keyless-local sentinel, or the referenced harness credential */
  const profileKey = async (profile: AiProviderProfile): Promise<string> => {
    if (profile.apiKey) return profile.apiKey
    if (profile.ollamaLike) return 'local'
    if (resolveSecret) return resolveSecret(profile)
    return ''
  }

  const readRaw = async (): Promise<AiSettingsV2> => {
    let settings = await source.read()
    // login gates nothing (consensus): a current model parked on the chatoffice
    // profile while signed out falls through to the first usable BYOK chat
    // model, so chat keeps working instead of erroring. The chatoffice error with its
    // inline sign-in button stays the guidance only when nothing else exists.
    const current = resolveCurrentModel(settings)
    if (current?.profileId === 'chatoffice' && !chatoffice.hasAuth()) {
      const fallback = enabledChatModels(settings).find((m) => {
        if (m.profileId === 'chatoffice') return false
        const profile = findProfile(settings, m.profileId)
        return !!profile && (!!profile.apiKey || !!profile.ollamaLike || !!profile.apiKeyRef)
      })
      if (fallback) {
        settings = {
          ...settings,
          currentModel: { profileId: fallback.profileId, modelId: fallback.modelId },
        }
        await source.write(settings)
      }
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

  /** resolve one run: profile + secret (chatoffice session for chatoffice) → wire call */
  const resolveForRun = async (selection: AiModelSelection): Promise<ResolvedModelCall> => {
    const settings = await readRaw()
    const profile = findProfile(settings, selection.profileId)
    if (!profile) throw new Error(translate('errNoModel'))
    if (profile.auth === 'chatoffice-login') {
      if (!chatoffice.hasAuth() || !chatoffice.apiKey())
        throw new Error(translate('errChatOfficeNotLoggedIn'))
      return resolveModelCall(settings, selection, chatoffice.apiKey())
    }
    if (profile.vendorId === 'codex' || profile.id === 'codex') {
      // Codex reuses the Codex CLI's own ChatGPT login (catalog auth
      // 'codex-chatgpt'): no key is stored or sent. The codex-app-server
      // protocol ignores the key; the sentinel passes the shared path.
      // UI wiring that creates codex profiles is deferred — see
      // docs/upstream-sync.md round-2 ledger.
      return resolveModelCall(settings, selection, 'codex-cli')
    }
    const key = await profileKey(profile)
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
    // per-vendor cap resolved after the call is known; a blanket 8192 truncates long tool arguments on vendors with higher limits
    let maxTokens: number = request.maxTokens ?? 8192
    let call: ResolvedModelCall
    try {
      call = await resolveForRun(request.selection)
    } catch (err) {
      send({ requestId, type: 'error', error: err instanceof Error ? err.message : String(err) })
      return
    }
    if (request.maxTokens === undefined) {
      // user's global per-turn cap (f105f36) wins over the per-vendor default
      const stored = await readRaw()
      maxTokens =
        stored?.maxOutputTokens !== undefined
          ? clampMaxOutputTokens(stored.maxOutputTokens)
          : maxOutputTokensFor(call.vendorId, call.model)
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
    // Codex routes through the local app-server CLI (node-only; discovery.ts
    // must stay browser-bundlable, so the branch lives here).
    if (target.codexLike) {
      const { listCodexModels } = await import('./codex-app-server')
      const catalog = await listCodexModels(target.cliPath || undefined)
      return { models: catalog.models.map((id) => ({ id })) }
    }
    if (!target.apiKey && target.profileId) {
      const settings = await readRaw()
      const profile = findProfile(settings, target.profileId)
      if (profile) {
        const key = await profileKey(profile)
        if (key && key !== 'local') target = { ...target, apiKey: key }
      }
    }
    const models = await discoverModels(target)
    return { models }
  }

  /** Look up the stored API key for a profile (the renderer only holds KEEP_KEY sentinels). */
  const resolveProfileApiKey = async (profileId: string): Promise<string | null> => {
    const settings = await readRaw()
    const profile = findProfile(settings, profileId)
    if (!profile) return null
    // keep the legacy shape for inline/local profiles; only referenced secrets
    // go through the resolver
    if (profile.apiKey || profile.ollamaLike || !resolveSecret) return profile.apiKey ?? null
    return (await resolveSecret(profile)) || null
  }

  /** BYOK image model first; chatoffice backend as fallback; error when neither exists.
   * If the user configured an image model, its failure is the answer — silent
   * fallbacks would hide broken keys. An explicit `model` selection (insert-media
   * dialog) is honored when it still points at an enabled image-gen model. */
  const generateImage = async (
    req: ImageGenRequest & { model?: AiModelSelection },
  ): Promise<{ url?: string; urls?: string[]; error?: string }> => {
    const settings = await readRaw()
    let imageSelection: AiModelSelection | undefined
    if (req.model) {
      const model = req.model
      const profile = findProfile(settings, model.profileId)
      const entry = profile?.models.find((m) => m.id === model.modelId)
      if (profile?.enabled && entry && isImageGenModel(entry)) imageSelection = model
    }
    if (!imageSelection) imageSelection = pickImageModel(settings)
    if (imageSelection) {
      try {
        const call = await resolveForRun(imageSelection)
        const result = await generateImageWithModel(call, req)
        return {
          urls: result.urls,
          ...(result.urls[0] !== undefined ? { url: result.urls[0] } : {}),
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
    if (chatoffice.hasAuth()) {
      try {
        const r = await chatoffice.generateImage(req)
        return { urls: [r.url], url: r.url }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
    return { error: translate('errNoImageModel') }
  }

  /** enabled media-generation models across profiles with their param specs —
   *  the insert-media dialog's model picker list (specs are computed main-side
   *  so the renderer stays vendor-agnostic). image entries always; video entries
   *  only for vendors with a wired MediaJobClient adapter. chatoffice video is
   *  data-driven: it appears only when the proxy's model list carries
   *  video-generation entries. Entries matching the capability defaults
   *  (settings.imageModel / modelDefaults.videoGeneration, or the first
   *  qualifying model) carry isDefault so the dialog can preselect them. */
  const listMediaModels = async (): Promise<
    Array<
      | {
          kind: 'image'
          profileId: string
          modelId: string
          label: string
          vendorId: string
          spec: MediaParamSpec
          isDefault?: boolean
        }
      | {
          kind: 'video'
          profileId: string
          modelId: string
          label: string
          vendorId: string
          spec: MediaParamSpec
          isDefault?: boolean
        }
    >
  > => {
    const settings = await readRaw()
    const out: Array<
      | {
          kind: 'image'
          profileId: string
          modelId: string
          label: string
          vendorId: string
          spec: MediaParamSpec
          isDefault?: boolean
        }
      | {
          kind: 'video'
          profileId: string
          modelId: string
          label: string
          vendorId: string
          spec: MediaParamSpec
          isDefault?: boolean
        }
    > = []
    const defaultImage = resolveCapabilityDefault(settings, 'imageGen')
    const defaultVideo = resolveCapabilityDefault(settings, 'videoGen')
    const push = (
      kind: 'image' | 'video',
      profile: AiProviderProfile,
      vendorId: string,
      modelId: string,
      name: string | undefined,
      spec: MediaParamSpec,
    ): void => {
      const isDefault =
        (kind === 'image' ? defaultImage : defaultVideo)?.profileId === profile.id &&
        (kind === 'image' ? defaultImage : defaultVideo)?.modelId === modelId
      out.push({
        kind,
        profileId: profile.id,
        modelId,
        label: name && name !== modelId ? `${name} (${modelId})` : modelId,
        vendorId,
        spec,
        ...(isDefault ? { isDefault: true } : {}),
      })
    }
    for (const profile of settings.profiles) {
      if (!profile.enabled) continue
      const vendorId = profile.vendorId ?? profile.id
      if (IMAGE_GEN_VENDOR_IDS.has(vendorId)) {
        for (const m of profile.models) {
          if (!isImageGenModel(m)) continue
          push('image', profile, vendorId, m.id, m.name, imageParamSpec(vendorId, m.id))
        }
      }
      if (VIDEO_GEN_VENDOR_IDS.has(vendorId)) {
        for (const m of profile.models) {
          if (!isVideoGenModel(m)) continue
          push('video', profile, vendorId, m.id, m.name, videoParamSpec(vendorId, m.id))
        }
      }
    }
    return out
  }

  /**
   * One-shot SVG illustration: the svgGeneration default model (or the
   * explicit selection) writes complete standalone SVG markup for a prompt.
   * The caller rasterizes; this only produces and extracts the markup.
   */
  const generateSvg = async (req: {
    profileId?: string
    modelId?: string
    prompt: string
  }): Promise<{ svg?: string; modelId?: string; error?: string }> => {
    const settings = await readRaw()
    const selection =
      req.profileId && req.modelId
        ? { profileId: req.profileId, modelId: req.modelId }
        : resolveCapabilityDefault(settings, 'svgGeneration')
    if (!selection) return { error: translate('errNoModel') }
    const system =
      'You are an SVG illustration generator. Reply with ONE complete standalone SVG document and nothing else: ' +
      'start with <svg viewBox="0 0 W H"> (W/H from the prompt, default 1024x768 when unspecified) and end with </svg>. ' +
      'No markdown fences, no commentary. Rules: no external images/fonts/CSS/scripts; no <text> with webfonts ' +
      '(convert text to paths or keep font-family generic); solid fills; keep all shapes inside the viewBox; ' +
      'prefer clean flat shapes with clear silhouettes readable at small sizes.'
    const r = await runChat(selection, system, String(req.prompt ?? ''))
    if (!r.ok || !r.content) return { error: r.error ?? 'empty model reply' }
    const m = /<svg[\s\S]*<\/svg>/i.exec(r.content)
    if (!m) return { error: 'the model reply carried no <svg> document' }
    return { svg: m[0], modelId: selection.modelId }
  }

  /** one video-generation job through MediaJobClient: resolve the model
   * selection (profile key/secret + vendor) then submit → poll → result.
   * The ai-host video-task registry drives this from the main process. */
  const runVideoJob = async (req: {
    profileId: string
    modelId: string
    prompt: string
    params?: Record<string, unknown>
    imageUrl?: string
    signal?: AbortSignal
    onProgress?(stage: 'submitted' | 'running', note?: string): void
  }): Promise<MediaJobResult> => {
    const settings = await readRaw()
    const profile = findProfile(settings, req.profileId)
    const entry = profile?.models.find((m) => m.id === req.modelId)
    if (!profile?.enabled || !entry || !isVideoGenModel(entry)) {
      throw new Error(`Model ${req.modelId} is not an enabled video-generation model`)
    }
    const call = await resolveForRun({ profileId: req.profileId, modelId: req.modelId })
    const aspectRatio =
      typeof req.params?.aspectRatio === 'string' && req.params.aspectRatio.trim()
        ? req.params.aspectRatio.trim()
        : undefined
    const rawDuration = req.params?.durationSeconds
    const durationSeconds =
      typeof rawDuration === 'number'
        ? rawDuration
        : typeof rawDuration === 'string' &&
            rawDuration.trim() &&
            Number.isFinite(Number(rawDuration))
          ? Number(rawDuration)
          : undefined
    return runMediaJob({
      kind: 'video',
      vendorId: call.vendorId ?? profile.vendorId ?? profile.id,
      model: call.model,
      apiKey: call.apiKey,
      ...(call.baseUrl ? { baseUrl: call.baseUrl } : {}),
      prompt: req.prompt,
      ...(req.imageUrl ? { imageUrl: req.imageUrl } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      ...(req.params ? { params: req.params } : {}),
      ...(req.signal ? { signal: req.signal } : {}),
      ...(req.onProgress ? { onProgress: req.onProgress } : {}),
    })
  }

  return {
    getSettingsView,
    saveSettings,
    setCurrentModel,
    resolveForRun,
    runStream,
    runChat,
    discover,
    resolveProfileApiKey,
    generateImage,
    generateSvg,
    runVideoJob,
    listMediaModels,
    /** unredacted settings for main-process features (stock-image keys) */
    readRawSettings: readRaw,
    writeSettings: async (settings: AiSettingsV2): Promise<void> => {
      await source.write(migrateSettingsV2(settings))
    },
  }
}

export type AiRuntime = ReturnType<typeof createAiRuntime>
