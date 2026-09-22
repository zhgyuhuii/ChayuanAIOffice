import type { AiPanelPrefs } from '@chatoffice/ui'
import { contextBridge, ipcRenderer } from 'electron'
import type { Lang } from '@chatoffice/i18n'
import type { AiStreamChunk } from '@chatoffice/ai-provider'
import { installDropOpenBridge } from '@chatoffice/electron-utils/drop-open'
import { installFilesPaneBridge } from '@chatoffice/electron-utils/files-pane-bridge'
import { AI_CHANNELS, PDF_CHANNELS } from '../shared/ipc'
import type { PdfApi, UiTheme } from '../shared/ipc'
import { KB_CHANNELS } from '@chatoffice/ai-host/kb-channels'

const api: PdfApi = {
  consumePending: () => ipcRenderer.invoke(PDF_CHANNELS.consumePending),
  readFile: (path) => ipcRenderer.invoke(PDF_CHANNELS.readFile, path),
  save: (request) => ipcRenderer.invoke(PDF_CHANNELS.save, request),
  writeRecovery: (request) => ipcRenderer.invoke(PDF_CHANNELS.writeRecovery, request),
  requestRedactionCopy: (path) => ipcRenderer.invoke(PDF_CHANNELS.requestRedactionCopy, path),
  isUntitled: (path) => ipcRenderer.invoke(PDF_CHANNELS.isUntitled, path),
  validateTextEdits: (request) => ipcRenderer.invoke(PDF_CHANNELS.validateTextEdits, request),
  listEditFonts: () => ipcRenderer.invoke(PDF_CHANNELS.listEditFonts),
  canDrawText: (text, font, bold, italic) =>
    ipcRenderer.invoke(PDF_CHANNELS.canDrawText, text, font, bold, italic),
  listPageImages: (path) => ipcRenderer.invoke(PDF_CHANNELS.listPageImages, path),
  listStaticFormFills: (path) => ipcRenderer.invoke(PDF_CHANNELS.listStaticFormFills, path),
  ocrPage: (png) => ipcRenderer.invoke(PDF_CHANNELS.ocrPage, png),
  pageImagePng: (request) => ipcRenderer.invoke(PDF_CHANNELS.pageImagePng, request),
  pagePreviewPng: (request) => ipcRenderer.invoke(PDF_CHANNELS.pagePreviewPng, request),
  extractPages: (request) => ipcRenderer.invoke(PDF_CHANNELS.extractPages, request),
  insertPdf: (request) => ipcRenderer.invoke(PDF_CHANNELS.insertPdf, request),
  insertBlankPage: (request) => ipcRenderer.invoke(PDF_CHANNELS.insertBlankPage, request),
  splitPdf: (request) => ipcRenderer.invoke(PDF_CHANNELS.splitPdf, request),
  mergePdf: (request) => ipcRenderer.invoke(PDF_CHANNELS.mergePdf, request),
  mergePages: (request) => ipcRenderer.invoke(PDF_CHANNELS.mergePages, request),
  replacePages: (request) => ipcRenderer.invoke(PDF_CHANNELS.replacePages, request),
  setPageSize: (request) => ipcRenderer.invoke(PDF_CHANNELS.setPageSize, request),
  splitPages: (request) => ipcRenderer.invoke(PDF_CHANNELS.splitPages, request),
  cropPages: (request) => ipcRenderer.invoke(PDF_CHANNELS.cropPages, request),
  exportImages: (request) => ipcRenderer.invoke(PDF_CHANNELS.exportImages, request),
  convertOffice: (format) => ipcRenderer.invoke(PDF_CHANNELS.convertOffice, format),
  createDocument: (request) => ipcRenderer.invoke(PDF_CHANNELS.createDocument, request),
  imageSearch: (query, maxResults) =>
    ipcRenderer.invoke(AI_CHANNELS.imageSearch, query, maxResults),
  fetchImage: (url) => ipcRenderer.invoke(AI_CHANNELS.fetchImage, url),
  generateImage: (op) => ipcRenderer.invoke(PDF_CHANNELS.generateImage, op),
  listSavedSignatures: () => ipcRenderer.invoke(PDF_CHANNELS.listSignatures),
  addSavedSignature: (data) => ipcRenderer.invoke(PDF_CHANNELS.addSignature, data),
  removeSavedSignature: (id) => ipcRenderer.invoke(PDF_CHANNELS.removeSignature, id),
  getUsername: () => ipcRenderer.invoke(PDF_CHANNELS.getUsername),
  setDirty: (dirty) => ipcRenderer.send(PDF_CHANNELS.dirtyChanged, dirty),
  onCloseSaveRequest: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(PDF_CHANNELS.closeSaveRequest, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.closeSaveRequest, listener)
  },
  sendCloseSaveResult: (ok) => ipcRenderer.send(PDF_CHANNELS.closeSaveResult, ok),
  onSaveAsRequest: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, targetPath: string) => handler(targetPath)
    ipcRenderer.on(PDF_CHANNELS.saveAsRequest, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.saveAsRequest, listener)
  },
  sendSaveAsResult: (ok) => ipcRenderer.send(PDF_CHANNELS.saveAsResult, ok),
  onSaveAsFlow: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, inFlight: boolean) => handler(inFlight)
    ipcRenderer.on(PDF_CHANNELS.saveAsFlow, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.saveAsFlow, listener)
  },
  onPrintRequest: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(PDF_CHANNELS.printRequest, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.printRequest, listener)
  },
  onFileRenamed: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, newPath: string) => handler(newPath)
    ipcRenderer.on(PDF_CHANNELS.fileRenamed, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.fileRenamed, listener)
  },
  getLanguage: () => ipcRenderer.invoke(PDF_CHANNELS.getLanguage),
  onLanguageChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, lang: Lang) => handler(lang)
    ipcRenderer.on(PDF_CHANNELS.languageChanged, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.languageChanged, listener)
  },
  getTheme: () => ipcRenderer.invoke(PDF_CHANNELS.getTheme),
  onThemeChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, theme: UiTheme) => handler(theme)
    ipcRenderer.on(PDF_CHANNELS.themeChanged, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.themeChanged, listener)
  },
  getAiPanelPrefs: () => ipcRenderer.invoke(PDF_CHANNELS.getAiPanelPrefs),
  setAiPanelPrefs: (patch) => ipcRenderer.invoke('app:set-ai-panel-prefs', patch),
  onAiPanelPrefsChanged: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, prefs: AiPanelPrefs) => handler(prefs)
    ipcRenderer.on(PDF_CHANNELS.aiPanelPrefsChanged, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.aiPanelPrefsChanged, listener)
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
  aiChatOfficeLogin: () => ipcRenderer.invoke(AI_CHANNELS.chatofficeLogin),
  aiLocalToolStatus: (vendorId: string) => ipcRenderer.invoke('ai:local-tool-status', vendorId),
  aiLocalToolInstall: (vendorId: string, onLine?: (line: string) => void) => {
    if (!onLine) return ipcRenderer.invoke('ai:local-tool-install', vendorId)
    const ch = (_e: Electron.IpcRendererEvent, vid: string, line: string) => {
      if (vid === vendorId) onLine(line)
    }
    ipcRenderer.on('ai:local-tool-progress', ch)
    return ipcRenderer
      .invoke('ai:local-tool-install', vendorId)
      .finally(() => ipcRenderer.removeListener('ai:local-tool-progress', ch))
  },
  aiLocalToolStart: (vendorId: string) => ipcRenderer.invoke('ai:local-tool-start', vendorId),
  chatofficeStatus: (withEmail) => ipcRenderer.invoke(AI_CHANNELS.chatofficeStatus, withEmail),
  aiStream: (request) => ipcRenderer.invoke(AI_CHANNELS.stream, request),
  aiStreamCancel: (requestId) => ipcRenderer.invoke(AI_CHANNELS.streamCancel, requestId),
  onAiStream: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, chunk: AiStreamChunk) => handler(chunk)
    ipcRenderer.on(AI_CHANNELS.streamChunk, listener)
    return () => ipcRenderer.removeListener(AI_CHANNELS.streamChunk, listener)
  },
}

