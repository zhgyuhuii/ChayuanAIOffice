import type { AiPanelPrefs } from '@chatoffice/ui'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Lang } from '@chatoffice/i18n'
import type { AiStreamChunk } from '@chatoffice/ai-provider'
import type { ProjectApi } from '@chatoffice/project-store'
import { installDropOpenBridge } from '@chatoffice/electron-utils/drop-open'
import { installFilesPaneBridge } from '@chatoffice/electron-utils/files-pane-bridge'
import { AI_CHANNELS, HTML_CHANNELS } from '../shared/ipc'
import type { AutoSaveDefault, ExportFormat, HtmlApi, SaveMode, UiTheme } from '../shared/ipc'
import { KB_CHANNELS } from '@chatoffice/ai-host/kb-channels'

const api: HtmlApi = {
  consumePending: () => ipcRenderer.invoke(HTML_CHANNELS.consumePending),
  consumeAiContent: () => ipcRenderer.invoke(HTML_CHANNELS.consumeAiContent),
  consumeHeadlessExport: () => ipcRenderer.invoke(HTML_CHANNELS.consumeHeadlessExport),
  headlessExportDone: (result: { ok: boolean; error?: string }) =>
    ipcRenderer.send(HTML_CHANNELS.headlessExportDone, result),
  readFile: (path) => ipcRenderer.invoke(HTML_CHANNELS.readFile, path),
  updatePreview: (text) => ipcRenderer.send(HTML_CHANNELS.previewUpdate, text),
  getPreviewInfo: () => ipcRenderer.invoke(HTML_CHANNELS.previewInfo),
  setPresentFullScreen: (on) => ipcRenderer.invoke(HTML_CHANNELS.presentFullScreen, on),
  presentInNewTab: (title) => ipcRenderer.invoke(HTML_CHANNELS.presentNewTab, title),
  save: (request) => ipcRenderer.invoke(HTML_CHANNELS.save, request),
  setDirty: (dirty) => ipcRenderer.send(HTML_CHANNELS.dirtyChanged, dirty),
  onSaveRequest: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, mode: SaveMode) => handler(mode)
    ipcRenderer.on(HTML_CHANNELS.saveRequest, listener)
    return () => ipcRenderer.removeListener(HTML_CHANNELS.saveRequest, listener)
  },
  onCloseSaveRequest: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(HTML_CHANNELS.closeSaveRequest, listener)
    return () => ipcRenderer.removeListener(HTML_CHANNELS.closeSaveRequest, listener)
  },
  sendCloseSaveResult: (ok) => ipcRenderer.send(HTML_CHANNELS.closeSaveResult, ok),
  sendSaveRequestAck: (ok) => ipcRenderer.send(HTML_CHANNELS.saveRequestAck, ok),
  onReadTextRequest: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(HTML_CHANNELS.readTextRequest, listener)
    return () => ipcRenderer.removeListener(HTML_CHANNELS.readTextRequest, listener)
  },
  sendReadTextResult: (result) => ipcRenderer.send(HTML_CHANNELS.readTextResult, result),
  onFileRenamed: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, newPath: string) => handler(newPath)
    ipcRenderer.on(HTML_CHANNELS.fileRenamed, listener)
    return () => ipcRenderer.removeListener(HTML_CHANNELS.fileRenamed, listener)
  },
  setProvisionalTitle: (title) => ipcRenderer.send(HTML_CHANNELS.provisionalTitle, title),
  pickImage: () => ipcRenderer.invoke(HTML_CHANNELS.pickImage),
  saveImage: (data) => ipcRenderer.invoke(HTML_CHANNELS.saveImage, data),
  readImage: (src) => ipcRenderer.invoke(HTML_CHANNELS.readImage, src),
  pickAttachments: () => ipcRenderer.invoke(HTML_CHANNELS.filesPick),
  addAttachmentPaths: (paths) => ipcRenderer.invoke(HTML_CHANNELS.filesAdd, paths),
  addPastedImage: (data, ext) => ipcRenderer.invoke(HTML_CHANNELS.filesAddPastedImage, data, ext),
  readAttachment: (path, offset, maxChars) =>
    ipcRenderer.invoke(HTML_CHANNELS.filesRead, path, offset, maxChars),
  readAttachmentImage: (path) => ipcRenderer.invoke(HTML_CHANNELS.filesReadImage, path),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onExportRequest: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, format: ExportFormat) => handler(format)
    ipcRenderer.on(HTML_CHANNELS.exportRequest, listener)
    return () => ipcRenderer.removeListener(HTML_CHANNELS.exportRequest, listener)
  },
  onPrintRequest: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(HTML_CHANNELS.printRequest, listener)
    return () => ipcRenderer.removeListener(HTML_CHANNELS.printRequest, listener)
  },
  exportDocx: (request) => ipcRenderer.invoke(HTML_CHANNELS.exportDocx, request),
  exportPdf: (request) => ipcRenderer.invoke(HTML_CHANNELS.exportPdf, request),
  exportHtml: (request) => ipcRenderer.invoke(HTML_CHANNELS.exportHtml, request),
  getLanguage: () => ipcRenderer.invoke(HTML_CHANNELS.getLanguage),
  onLanguageChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, lang: Lang) => handler(lang)
    ipcRenderer.on(HTML_CHANNELS.languageChanged, listener)
    return () => ipcRenderer.removeListener(HTML_CHANNELS.languageChanged, listener)
  },
  getTheme: () => ipcRenderer.invoke(HTML_CHANNELS.getTheme),
  onThemeChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, theme: UiTheme) => handler(theme)
    ipcRenderer.on(HTML_CHANNELS.themeChanged, listener)
    return () => ipcRenderer.removeListener(HTML_CHANNELS.themeChanged, listener)
  },
  getAutoSaveDefault: () => ipcRenderer.invoke(HTML_CHANNELS.getAutoSaveDefault),
  onAutoSaveDefaultChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, value: AutoSaveDefault) => handler(value)
    ipcRenderer.on(HTML_CHANNELS.autoSaveDefaultChanged, listener)
    return () => ipcRenderer.removeListener(HTML_CHANNELS.autoSaveDefaultChanged, listener)
  },
  getAiPanelPrefs: () => ipcRenderer.invoke(HTML_CHANNELS.getAiPanelPrefs),
  setAiPanelPrefs: (patch) => ipcRenderer.invoke('app:set-ai-panel-prefs', patch),
  onAiPanelPrefsChanged: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, prefs: AiPanelPrefs) => handler(prefs)
    ipcRenderer.on(HTML_CHANNELS.aiPanelPrefsChanged, listener)
    return () => ipcRenderer.removeListener(HTML_CHANNELS.aiPanelPrefsChanged, listener)
  },
  // dock lifecycle (P1 契约): the shell pushes false when a docked editor pops
  // out to a full tab — the renderer restores its own AI panel preference then
  onDockedState: (handler: (docked: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, docked: boolean): void => handler(docked)
    ipcRenderer.on('app:docked-state', listener)
    return () => ipcRenderer.removeListener('app:docked-state', listener)
  },
  onChromePressed: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('app:chrome-pressed', listener)
    return () => ipcRenderer.removeListener('app:chrome-pressed', listener)
  },
  getAiSettings: () => ipcRenderer.invoke(AI_CHANNELS.getSettings),
  setAiSettings: (view) => ipcRenderer.invoke(AI_CHANNELS.setSettings, view),
  setAiCurrentModel: (selection) => ipcRenderer.invoke(AI_CHANNELS.setCurrentModel, selection),
  aiDiscoverModels: (target) => ipcRenderer.invoke(AI_CHANNELS.discoverModels, target),
  aiChatOfficeStatus: (withEmail) => ipcRenderer.invoke(AI_CHANNELS.chatofficeStatus, withEmail),
  aiChatOfficeLogin: () => ipcRenderer.invoke(AI_CHANNELS.chatofficeLogin),
  aiLocalToolStatus: (vendorId) => ipcRenderer.invoke(AI_CHANNELS.localToolStatus, vendorId),
  aiLocalToolInstall: (vendorId, onLine) => {
    if (!onLine) return ipcRenderer.invoke(AI_CHANNELS.localToolInstall, vendorId)
    const ch = (_e: Electron.IpcRendererEvent, vid: string, line: string) => {
      if (vid === vendorId) onLine(line)
    }
    ipcRenderer.on(AI_CHANNELS.localToolProgress, ch)
    return ipcRenderer
      .invoke(AI_CHANNELS.localToolInstall, vendorId)
      .finally(() => ipcRenderer.removeListener(AI_CHANNELS.localToolProgress, ch))
  },
  aiLocalToolStart: (vendorId) => ipcRenderer.invoke(AI_CHANNELS.localToolStart, vendorId),
  aiStream: (request) => ipcRenderer.invoke(AI_CHANNELS.stream, request),
  aiStreamCancel: (requestId) => ipcRenderer.invoke(AI_CHANNELS.streamCancel, requestId),
  onAiStream: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, chunk: AiStreamChunk) => handler(chunk)
    ipcRenderer.on(AI_CHANNELS.streamChunk, listener)
    return () => ipcRenderer.removeListener(AI_CHANNELS.streamChunk, listener)
  },
  webSearch: (query, maxResults) => ipcRenderer.invoke(AI_CHANNELS.webSearch, query, maxResults),
  imageSearch: (query, maxResults) =>
    ipcRenderer.invoke(AI_CHANNELS.imageSearch, query, maxResults),
  fetchImage: (url) => ipcRenderer.invoke(HTML_CHANNELS.fetchImage, url),
}

