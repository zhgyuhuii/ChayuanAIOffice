import { join } from 'node:path'
import {
  createAiRuntime,
  createFileSource,
  createHarnessSource,
  resolveHarnessSecret,
  type AiModelSelection,
  type AiRuntime,
  type AiRuntimeChaOffice,
  type AiSettingsSource,
  type AiSettingsV2,
  type AiStreamChunk,
  type DiscoveryTarget,
  type FileSourceFs,
  type ChaOfficeAccountStatus,
} from '@chatoffice/ai-provider'
import {
  imageSearch,
  searchStockImages,
  StockSearchError,
  webSearch,
  type StockSource,
} from '@chatoffice/ai-search'
import { fetchRemoteImage } from '@chatoffice/electron-utils/remote-image'
import { CHATOP_LOCAL_AGENT_ID, CHATOP_LOCAL_PROFILE_ID, parseChatopProxyKey } from '@chatoffice/ai-provider'
import {
  createVideoTaskRegistry,
  type VideoTaskRegistry,
  type VideoTaskRegistryDeps,
} from './video-tasks'
import { localToolInstall, localToolStart, localToolStatus } from './local-tools'
import { persistGeneratedImage } from './media-ipc'
import { discoverDshHome, type DiscoveredDshHome } from './dsh-home'

export type { VideoTaskView, VideoSubmitRequest, VideoFileSink } from './video-tasks'
export { registerSharedKbIpc, type KbSourceState, type SharedKbIpcDeps } from './kb-ipc'
export { registerFetchImageIpc, registerMediaIpc, type MediaIpcDeps } from './media-ipc'
export { materializeUrl, persistGeneratedImage } from './media-ipc'
export {
  createLocalTools,
  defaultLocalToolDeps,
  localTools,
  type LocalToolDeps,
} from './local-tools'

/**
 * BYOK-only image generation for mains that host no shared ai:* registrar
 * (markdown / pdf): the per-app *:ai-generate-image channel wraps this instead
 * of going straight to the ChaOffice cloud. Resolution order matches the
 * registrar-backed editors (docs/sheets/slides): the settings default image
 * model (设置 → 生图、媒体与搜索); no cloud fallback exists.
 */
export function createByokImageHandler(deps: {
  settingsPath: () => string
  fs: FileSourceFs
  chatoffice: AiRuntimeChaOffice
}): (req: {
  prompt: string
  aspectRatio?: string
}) => Promise<{ url?: string; urls?: string[]; error?: string }> {
  const RUNTIME_ERRORS: Record<string, string> = {
    errNoModel: 'No usable model configured',
    errNoApiKey: 'Missing API key',
    errChaOfficeNotLoggedIn: 'Not signed in to ChaOffice',
    errNoImageModel: 'No image model configured (Settings → 生图、媒体与搜索)',
  }
  const runtime = createAiRuntime({
    source: createFileSource(deps.settingsPath(), deps.fs),
    chatoffice: deps.chatoffice,
    translate: (key, params) => {
      const base = RUNTIME_ERRORS[key] ?? key
      return params && typeof params.provider === 'string' ? `${base}: ${params.provider}` : base
    },
  })
  // Generated images come back as data: URLs (most BYOK APIs answer b64) or
  // remote CDN links; the editors' insert pipelines fetch through
  // fetchRemoteImage, which accepts neither. Materialize into the
  // generated-image store so the returned file:// URL is insertable everywhere.
  return async (req): Promise<{ url?: string; urls?: string[]; error?: string }> => {
    const result = await runtime.generateImage(req)
    if (!result.url) {
      const { url, urls, error } = result
      return {
        ...(url !== undefined ? { url } : {}),
        ...(urls !== undefined ? { urls } : {}),
        ...(error !== undefined ? { error } : {}),
      }
    }
    try {
      const url = await persistGeneratedImage(result.url)
      const urls = result.urls?.map((u) => (u === result.url ? url : u))
      return { url, ...(urls !== undefined ? { urls } : {}) }
    } catch (e) {
      // store failure must not mask the generation itself
      return { url: result.url, error: e instanceof Error ? e.message : String(e) }
    }
  }
}

