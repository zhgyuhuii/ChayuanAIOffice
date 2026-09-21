import type { AiPanelPrefs } from '@chatoffice/ui/ai-panel-prefs'
export interface OpenFileResult {
  path: string
  name: string
  /** one-shot URL serving the docx bytes (fetch it exactly once) */
  dataUrl: string
  /** sha256 of the original file; original archived under this hash */
  hash: string
  /** the on-disk file is password protected (opened via decrypt; saves re-encrypt) */
  encrypted?: boolean
  /** content came from a newer crash-recovery copy and still needs an explicit save */
  recovered?: boolean
}

/** Password-protected (ECMA-376 encrypted) docx: the renderer prompts for the
 *  open password and retries via openDocxDecrypt. */
export interface OpenFileNeedsPassword {
  needsPassword: true
  path: string
  name: string
}

export type OpenDocxResult = OpenFileResult | OpenFileNeedsPassword | null

/** result of an openDocxDecrypt attempt; wrong-password keeps the prompt open */
export type DecryptOpenResult =
  | { ok: true; result: OpenFileResult }
  | { ok: false; reason: 'wrong-password' | 'unsupported' | 'error'; error?: string }

export interface PickImageResult {
  /** raw image bytes, base64 encoded */
  base64: string
  mime: 'image/png' | 'image/jpeg' | 'image/gif'
  name: string
}

/** renderer view of one main-process video task (ai-host video-tasks) */
export interface VideoTaskInfo {
  id: string
  profileId: string
  modelId: string
  label: string
  prompt: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  submittedAt: number
  completedAt?: number
  note?: string
  error?: string
  retriable?: boolean
  result?: {
    filePath?: string
    url?: string
    posterDataUrl?: string
  }
}

// ---- AI provider settings/config/streaming: canonical types live in @chatoffice/ai-provider ----

import type {
  AiChatResponse,
  AiModelEntry,
  AiModelSelection,
  AiSettingsV2,
  AiStreamChunk,
  AiStreamRequest,
  DiscoveryTarget,
  ChatOfficeAccountStatus,
  LocalToolOpResult,
  LocalToolStatus,
} from '@chatoffice/ai-provider'
import type { HeadlessExportTarget } from '@chatoffice/electron-utils/headless-export'
import type { FaceVerticalMetrics } from '@chatoffice/font-metrics'

export type { FaceVerticalMetrics }

export type {
  AiChatResponse,
  AiImageSource,
  AiModelEntry,
  AiModelSelection,
  AiProviderConfig,
  AiProviderId,
  AiProviderMeta,
  AiProviderProfile,
  AiSettings,
  AiSettingsV2,
  AiStreamChunk,
  AiStreamRequest,
  AiStreamRequestV2,
  AiWireProtocol,
  DiscoveryTarget,
  ChatOfficeAccountStatus,
} from '@chatoffice/ai-provider'
export { AI_PROVIDERS, KEEP_KEY } from '@chatoffice/ai-provider/browser'

// ---- agent protocol: canonical types live in @chatoffice/agent-core ----

export type {
  AgentMessage,
  AgentToolCall,
  AgentToolDef,
  AgentToolResult,
} from '@chatoffice/agent-core'

/** wire shape of an ai:stream request: the settings slot carries the selection */
export interface AiStreamWireRequest {
  requestId: string
  settings: AiModelSelection
  system: string
  messages: import('@chatoffice/agent-core').AgentMessage[]
  tools?: import('@chatoffice/agent-core').AgentToolDef[]
  maxTokens?: number
}

// ---- chat attachments (local files fed to the agent via tools) ----

/** Image attachment extensions: no text extraction; read as base64 on send and passed to the model as a multimodal image with the user message */
export const ATTACHMENT_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

export interface AttachmentMeta {
  /** absolute local path; the file never leaves the machine */
  path: string
  name: string
  /** lowercased extension without the dot */
  ext: string
  sizeBytes: number
}

export interface AttachmentAddResult {
  accepted: AttachmentMeta[]
  /** per-file rejection messages (too large / unsupported type / unreadable) */
  rejected: string[]
}

export interface AttachmentReadResult {
  ok: boolean
  error?: string
  name?: string
  /** total characters of the extracted text */
  totalChars?: number
  /** requested slice */
  text?: string
  offset?: number
}

