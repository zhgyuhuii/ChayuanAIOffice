import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { createRemoteFilesClient } from '@chatoffice/storage-adapter/remote-ipc'
import type { IpcRendererEvent } from 'electron'
import type { AiPanelPrefs } from '@chatoffice/ui'
import type {
  AiModelSelection,
  AiSettingsV2,
  AiStreamChunk,
  AiStreamWireRequest,
  DiscoveryTarget,
  DesktopApi,
  MenuCommand,
  AutoSaveDefault,
  UiTheme,
  ZoteroRendererRequest,
} from '../shared/ipc'
import type { ProjectApi } from '@chatoffice/project-store'
import { installDropOpenBridge } from '@chatoffice/electron-utils/drop-open'

/** P2 relay command pump: main → renderer. Buffers commands that race the
 *  renderer boot (the dock's first seed) until onRelayCommand subscribes. */
let relayCommandHandler: ((command: unknown) => void) | null = null
const relayCommandQueue: unknown[] = []
ipcRenderer.on('docs:relay-command', (_event, command: unknown) => {
  if (relayCommandHandler) relayCommandHandler(command)
  else if (relayCommandQueue.length < 50) relayCommandQueue.push(command)
})

const api: DesktopApi = {
  getLanguage: () => ipcRenderer.invoke('app:get-language'),
  onLanguageChanged: (handler) => {
    const listener = (
      _event: IpcRendererEvent,
      lang: 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'th' | 'id' | 'ru' | 'ar',
    ) => handler(lang)
    ipcRenderer.on('app:language-changed', listener)
    return () => ipcRenderer.removeListener('app:language-changed', listener)
  },
  getTheme: () => ipcRenderer.invoke('app:get-theme'),
  onThemeChanged: (handler) => {
    const listener = (_event: IpcRendererEvent, theme: UiTheme) => handler(theme)
    ipcRenderer.on('app:theme-changed', listener)
    return () => ipcRenderer.removeListener('app:theme-changed', listener)
  },
  getAutoSaveDefault: () => ipcRenderer.invoke('app:get-auto-save-default'),
  onAutoSaveDefaultChanged: (handler) => {
    const listener = (_event: IpcRendererEvent, value: AutoSaveDefault) => handler(value)
    ipcRenderer.on('app:auto-save-default-changed', listener)
    return () => ipcRenderer.removeListener('app:auto-save-default-changed', listener)
  },
  getAiPanelPrefs: () => ipcRenderer.invoke('app:get-ai-panel-prefs'),
  onAiPanelPrefsChanged: (handler) => {
    const listener = (_event: IpcRendererEvent, prefs: AiPanelPrefs) => handler(prefs)
    ipcRenderer.on('app:ai-panel-prefs-changed', listener)
    return () => ipcRenderer.removeListener('app:ai-panel-prefs-changed', listener)
  },
  onChromePressed: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('app:chrome-pressed', listener)
    return () => ipcRenderer.removeListener('app:chrome-pressed', listener)
  },
  zoteroCommand: (command) => ipcRenderer.invoke('zotero:command', command),
  onZoteroRequest: (handler) => {
    const listener = (_event: IpcRendererEvent, request: ZoteroRendererRequest) => handler(request)
    ipcRenderer.on('zotero:request', listener)
    return () => ipcRenderer.removeListener('zotero:request', listener)
  },
  respondToZotero: (response) => ipcRenderer.send('zotero:response', response),
  openDocx: () => ipcRenderer.invoke('docs:open'),
  openDocxPath: (path: string) => ipcRenderer.invoke('docs:open-path', path),
  convertAltChunkHtml: (html: string) => ipcRenderer.invoke('docs:altchunk-html-to-docx', html),
  openDocxDecrypt: (path: string, password: string) =>
    ipcRenderer.invoke('docs:open-decrypt', path, password),
  setDocPassword: (filePath: string | null, password: string | null) =>
    ipcRenderer.invoke('docs:set-password', filePath, password),
  docPasswordIntentRevision: async () => {
    const revision: unknown = await ipcRenderer.invoke('docs:password-intent-revision')
    return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0
      ? revision
      : 0
  },
  discardDocPasswordIntents: (throughRevision: number) =>
    ipcRenderer.invoke('docs:discard-password-intents', throughRevision),
  consumePendingOpenDocx: () => ipcRenderer.invoke('docs:consume-pending-open'),
  consumeNewBlankDoc: () => ipcRenderer.invoke('docs:consume-new-blank'),
  consumeAiDocContent: () => ipcRenderer.invoke('docs:consume-ai-doc-content'),
  consumeHeadlessExport: () => ipcRenderer.invoke('docs:consume-headless-export'),
  headlessExportDone: (result: { ok: boolean; error?: string }) =>
    ipcRenderer.send('docs:headless-export-done', result),
  createDocument: (request) => ipcRenderer.invoke('docs:create-document', request),
  onOpenDocx: (handler) => {
    const listener = (_event: IpcRendererEvent, result: Parameters<typeof handler>[0]) =>
      handler(result)
    ipcRenderer.on('docs:opened', listener)
    return () => ipcRenderer.removeListener('docs:opened', listener)
  },
  onRenamedDocx: (handler) => {
    const listener = (_event: IpcRendererEvent, paths: Parameters<typeof handler>[0]) =>
      handler(paths)
    ipcRenderer.on('docs:renamed', listener)
    return () => ipcRenderer.removeListener('docs:renamed', listener)
  },
  saveDocx: (path: string, data: ArrayBuffer, auto?: boolean) =>
    ipcRenderer.invoke('docs:save', path, data, auto === true),
  writeRecoveryCopy: (path: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('docs:write-recovery', path, data),
  onTeardown: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('docs:teardown', listener)
    return () => ipcRenderer.removeListener('docs:teardown', listener)
  },
  respellKick: () => ipcRenderer.invoke('docs:respell-kick'),
  saveDocxAs: (defaultName: string, data: ArrayBuffer, sourcePath?: string | null) =>
    ipcRenderer.invoke('docs:save-as', defaultName, data, sourcePath ?? null),
  saveDocxNew: (defaultName: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('docs:save-new', defaultName, data),
  getRecentFiles: () => ipcRenderer.invoke('docs:recent'),
  pickImage: () => ipcRenderer.invoke('docs:pick-image'),
  fontMetrics: (family: string) => ipcRenderer.invoke('docs:font-metrics', family),
  print: (scale?: number) => ipcRenderer.invoke('docs:print', scale),
  exportPdf: (
    defaultName: string,
    pageWidthTwips: number,
    pageHeightTwips: number,
    outPath?: string,
    scale?: number,
  ) =>
    ipcRenderer.invoke(
      'docs:export-pdf',
      defaultName,
      pageWidthTwips,
      pageHeightTwips,
      outPath,
      scale,
    ),
  exportHtml: (defaultName: string, html: string, outPath?: string) =>
    ipcRenderer.invoke('docs:export-html', defaultName, html, outPath),
  printPdfBuffer: (pageWidthTwips: number, pageHeightTwips: number, scale?: number) =>
    ipcRenderer.invoke('docs:print-pdf-buffer', pageWidthTwips, pageHeightTwips, scale),
  saveMergedPdf: (defaultName: string, base64Parts: string[], outPath?: string) =>
    ipcRenderer.invoke('docs:save-merged-pdf', defaultName, base64Parts, outPath),
  getAiSettings: () => ipcRenderer.invoke('ai:get-settings'),
  setAiSettings: (view: AiSettingsV2) => ipcRenderer.invoke('ai:set-settings', view),
  setAiCurrentModel: (selection: AiModelSelection) =>
    ipcRenderer.invoke('ai:set-current-model', selection),
  aiDiscoverModels: (target: DiscoveryTarget) => ipcRenderer.invoke('ai:discover-models', target),
  aiChat: (request: { selection: AiModelSelection; system: string; user: string }) =>
    ipcRenderer.invoke('ai:chat', request),
  aiStream: (request: AiStreamWireRequest) => ipcRenderer.invoke('ai:stream', request),
  aiStreamCancel: (requestId: string) => ipcRenderer.invoke('ai:stream-cancel', requestId),
  aiChatOfficeStatus: (withEmail?: boolean) =>
    ipcRenderer.invoke('ai:chatoffice-status', withEmail),
  aiChatOfficeLogin: () => ipcRenderer.invoke('ai:chatoffice-login'),
  aiLocalToolStatus: (vendorId: string) => ipcRenderer.invoke('ai:local-tool-status', vendorId),
  aiLocalToolInstall: (vendorId: string, onLine?: (line: string) => void) => {
    if (!onLine) return ipcRenderer.invoke('ai:local-tool-install', vendorId)
    const ch = (_e: IpcRendererEvent, vid: string, line: string) => {
      if (vid === vendorId) onLine(line)
    }
    ipcRenderer.on('ai:local-tool-progress', ch)
    return ipcRenderer
      .invoke('ai:local-tool-install', vendorId)
      .finally(() => ipcRenderer.removeListener('ai:local-tool-progress', ch))
  },
  aiLocalToolStart: (vendorId: string) => ipcRenderer.invoke('ai:local-tool-start', vendorId),
  webSearch: (query: string, maxResults?: number) =>
    ipcRenderer.invoke('ai:web-search', query, maxResults),
  imageSearch: (query: string, maxResults?: number) =>
    ipcRenderer.invoke('ai:image-search', query, maxResults),
  fetchImage: (url: string) => ipcRenderer.invoke('ai:fetch-image', url),
  stockImageSearch: (source: string, query: string, maxResults?: number, page?: number) =>
    ipcRenderer.invoke('ai:stock-image-search', { source, query, maxResults, page }),
  stockKeysGet: () => ipcRenderer.invoke('ai:stock-keys-get'),
  stockKeysSet: (keys: { pexels?: string; pixabay?: string }) =>
    ipcRenderer.invoke('ai:stock-keys-set', keys),
  webImageSearch: (query: string, maxResults?: number, page?: number) =>
    ipcRenderer.invoke('ai:web-image-search', query, maxResults, page),
  remoteImage: (url: string) => ipcRenderer.invoke('ai:remote-image', url),
  mediaModels: () => ipcRenderer.invoke('ai:media-models'),
  mediaGenerate: (req: {
    profileId?: string
    modelId?: string
    prompt: string
    params?: Record<string, unknown>
  }) => ipcRenderer.invoke('ai:media-generate', req),
  videoSubmit: (req: {
    profileId: string
    modelId: string
    label?: string
    prompt: string
    params?: Record<string, unknown>
  }) => ipcRenderer.invoke('ai:video-submit', req),
  videoTasks: () => ipcRenderer.invoke('ai:video-tasks'),
  videoCancel: (id: string) => ipcRenderer.invoke('ai:video-cancel', id),
  videoRetry: (id: string) => ipcRenderer.invoke('ai:video-retry', id),
  videoPreview: (id: string) => ipcRenderer.invoke('ai:video-preview', id),
  onVideoTasksChanged: (handler: (payload: { id: string; status: string }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { id: string; status: string }) =>
      handler(payload)
    ipcRenderer.on('ai:video-tasks-changed', listener)
    return () => ipcRenderer.removeListener('ai:video-tasks-changed', listener)
  },
  aiGenerateImage: (op: { prompt: string; aspectRatio?: string }) =>
    ipcRenderer.invoke('docs:ai-generate-image', op),
  pickAttachments: () => ipcRenderer.invoke('files:pick'),
  addAttachmentPaths: (paths: string[]) => ipcRenderer.invoke('files:add', paths),
  addPastedImage: (data: ArrayBuffer, ext: string) =>
    ipcRenderer.invoke('files:add-pasted-image', data, ext),
  copyImageToClipboard: (dataUrl: string, metaJson?: string) =>
    ipcRenderer.invoke('docs:copy-image-to-clipboard', dataUrl, metaJson),
  readAttachment: (path: string, offset: number, maxChars: number) =>
    ipcRenderer.invoke('files:read', path, offset, maxChars),
  readAttachmentImage: (path: string) => ipcRenderer.invoke('files:read-image', path),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  openNewTab: (openPath?: string | null) => ipcRenderer.invoke('win:new', openPath ?? null),
  listDocsTabs: () => ipcRenderer.invoke('win:list'),
  focusDocsTab: (id: string) => ipcRenderer.invoke('win:focus', id),
  onAiStream: (handler: (chunk: AiStreamChunk) => void) => {
    const listener = (_event: IpcRendererEvent, chunk: AiStreamChunk) => handler(chunk)
    ipcRenderer.on('ai:stream-chunk', listener)
    return () => ipcRenderer.removeListener('ai:stream-chunk', listener)
  },
  onMenuCommand: (handler: (command: MenuCommand, payload?: string) => void) => {
    const listener = (_event: IpcRendererEvent, command: MenuCommand, payload?: string) =>
      handler(command, payload)
    ipcRenderer.on('menu:command', listener)
    return () => ipcRenderer.removeListener('menu:command', listener)
  },
  onCloseCheck: (handler: () => void) => {
    const listener = () => handler()
    ipcRenderer.on('docs:close-check', listener)
    return () => ipcRenderer.removeListener('docs:close-check', listener)
  },
  reportViewMenuState: (state: { aiSidebar: boolean; darkCanvas: boolean }) =>
    ipcRenderer.send('docs:view-menu-state', {
      aiSidebar: state?.aiSidebar === true,
      darkCanvas: state?.darkCanvas === true,
    }),
  reportCloseCheck: (state: { dirty: boolean; autoSave: boolean; filePath?: string | null }) =>
    ipcRenderer.send('docs:close-check-result', {
      dirty: state?.dirty === true,
      autoSave: state?.autoSave === true,
      filePath: typeof state?.filePath === 'string' ? state.filePath : null,
    }),
  onCloseSaveRequest: (handler: () => void) => {
    const listener = () => handler()
    ipcRenderer.on('docs:close-save-request', listener)
    return () => ipcRenderer.removeListener('docs:close-save-request', listener)
  },
  reportCloseSaveResult: (ok: boolean) => ipcRenderer.send('docs:close-save-result', ok === true),
  // P2 中继服务: docked editor's conversation relay (RelayEvent out / RelayCommand in).
  // Commands can arrive while the renderer is still booting (Home seeds the
  // loop the moment the dock tab opens) — the module-level pump below buffers
  // them until a handler subscribes, then replays, so the first seed is
  // never lost.
  relaySend: (event: unknown) => ipcRenderer.send('docs:relay-event', event),
  // P2-5 回流薄钩: panel turns report to the shell (project mainline mirror)
  panelTurnCompleted: (turn: unknown) => ipcRenderer.send('docs:panel-turn-completed', turn),
  // dock lifecycle: the shell pushes false when a docked editor pops out to a
  // full tab — the renderer restores its own AI panel preference then
  onDockedState: (handler: (docked: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, docked: boolean): void => handler(docked)
    ipcRenderer.on('app:docked-state', listener)
    return () => ipcRenderer.removeListener('app:docked-state', listener)
  },
  onRelayCommand: (handler: (command: unknown) => void) => {
    relayCommandHandler = handler
    for (const queued of relayCommandQueue.splice(0)) handler(queued)
    return () => {
      relayCommandHandler = null
    }
  },
}