/**
 * Shared registration of the generic ai:* IPC channels — identical channel
 * names in every editor main process (docs registers them for the shell
 * aggregate; sheets/slides register them standalone). Electron's ipcMain is
 * injected structurally so this package stays dependency-light; per-app
 * channels (search, per-app image generation) stay in the apps.
 */

/** structural slice of Electron.IpcMain this module needs (methods are bivariant, so the real IpcMain slots in) */
export interface IpcMainLike {
  handle(channel: string, listener: (event: any, ...args: any[]) => any): unknown
}

/** the sender half of an invoke event, as far as the stream loop cares */
export interface StreamEventLike {
  sender: { isDestroyed(): boolean; send(channel: string, ...data: unknown[]): void }
}

/** download an https/data URL → base64 + mime (SSRF-guarded, retried); null when unreachable */
async function downloadAsDataUrl(url: string): Promise<{ base64: string; mime: string } | null> {
  try {
    const resp = await fetchRemoteImage(String(url))
    if (!resp || !resp.ok) return null
    const buf = Buffer.from(await resp.arrayBuffer())
    const ct = resp.headers.get('content-type') ?? ''
    const mime = ct.includes('png')
      ? 'image/png'
      : ct.includes('gif')
        ? 'image/gif'
        : ct.includes('webp')
          ? 'image/webp'
          : 'image/jpeg'
    return { base64: buf.toString('base64'), mime }
  } catch {
    return null
  }
}

export interface SharedAiIpcDeps {
  ipcMain: IpcMainLike
  /** absolute path of ai-settings.json in the app's userData */
  settingsPath: string
  /** injected Node fs (atomic write + watch live in the app) */
  fs: FileSourceFs
  chatoffice: AiRuntimeChaOffice
  /** opens the chatoffice device-code login flow (app closes over shell.openExternal) */
  chatofficeLogin: () => void
  translate: (key: string, params?: Record<string, unknown>) => string
  /** video task registry wiring (absent = ai:video-* channels stay unregistered) */
  videoTasks?: VideoTaskRegistryDeps
  /** LOCAL(8b6e6e88/自动识别): explicit pin of the 察元 dsh home. Absent (the
   *  normal desktop case) = auto-discovery across the known install shapes
   *  (env pins, ~/.chatop, ~/.dsh, per-user chatop-data roots; a live model
   *  proxy outranks stale siblings) — see ./dsh-home.ts. When a home is found
   *  the office fuses the harness's models read-only: the chatop-local group
   *  (model proxy, managed virtual key) and any llm-pi-ai vendor routes
   *  (credentials resolved from .credentials.yaml at call time) appear with
   *  zero key entry on this side; no home = legacy pure-BYOK behavior */
  dshHome?: string | undefined
}

export interface AiStreamWireRequest {
  requestId: string
  /** carries the model selection (agent-core's generic transport slot) */
  settings: AiModelSelection
  system: string
  messages: Parameters<AiRuntime['runStream']>[0]['messages']
  tools?: Parameters<AiRuntime['runStream']>[0]['tools']
  maxTokens?: number
}

/**
 * Register ai:get-settings / ai:set-settings / ai:set-current-model /
 * ai:discover-models / ai:stream(+-cancel,-chunk) / ai:chatoffice-status /
 * ai:chatoffice-login. (ai:chat and per-app channels stay in the apps.) Returns the
 * runtime so per-app handlers can reuse the same resolution.
 */
export type { AiModelSelection, AiRuntime } from '@chatoffice/ai-provider'

