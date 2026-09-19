/**
 * AI endpoints for the web/embedded forms (plan v2.2):
 *
 * The BFF owns the v2 settings (server-side file under the data dir, or the
 * dsh harness's llm-pi-ai namespace in the plugin form) and resolves every
 * provider call itself — keys never reach the browser. Streaming is SSE with
 * the same chunk shape the desktop mains push over IPC, so the web shims can
 * forward chunks into the editors unchanged.
 *
 * chatoffice login is desktop-only: the web form is pure BYOK (capabilities flags it)
 * and the chatoffice profile stays hidden in the settings UI.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { watch } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import {
  KEEP_KEY,
  CHATOP_LOCAL_AGENT_ID,
  CHATOP_LOCAL_PROFILE_ID,
  createAiRuntime,
  createFileSource,
  createHarnessSource,
  parseChatopProxyKey,
  resolveHarnessSecret,
  type AiModelSelection,
  type AiRuntime,
  type AiSettingsV2,
  type DiscoveryTarget,
} from '@chatoffice/ai-provider'
import { fetchRemoteImage } from '@chatoffice/electron-utils/remote-image'
import { imageSearch, webSearch } from '@chatoffice/ai-search'

export interface AiCallRecord {
  ts: string
  channel: string
  model: string
  requestId: string
  /** Usage when the provider reports it; call count is metered regardless */
  inputTokens?: number
  outputTokens?: number
}

export interface AiProxyOptions {
  /** Metering sink; default keeps an in-memory ring. */
  onCall?: (record: AiCallRecord) => void
  /** Data root hosting ai-settings.json (default: server data dir) */
  dataDir?: string
  /**
   * Harness fusion (dsh plugin form): when set, provider profiles + keys live
   * in dsh's llm-pi-ai namespace (shared with chatop) and office-side state
   * stays in the sidecar file. Reads settings.yaml/.credentials.yaml relative
   * to the dsh home and calls the harness loopback RPC base.
   */
  harness?: {
    dshHome: string
    rpcOrigin: string
    /** the origin is only knowable once dsh serves its first request; read lazily from this file */
    rpcOriginFile?: string
  }
}

/** server-side error copy for the four runtime keys (zh, matching the default UI locale) */
const ERR = {
  errChatOfficeNotLoggedIn: 'Web 端不支持 察元AIOffice 登录，请使用自己配置的模型',
  errNoApiKey: '未配置 {provider} 的 API Key',
  errNoModel: '未配置模型',
  errNoImageModel: '未配置生图模型：请在模型设置中启用生图模型',
}

