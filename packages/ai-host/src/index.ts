import {
  createAiRuntime,
  createFileSource,
  type AiModelSelection,
  type AiRuntime,
  type AiRuntimeGsk,
  type AiSettingsV2,
  type AiStreamChunk,
  type DiscoveryTarget,
  type FileSourceFs,
  type GenSparkAccountStatus,
} from '@chatoffice/ai-provider'
import {
  imageSearch,
  searchStockImages,
  StockSearchError,
  type StockSource,
} from '@chatoffice/ai-search'
import { fetchRemoteImage } from '@chatoffice/electron-utils/remote-image'

/**
 * Shared registration of the generic ai:* IPC channels — identical channel
 * names in every editor main process (docs registers them for the shell
 * aggregate; sheets/slides register them standalone). Electron's ipcMain is
 * injected structurally so this package stays dependency-light; per-app
 * channels (search, per-app image generation) stay in the apps.
 */

/** structural slice of Electron.IpcMain this module needs (methods are bivariant, so the real IpcMain slots in) */
export interface IpcMainLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches Electron's handler signature
  handle(channel: string, listener: (event: any, ...args: any[]) => any): unknown
}

/** the sender half of an invoke event, as far as the stream loop cares */
export interface StreamEventLike {
  sender: { isDestroyed(): boolean; send(channel: string, chunk: unknown): void }
}

export interface SharedAiIpcDeps {
  ipcMain: IpcMainLike
  /** absolute path of ai-settings.json in the app's userData */
  settingsPath: string
  /** injected Node fs (atomic write + watch live in the app) */
  fs: FileSourceFs
  gsk: AiRuntimeGsk
  /** opens the gsk device-code login flow (app closes over shell.openExternal) */
  gskLogin: () => void
  translate: (key: string, params?: Record<string, unknown>) => string
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
 * ai:discover-models / ai:stream(+-cancel,-chunk) / ai:gsk-status /
 * ai:gsk-login. (ai:chat and per-app channels stay in the apps.) Returns the
 * runtime so per-app handlers can reuse the same resolution.
 */
export function registerSharedAiIpc(deps: SharedAiIpcDeps): AiRuntime {
  const { ipcMain, gsk, translate } = deps

  const runtime = createAiRuntime({
    source: createFileSource(deps.settingsPath, deps.fs),
    gsk,
    translate,
  })

  const activeStreams = new Map<string, AbortController>()

  ipcMain.handle('ai:get-settings', (): Promise<AiSettingsV2> => runtime.getSettingsView())

  ipcMain.handle(
    'ai:gsk-status',
    async (_event, withEmail?: boolean): Promise<GenSparkAccountStatus> => gsk.status(!!withEmail),
  )

  ipcMain.handle('ai:gsk-login', () => {
    deps.gskLogin()
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
  // Web image search (gsk → Serper → DuckDuckGo, copyright hosts filtered)
  ipcMain.handle('ai:web-image-search', async (_event, query: string, maxResults?: number) => {
    try {
      return await imageSearch(
        String(query),
        typeof maxResults === 'number' ? maxResults : 12,
        true,
      )
    } catch (err) {
      return { images: [], method: 'error', error: String(err) }
    }
  })
  // Stock libraries (Pexels/Pixabay): keys resolve main-side from ai-settings
  ipcMain.handle(
    'ai:stock-image-search',
    async (
      _event,
      req: { source: string; query: string; maxResults?: number },
    ): Promise<{ images: unknown[]; source: string; error?: string; code?: string }> => {
      try {
        const settings = await runtime.readRawSettings()
        const source = String(req.source) as StockSource
        const key =
          source === 'pexels'
            ? (settings.stockApiKeys?.pexels ?? '')
            : (settings.stockApiKeys?.pixabay ?? '')
        const images = await searchStockImages(
          source,
          key,
          String(req.query),
          typeof req.maxResults === 'number' ? req.maxResults : 12,
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
    }
  })
  ipcMain.handle(
    'ai:stock-keys-set',
    async (_event, keys: { pexels?: string; pixabay?: string }) => {
      const settings = await runtime.readRawSettings()
      const stored = settings.stockApiKeys ?? {}
      const next = {
        pexels:
          keys.pexels === '__keep__'
            ? (stored.pexels ?? '')
            : keys.pexels !== undefined
              ? keys.pexels
              : (stored.pexels ?? ''),
        pixabay:
          keys.pixabay === '__keep__'
            ? (stored.pixabay ?? '')
            : keys.pixabay !== undefined
              ? keys.pixabay
              : (stored.pixabay ?? ''),
      }
      await runtime.writeSettings({ ...settings, stockApiKeys: next })
      return true
    },
  )
  // Download an image URL → base64 (CORS-free, SSRF-guarded, retried)
  ipcMain.handle(
    'ai:remote-image',
    async (_event, url: string): Promise<{ base64: string; mime: string } | null> => {
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
    },
  )

  return runtime
}
