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
    async (_event, withEmail?: boolean): Promise<GenSparkAccountStatus> =>
      gsk.status(!!withEmail),
  )

  ipcMain.handle('ai:gsk-login', () => {
    deps.gskLogin()
  })

  // the settings view carries KEEP_KEY sentinels; the runtime merges stored keys back
  ipcMain.handle('ai:set-settings', (_event, view: AiSettingsV2) =>
    runtime.saveSettings(view),
  )

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

  return runtime
}
