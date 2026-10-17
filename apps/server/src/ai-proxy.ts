/**
 * AI endpoints for the web/embedded forms (plan v2.2):
 *
 * The BFF owns the v2 settings (server-side file under the data dir, or the
 * dsh harness's llm-pi-ai namespace in the plugin form) and resolves every
 * provider call itself — keys never reach the browser. Streaming is SSE with
 * the same chunk shape the desktop mains push over IPC, so the web shims can
 * forward chunks into the editors unchanged.
 *
 * chaoffice login is desktop-only: the web form is pure BYOK (capabilities flags it)
 * and the chaoffice profile stays hidden in the settings UI.
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
  resolveMediaCapability,
  type AiModelSelection,
  type AiProviderProfile,
  type AiRuntime,
  type AiSettingsV2,
  type DiscoveryTarget,
} from '@chaoffice/ai-provider'
import { fetchRemoteImage } from '@chaoffice/electron-utils/remote-image'
import { imageSearch, webSearch } from '@chaoffice/ai-search'

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
  errChaOfficeNotLoggedIn: 'Web 端不支持 察元AIOffice 登录，请使用自己配置的模型',
  errNoApiKey: '未配置 {provider} 的 API Key',
  errNoModel: '未配置模型',
  errNoImageModel: '未配置生图模型：请在模型设置中启用生图模型',
}

/** harness-fused secret resolution shared by the runtime and the capability probe */
type SecretResolver = (profile: AiProviderProfile) => Promise<string>

function buildRuntime(options: AiProxyOptions): { runtime: AiRuntime; mediaResolveSecret?: SecretResolver } {
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
    const response = await fetch(`${rpcOriginBase(origin)}/api/chatop-models/proxy/keys/issue`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(await dshRpcHeaders(origin)),
      },
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
          // dsh 0.1.5+/rc 网关协议：端点与信封 method 用斜杠形式
          // （settings.mutate → settings/mutate，点形式 404），payload 必须
          // {args: {...}} 单字段包裹 —— 与 chatop web 客户端 harness-rpc.js
          // 的适配同款。the web face authenticates /api/ by browser cookie; a
          // 401 invalidates the cached exchange (process restart rotates the
          // launch token) and the call retries once with a fresh cookie
          const wire = method.replace('.', '/')
          const call = async (fresh = false): Promise<Response> => {
            const response = await fetch(`${rpcOriginBase(origin)}/api/${wire}`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                ...(await dshRpcHeaders(origin, fresh)),
              },
              body: JSON.stringify({
                type: 'client-request',
                rpcId: crypto.randomUUID(),
                method: wire,
                payload: { args: payload ?? {} },
              }),
            })
            if (response.status === 401) {
              invalidateDshRpcCookie()
              return call(true)
            }
            return response
          }
          const response = await call()
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
  // harness form: profiles carry apiKeyRef only — resolve the referenced
  // credential at call time (rotations apply on the next request; the secret
  // never enters settings views). The synthetic chatop-local profile
  // resolves to a model-proxy virtual key instead of the credentials file.
  const mediaResolveSecret: SecretResolver | undefined = options.harness
    ? (profile) =>
        profile.id === CHATOP_LOCAL_PROFILE_ID
          ? chatopLocalKey(options.harness!)
          : resolveHarnessSecret(profile, readDshFile)
    : undefined
  const runtime = createAiRuntime({
    source,
    ...(mediaResolveSecret ? { resolveSecret: mediaResolveSecret } : {}),
    // chaoffice login is desktop-only; the web form is pure BYOK
    chaoffice: {
      apiKey: () => '',
      hasAuth: () => false,
      status: async () => ({ loggedIn: false }),
    },
    translate: (key, params) =>
      (ERR as Record<string, string>)[key]?.replace(/\{(\w+)\}/g, (_, k) =>
        String(params?.[k] ?? ''),
      ) ?? key,
  })
  return { runtime, ...(mediaResolveSecret ? { mediaResolveSecret } : {}) }
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

/** the API base of a resolved rpc origin — the file may carry the process
 *  launch token as a query (?token=…, minted by the plugin host via
 *  connection.authenticatedUrl) which never belongs on an /api/ URL */
export function rpcOriginBase(origin: string): string {
  return origin.split('?')[0]!.replace(/\/$/, '')
}

/** vendor image answers are data: URLs or remote links — one retry rides out
 *  transient OSS hiccups, misses return null so the caller can try the rest */