const projectApi: ProjectApi = {
  resolveChat: (args) => ipcRenderer.invoke('project:resolveChat', args),
  appendChat: (args) => ipcRenderer.invoke('project:appendChat', args),
  loadChat: (args) => ipcRenderer.invoke('project:loadChat', args),
  rebindChat: (args) => ipcRenderer.invoke('project:rebindChat', args),
  // P1 extensions
  listProjects: () => ipcRenderer.invoke('project:list'),
  createProject: (args) => ipcRenderer.invoke('project:create', args),
  renameProject: (args) => ipcRenderer.invoke('project:rename', args),
  deleteProject: (args) => ipcRenderer.invoke('project:delete', args),
  moveFile: (args) => ipcRenderer.invoke('project:moveFile', args),
  getTimeline: (args) => ipcRenderer.invoke('project:timeline', args),
}

contextBridge.exposeInMainWorld('desktop', api)
contextBridge.exposeInMainWorld('projectApi', projectApi)

// remote storage (MinIO / OSS): settings, listing, object transfer, pending queue
contextBridge.exposeInMainWorld(
  'chatOfficeRemoteFiles',
  createRemoteFilesClient((channel, payload) => ipcRenderer.invoke(channel, payload)),
)

// open documents dragged from the OS onto this tab as a new shell tab
installDropOpenBridge()