// Shared project chat store (registered app-wide by the shell's main init):
// AI PDF conversations persist per file, like Docs/Sheets
const projectApi = {
  resolveChat: (args: { filePath: string | null; tempChatId?: string }) =>
    ipcRenderer.invoke('project:resolveChat', args),
  appendChat: (args: unknown) => ipcRenderer.invoke('project:appendChat', args),
  loadChat: (args: { projectId: string; chatId: string; limit?: number }) =>
    ipcRenderer.invoke('project:loadChat', args),
  rebindChat: (args: { projectId: string; tempChatId: string; newFilePath: string }) =>
    ipcRenderer.invoke('project:rebindChat', args),
  // LOCAL(2026-09-21, d8201ad0): 多会话对话索引(追加式)
  conversationsList: (args: unknown) => ipcRenderer.invoke('project:conversationsList', args),
  conversationCreate: (args: unknown) => ipcRenderer.invoke('project:conversationCreate', args),
  conversationMeta: (args: unknown) => ipcRenderer.invoke('project:conversationMeta', args),
  conversationsOpenSet: (args: unknown) => ipcRenderer.invoke('project:conversationsOpenSet', args),
  conversationDelete: (args: unknown) => ipcRenderer.invoke('project:conversationDelete', args),
  conversationsDeleteAll: (args: unknown) =>
    ipcRenderer.invoke('project:conversationsDeleteAll', args),
  conversationsRebind: (args: unknown) => ipcRenderer.invoke('project:conversationsRebind', args),
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
contextBridge.exposeInMainWorld('pdfApi', api)
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