/** Chat persistence: the shared project:* handlers are registered once by the shell (docs-main registerProjectIpc) */
const projectApi: Pick<
  ProjectApi,
  | 'resolveChat'
  | 'appendChat'
  | 'loadChat'
  | 'rebindChat'
  | 'conversationsList'
  | 'conversationCreate'
  | 'conversationMeta'
  | 'conversationsOpenSet'
  | 'conversationDelete'
  | 'conversationsDeleteAll'
  | 'conversationsRebind'
> = {
  resolveChat: (args) => ipcRenderer.invoke('project:resolveChat', args),
  appendChat: (args) => ipcRenderer.invoke('project:appendChat', args),
  loadChat: (args) => ipcRenderer.invoke('project:loadChat', args),
  rebindChat: (args) => ipcRenderer.invoke('project:rebindChat', args),
  // LOCAL(2026-09-21, d8201ad0): 多会话对话索引(追加式)
  conversationsList: (args) => ipcRenderer.invoke('project:conversationsList', args),
  conversationCreate: (args) => ipcRenderer.invoke('project:conversationCreate', args),
  conversationMeta: (args) => ipcRenderer.invoke('project:conversationMeta', args),
  conversationsOpenSet: (args) => ipcRenderer.invoke('project:conversationsOpenSet', args),
  conversationDelete: (args) => ipcRenderer.invoke('project:conversationDelete', args),
  conversationsDeleteAll: (args) => ipcRenderer.invoke('project:conversationsDeleteAll', args),
  conversationsRebind: (args) => ipcRenderer.invoke('project:conversationsRebind', args),
}


  // LOCAL(2026-09-20): unified media capability bridge; upstream: additive-only; converge: never (local feature)
  const mediaApi = {
    mediaCapabilities: () => ipcRenderer.invoke('ai:media-capabilities'),
    mediaImage: (op: { prompt: string; aspectRatio?: string }) =>
      ipcRenderer.invoke('ai:media-image', op),
    mediaVideo: (op: { prompt: string; aspectRatio?: string; durationSeconds?: number }) =>
      ipcRenderer.invoke('ai:media-video', op),
    mediaUnderstand: (op: {
      kind: 'image' | 'video' | 'auto'
      sources: string[]
      requirements: string
    }) => ipcRenderer.invoke('ai:media-understand', op),
    mediaAsr: (op: { source: string; language?: string }) => ipcRenderer.invoke('ai:media-asr', op),
    mediaTts: (op: { text: string; voice?: string }) => ipcRenderer.invoke('ai:media-tts', op),
  }
  Object.assign(api, mediaApi)
contextBridge.exposeInMainWorld('htmlApi', api)
contextBridge.exposeInMainWorld('projectApi', projectApi)

// open documents dragged from the OS onto this tab as a new shell tab
installDropOpenBridge()
// folder tree over the default save folder (Files pane)
installFilesPaneBridge()

// Knowledge-base read surface (docs/kb-integration-plan.md): one dedicated
// global so every app shell / editor window shares the same facade contract.
contextBridge.exposeInMainWorld('chatOfficeKb', {
  discover: () => ipcRenderer.invoke(KB_CHANNELS.discover),
  search: (args: { kbIds: string[]; q: string; topK?: number }) =>
    ipcRenderer.invoke(KB_CHANNELS.search, args),
  doc: (args: { kbId: string; docId: string }) => ipcRenderer.invoke(KB_CHANNELS.doc, args),
  file: (args: { kbId: string; docId: string }) => ipcRenderer.invoke(KB_CHANNELS.file, args),
  getSource: () => ipcRenderer.invoke(KB_CHANNELS.getSource),
  setOrigin: (origin: string | null) => ipcRenderer.invoke(KB_CHANNELS.setOrigin, origin),
})