/** an image attachment read as raw bytes for multimodal input (files:read-image) */
export interface AttachmentImageResult {
  ok: boolean
  /** raw base64 (no data: URL prefix) */
  base64?: string
  mime?: string
  error?: string
}

/** an open docs tab, for View → Switch Tab */
export interface DocsTabInfo {
  id: string
  title: string
  focused: boolean
}

/** commands dispatched from the native application menu to the renderer */
export type MenuCommand =
  | 'new'
  | 'open'
  | 'open-path'
  | 'save'
  | 'save-as'
  | 'undo'
  | 'redo'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-100'
  | 'zoom-page-width'
  | 'zoom-whole-page'
  | 'toggle-ai'
  | 'toggle-dark'
  | 'insert-table'
  | 'insert-image'
  | 'insert-page-break'
  | 'insert-link'
  | 'insert-equation'
  | 'insert-comment'
  | 'font-dialog'
  | 'paragraph-dialog'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-justify'
  | 'page-setup'
  | 'find'
  | 'print'
  | 'export-pdf'
  | 'export-html'
  | 'export-images'
  | 'word-count'
  | 'ai-proofread'
  | 'shortcuts'

export type UiTheme = 'light' | 'dark' | 'system'

/** shell-wide AutoSave default; updatedAt is 0 until the user has ever set it */
export interface AutoSaveDefault {
  on: boolean
  updatedAt: number
}

/** target file type of the AI create_document tool */
export type CreateDocumentType = 'docx' | 'pdf' | 'md' | 'html'

export interface CreateDocumentRequest {
  type: CreateDocumentType
  /** file name stem (sanitized main-side) */
  title: string
  /** docx/pdf: restricted HTML; md: Markdown source; html: a complete HTML document */
  content: string
  /** home-chat callers: dock the result into the Home right pane instead of a
   *  full tab (P1 契约 — the conversation stays beside the document) */
  dock?: boolean
  /** project the document belongs to (项目中心模型): its root becomes the
   *  first-save / direct-write directory instead of the global default */
  projectId?: string
  /** T3 排版接力: the user's original instruction for this turn — docked docx
   *  routes carry it into AiDocContent so the docs renderer runs one local
   *  AgentLoop formatting pass (fonts / TOC / page numbers) after the fill */
  instruction?: string
}

export interface CreateDocumentResult {
  ok: boolean
  /** the created file, when it is written directly (pdf/md); docx opens as a new tab that saves itself */
  path?: string
  error?: string
}

/** AI-authored content queued for a docs tab spawned by create_document */
export interface AiDocContent {
  title: string
  html: string
  /** T3 排版接力: after the boot fill, the docked editor runs one local
   *  formatting turn over this raw user instruction (absent = no pass) */
  formattingInstruction?: string
}

export type ZoteroCommand =
  'addEditCitation' | 'addEditBibliography' | 'refresh' | 'setDocPrefs' | 'removeCodes'

export type ZoteroCommandErrorCode =
  'connection-refused' | 'unsupported-command' | 'operation-failed'

export interface ZoteroCommandResult {
  ok: boolean
  errorCode?: ZoteroCommandErrorCode
  error?: string
}

export interface ZoteroRendererRequest {
  requestId: string
  command: string
  args: unknown[]
}

export interface ZoteroRendererResponse {
  requestId: string
  ok: boolean
  result?: unknown
  error?: string
}

/**
 * MCP bridge: an editor command pushed from the shell main process into a docs
 * tab so an external agent drives the *visible* editor instead of writing a file
 * behind it. `insert_content` / `replace_blocks` / `apply_ops` / `read_document`
 * reuse the built-in agent's tool executors; `save_document` writes the live
 * document to an explicit path.
 */
export type McpEditorCommand =
  'insert_content' | 'replace_blocks' | 'apply_ops' | 'read_document' | 'save_document'

export interface McpCommandMessage {
  requestId: string
  command: McpEditorCommand
  payload: unknown
}

export interface McpCommandResult {
  requestId: string
  ok: boolean
  result?: unknown
  error?: string
}

export interface McpSaveResult {
  ok: boolean
  path?: string
  error?: string
  passwordIntentPending?: boolean
  dataUrl?: string
}

