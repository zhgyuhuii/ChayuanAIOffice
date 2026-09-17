import {
  createAiRuntime,
  createFileSource,
  type AiModelSelection,
  type AiRuntime,
  type AiRuntimeChatOffice,
  type AiSettingsV2,
  type AiStreamChunk,
  type DiscoveryTarget,
  type FileSourceFs,
  type ChatOfficeAccountStatus,
} from '@chatoffice/ai-provider'
import {
  imageSearch,
  searchStockImages,
  StockSearchError,
  webSearch,
  type StockSource,
} from '@chatoffice/ai-search'
import { fetchRemoteImage } from '@chatoffice/electron-utils/remote-image'
import {
  createVideoTaskRegistry,
  type VideoTaskRegistry,
  type VideoTaskRegistryDeps,
} from './video-tasks'
import { localToolInstall, localToolStart, localToolStatus } from './local-tools'

export type { VideoTaskView, VideoSubmitRequest, VideoFileSink } from './video-tasks'
export { registerSharedKbIpc, type KbSourceState, type SharedKbIpcDeps } from './kb-ipc'
export {
  createLocalTools,
  defaultLocalToolDeps,
  localTools,
  type LocalToolDeps,
} from './local-tools'

/**
 * BYOK-first image generation for mains that host no shared ai:* registrar
 * (markdown / pdf): the per-app *:ai-generate-image channel wraps this instead
 * of going straight to the ChatOffice cloud. Resolution order matches the
 * registrar-backed editors (docs/sheets/slides): the settings default image
 * model (设置 → 生图、媒体与搜索), then the injected chatoffice backend whose
 * login/cloud gates live in its generateImage.
 */
export function createByokImageHandler(deps: {
  settingsPath: () => string
  fs: FileSourceFs
  chatoffice: AiRuntimeChatOffice
}): (req: {
  prompt: string
  aspectRatio?: string
}) => Promise<{ url?: string; urls?: string[]; error?: string }> {
  const RUNTIME_ERRORS: Record<string, string> = {
    errNoModel: 'No usable model configured',
    errNoApiKey: 'Missing API key',
    errChatOfficeNotLoggedIn: 'Not signed in to ChatOffice',
    errNoImageModel: 'No image model configured and not signed in to ChatOffice',
  }
  const runtime = createAiRuntime({
    source: createFileSource(deps.settingsPath(), deps.fs),
    chatoffice: deps.chatoffice,
    translate: (key, params) => {
      const base = RUNTIME_ERRORS[key] ?? key
      return params && typeof params.provider === 'string' ? `${base}: ${params.provider}` : base
    },
  })
  return (req) => runtime.generateImage(req)
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
  chatoffice: AiRuntimeChatOffice
  /** opens the chatoffice device-code login flow (app closes over shell.openExternal) */
  chatofficeLogin: () => void
  translate: (key: string, params?: Record<string, unknown>) => string
  /** video task registry wiring (absent = ai:video-* channels stay unregistered) */
  videoTasks?: VideoTaskRegistryDeps
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
export function registerSharedAiIpc(deps: SharedAiIpcDeps): AiRuntime {
  const { ipcMain, chatoffice, translate } = deps

  const runtime = createAiRuntime({
    source: createFileSource(deps.settingsPath, deps.fs),
    chatoffice,
    translate,
  })

  const activeStreams = new Map<string, AbortController>()

  ipcMain.handle('ai:get-settings', (): Promise<AiSettingsV2> => runtime.getSettingsView())

  ipcMain.handle(
    'ai:chatoffice-status',
    async (_event, withEmail?: boolean): Promise<ChatOfficeAccountStatus> =>
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