function buildRuntime(options: AiProxyOptions): AiRuntime {
  const dataDir = options.dataDir ?? './data'
  const settingsFile = resolve(dataDir, 'ai-settings.json')
  const fileFs = {
    readFile: (p: string) => readFile(p, 'utf8'),
    writeFile: async (p: string, contents: string) => {
      await mkdir(dirname(p), { recursive: true })
      await writeFile(p, contents, 'utf8')
    },
    watch: (p: string, cb: () => void) => {
      try {
        const w = watch(p, () => cb())
        return () => w.close()
      } catch {
        return () => {}
      }
    },
  }
  const officeState = createFileSource(settingsFile, fileFs)
  const readDshFile = async (relativePath: string) =>
    readFile(resolve(options.harness!.dshHome, relativePath), 'utf8')
  /** Bearer key for the synthetic chatop-local profile: a live virtual key from
   *  chatop-models' proxy-keys.json when present, else issue one for our fixed
   *  agentId over the loopback HTTP face (same agentId re-issue revokes the old
   *  key — the short-lived cache keeps a burst of runs from thrashing keys). */
  let cachedLocalKey = ''
  let cachedLocalKeyAt = 0
  const chatopLocalKey = async (harness: {
    dshHome: string
    rpcOrigin: string
    rpcOriginFile?: string
  }): Promise<string> => {
    const live = await readFile(
      resolve(harness.dshHome, 'storages', 'chatop-models', 'proxy-keys.json'),
      'utf8',
    )
      .then(parseChatopProxyKey)
      .catch(() => null)
    if (live) return live
    if (cachedLocalKey && Date.now() - cachedLocalKeyAt < 10_000) return cachedLocalKey
    const origin = await resolveRpcOrigin(harness)
    const response = await fetch(`${origin}/api/chatop-models/proxy/keys/issue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: CHATOP_LOCAL_AGENT_ID }),
    })
    if (!response.ok) throw new Error(`chatop-models key issue failed: HTTP ${response.status}`)
    const doc = (await response.json()) as { ok?: boolean; key?: string; error?: unknown }
    if (!doc?.key) throw new Error('chatop-models key issue returned no key')
    cachedLocalKey = doc.key
    cachedLocalKeyAt = Date.now()
    return cachedLocalKey
  }
  const source = options.harness
    ? createHarnessSource({
        rpc: async (method, payload) => {
          const origin = await resolveRpcOrigin(options.harness!)
          const response = await fetch(`${origin}/api/${method}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              type: 'client-request',
              rpcId: crypto.randomUUID(),
              method,
              payload,
            }),
          })
          if (!response.ok)
            throw new Error(`transport failure for ${method}: HTTP ${response.status}`)
          const envelope = (await response.json()) as {
            result?: { ok: boolean; value?: unknown; error?: { message?: string } }
          }
          if (!envelope.result) throw new Error(`malformed rpc envelope for ${method}`)
          if (!envelope.result.ok) {
            throw new Error(envelope.result.error?.message ?? `${method} failed`)
          }
          return envelope.result.value
        },
        readDshFile,
        officeStateSource: officeState,
      })
    : officeState
  return createAiRuntime({
    source,
    // harness form: profiles carry apiKeyRef only — resolve the referenced
    // credential at call time (rotations apply on the next request; the secret
    // never enters settings views). The synthetic chatop-local profile
    // resolves to a model-proxy virtual key instead of the credentials file.
    ...(options.harness
      ? {
          resolveSecret: (profile) =>
            profile.id === CHATOP_LOCAL_PROFILE_ID
              ? chatopLocalKey(options.harness!)
              : resolveHarnessSecret(profile, readDshFile),
        }
      : {}),
    // chatoffice login is desktop-only; the web form is pure BYOK
    chatoffice: {
      apiKey: () => '',
      hasAuth: () => false,
      status: async () => ({ loggedIn: false }),
      generateImage: async () => {
        throw new Error(ERR.errNoImageModel)
      },
    },
    translate: (key, params) =>
      (ERR as Record<string, string>)[key]?.replace(/\{(\w+)\}/g, (_, k) =>
        String(params?.[k] ?? ''),
      ) ?? key,
  })
}

/** harness loopback origin: direct value or lazily-read file (written by the dsh plugin host) */
let cachedRpcOrigin = ''
let cachedRpcOriginAt = 0
async function resolveRpcOrigin(harness: {
  rpcOrigin: string
  rpcOriginFile?: string
}): Promise<string> {
  if (harness.rpcOrigin) return harness.rpcOrigin
  if (!harness.rpcOriginFile) throw new Error('harness rpc origin not configured')
  if (Date.now() - cachedRpcOriginAt < 5000 && cachedRpcOrigin) return cachedRpcOrigin
  cachedRpcOrigin = (await readFile(harness.rpcOriginFile, 'utf8')).trim()
  cachedRpcOriginAt = Date.now()
  if (!cachedRpcOrigin)
    throw new Error('harness rpc origin not discovered yet (dsh has served no request)')
  return cachedRpcOrigin
}

const activeStreams = new Map<string, AbortController>()