async function urlAsDataUrl(url: string): Promise<{ base64: string; mime: string } | null> {
  if (url.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(url)
    return match ? { base64: match[2]!, mime: match[1]! } : null
  }
  if (!/^https?:\/\//i.test(url)) return null
  let resp = await fetch(url)
  if (!resp.ok) resp = await fetch(url)
  if (!resp.ok) return null
  const bytes = new Uint8Array(await resp.arrayBuffer())
  const ct = resp.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  const sniff =
    bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8
      ? 'image/jpeg'
      : bytes.length > 12 && bytes[0] === 0x89 && bytes[1] === 0x50
        ? 'image/png'
        : 'image/png'
  return { base64: Buffer.from(bytes).toString('base64'), mime: ct ?? sniff }
}

let cachedDshCookie = ''
let cachedDshCookieAt = 0

export function invalidateDshRpcCookie(): void {
  cachedDshCookie = ''
  cachedDshCookieAt = 0
}

/**
 * dsh's web face authenticates /api/ through a browser cookie; the launch
 * token carried in the origin file is exchanged once at `GET /?token=…`
 * (dsh answers 303 + Set-Cookie dsh-auth-<authority>). Server-side callers
 * keep the exchanged cookie cached; a stale cookie (rotated process) is
 * dropped by invalidateDshRpcCookie and re-exchanged on demand.
 */
async function dshRpcHeaders(origin: string, fresh = false): Promise<Record<string, string>> {
  const token = new URL(origin).searchParams.get('token')
  if (!token) return {}
  if (
    !fresh &&
    cachedDshCookie &&
    Date.now() - cachedDshCookieAt < 10 * 60_000
  )
    return { cookie: cachedDshCookie }
  const response = await fetch(`${rpcOriginBase(origin)}/?token=${encodeURIComponent(token)}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(5_000),
  })
  const setCookie = response.headers.get('set-cookie')
  const pair = setCookie?.split(';')[0]
  if (!pair) throw new Error('dsh token exchange returned no session cookie')
  cachedDshCookie = pair
  cachedDshCookieAt = Date.now()
  return { cookie: cachedDshCookie }
}

const activeStreams = new Map<string, AbortController>()

export function attachAiProxy(app: FastifyInstance, options: AiProxyOptions): void {
  const { runtime, mediaResolveSecret } = buildRuntime(options)
  const records: AiCallRecord[] = []
  const record = (r: AiCallRecord) => {
    records.push(r)
    if (records.length > 1000) records.shift()
    options.onCall?.(r)
  }

  // ── settings ───────────────────────────────────────────────────────────
  // web form: the chaoffice-login profile can never authenticate here — filter it
  // from the view so the UI never offers it
  app.get('/ai/settings', async () => {
    const view = await runtime.getSettingsView()
    const profiles = view.profiles.filter((p) => p.auth !== 'chaoffice-login')
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

  // ── media channels (web/dsh form parity with the desktop ai:media-* IPC) ──
  // image generation rides runtime.generateImage (settings defaults → chain
  // fallback, harness apiKeyRef resolved server-side); vendor answers data:
  // URLs or remote links, materialized to data URLs so the renderer history
  // and the generated-image pipelines see one shape
  app.post<{
    Body: { profileId?: string; modelId?: string; prompt?: string; params?: Record<string, unknown> }
  }>('/ai/media/generate', async (request) => {
    const req = request.body ?? {}
    const prompt = String(req.prompt ?? '').trim()
    if (!prompt) return { error: 'prompt must not be empty' }
    try {
      const model =
        req.profileId && req.modelId
          ? { profileId: String(req.profileId), modelId: String(req.modelId) }
          : undefined
      const r = await runtime.generateImage({
        prompt,
        ...(req.params ? { params: req.params } : {}),
        ...(model ? { model } : {}),
      })
      if (r.error) return { error: r.error }
      const urls = r.urls ?? (r.url ? [r.url] : [])
      const images: { dataUrl: string }[] = []
      for (const url of urls) {
        const media = await urlAsDataUrl(url)
        if (media) images.push({ dataUrl: `data:${media.mime};base64,${media.base64}` })
      }
      return images.length ? { images } : { error: 'image download failed' }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  app.get('/ai/media/capabilities', async () => {
    try {
      const settings = await runtime.readRawSettings()
      const kinds = ['image', 'video', 'imageUnderstanding', 'videoUnderstanding', 'tts', 'asr'] as const
      const flags: Record<string, boolean> = {}
      const models: Record<string, string> = {}
      for (const kind of kinds) {
        const call = await resolveMediaCapability(settings, kind, {
          resolveSecret: mediaResolveSecret
            ? async (profileId: string): Promise<string | null> => {
                const profile = settings.profiles.find((p) => p.id === profileId)
                if (!profile) return null
                return mediaResolveSecret(profile)
              }
            : async () => null,
        })
        flags[kind] = !!call
        if (call) models[kind] = call.model
      }
      return { flags, models }
    } catch (e) {
      return { flags: {}, models: {}, error: e instanceof Error ? e.message : String(e) }
    }
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

  /** web form is pure BYOK: the UI hides the chaoffice profile + login card on this flag */
  app.get('/ai/capabilities', async () => ({
    chaofficeAvailable: false,
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

  app.get('/ai/chaoffice-status', async () => ({ loggedIn: false }))
  app.post('/ai/chaoffice-login', async () => ({
    ok: false,
    error: 'chaoffice login is desktop-only',
  }))

  // Metering read-back (ops/debug until the usage dashboard exists)
  app.get('/ai/usage', async () => ({ calls: records.length, records }))
}

export { KEEP_KEY }
