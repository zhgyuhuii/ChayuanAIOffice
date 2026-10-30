import type { AiPanelPrefs } from '@chaoffice/ui'
import { contextBridge, ipcRenderer } from 'electron'
import type { Lang } from '@chaoffice/i18n'
import type { AiStreamChunk } from '@chaoffice/ai-provider'
import type { ProjectApi } from '@chaoffice/project-store'
import { installDropOpenBridge } from '@chaoffice/electron-utils/drop-open'
import { installFilesPaneBridge } from '@chaoffice/electron-utils/files-pane-bridge'
import { AI_CHANNELS, MARKDOWN_CHANNELS } from '../shared/ipc'
import { normalizeMarkdownTheme, type MarkdownTheme } from '../shared/markdown-theme'
import type { AutoSaveDefault, DocTheme, ExportFormat, MarkdownApi, SaveMode, UiTheme } from '../shared/ipc'
import { KB_CHANNELS } from '@chaoffice/ai-host/kb-channels'

const api: MarkdownApi = {
  openSkillsSettings: () => ipcRenderer.invoke('ai:open-skills-settings'),
  skillsList: () => ipcRenderer.invoke('ai:skills-list'),
  skillText: (name: string) => ipcRenderer.invoke('ai:skill-text', name),
  consumePending: () => ipcRenderer.invoke(MARKDOWN_CHANNELS.consumePending),
  consumeAiContent: () => ipcRenderer.invoke(MARKDOWN_CHANNELS.consumeAiContent),
  openSourcePath: (path: string) => ipcRenderer.invoke('home:open-path', path),
  resolveWikiLinks: (request) => ipcRenderer.invoke(MARKDOWN_CHANNELS.resolveWikiLinks, request),
  rememberWikiFragment: (path, fragment) =>
    ipcRenderer.invoke(MARKDOWN_CHANNELS.rememberWikiFragment, path, fragment),
  takeWikiFragment: (path) => ipcRenderer.invoke(MARKDOWN_CHANNELS.takeWikiFragment, path),
  listWikiNotes: () => ipcRenderer.invoke(MARKDOWN_CHANNELS.listWikiNotes),
  createWikiNote: (request) => ipcRenderer.invoke(MARKDOWN_CHANNELS.createWikiNote, request),
  wikiHeads: (request) => ipcRenderer.invoke(MARKDOWN_CHANNELS.wikiHeads, request),
  wikiBacklinks: (path: string) => ipcRenderer.invoke(MARKDOWN_CHANNELS.wikiBacklinks, path),
  wikiTags: () => ipcRenderer.invoke(MARKDOWN_CHANNELS.wikiTags),
  wikiGraph: () => ipcRenderer.invoke(MARKDOWN_CHANNELS.wikiGraph),
  consumeHeadlessExport: () => ipcRenderer.invoke(MARKDOWN_CHANNELS.consumeHeadlessExport),
  headlessExportDone: (result: { ok: boolean; error?: string }) =>
    ipcRenderer.send(MARKDOWN_CHANNELS.headlessExportDone, result),
  readFile: (path) => ipcRenderer.invoke(MARKDOWN_CHANNELS.readFile, path),
  save: (request) => ipcRenderer.invoke(MARKDOWN_CHANNELS.save, request),
  setDirty: (dirty) => ipcRenderer.send(MARKDOWN_CHANNELS.dirtyChanged, dirty),
  onSaveRequest: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, mode: SaveMode) => handler(mode)
    ipcRenderer.on(MARKDOWN_CHANNELS.saveRequest, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.saveRequest, listener)
  },
  onCloseSaveRequest: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(MARKDOWN_CHANNELS.closeSaveRequest, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.closeSaveRequest, listener)
  },
  sendCloseSaveResult: (ok) => ipcRenderer.send(MARKDOWN_CHANNELS.closeSaveResult, ok),
  sendSaveRequestAck: (ok) => ipcRenderer.send(MARKDOWN_CHANNELS.saveRequestAck, ok),
  onReadTextRequest: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(MARKDOWN_CHANNELS.readTextRequest, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.readTextRequest, listener)
  },
  sendReadTextResult: (result) => ipcRenderer.send(MARKDOWN_CHANNELS.readTextResult, result),
  onFileRenamed: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, newPath: string) => handler(newPath)
    ipcRenderer.on(MARKDOWN_CHANNELS.fileRenamed, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.fileRenamed, listener)
  },
  onFileChangedOnDisk: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, path: string) => handler(path)
    ipcRenderer.on(MARKDOWN_CHANNELS.fileChangedOnDisk, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.fileChangedOnDisk, listener)
  },
  ackFileChangedOnDisk: () => ipcRenderer.send(MARKDOWN_CHANNELS.ackFileChangedOnDisk),
  pickImage: () => ipcRenderer.invoke(MARKDOWN_CHANNELS.pickImage),
  saveImage: (data) => ipcRenderer.invoke(MARKDOWN_CHANNELS.saveImage, data),
  readImage: (src) => ipcRenderer.invoke(MARKDOWN_CHANNELS.readImage, src),
  saveImageAs: (src) => ipcRenderer.invoke(MARKDOWN_CHANNELS.saveImageAs, src),
  getMarkdownTheme: async () => {
    const result: unknown = await ipcRenderer.invoke(MARKDOWN_CHANNELS.getMarkdownTheme)
    return normalizeMarkdownTheme(result)
  },
  setMarkdownTheme: async (theme: MarkdownTheme) => {
    const result: unknown = await ipcRenderer.invoke(MARKDOWN_CHANNELS.setMarkdownTheme, theme)
    return normalizeMarkdownTheme(result)
  },
  getImageHost: () => ipcRenderer.invoke(MARKDOWN_CHANNELS.getImageHost),
  setImageHost: (config) => ipcRenderer.invoke(MARKDOWN_CHANNELS.setImageHost, config),
  uploadImage: (data) => ipcRenderer.invoke(MARKDOWN_CHANNELS.uploadImage, data),
  onViewImage: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, src: string) => handler(src)
    ipcRenderer.on(MARKDOWN_CHANNELS.viewImage, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.viewImage, listener)
  },
  onExportRequest: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, format: ExportFormat) => handler(format)
    ipcRenderer.on(MARKDOWN_CHANNELS.exportRequest, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.exportRequest, listener)
  },
  onPrintRequest: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(MARKDOWN_CHANNELS.printRequest, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.printRequest, listener)
  },
  exportDocx: (request) => ipcRenderer.invoke(MARKDOWN_CHANNELS.exportDocx, request),
  exportPdf: (request) => ipcRenderer.invoke(MARKDOWN_CHANNELS.exportPdf, request),
  prepareImageExport: (request) =>
    ipcRenderer.invoke(MARKDOWN_CHANNELS.prepareImageExport, request),
  writeExportImage: (id, page, base64) =>
    ipcRenderer.invoke(MARKDOWN_CHANNELS.writeExportImage, id, page, base64),
  finishImageExport: (id, success) =>
    ipcRenderer.invoke(MARKDOWN_CHANNELS.finishImageExport, id, success),
  getLanguage: () => ipcRenderer.invoke(MARKDOWN_CHANNELS.getLanguage),
  onLanguageChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, lang: Lang) => handler(lang)
    ipcRenderer.on(MARKDOWN_CHANNELS.languageChanged, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.languageChanged, listener)
  },
  getTheme: () => ipcRenderer.invoke(MARKDOWN_CHANNELS.getTheme),
  onThemeChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, theme: UiTheme) => handler(theme)
    ipcRenderer.on(MARKDOWN_CHANNELS.themeChanged, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.themeChanged, listener)
  },
  getDocumentTheme: async () => {
    const result: unknown = await ipcRenderer.invoke(MARKDOWN_CHANNELS.getDocumentTheme)
    return result === 'dark' || result === 'light' ? result : 'follow'
  },
  onDocumentThemeChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, theme: DocTheme) => handler(theme)
    ipcRenderer.on(MARKDOWN_CHANNELS.documentThemeChanged, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.documentThemeChanged, listener)
  },
  getAutoSaveDefault: () => ipcRenderer.invoke(MARKDOWN_CHANNELS.getAutoSaveDefault),
  onAutoSaveDefaultChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, value: AutoSaveDefault) => handler(value)
    ipcRenderer.on(MARKDOWN_CHANNELS.autoSaveDefaultChanged, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.autoSaveDefaultChanged, listener)
  },
  getAiPanelPrefs: () => ipcRenderer.invoke(MARKDOWN_CHANNELS.getAiPanelPrefs),
  setAiPanelPrefs: (patch) => ipcRenderer.invoke('app:set-ai-panel-prefs', patch),
  onAiPanelPrefsChanged: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, prefs: AiPanelPrefs) => handler(prefs)
    ipcRenderer.on(MARKDOWN_CHANNELS.aiPanelPrefsChanged, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.aiPanelPrefsChanged, listener)
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
  aiChaOfficeStatus: (withEmail) => ipcRenderer.invoke(AI_CHANNELS.chaofficeStatus, withEmail),
  aiChaOfficeLogin: () => ipcRenderer.invoke(AI_CHANNELS.chaofficeLogin),
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
  fetchImage: (url) => ipcRenderer.invoke(AI_CHANNELS.fetchImage, url),
  aiGenerateImage: (op) => ipcRenderer.invoke(MARKDOWN_CHANNELS.aiGenerateImage, op),
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