export interface DesktopApi {
  /** current UI language (persisted by the shell in app-settings.json) */
  getLanguage(): Promise<'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'th' | 'id' | 'ru' | 'ar'>
  /** language switched from the shell home page */
  onLanguageChanged(
    handler: (
      lang: 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'th' | 'id' | 'ru' | 'ar',
    ) => void,
  ): () => void
  /** current UI theme preference (persisted by the shell in app-settings.json) */
  getTheme(): Promise<UiTheme>
  /** theme switched from the shell home page */
  onThemeChanged(handler: (theme: UiTheme) => void): () => void
  /** shell-wide AutoSave default (see useAutoSavePref) */
  getAutoSaveDefault(): Promise<AutoSaveDefault>
  onAutoSaveDefaultChanged(handler: (value: AutoSaveDefault) => void): () => void
  /** AI panel text size + chat-input spellcheck (Settings → General in the shell) */
  getAiPanelPrefs(): Promise<AiPanelPrefs>
  setAiPanelPrefs(patch: Partial<AiPanelPrefs>): Promise<AiPanelPrefs>
  onAiPanelPrefsChanged(handler: (prefs: AiPanelPrefs) => void): () => void
  /** dock lifecycle (P1 契约): the shell pushes false when a docked editor
   *  pops out to a full tab — restore the editor's own panel preference */
  onDockedState(handler: (docked: boolean) => void): () => void
  /** press on the shell chrome (tab strip is a sibling WebContentsView whose
   *  clicks produce no DOM event here) — dismiss open popovers */
  onChromePressed(handler: () => void): () => void
  /** invoke Zotero's word-processor integration and service its document callbacks */
  zoteroCommand(command: ZoteroCommand): Promise<ZoteroCommandResult>
  onZoteroRequest(handler: (request: ZoteroRendererRequest) => void): () => void
  respondToZotero(response: ZoteroRendererResponse): void
  openDocx(): Promise<OpenDocxResult>
  openDocxPath(path: string): Promise<OpenDocxResult>
  /** decrypt-and-open a password-protected docx (path from a needsPassword result) */
  openDocxDecrypt(path: string, password: string): Promise<DecryptOpenResult>
  /** w:altChunk HTML rendered through html2docx in a hidden window; null when conversion fails */
  convertAltChunkHtml(html: string): Promise<Uint8Array | null>
  /** Review > Protect: set (or clear with null) the desired next-save password;
   *  filePath null = document not saved yet, applied on its first successful save */
  setDocPassword(filePath: string | null, password: string | null): Promise<{ ok: boolean }>
  /** snapshot the current intent sequence before replacement cleanup is queued */
  docPasswordIntentRevision(): Promise<number>
  /** discard prior-document intents through a captured revision */
  discardDocPasswordIntents(throughRevision: number): Promise<{ ok: boolean }>
  /** mark the renderer ready and consume a file passed by Finder/Explorer at launch */
  consumePendingOpenDocx(): Promise<OpenDocxResult>
  /** returns true when this tab was created via "New Document" and should start blank */
  consumeNewBlankDoc(): Promise<boolean>
  /** AI-authored content queued for this tab by create_document; one-shot, null when none */
  consumeAiDocContent(): Promise<AiDocContent | null>
  /** Headless export mode: the path and format this hidden renderer must export, null in normal use */
  consumeHeadlessExport(): Promise<HeadlessExportTarget | null>
  /** Headless export mode: report the export outcome so the main process can quit */
  headlessExportDone(result: { ok: boolean; error?: string }): void
  /** AI create_document: build a new standalone file and open it in a new tab */
  createDocument(request: CreateDocumentRequest): Promise<CreateDocumentResult>
  /** receive documents opened from Finder/Explorer while the app is running */
  onOpenDocx(handler: (result: Exclude<OpenDocxResult, null>) => void): () => void
  /** File was renamed externally (renamed in the shell Home list) — pushes old and new paths; renderer syncs its save path and title bar */
  onRenamedDocx(handler: (paths: { oldPath: string; newPath: string }) => void): () => void
  /** auto=true marks an autosave: an externally modified file then fails with
   *  reason 'external-modified' instead of prompting (manual saves get an
   *  Overwrite/Cancel dialog in the main process) */
  saveDocx(
    path: string,
    data: ArrayBuffer,
    auto?: boolean,
  ): Promise<{
    ok: boolean
    error?: string
    reason?: 'external-modified'
    /** a newer password choice arrived after this save's snapshot */
    passwordIntentPending?: boolean
    /** one-shot URL of the saved document in full when an encrypted save absorbed
     *  lazily served pictures: the renderer reparses from it and leaves lazy mode */
    dataUrl?: string
  }>
  /** crash-recovery copy of a dirty document, stored under userData */
  writeRecoveryCopy(path: string, data: ArrayBuffer): Promise<{ ok: boolean }>
  /** 察元 AI docops: export one file (save dialog) or many (folder pick) */
  exportFiles(
    suggestedName: string,
    files: Array<{ fileName: string; base64: string }>,
  ): Promise<{ ok: boolean; canceled?: boolean; error?: string; paths?: string[] }>
  /** 察元 AI docops: declassify backup sidecar next to the document */
  declassifyStore(
    action: 'save' | 'load' | 'clear',
    docPath: string,
    sidecar?: unknown,
  ): Promise<{ ok: boolean; error?: string; path?: string; sidecar?: unknown }>
  /** tab closed but webContents kept alive (shell freeze workaround) — stop background timers */
  onTeardown(handler: () => void): () => void
  /** one trusted space keystroke into this webContents — the only thing that
   *  makes Blink respell existing text after the spellcheck attribute turns
   *  back on (r168); the caller pauses the PM DOM observer and removes the
   *  space again by script */
  respellKick(): Promise<void>
  /** append one line to userData/spell-diag.log (size-capped) — field
   *  spellcheck failures are intermittent and platform-bound, so the
   *  toggle/kick lifecycle keeps a trace support can ask users for */
  spellDiag(line: string): void
  /** sourcePath: the document's current path — Save As uses its desired next-save
   *  password and commits that state to the chosen path only after success */
  saveDocxAs(
    defaultName: string,
    data: ArrayBuffer,
    sourcePath?: string | null,
  ): Promise<{
    ok: boolean
    path?: string
    error?: string
    passwordIntentPending?: boolean
    dataUrl?: string
  }>
  /** first save of a new document: silently writes into the default folder, no dialog */
  saveDocxNew(
    defaultName: string,
    data: ArrayBuffer,
  ): Promise<{
    ok: boolean
    path?: string
    error?: string
    passwordIntentPending?: boolean
    dataUrl?: string
  }>
  /** MCP-driven output: write the current document to an explicit absolute path
   *  with no dialog; refuses to replace an existing file unless overwrite is true */
  saveDocxTo(path: string, data: ArrayBuffer, overwrite: boolean): Promise<McpSaveResult>
  /** MCP bridge: receive an editor command pushed by the shell main process */
  onMcpCommand(handler: (message: McpCommandMessage) => void): () => void
  /** MCP bridge: report a command's outcome back to the shell main process */
  reportMcpResult(result: McpCommandResult): void
  /** MCP bridge: announce that this tab's editor is ready for commands */
  signalMcpReady(): void
  getRecentFiles(): Promise<string[]>
  pickImage(): Promise<PickImageResult | null>
  /** vertical metrics of an installed family (exact name match), null when missing */
  fontMetrics(family: string): Promise<FaceVerticalMetrics | null>
  /** v2 settings view: BYOK keys redacted to the KEEP_KEY sentinel */
  getAiSettings(): Promise<AiSettingsV2>
  /** persist the view; KEEP_KEY entries keep their stored key */
  setAiSettings(view: AiSettingsV2): Promise<void>
  /** quick-switch: persist the global current model */
  setAiCurrentModel(selection: AiModelSelection): Promise<void>
  /** model list discovery; doubles as the settings page connection test */
  aiDiscoverModels(target: DiscoveryTarget): Promise<{ models: AiModelEntry[]; error?: string }>
  /** system print dialog for the current window; ok=false without error = canceled.
   *  scale: print scale inverting the preview's print zoom (print-zoom.ts) */
  print(scale?: number): Promise<{ ok: boolean; error?: string }>
  /** render the document to PDF and ask where to save; size in twips.
   *  outPath is only honored when a previous export dialog chose that exact path */
  exportPdf(
    defaultName: string,
    pageWidthTwips: number,
    pageHeightTwips: number,
    outPath?: string,
    scale?: number,
  ): Promise<{ ok: boolean; path?: string; error?: string }>
  exportHtml(
    defaultName: string,
    html: string,
    outPath?: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }>
  /** Mixed paper-size export: produce a set of PDF bytes (base64) at given sizes per the current print layout */
  printPdfBuffer(
    pageWidthTwips: number,
    pageHeightTwips: number,
    scale?: number,
  ): Promise<{ ok: boolean; base64?: string; error?: string }>
  /** Merge grouped PDF fragments in order and write to disk (missing outPath opens
   *  the save dialog; a given outPath must come from a previous export dialog) */
  saveMergedPdf(
    defaultName: string,
    base64Parts: string[],
    outPath?: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }>
  aiChat(request: {
    selection: AiModelSelection
    system: string
    user: string
  }): Promise<AiChatResponse>
  /** start a streaming AI call; deltas arrive via onAiStream with the same requestId.
   *  The `settings` slot carries the model selection (agent-core's generic transport shape). */
  aiStream(request: AiStreamWireRequest): Promise<void>
  pickExportImagesTarget(): Promise<{ dir: string; pdfPath: string } | null>
  takeExportPdf(pdfPath: string): Promise<{ ok: boolean; base64?: string; error?: string }>
  /** Write one page PNG into the folder chosen by pickExportImagesTarget */
  writeExportImage(
    dir: string,
    fileName: string,
    pngBase64: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }>
  /** Save a picture the renderer displays (data URL) through a Save dialog */
  saveImageAs(src: string): Promise<{ ok: boolean; path?: string; error?: string }>
  onViewImage(handler: (src: string) => void): () => void
  aiStreamCancel(requestId: string): Promise<void>
  /** ChatOffice account status (chatoffice login state); withEmail also returns the email (needs a network request, slower) */
  aiChatOfficeStatus(withEmail?: boolean): Promise<ChatOfficeAccountStatus>
  /** Open the browser to log in to ChatOffice (fire-and-forget; aiChatOfficeStatus flips to logged-in when done) */
  aiChatOfficeLogin(): Promise<void>
  /** 本地与自建：探测 / 一键安装 / 启动（模型设置页状态卡） */
  aiLocalToolStatus(vendorId: string): Promise<LocalToolStatus>
  aiLocalToolInstall(vendorId: string, onLine?: (line: string) => void): Promise<LocalToolOpResult>
  aiLocalToolStart(vendorId: string): Promise<LocalToolOpResult>
  webSearch(
    query: string,
    maxResults?: number,
  ): Promise<{
    results: Array<{ title: string; url: string; snippet: string }>
    answer?: string
    method: string
    /** failure reason when method === 'error' */
    error?: string
  }>
  imageSearch(
    query: string,
    maxResults?: number,
  ): Promise<{
    images: Array<{
      title: string
      imageUrl: string
      sourceUrl: string
      source: string
      width?: number
      height?: number
    }>
    method: string
    /** failure reason when method === 'error' */
    error?: string
  }>
  fetchImage(url: string): Promise<{ base64: string; mime: string } | null>
  stockImageSearch(
    source: string,
    query: string,
    maxResults?: number,
    page?: number,
  ): Promise<{ images: unknown[]; source: string; error?: string; code?: string }>
  stockKeysGet(): Promise<{ pexels: string; pixabay: string; unsplash?: string }>
  stockKeysSet(keys: { pexels?: string; pixabay?: string; unsplash?: string }): Promise<void>
  webImageSearch(
    query: string,
    maxResults?: number,
    page?: number,
    source?: string,
  ): Promise<{
    images: {
      thumbnail?: string
      full: string
      width?: number
      height?: number
      attribution?: string
    }[]
    method?: string
    error?: string
    attempts?: {
      backend: string
      status: 'skipped' | 'ok' | 'error'
      detail?: string
      count?: number
    }[]
  }>
  remoteImage(url: string): Promise<{ base64: string; mime: string } | null>
  /** SVG illustration on the svgGeneration default (or explicit) chat model */
  generateSvg(req: {
    profileId?: string
    modelId?: string
    prompt: string
  }): Promise<{ svg?: string; modelId?: string; error?: string }>
  /** enabled image/video-generation models + param specs (insert-media dialog picker) */
  mediaModels(): Promise<{
    models: {
      kind: 'image' | 'video'
      profileId: string
      modelId: string
      label: string
      vendorId: string
      isDefault?: boolean
      spec: {
        fields: {
          id: string
          label: string
          labelZh?: string
          type: 'select' | 'text' | 'number'
          options?: Array<string | number>
          min?: number
          max?: number
          step?: number
          default: string | number
          required?: boolean
        }[]
      }
    }[]
    error?: string
  }>
  /** media generation with model selection + dynamic params; data URLs come back */
  mediaGenerate(req: {
    profileId?: string
    modelId?: string
    prompt: string
    params?: Record<string, unknown>
  }): Promise<{ images?: { dataUrl: string }[]; error?: string }>
  /** video task registry (ai-host): submit returns immediately, tasks run main-side */
  videoSubmit(req: {
    profileId: string
    modelId: string
    label?: string
    prompt: string
    params?: Record<string, unknown>
  }): Promise<{ id?: string; error?: string; code?: string }>
  videoTasks(): Promise<{ tasks: VideoTaskInfo[]; error?: string }>
  videoCancel(id: string): Promise<void>
  videoRetry(id: string): Promise<{ error?: string }>
  videoPreview(id: string): Promise<{ dataUrl?: string; url?: string; error?: string }>
  onVideoTasksChanged(handler: (payload: { id: string; status: string }) => void): () => void
  /** AI image generation via the ChatOffice cloud channel (requires login + cloud tools) */
  aiGenerateImage(op: {
    prompt: string
    aspectRatio?: string
  }): Promise<{ url?: string; error?: string }>
  /** file picker for chat attachments (multi-select) */
  pickAttachments(): Promise<AttachmentAddResult | null>
  /** validate dropped paths and return attachment metadata */
  addAttachmentPaths(paths: string[]): Promise<AttachmentAddResult>
  /** persist a pasted clipboard image (no local path) to a temp file and add it as an attachment */
  addPastedImage(data: ArrayBuffer, ext: string): Promise<AttachmentAddResult>
  /** copy an embedded picture to the OS clipboard as a real bitmap + <img>
   *  html (r136: copying an image exported only the protected placeholder) */
  copyImageToClipboard(dataUrl: string, metaJson?: string): Promise<boolean>
  /** read a slice of the extracted text of an attachment */
  readAttachment(path: string, offset: number, maxChars: number): Promise<AttachmentReadResult>
  /** read an image attachment as base64 for multimodal input (≤5MB) */
  readAttachmentImage(path: string): Promise<AttachmentImageResult>
  /** absolute path of a File dropped onto the window (Electron webUtils) */
  getPathForFile(file: File): string
  /** View → New Tab: open another docs tab, optionally loading the same document */
  openNewTab(openPath?: string | null): Promise<void>
  /** all open docs tabs, for View → Switch Tab */
  listDocsTabs(): Promise<DocsTabInfo[]>
  focusDocsTab(id: string): Promise<void>
  /** subscribe to AI stream chunks; returns unsubscribe */
  onAiStream(handler: (chunk: AiStreamChunk) => void): () => void
  /** subscribe to native menu commands; returns unsubscribe */
  onMenuCommand(handler: (command: MenuCommand, payload?: string) => void): () => void
  /** Close guard: main process queries pre-close state (dirty flag + autosave switch; if autosave is on, save silently without a dialog) */
  onCloseCheck(handler: () => void): () => void
  reportCloseCheck(state: { dirty: boolean; autoSave: boolean; filePath?: string | null }): void
  /** Close guard chose "Save": main process asks the renderer to run the full save flow */
  onCloseSaveRequest(handler: () => void): () => void
  reportCloseSaveResult(ok: boolean): void
  /** keep the native View menu's checkbox items in sync with renderer state */
  reportViewMenuState(state: { aiSidebar: boolean; darkCanvas: boolean }): void
  /** P2 中继: emit a RelayEvent to the shell (docked conversation relay) */
  relaySend(event: unknown): void
  /** P2 中继: subscribe to RelayCommands from the shell; returns unsubscribe */
  onRelayCommand(handler: (command: unknown) => void): () => void
  /** P2-5 回流薄钩: a completed panel turn (Home mainline mirror) */
  panelTurnCompleted(turn: {
    filePath: string | null
    userText: string
    assistantText: string
    cancelled: boolean
  }): void
}

/** mirrors VIEW_IMAGE_CHANNEL in @chatoffice/electron-utils (kept literal so the preload stays free of main-only deps) */
export const VIEW_IMAGE_CHANNEL = 'chatoffice:view-image'