export function registerSharedAiIpc(deps: SharedAiIpcDeps): AiRuntime {
  const { ipcMain, chatoffice, translate } = deps

  const fileSource = createFileSource(deps.settingsPath, deps.fs)

  // ── 察元 harness 自动识别（自动发现 dsh home → 只读融合 + 托管代理 key）────
  // 桌面端与 harness 共居一机:发现 home 后 (1) 模型列表融合 harness 的本地
  // 模型组(chatop-local,经模型代理)与 llm-pi-ai 厂商路由(密钥调用时从
  // .credentials.yaml 解析),用户零配置即可用 harness 配置的模型;(2) 任何指向
  // 模型代理的 profile(含用户手建、粘过已吊销虚拟 key 的)统一改用托管虚拟 key
  // ——从 proxy-keys.json 取活 key,缺席经回环管理面签发,401 自愈。
  let dshHomeInfo: DiscoveredDshHome | null | undefined
  let dshHomePromise: Promise<DiscoveredDshHome | null> | undefined
  /** a settings source that starts as the office file and upgrades to harness
   *  fusion once discovery settles (reads racing the swap see the raw file) */
  let activeSource: AiSettingsSource = fileSource
  const source: AiSettingsSource = {
    read: () => activeSource.read(),
    write: (next) => activeSource.write(next),
  }
  const ensureDshHome = (): Promise<DiscoveredDshHome | null> => {
    if (dshHomeInfo !== undefined) return Promise.resolve(dshHomeInfo)
    dshHomePromise ??= (async () => {
      let info: DiscoveredDshHome | null
      if (deps.dshHome) {
        const proxyPort = await deps.fs
          .readFile(join(deps.dshHome, 'storages', 'chatop-models', 'state.json'))
          .then((t) => {
            const port = (JSON.parse(t) as { proxyPort?: unknown }).proxyPort
            return typeof port === 'number' && port > 0 ? port : null
          })
          .catch(() => null)
        info = { home: deps.dshHome, proxyPort, proxyLive: false }
      } else {
        info = (await discoverDshHome()) ?? null
      }
      dshHomeInfo = info
      if (info) {
        // upgrade the settings source to read-only harness fusion; the office
        // file stays the sidecar (selections, chatoffice profiles, custom BYOK)
        const home = info.home
        activeSource = createHarnessSource({
          readDshFile: (rel) => deps.fs.readFile(join(home, rel)),
          officeStateSource: fileSource,
        })
      }
      return info
    })()
    return dshHomePromise
  }
  // warm the discovery at registration so the first settings read usually
  // already carries the fused harness groups
  void ensureDshHome()

  // LOCAL(8b6e6e88 桌面补齐 + 自动识别自愈): chatop-local 走模型代理虚拟 key(与
  // server 形态同款,见 apps/server/src/ai-proxy.ts chatopLocalKey)。桌面端此前缺
  // 这环——key 被外部重新签发吊销后,设置里存的旧 key 直接 401 invalid_api_key
  // 且无法自愈。现在:proxy-keys.json 的活 key 先经 /v1/models 验证再用(60s 正向
  // 缓存);被代理拒收(服务重启丢内存态/同 agentId 他处重签)则记毒 60s 并转回环
  // 管理面签发新 key——用户全程无感,无需任何手工签发。
  let cachedLocalKey = ''
  let cachedLocalKeyAt = 0
  let cachedLocalKeyOkAt = 0
  const poisonedFileKeys = new Map<string, number>()
  const keyAccepted = async (origin: string, key: string): Promise<boolean> => {
    try {
      const resp = await fetch(`${origin}/v1/models`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(2_000),
      })
      if (resp.ok) return true
      // the proxy authenticates before routing: only an auth verdict rejects
      // the key — a 404 (route missing) or 5xx means the key itself passed
      return resp.status !== 401 && resp.status !== 403
    } catch {
      // probe unreachable: keep the candidate (the call itself will surface
      // any real failure with the proxy's own error text)
      return true
    }
  }
  const chatopLocalSecret = async (home: string, proxyOrigin: string): Promise<string> => {
    const keysPath = join(home, 'storages', 'chatop-models', 'proxy-keys.json')
    const live = await (deps.fs.readFile(keysPath))
      .then(parseChatopProxyKey)
      .catch(() => null)
    if (live) {
      const poisonedUntil = poisonedFileKeys.get(live) ?? 0
      if (Date.now() < poisonedUntil) {
        // known-rejected by the live service — go straight to reissue
      } else if (cachedLocalKey === live && Date.now() - cachedLocalKeyOkAt < 60_000) {
        return live
      } else if (await keyAccepted(proxyOrigin, live)) {
        cachedLocalKey = live
        cachedLocalKeyAt = Date.now()
        cachedLocalKeyOkAt = Date.now()
        return live
      } else {
        poisonedFileKeys.set(live, Date.now() + 60_000)
      }
    }
    if (cachedLocalKey && Date.now() - cachedLocalKeyAt < 10_000) return cachedLocalKey
    const state = await deps.fs
      .readFile(join(home, 'storages', 'chatop-models', 'state.json'))
      .then((t) => JSON.parse(t) as { managementPort?: number })
      .catch(() => null)
    const origin = state?.managementPort ? `http://127.0.0.1:${state.managementPort}` : 'http://127.0.0.1:52601'
    const response = await fetch(`${origin}/api/chatop-models/proxy/keys/issue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: CHATOP_LOCAL_AGENT_ID }),
    })
    if (!response.ok) throw new Error(`chatop-models key issue failed: HTTP ${response.status}`)
    const doc = (await response.json()) as { key?: string }
    if (!doc?.key) throw new Error('chatop-models key issue returned no key')
    cachedLocalKey = doc.key
    cachedLocalKeyAt = Date.now()
    cachedLocalKeyOkAt = Date.now()
    return cachedLocalKey
  }

  /** does a profile's baseUrl point at the local model proxy on this port? */
  const proxyOriginOf = (baseUrl: string | undefined, port: number | null): string | null => {
    if (!baseUrl || port === null) return null
    try {
      const url = new URL(baseUrl)
      if (
        (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
        Number(url.port || (url.protocol === 'https:' ? 443 : 80)) === port
      ) {
        return `${url.protocol}//${url.host}`
      }
      return null
    } catch {
      return null
    }
  }

  const runtime = createAiRuntime({
    source,
    chatoffice,
    translate,
    resolveSecret: async (profile) => {
      const info = await ensureDshHome()
      if (!info) return ''
      // profiles targeting the model proxy (the synthetic chatop-local group
      // AND user-built ones at the same endpoint) run on the managed virtual
      // key — a pasted key that the proxy has since revoked is overridden,
      // which is what heals the desktop 401 invalid_api_key incidents
      const proxyOrigin = proxyOriginOf(profile.baseUrl, info.proxyPort)
      if (proxyOrigin) return chatopLocalSecret(info.home, proxyOrigin)
      // harness vendor routes keep their credential-ref resolution
      if (profile.apiKeyRef && profile.id !== CHATOP_LOCAL_PROFILE_ID) {
        return resolveHarnessSecret(
          profile,
          (rel) => deps.fs.readFile(join(info.home, rel)),
        )
      }
      return ''
    },
  })

  const activeStreams = new Map<string, AbortController>()

  ipcMain.handle('ai:get-settings', (): Promise<AiSettingsV2> => runtime.getSettingsView())

  ipcMain.handle(
    'ai:chatoffice-status',
    async (_event, withEmail?: boolean): Promise<ChaOfficeAccountStatus> =>
      chatoffice.status(!!withEmail),
  )

  ipcMain.handle('ai:chatoffice-login', () => {
    deps.chatofficeLogin()
  })

  // the settings view carries KEEP_KEY sentinels; the runtime merges stored keys back
  ipcMain.handle('ai:set-settings', (_event, view: AiSettingsV2) => runtime.saveSettings(view))

  ipcMain.handle('ai:set-current-model', (_event, selection: AiModelSelection) =>
    runtime.setCurrentModel(selection),
  )

  // model discovery for the settings page; a successful list doubles as the connection test
  ipcMain.handle('ai:discover-models', async (_event, target: DiscoveryTarget) => {
    try {
      return await runtime.discover(target)
    } catch (err) {
      return { models: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  // preload-side discovery needs the stored key (the renderer only holds KEEP_KEY sentinels)
  ipcMain.handle('ai:resolve-profile-key', (_event, profileId: string) =>
    runtime.resolveProfileApiKey(String(profileId)),
  )

  // ── 本地与自建：一键安装/探测/启动（spec 表见 local-tools.ts） ──────────
  ipcMain.handle('ai:local-tool-status', (_event, vendorId: string) =>
    localToolStatus(String(vendorId)),
  )
  ipcMain.handle('ai:local-tool-install', (event, vendorId: string) => {
    const sender = (event as StreamEventLike).sender
    const onLine = (line: string) => {
      if (!sender.isDestroyed()) sender.send('ai:local-tool-progress', String(vendorId), line)
    }
    return localToolInstall(String(vendorId), onLine)
  })
  ipcMain.handle('ai:local-tool-start', (_event, vendorId: string) =>
    localToolStart(String(vendorId)),
  )

  ipcMain.handle('ai:stream', async (event, wireRequest: AiStreamWireRequest) => {
    const streamEvent = event as StreamEventLike
    const { requestId, settings: selection } = wireRequest
    const controller = new AbortController()
    activeStreams.set(requestId, controller)
    const send = (chunk: AiStreamChunk) => {
      if (!streamEvent.sender.isDestroyed()) {
        streamEvent.sender.send('ai:stream-chunk', chunk)
      }
    }
    try {
      await runtime.runStream(
        {
          requestId,
          selection,
          system: wireRequest.system,
          messages: wireRequest.messages,
          tools: wireRequest.tools ?? [],
          ...(wireRequest.maxTokens !== undefined ? { maxTokens: wireRequest.maxTokens } : {}),
          signal: controller.signal,
        },
        send,
      )
    } finally {
      activeStreams.delete(requestId)
    }
  })

  ipcMain.handle('ai:stream-cancel', (_event, requestId: string) => {
    activeStreams.get(requestId)?.abort()
  })

  // ── picture-source channels (insert-image dialog) ────────────────────
  // Web image search: per-platform pick or fallback chain (chatoffice →
  // Serper → Bing → Openverse), per-tier attempts attached for the dialog's
  // diagnostics. Keys resolve main-side from ai-settings (search.providers,
  // legacy searchApiKeys) then env. Results map to the dialog's WebImageItem
  // wire shape here — ai-search speaks imageUrl/thumbnail; the gallery
  // renders thumbnail||full and inserts full.
  ipcMain.handle(
    'ai:web-image-search',
    async (_event, query: string, maxResults?: number, page?: number, source?: string) => {
      try {
        const settings = await runtime.readRawSettings()
        const searchProviders = settings.search?.providers as
          Record<string, { apiKey?: string } | undefined> | undefined
        const serperKey =
          searchProviders?.serper?.apiKey ||
          settings.searchApiKeys?.serper ||
          process.env.SERPER_API_KEY ||
          undefined
        const only =
          source === 'serper' || source === 'bing' || source === 'openverse' ? source : undefined
        const r = await imageSearch(
          String(query),
          typeof maxResults === 'number' ? maxResults : 20,
          true,
          serperKey,
          typeof page === 'number' && page > 1 ? Math.floor(page) : 1,
          only,
        )
        return {
          ...r,
          images: r.images.map((img) => ({
            thumbnail: img.thumbnail ?? img.imageUrl,
            full: img.imageUrl,
            ...(typeof img.width === 'number' ? { width: img.width } : {}),
            ...(typeof img.height === 'number' ? { height: img.height } : {}),
            ...(img.attribution ? { attribution: img.attribution } : {}),
          })),
        }
      } catch (err) {
        return { images: [], method: 'error', error: String(err), attempts: [] }
      }
    },
  )
  // Enabled image/video-generation models + their param specs (model picker list)
  ipcMain.handle('ai:media-models', async () => {
    try {
      return { models: await runtime.listMediaModels() }
    } catch (err) {
      return { models: [], error: String(err) }
    }
  })
  // Media generation: model selection + dynamic params, result URLs downloaded
  // main-side so the renderer only ever sees data: URLs
  ipcMain.handle(
    'ai:media-generate',
    async (
      _event,
      req: {
        profileId?: string
        modelId?: string
        prompt: string
        params?: Record<string, unknown>
      },
    ): Promise<{ images?: { dataUrl: string }[]; error?: string }> => {
      try {
        const model =
          req.profileId && req.modelId
            ? { profileId: req.profileId, modelId: req.modelId }
            : undefined
        const r = await runtime.generateImage({
          prompt: String(req.prompt ?? ''),
          ...(req.params ? { params: req.params } : {}),
          ...(model ? { model } : {}),
        })
        if (r.error) return { error: r.error }
        const urls = r.urls ?? (r.url ? [r.url] : [])
        const images: { dataUrl: string }[] = []
        for (const url of urls) {
          const media = await downloadAsDataUrl(url)
          if (media) images.push({ dataUrl: `data:${media.mime};base64,${media.base64}` })
        }
        if (!images.length) return { error: r.error ?? 'image download failed' }
        return { images }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )
  // Stock libraries (Pexels/Pixabay/Unsplash): keys resolve main-side from ai-settings
  ipcMain.handle(
    'ai:stock-image-search',
    async (
      _event,
      req: { source: string; query: string; maxResults?: number; page?: number },
    ): Promise<{ images: unknown[]; source: string; error?: string; code?: string }> => {
      try {
        const settings = await runtime.readRawSettings()
        const source = String(req.source) as StockSource
        const stock = settings.stockApiKeys ?? {}
        const key =
          source === 'pexels'
            ? (stock.pexels ?? '')
            : source === 'pixabay'
              ? (stock.pixabay ?? '')
              : (stock.unsplash ?? '')
        const images = await searchStockImages(
          source,
          key,
          String(req.query),
          typeof req.maxResults === 'number' ? req.maxResults : 20,
          typeof req.page === 'number' && req.page > 1 ? Math.floor(req.page) : 1,
        )
        return { images, source }
      } catch (err) {
        const code = err instanceof StockSearchError ? err.code : 'network'
        return { images: [], source: String(req.source), error: String(err), code }
      }
    },
  )
  // Stock key management: renderer sees KEEP_KEY sentinels only
  ipcMain.handle('ai:stock-keys-get', async () => {
    const settings = await runtime.readRawSettings()
    return {
      pexels: settings.stockApiKeys?.pexels ? '__keep__' : '',
      pixabay: settings.stockApiKeys?.pixabay ? '__keep__' : '',
      unsplash: settings.stockApiKeys?.unsplash ? '__keep__' : '',
    }
  })
  ipcMain.handle(
    'ai:stock-keys-set',
    async (_event, keys: { pexels?: string; pixabay?: string; unsplash?: string }) => {
      const settings = await runtime.readRawSettings()
      const stored = settings.stockApiKeys ?? {}
      const keepOr = (next: string | undefined, prev: string | undefined): string =>
        next === '__keep__' ? (prev ?? '') : next !== undefined ? next : (prev ?? '')
      const next = {
        pexels: keepOr(keys.pexels, stored.pexels),
        pixabay: keepOr(keys.pixabay, stored.pixabay),
        unsplash: keepOr(keys.unsplash, stored.unsplash),
      }
      await runtime.writeSettings({ ...settings, stockApiKeys: next })
      return true
    },
  )
  // Download an image URL → base64 (CORS-free, SSRF-guarded, retried)
  ipcMain.handle('ai:remote-image', (_event, url: string) => downloadAsDataUrl(String(url)))

  // One-shot SVG illustration on the svgGeneration default (or explicit)
  // chat model — the insert-media dialog's AI → SVG line
  ipcMain.handle(
    'ai:generate-svg',
    (_event, req: { profileId?: string; modelId?: string; prompt: string }) =>
      runtime.generateSvg(req),
  )

  // Search-platform connectivity probe for the 生图、媒体与搜索 settings page:
  // web platforms run a minimal web query on THAT platform only; stock
  // libraries run a minimal photo query. The passed key wins over the stored
  // one so a freshly typed key can be tested before saving.
  ipcMain.handle(
    'ai:test-search-platform',
    async (
      _event,
      req: { platform: string; key?: string },
    ): Promise<{ ok: boolean; detail?: string }> => {
      const id = String(req.platform)
      try {
        const settings = await runtime.readRawSettings()
        if (id === 'pexels' || id === 'pixabay' || id === 'unsplash') {
          const stored = settings.stockApiKeys?.[id] ?? ''
          const key = req.key?.trim() || stored
          const images = await searchStockImages(id, key, 'test', 1)
          return { ok: images.length > 0 }
        }
        const providers = settings.search?.providers as
          Record<string, { apiKey?: string } | undefined> | undefined
        const storedKey = (providers?.[id]?.apiKey ?? '').trim()
        const key = req.key?.trim() || storedKey
        if (id === 'serper') {
          const r = await webSearch('test', 1, false, { serper: key }, 'serper')
          if (r.error) return { ok: false, detail: r.error }
          return { ok: r.method === 'serper' }
        }
        if (id === 'tavily') {
          const r = await webSearch('test', 1, false, { tavily: key }, 'tavily')
          if (r.error) return { ok: false, detail: r.error }
          return { ok: r.method === 'tavily' }
        }
        if (id === 'linkup') {
          const r = await webSearch('test', 1, false, { linkup: key }, 'linkup')
          if (r.error) return { ok: false, detail: r.error }
          return { ok: r.method === 'linkup' }
        }
        if (id === 'searxng') {
          const r = await webSearch('test', 1, false, { searxngBaseUrl: key }, 'searxng')
          if (r.error) return { ok: false, detail: r.error }
          return { ok: r.method === 'searxng' }
        }
        if (id === 'duckduckgo') {
          const r = await webSearch('test', 1, false, {}, 'duckduckgo')
          if (r.error) return { ok: false, detail: r.error }
          return { ok: r.method === 'duckduckgo' }
        }
        if (id === 'bing') {
          const r = await imageSearch('test', 1, false, undefined, 1, 'bing')
          if (r.error) return { ok: false, detail: r.error }
          return { ok: r.images.length > 0 }
        }
        return { ok: false, detail: `unknown platform: ${id}` }
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // ── video task channels (insert-media dialog AI tab, video models) ─────
  // submit returns immediately; the poll loop lives in this process and the
  // renderer hears 'ai:video-tasks-changed' on every state transition.
  let videoRegistry: VideoTaskRegistry | undefined
  if (deps.videoTasks) {
    videoRegistry = createVideoTaskRegistry({
      ...deps.videoTasks,
      downloadPoster: deps.videoTasks.downloadPoster ?? downloadAsDataUrl,
    })
    ipcMain.handle(
      'ai:video-submit',
      (
        _event,
        req: {
          profileId: string
          modelId: string
          label?: string
          prompt: string
          params?: Record<string, unknown>
          imageUrl?: string
        },
      ) => videoRegistry!.submit(req),
    )
    ipcMain.handle('ai:video-tasks', () => videoRegistry!.list())
    ipcMain.handle('ai:video-cancel', (_event, id: string) => videoRegistry!.cancel(String(id)))
    ipcMain.handle('ai:video-retry', (_event, id: string) => videoRegistry!.retry(String(id)))
    ipcMain.handle('ai:video-preview', (_event, id: string) => videoRegistry!.preview(String(id)))
  }

  return runtime
}