/**
 * Model file naming: the transport half of `suggestFileName`.
 *
 * Inlined rather than imported — a preload entry must stay a single-file bundle,
 * or the sandbox drops every global it exposed. The one `ai:` channel is
 * registered app-wide by the shell rather than by this app, the same arrangement
 * the `project:*` bridge below already depends on.
 *
 * `content` crosses this bridge verbatim and the main process cannot see what
 * this editor withheld, so what the caller hands over is exactly what the model
 * sees. A caller that passed raw document text would undo its own redactions.
 *
 * The global is `aiNamingApi`, not `chaOffice`: `chaOffice` is the shell's home
 * API, and a partial one in an editor window would shadow it there.
 */
const aiNamingApi = {
  suggestFileName: (input: { content: string }) =>
    ipcRenderer.invoke('ai:suggest-file-name', input),
}

contextBridge.exposeInMainWorld('markdownApi', api)
contextBridge.exposeInMainWorld('aiNamingApi', aiNamingApi)
contextBridge.exposeInMainWorld('projectApi', projectApi)

// open documents dragged from the OS onto this tab as a new shell tab
installDropOpenBridge()
// folder tree over the default save folder (Files pane)
installFilesPaneBridge()

// Knowledge-base read surface (docs/kb-integration-plan.md): one dedicated
// global so every app shell / editor window shares the same facade contract.
contextBridge.exposeInMainWorld('chaOfficeKb', {
  discover: () => ipcRenderer.invoke(KB_CHANNELS.discover),
  search: (args: { kbIds: string[]; q: string; topK?: number }) =>
    ipcRenderer.invoke(KB_CHANNELS.search, args),
  doc: (args: { kbId: string; docId: string }) => ipcRenderer.invoke(KB_CHANNELS.doc, args),
  file: (args: { kbId: string; docId: string }) => ipcRenderer.invoke(KB_CHANNELS.file, args),
  getSource: () => ipcRenderer.invoke(KB_CHANNELS.getSource),
  setOrigin: (origin: string | null) => ipcRenderer.invoke(KB_CHANNELS.setOrigin, origin),
})