export function attachAiProxy(app: FastifyInstance, options: AiProxyOptions): void {
  const runtime = buildRuntime(options)
  const records: AiCallRecord[] = []
  const record = (r: AiCallRecord) => {
    records.push(r)
    if (records.length > 1000) records.shift()
    options.onCall?.(r)
  }

  // ── settings ───────────────────────────────────────────────────────────
  // web form: the chatoffice-login profile can never authenticate here — filter it
  // from the view so the UI never offers it
  app.get('/ai/settings', async () => {
    const view = await runtime.getSettingsView()
    const profiles = view.profiles.filter((p) => p.auth !== 'chatoffice-login')
    return {
      ...view,
      profiles,
      ...(view.currentModel && profiles.some((p) => p.id === view.currentModel!.profileId)
        ? {}
        : { currentModel: undefined }),
    }
  })

  app.put<{ Body: AiSettingsV2 }>('/ai/settings', async (request, reply) => {
    const view = request.body
    if (!view || view.version !== 2 || !Array.isArray(view.profiles)) {
      return reply.code(400).send({ error: 'invalid settings view' })
    }
    await runtime.saveSettings(view)
    return { ok: true }
  })

  app.post<{ Body: AiModelSelection }>('/ai/set-current-model', async (request, reply) => {
    const selection = request.body
    if (!selection?.profileId || !selection?.modelId) {
      return reply.code(400).send({ error: 'profileId and modelId are required' })
    }
    await runtime.setCurrentModel(selection)
    return { ok: true }
  })

  app.post<{ Body: DiscoveryTarget }>('/ai/discover-models', async (request) => {
    try {
      return await runtime.discover(request.body)
    } catch (err) {
      return { models: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  /** web form is pure BYOK: the UI hides the chatoffice profile + login card on this flag */
  app.get('/ai/capabilities', async () => ({
    chatofficeAvailable: false,
    harness: !!options.harness,
  }))

  // ── streaming (SSE with the desktop chunk shape) ───────────────────────
  app.post<{
    Body: {
      requestId: string
      settings: AiModelSelection
      system: string
      messages: unknown[]
      tools?: unknown[]
      maxTokens?: number
    }
  }>('/ai/stream', async (request, reply) => {
    const wire = request.body
    if (!wire?.requestId || !wire.settings?.profileId || !Array.isArray(wire.messages)) {
      return reply.code(400).send({ error: 'requestId, settings and messages are required' })
    }
    const controller = new AbortController()
    activeStreams.set(wire.requestId, controller)
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    const send = (chunk: unknown) => {
      if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`)
    }
    record({
      ts: new Date().toISOString(),
      channel: 'web',
      model: wire.settings.modelId,
      requestId: wire.requestId,
    })
    try {
      await runtime.runStream(
        {
          requestId: wire.requestId,
          selection: wire.settings,
          system: wire.system ?? '',
          messages: wire.messages as Parameters<AiRuntime['runStream']>[0]['messages'],
          tools: (wire.tools ?? []) as Parameters<AiRuntime['runStream']>[0]['tools'],
          ...(wire.maxTokens !== undefined ? { maxTokens: wire.maxTokens } : {}),
          signal: controller.signal,
        },
        send,
      )
    } finally {
      activeStreams.delete(wire.requestId)
      if (!reply.raw.writableEnded) reply.raw.end()
    }
  })

  app.post<{ Body: { requestId: string } }>('/ai/stream-cancel', async (request, _reply) => {
    activeStreams.get(request.body?.requestId)?.abort()
    return { ok: true }
  })

  // ── capability endpoints (mirrors of the desktop ai:* channels) ────────
  app.post<{ Body: { query: string; maxResults?: number } }>('/ai/web-search', async (request) => {
    try {
      return await webSearch(
        String(request.body?.query ?? ''),
        request.body?.maxResults ?? 6,
        false,
      )
    } catch (err) {
      return { results: [], method: 'error', error: String(err) }
    }
  })

  app.post<{ Body: { query: string; maxResults?: number } }>(
    '/ai/image-search',
    async (request) => {
      try {
        return await imageSearch(
          String(request.body?.query ?? ''),
          request.body?.maxResults ?? 8,
          false,
        )
      } catch (err) {
        return { images: [], method: 'error', error: String(err) }
      }
    },
  )

  app.post<{ Body: { url: string } }>('/ai/fetch-image', async (request) => {
    try {
      // AI-supplied URLs are prompt-injectable: fetchRemoteImage refuses
      // non-http schemes and private/link-local targets, validating redirects
      const resp = await fetchRemoteImage(String(request.body?.url ?? ''))
      if (!resp || !resp.ok) return null
      const buf = Buffer.from(await resp.arrayBuffer())
      const ct = resp.headers.get('content-type') ?? ''
      const mime = ct.includes('png')
        ? 'image/png'
        : ct.includes('gif')
          ? 'image/gif'
          : 'image/jpeg'
      return { base64: buf.toString('base64'), mime }
    } catch {
      return null
    }
  })

  app.post<{ Body: { prompt: string; aspectRatio?: string } }>(
    '/ai/generate-image',
    async (request) => {
      const prompt = String(request.body?.prompt ?? '').trim()
      if (!prompt) return { error: 'prompt must not be empty' }
      return runtime.generateImage({
        prompt,
        ...(request.body?.aspectRatio ? { aspectRatio: String(request.body.aspectRatio) } : {}),
      })
    },
  )

  app.get('/ai/chatoffice-status', async () => ({ loggedIn: false }))
  app.post('/ai/chatoffice-login', async () => ({
    ok: false,
    error: 'chatoffice login is desktop-only',
  }))

  // Metering read-back (ops/debug until the usage dashboard exists)
  app.get('/ai/usage', async () => ({ calls: records.length, records }))
}

export { KEEP_KEY }
