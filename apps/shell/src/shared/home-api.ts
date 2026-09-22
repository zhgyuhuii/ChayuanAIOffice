import type { KbCitation } from '@chatoffice/ai-provider'
import type {
  AiModelEntry,
  AiModelSelection,
  AiSettingsV2,
  DiscoveryTarget,
  ChatOfficeAccountStatus,
  LocalToolOpResult,
  LocalToolStatus,
} from '@chatoffice/ai-provider'
import type {
  AiStreamChunk,
  AiStreamWireRequest,
  AttachmentAddResult,
  AttachmentImageResult,
  AttachmentMeta,
  AttachmentReadResult,
  CreateDocumentRequest,
  CreateDocumentResult,
} from '../../../docs/src/shared/ipc'
import type { UpdateChannel } from './update-api'
import type { AiPanelPrefs } from '@chatoffice/ui/ai-panel-prefs'

/** folder the new file's first save should land in (upstream 7036122; Home "Folders" panel) */
export interface NewFileOpts {
  dir?: string
  /** route the new file into a Home project (local feature) */
  projectId?: string
}
import type { DockKind } from './dock-api'

/** UI language; kept self-contained here (mirrors Lang in @chatoffice/i18n) */
export type UiLanguage =
  | 'zh'
  | 'en'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'th'
  | 'id'
  | 'ru'
  | 'ar'
  | 'pt'
  | 'it'
  | 'pl'
  | 'cs'
  | 'nl'
  | 'ms'
  | 'he'
  | 'hi'
  | 'zh-TW'

/** UI theme preference */
export type UiTheme = 'light' | 'dark' | 'system'

/** shell-wide AutoSave default for every editor; updatedAt is 0 until first set */
export interface AutoSaveDefault {
  on: boolean
  updatedAt: number
}

/** local MCP server state (persisted in userData/app-settings.json) */
export interface McpStatus {
  running: boolean
  enabled: boolean
  port: number
  /** headless generation (create_docx without opening the UI) is allowed */
  background: boolean
  /** server/tool activity is recorded to the local log file */
  logging: boolean
  /** base URL when running, else null */
  url: string | null
  /** capability families the running build exposes, e.g. ['docs', 'slides'] */
  capabilities: string[]
  /** present when the last start attempt failed (e.g. port in use) */
  error?: string
}

/** a recent file entry shown on the home screen; type derives from the extension */
export interface RecentEntry {
  path: string
  name: string
  /** lowercased extension without the dot ('docx' | 'xlsx' | 'pptx') */
  ext: string
  /** last-modified time, ms since epoch */
  mtimeMs: number
  /** file size in bytes */
  sizeBytes: number
  /** whether the user starred this file */
  starred: boolean
  /** the path failed to stat (disconnected drive, moved, deleted) — kept
      listed like Word's recents instead of silently dropped (r158) */
  missing?: boolean
}

/** a single file from system-wide search */
export interface SystemSearchEntry {
  name: string
  path: string
  ext: string
  mtimeMs: number
  sizeBytes: number
}

/** result of systemFileSearch */
export interface SystemSearchResult {
  entries: SystemSearchEntry[]
  /** whether the search hit the result limit (more matches may exist) */
  truncated: boolean
}

/** paged query for the home file lists */
/** an untitled temp-backed document the app can restore after a crash */
export interface PendingUntitledDocEntry {
  kind: 'sheet' | 'pdf'
  tempPath: string
  suggestedName?: string
  savedAt: number
}

export interface RecentQuery {
  /** number of entries to skip (default 0) */
  offset?: number
  /** page size; 0 returns no entries but still reports totals (default 50) */
  limit?: number
  /** restrict to one extension ('docx' | 'xlsx' | 'pptx'); omit for all */
  ext?: string
}

export interface RecentPage {
  entries: RecentEntry[]
  /** total matching the query's ext filter */
  total: number
  /** total ignoring the ext filter (for the sidebar counters) */
  totalAll: number
}

/** local file search over names, folders and extracted text */
export interface FileSearchQuery {
  q: string
  /** sidebar filter key ('docx' | 'xlsx' | ...); omit for all */
  ext?: string
  offset?: number
  limit?: number
}

export interface FileSearchSnippetPart {
  text: string
  hit: boolean
}

export interface FileSearchHit extends RecentEntry {
  /** excerpt around the first content match; null when only the name or folder matched */
  snippet: FileSearchSnippetPart[] | null
  /** folded query fragments the file matched; highlight them in the name and folder */
  needles: string[]
}

export type JevEndpoint = 'openrouter' | 'direct'

/** home search options persisted in app-settings.json under `fileSearch` */
export interface FileSearchSettings {
  /** send the top local hits to TypeSafe's Jev model for reranking; default off */
  rerank: boolean
  jevEndpoint: JevEndpoint
  jevKeys: Record<JevEndpoint, string>
}

export interface FileSearchRerank {
  /** paths in Jev's order, most relevant first; paths not judged keep their local order after these */
  order: string[]
  /** calibrated 0–2 relevance per judged path */
  scores: Record<string, number>
}

export interface FileSearchPage {
  hits: FileSearchHit[]
  total: number
  index: {
    indexed: number
    pending: number
    scanning: boolean
  }
}

export interface HomeApi {
  /** unified recents across document types, newest first (paged) */
  recents(query?: RecentQuery): Promise<RecentPage>
  /** search indexed files by name, folder and content */
  searchFiles(query: FileSearchQuery): Promise<FileSearchPage>
  /** Jev order for the hits currently shown (≤ 20 paths); null when reranking is off or unavailable */
  rerankSearch(query: { q: string; paths: string[] }): Promise<FileSearchRerank | null>
  getFileSearchSettings(): Promise<FileSearchSettings>
  setFileSearchSettings(patch: Partial<FileSearchSettings>): Promise<FileSearchSettings>
  /** one two-document Jev judgement against a (possibly unsaved) key */
  testFileSearchRerank(input: {
    endpoint: JevEndpoint
    apiKey: string
  }): Promise<{ ok: boolean; error?: string }>
  /** starred files (independent of the recent list), newest first (paged) */
  starred(query?: RecentQuery): Promise<RecentPage>
  /** stat a specific set of paths (project view); unstat-able files come back flagged `missing` */
  statPaths(paths: string[]): Promise<RecentEntry[]>
  /** star / unstar a file */
  toggleStar(path: string): Promise<void>
  /** open an existing file, routing to the right module by extension */
  /** options.dock (home-chat open_document): dock the file into the Home
   *  right pane instead of opening a full tab (P1 契约) */
  openPath(path: string, options?: { dock?: boolean }): Promise<void>
  /** file picker accepting every supported extension, then routes */
  browse(): Promise<void>
  /** open a docs window at its start screen; `dir` = folder the first save should land in */
  newDoc(opts?: NewFileOpts): Promise<void>
  /** open a sheets window */
  newSheet(opts?: NewFileOpts): Promise<void>
  /** open a slides tab at its start screen (open-a-pptx) */
  newSlide(opts?: NewFileOpts): Promise<void>
  /** open a blank markdown editor tab */
  newMarkdown(opts?: NewFileOpts): Promise<void>
  /** open a blank html editor tab */
  newHtml(opts?: NewFileOpts): Promise<void>
  /** create a blank single-page PDF in the default save folder and open it */
  newPdf(opts?: { projectId?: string } & NewFileOpts): Promise<void>
  /** Untitled temp-backed documents (crashed before first save) offered on the Home restore banner */
  listPendingUntitled(): Promise<PendingUntitledDocEntry[]>
  /** Reopen a crashed untitled document as an unsaved in-memory tab */
  restorePendingUntitled(tempPath: string): Promise<boolean>
  /** Forget a crashed untitled document without restoring it */
  discardPendingUntitled(tempPath: string): Promise<boolean>
  /** drop entries from the recent list (does not touch the files) */
  removeRecent(paths: string[]): Promise<void>
  /** reveal the file in Finder / Explorer */
  revealPath(path: string): Promise<void>
  /** rename the file on disk (same directory) and update the recent list */
  renameFile(path: string, newName: string): Promise<RenameResult>
  /** copy the file next to itself (localized "copy" suffix before .ext) and record it as recent */
  duplicateFile(path: string): Promise<void>
  /** move files to the trash and drop them from the recent list */
  deleteFiles(paths: string[]): Promise<void>
  /** open the OS trash, where deleted files can be restored */
  openTrash(): Promise<void>
  /** the tree roots: the default save folder first, then the folders the user added */
  folderRoots(): Promise<FolderRoot[]>
  /** directory picker; the chosen folder joins the tree in place (nothing is copied or moved) */
  addFolderRoot(): Promise<FolderRoot | null>
  /** OS paths dropped on the Folders panel: folders join the tree, documents open */
  dropFolderRoots(paths: string[]): Promise<FolderRoot[]>
  /** take an added folder off the list; the disk is untouched */
  removeFolderRoot(path: string): Promise<void>
  /** absolute path of a File from an OS drag (Electron webUtils) */
  pathForFile(file: File): string
  /** one level of the tree: sub-folders + supported files directly inside `dir` */
  listFolder(dir: string): Promise<FolderListing>
  /** create `parent/name`; resolves to the new path */
  createFolder(parent: string, name: string): Promise<RenameResult>
  /** rename a folder in place (files inside keep their recents/stars/chat history) */
  renameFolder(dir: string, newName: string): Promise<RenameResult>
  /** move files and/or folders into `targetDir` */
  movePaths(paths: string[], targetDir: string, onConflict: MoveConflictPolicy): Promise<MoveResult>
  /** move a folder (and everything inside) to the trash */
  deleteFolder(dir: string): Promise<void>
  /** a folder under the root changed on disk (created/renamed/deleted/moved, from anywhere) */
  onFolderChanged(handler: (dirs: string[]) => void): () => void
  /** current UI language (persisted in userData/app-settings.json) */
  getLanguage(): Promise<UiLanguage>
  /** switch + persist the UI language; main rebuilds its menus to match */
  setLanguage(lang: UiLanguage): Promise<void>
  /** current update channel (persisted in userData/app-settings.json; default 'stable') */
  getUpdateChannel(): Promise<UpdateChannel>
  /** switch + persist the update channel; triggers an immediate update check */
  setUpdateChannel(channel: UpdateChannel): Promise<void>
  /** ChatOffice account status (chatoffice login state; to be upgraded to a signup/account system later) */
  accountStatus(): Promise<AccountStatus>
  /** start ChatOffice login (opens the browser; accountStatus flips to logged-in on completion); returns whether the launch succeeded */
  accountLogin(): Promise<boolean>
  /** progress events for the login started via accountLogin; returns an unsubscribe */
  onAccountLogin(handler: (ev: AccountLoginEvent) => void): () => void
  /** re-open the pending login auth URL in the default browser (rescue when auto-open failed) */
  openLoginUrl(): Promise<void>
  /** open an arbitrary https URL in the system browser (homepage footer links);
   *  main validates the scheme, non-https is dropped. Optional: web shim omits it */
  openExternal?(url: string): Promise<void>
  openChat?(): Promise<boolean>
  /** log out (clears the saved API key; the login state is shared globally with the chatoffice CLI) */
  accountLogout(): Promise<void>
  /** app version (from package.json / electron app.getVersion) */
  getAppVersion(): Promise<string>
  /** feedback channel (aidooo.com): cheap connectivity probe — true when the dialog can be opened */
  feedbackProbe(): Promise<boolean>
  /** upload one feedback attachment (binary); main proxies to aidooo.com (renderer CSP blocks cross-origin) */
  feedbackUpload(name: string, mime: string, data: Uint8Array): Promise<FeedbackUploadResult>
  /** submit the feedback form; main holds the signing secret and app identity */
  feedbackSubmit(payload: FeedbackSubmitPayload): Promise<FeedbackSubmitResult>
  /** whether the first-run onboarding has been completed or skipped (persisted in userData/app-settings.json) */
  onboardingSeen(): Promise<boolean>
  /** mark onboarding done; analytics remains enabled unless separately opted out */
  setOnboardingSeen(): Promise<boolean>
  /** current UI theme preference (persisted in userData/app-settings.json) */
  getTheme(): Promise<UiTheme>
  /** switch + persist the UI theme; broadcasts 'app:theme-changed' to all web contents */
  setTheme(theme: UiTheme): Promise<void>
  /** AutoSave default applied by every editor window (persisted in userData/app-settings.json) */
  getAutoSaveDefault(): Promise<AutoSaveDefault>
  /** persist the AutoSave default; broadcasts 'app:auto-save-default-changed' to all web contents */
  setAutoSaveDefault(on: boolean): Promise<void>
  /** current local MCP server state (running/enabled/port/url) */
  getMcpStatus(): Promise<McpStatus>
  /** enable/disable the MCP server and/or change its port/background/logging; applies and persists, returns the new state */
  setMcpSettings(patch: {
    enabled?: boolean
    port?: number
    background?: boolean
    logging?: boolean
  }): Promise<McpStatus>
  /** last MCP log lines (empty when logging has never been on) */
  getMcpLogs(): Promise<string[]>
  /** truncate the MCP log file */
  clearMcpLogs(): Promise<void>
  /** reveal the MCP log file in the file manager (created empty when missing) */
  openMcpLogFile(): Promise<void>
  /** whether anonymous usage statistics are enabled (default true in official builds) */
  getAnalyticsEnabled(): Promise<boolean>
  /** persist an explicit analytics opt-in or opt-out */
  setAnalyticsEnabled(enabled: boolean): Promise<boolean>
  /** effective default save folder for new/untitled files (configured in userData/app-settings.json, falls back to <Documents>/ChatOffice) */
  getDefaultSaveDir(): Promise<string>
  /** directory picker to change the default save folder; resolves to the new folder, or null when canceled or the pick was unusable */
  pickDefaultSaveDir(): Promise<string | null>
  /** theme switched anywhere (broadcast from the main process) */
  onThemeChanged(handler: (theme: UiTheme) => void): () => void
  /** open the GenTeam community page in the default browser */
  openGenTeam(): Promise<void>
  /** open the ChatOffice credit-usage page in the default browser */
  openCreditUsage(): Promise<void>
  /** open the public GitHub repository in the default browser */
  openGitHubRepo(): Promise<void>
  /** current stargazer count of the public repo (null while offline / rate-limited) */
  githubStars(): Promise<number | null>
  /** whether the one-time "star us" prompt should show now (show:true also counts as shown);
   * docOpens personalizes the card copy ("you've opened N documents") */
  starPromptShouldShow(): Promise<StarPromptShow>
  /** user reacted to the star prompt; 'starred' resolves it permanently */
  starPromptAction(action: StarPromptAction): Promise<void>
  /** locally stored full cloud project list (instant; null when no store or logged out) */
  cloudProjectsCached(): Promise<CloudProjectsSnapshot | null>
  /** sync the full list from ChatOffice and return it (1 request when nothing changed); null when the sync failed */
  cloudProjectsSync(): Promise<CloudProjectsSnapshot | null>
  /** open a cloud project (relative '/agents?id=...' URL) in the default browser */
  openCloudProject(projectUrl: string): Promise<void>
  /** AI settings (userData/ai-settings.json, shared by every editor); the chatoffice key never appears here */
  getAiSettings(): Promise<AiSettingsV2>
  /** persist AI settings; open editors pick the change up on their next settings read */
  setAiSettings(view: AiSettingsV2): Promise<void>
  /** quick-switch: persist the global current model */
  setAiCurrentModel(selection: AiModelSelection): Promise<void>
  /** model list discovery; doubles as the settings page connection test */
  aiDiscoverModels(target: DiscoveryTarget): Promise<{ models: AiModelEntry[]; error?: string }>
  /** chatoffice login state */
  chatofficeStatus(withEmail?: boolean): Promise<ChatOfficeAccountStatus>
  /** open the browser to log in to ChatOffice */
  chatofficeLogin(): Promise<void>
  /** 本地与自建：探测 / 一键安装 / 启动（模型设置页状态卡） */
  aiLocalToolStatus(vendorId: string): Promise<LocalToolStatus>
  aiLocalToolInstall(vendorId: string, onLine?: (line: string) => void): Promise<LocalToolOpResult>
  aiLocalToolStart(vendorId: string): Promise<LocalToolOpResult>
  /** 生图、媒体与搜索：搜索平台连通性探测（主进程执行） */
  aiTestSearchPlatform(req: {
    platform: string
    key?: string
  }): Promise<{ ok: boolean; detail?: string }>
  /** 首页对话能力工具：网页搜索（按全局默认平台路由） */
  webSearch(
    query: string,
    maxResults?: number,
  ): Promise<{
    results: { title: string; url: string; snippet: string }[]
    answer?: string
    method: string
    error?: string
  }>
  /** 搜索通道可用性探测（web_search 工具门控；web 宿主 shim 可不实现） */
  searchCapabilities?(): Promise<{ search: boolean }>
  /** 首页对话能力工具：AI 生图（默认生图模型，返回 data: URL） */
  mediaGenerate(req: {
    profileId?: string
    modelId?: string
    prompt: string
    params?: Record<string, unknown>
  }): Promise<{ images?: { dataUrl: string }[]; error?: string }>
  /** 首页对话能力工具：SVG 插画（默认 SVG 对话模型） */
  generateSvg(req: {
    profileId?: string
    modelId?: string
    prompt: string
  }): Promise<{ svg?: string; modelId?: string; error?: string }>
  /** unified media capability probe + generation/understanding/speech channels (main: registerMediaIpc) */
  mediaCapabilities(): Promise<{ flags?: Record<string, boolean>; models?: Record<string, string> }>
  mediaVideo(req: {
    prompt: string
    aspectRatio?: string
    durationSeconds?: number
  }): Promise<{ url?: string; filePath?: string; model?: string; error?: string }>
  mediaUnderstand(req: {
    kind: 'image' | 'video' | 'auto'
    sources: string[]
    requirements: string
  }): Promise<{ text?: string; error?: string }>
  mediaAsr(req: { source: string; language?: string }): Promise<{ text?: string; error?: string }>
  mediaTts(req: { text: string; voice?: string }): Promise<{ url?: string; mime?: string; error?: string }>
  /** start a streaming AI turn for the home chat; chunks arrive via onAiStream (same ai:* channels the editors use) */
  aiStream(request: AiStreamWireRequest): Promise<void>
  /** abort an in-flight home chat turn */
  aiStreamCancel(requestId: string): Promise<void>
  /** subscribe to AI stream chunks; returns an unsubscribe */
  onAiStream(handler: (chunk: AiStreamChunk) => void): () => void
  /** AI create_document: build a standalone file and open it in a new tab (docs:create-document) */
  createDocument(request: CreateDocumentRequest): Promise<CreateDocumentResult>
  /** file picker for home chat attachments (multi-select) */
  pickAttachments(): Promise<AttachmentAddResult | null>
  /** validate dropped file paths into attachment metadata */
  validateAttachments(paths: string[]): Promise<AttachmentAddResult>
  /** read a slice of an attachment's extracted text */
  readAttachment(path: string, offset?: number, maxChars?: number): Promise<AttachmentReadResult>
  /** read an image attachment's raw bytes as base64 (multimodal input) */
  readAttachmentImage(path: string): Promise<AttachmentImageResult>
  /** system-wide file search across common user directories (Documents, Desktop, Downloads); returns matching document files sorted by mtime */
  systemFileSearch(query: string, ext?: string): Promise<SystemSearchResult>
  /** load persisted home chat sessions (userData/home-chat-sessions.json) */
  chatSessionsLoad(): Promise<HomeChatSession[]>
  /** persist home chat sessions */
  chatSessionsSave(sessions: HomeChatSession[]): Promise<void>
  /** AI panel layout prefs (upstream parity; applied by editor panels) */
  getAiPanelPrefs(): Promise<AiPanelPrefs>
  setAiPanelPrefs(patch: Partial<AiPanelPrefs>): Promise<AiPanelPrefs>
}

// ── Home chat (AI agent on the home screen) ─────────────────

/** a file attached to a home chat message (metadata only; bytes stay on disk) */
export type HomeChatAttachment = AttachmentMeta

/** side card rendered under an assistant message */
export type HomeChatCard =
  /** the streamed body became a document that opened in a new tab */
  | {
      kind: 'doc-created'
      title: string
      docType: 'docx' | 'xlsx' | 'pptx' | 'md' | 'html' | 'pdf'
      filePath?: string | undefined
    }
  /** an existing document was opened (with the conversation handed off to its panel) */
  | { kind: 'doc-opened'; title: string; filePath: string }
  /** no usable model is configured; offers a jump to AI settings */
  | { kind: 'setup-required' }

export interface HomeChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** assistant text is a document body: restricted HTML for docx, Markdown for md */
  bodyFormat?: 'html' | 'markdown' | undefined
  attachments?: HomeChatAttachment[] | undefined
  card?: HomeChatCard | undefined
  /** model/IPC failure — the text holds the error description */
  error?: boolean | undefined
  ts: number
  /** P2 中继轮次: this assistant message is the mirror of one relayed turn
   *  into a docked editor's loop; local agent runs feed the same timeline */
  relayTurnId?: string | undefined
  /** tool activity timeline of this assistant message (running pulse → 成败),
   *  fed by BOTH the relay mirror and the home agent's own tool executions */
  relayTools?:
    | Array<{
        callId: string
        name: string
        summary?: string
        running?: boolean
        ok?: boolean
        outputPreview?: string
        /** search_files/system_search 的命中文件(可点击打开) */
        files?: Array<{ name: string; path: string }>
        /** generate_image 的生成结果(data: URL,工具卡内嵌展示) */
        image?: string
      }>
    | undefined
  /** ZCode 式任务清单:update_task_list 工具维护的全量快照(最新一次覆盖) */
  tasks?: Array<{ title: string; status: 'pending' | 'in_progress' | 'done' }> | undefined
  /** KB 检索引用:本轮发送前注入的知识库片段(编号 [n] ↔ chips 渲染) */
  kbCitations?: KbCitation[] | undefined
  /** P2-7 确认门:该轮挂起的大纲/计划确认卡(决议后原地留痕) */
  relayConfirm?:
    | {
        confirmId: string
        kind: 'ops' | 'plan' | 'outline'
        payload: string
        state: 'pending' | 'approved' | 'rejected' | 'expired'
        feedback?: string
      }
    | undefined
}

/** where a home-chat session lives in the left tree (P2): a project's own
 * conversation (a "task") or one attached to a document file */
export interface HomeChatSessionScope {
  kind: 'project' | 'file'
  /** project id, or the file's absolute path */
  id: string
}

export interface HomeChatSession {
  id: string
  /** sidebar label: first user message, truncated */
  title: string
  createdAt: number
  updatedAt: number
  messages: HomeChatMessage[]
  /** tree ownership; absent on legacy sessions = unattached (未归属) */
  scope?: HomeChatSessionScope | undefined
  /** archived out of the tree's conversation lists (ZCode 式归档):
   *  lives only in the archive view until unarchived */
  archived?: boolean | undefined
  /** pinned to the top of its list (对话 group / its project's list) */
  pinned?: boolean | undefined
  /** set when the conversation moved into a document tab's AI panel: the home
   * copy becomes read-only and offers "open that tab" instead of continuing */
  handedOff?: { docTitle: string; filePath?: string | undefined } | undefined
  /** session-scoped model picked in the composer; falls back to the global
   *  current model when absent (the picker writes here, never to the global) */
  modelId?: AiModelSelection | undefined
  /** composer mode: 'plan' constrains the agent to advice-only replies */
  mode?: 'default' | 'plan' | undefined
  /** active assistant persona picked in the composer's assistant picker:
   *  identity for re-hydration (label/icon for the chip) — the persona text
   *  itself is re-loaded from the assistant library by id on session switch */
  assistant?: { id: string; icon: string; label: string } | undefined
  /** docked-editor tab group this conversation works with (P1 契约):
   *  remembered across session switches — the views live in the main process,
   *  only the arrangement is persisted here and re-docked on switch-back */
  dock?:
    { tabs: Array<{ kind: DockKind; file?: string | undefined }>; activeIndex?: number } | undefined
}

/** 'starred' = went to GitHub or said "already starred" (never prompt again);
 * 'later' = dismissed this time (already counted as shown by the query) */
export type StarPromptAction = 'starred' | 'later'

/** answer to starPromptShouldShow */
export interface StarPromptShow {
  show: boolean
  /** lifetime documents opened — drives the personalized card title */
  docOpens: number
}

export type CloudProjectKind = 'docs' | 'sheets' | 'slides'

/** a ChatOffice web project shown in the home cloud section */
export interface CloudProjectEntry {
  projectId: string
  title: string
  /** module kind derived from the API project type ('docs_agent' → 'docs') */
  kind: CloudProjectKind | 'other'
  /** creation time, ms since epoch (0 when unparsable) */
  ctimeMs: number
  /** relative genspark.ai URL ('/agents?id=...') */
  projectUrl: string
}

/** full local copy of the cloud project list; filtering/paging are client-side */
export interface CloudProjectsSnapshot {
  /** false when chatoffice is unavailable (CLI missing or not logged in) */
  available: boolean
  /** all projects, newest first */
  projects: CloudProjectEntry[]
  /** ms epoch of the last successful sync (0 when never synced) */
  syncedAt: number
}

export interface AccountStatus {
  /** chatoffice is installed and logged in */
  loggedIn: boolean
  email?: string
  /** remaining ChatOffice credits (absent when the balance query failed) */
  creditBalance?: number
}

/** login flow progress pushed from main (chatoffice login CLI output) */
export interface AccountLoginEvent {
  phase: 'launched' | 'url' | 'success' | 'error'
  url?: string
  expiresInSec?: number
  /** 'network' | 'expired' | raw CLI error text */
  error?: string
}

export interface RenameResult {
  ok: boolean
  /** the new absolute path when ok */
  path?: string
  error?: string
}

// ── Feedback channel (aidooo.com) ───────────────────────────

/** uploaded attachment metadata, referenced by the submit payload */
export interface FeedbackAttachmentMeta {
  name: string
  /** relative URL on aidooo.com (/feedback-uploads/...) */
  url: string
  kind: 'image' | 'file'
  size: number
}

/** renderer→main submit payload: device id + diagnostics + the form itself */
export interface FeedbackSubmitPayload {
  /** 16-hex device id (renderer-owned, localStorage-anchored) */
  mid: string
  /** 'bug' | 'suggestion' | 'other' */
  type: string
  content: string
  attachments: FeedbackAttachmentMeta[]
  /** diagnostics JSON string (version/ua/log tail) */
  logJson: string
  appVersion?: string
  os?: string
  osVer?: string
  arch?: string
}

export interface FeedbackSubmitResult {
  ok: boolean
  id?: string
  status?: string
  /** true when the failure looks like "no network" (renderer offers a draft) */
  offline?: boolean
  error?: string
}

export interface FeedbackUploadResult {
  ok: boolean
  name?: string
  url?: string
  kind?: 'image' | 'file'
  size?: number
  error?: string
}

// ── Project-related APIs (P1) ────────────────────────────────

export interface ProjectSummaryEntry {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  fileCount: number
  lastActiveAt: string
  isDefault: boolean
  /** P4 folder project: absolute directory this project is bound to */
  rootPath?: string
}

export interface TimelineEntryItem {
  filePath: string
  fileName: string
  chatId: string
  ts: string
  role: 'user' | 'assistant'
  preview: string
  seq: number
}

export interface ProjectHomeApi {
  /** list all projects (with file count + last-active time) */
  listProjects(): Promise<ProjectSummaryEntry[]>
  /** list existing files currently belonging to a project */
  listFiles(projectId: string): Promise<string[]>
  /** create a project */
  createProject(name: string, rootPath?: string): Promise<ProjectSummaryEntry>
  /** rename a project */
  renameProject(id: string, name: string): Promise<void>
  /** soft-delete a project */
  deleteProject(id: string): Promise<void>
  /** move a file into the given project */
  /** P4: OS directory picker for binding a new project; null = cancelled */
  pickFolder(): Promise<string | null>
  moveFile(filePath: string, projectId: string): Promise<void>
  /** fetch the project timeline */
  getTimeline(projectId: string, limit?: number): Promise<TimelineEntryItem[]>
}

// ── Folder tree (home "Folders" panel: the default save folder plus any folder the user added) ──

export interface FolderRoot {
  path: string
  /** folder name shown on the root row */
  name: string
  /** false when the folder does not exist and cannot be created, or is read-only */
  usable: boolean
  /** the folder exists and can be listed (a read-only or unplugged root is still shown) */
  readable: boolean
  /** an added folder: can be taken off the list; the default save folder cannot */
  removable: boolean
}

export interface FolderEntry {
  path: string
  name: string
  mtimeMs: number
  /** whether it contains at least one visible sub-folder (drives the expand chevron) */
  hasSubfolders: boolean
}

/** a document file listed by the tree (same shape as the home recents rows) */
export interface FileEntry {
  path: string
  name: string
  /** lowercased extension without the dot */
  ext: string
  mtimeMs: number
  sizeBytes: number
  starred: boolean
  /** the path failed to stat */
  missing?: boolean
}

export interface FolderListing {
  dir: string
  folders: FolderEntry[]
  /** supported document files directly inside `dir`, newest first */
  files: FileEntry[]
  /** the directory could not be read (deleted or moved outside the app) */
  missing?: boolean
}

/** what to do when a moved item's name already exists in the target */
export type MoveConflictPolicy = 'ask' | 'replace' | 'keepBoth' | 'skip'

export interface MoveResult {
  /** old path → new path for everything that moved */
  moved: Array<{ from: string; to: string }>
  /** items skipped because the name exists in the target (policy 'ask'/'skip') */
  conflicts: string[]
  /** items that failed for another reason */
  failed: Array<{ path: string; error: string }>
}

export const HOME_CHANNELS = {
  recents: 'home:recents',
  searchFiles: 'home:search-files',
  rerankSearch: 'home:rerank-search',
  getFileSearchSettings: 'home:get-file-search-settings',
  setFileSearchSettings: 'home:set-file-search-settings',
  testFileSearchRerank: 'home:test-file-search-rerank',
  starred: 'home:starred',
  statPaths: 'home:stat-paths',
  toggleStar: 'home:toggle-star',
  openPath: 'home:open-path',
  browse: 'home:browse',
  newDoc: 'home:new-doc',
  newSheet: 'home:new-sheet',
  newSlide: 'home:new-slide',
  newMarkdown: 'home:new-markdown',
  newHtml: 'home:new-html',
  newPdf: 'home:new-pdf',
  listPendingUntitled: 'home:list-pending-untitled',
  restorePendingUntitled: 'home:restore-pending-untitled',
  discardPendingUntitled: 'home:discard-pending-untitled',
  removeRecent: 'home:remove-recent',
  revealPath: 'home:reveal-path',
  renameFile: 'home:rename-file',
  duplicateFile: 'home:duplicate-file',
  deleteFiles: 'home:delete-files',
  openTrash: 'home:open-trash',
  folderRoots: 'home:folder-roots',
  // LOCAL 兼容通道：编辑器 Files pane 桥（files-pane-bridge）仍硬编码旧单根通道，
  // 上游 #757 改多根 folderRoots 后主进程必须继续注册旧名，否则六端 Files pane 根目录查询全断
  folderRoot: 'home:folder-root',
  addFolderRoot: 'home:folder-root-add',
  dropFolderRoots: 'home:folder-root-drop',
  removeFolderRoot: 'home:folder-root-remove',
  listFolder: 'home:folder-list',
  createFolder: 'home:folder-create',
  renameFolder: 'home:folder-rename',
  movePaths: 'home:move-paths',
  deleteFolder: 'home:folder-delete',
  folderChanged: 'home:folder-changed',
  getLanguage: 'home:get-language',
  setLanguage: 'home:set-language',
  getUpdateChannel: 'home:get-update-channel',
  setUpdateChannel: 'home:set-update-channel',
  accountStatus: 'home:account-status',
  accountLogin: 'home:account-login',
  accountLoginEvent: 'home:account-login-event',
  accountLoginOpenUrl: 'home:account-login-open-url',
  openExternal: 'home:open-external',
  accountLogout: 'home:account-logout',
  getAppVersion: 'home:get-app-version',
  feedbackProbe: 'home:feedback-probe',
  feedbackUpload: 'home:feedback-upload',
  feedbackSubmit: 'home:feedback-submit',
  openChat: 'home:open-chat',
  onboardingSeen: 'home:onboarding-seen',
  setOnboardingSeen: 'home:set-onboarding-seen',
  getTheme: 'home:get-theme',
  setTheme: 'home:set-theme',
  getAutoSaveDefault: 'home:get-auto-save-default',
  setAutoSaveDefault: 'home:set-auto-save-default',
  getMcpStatus: 'home:get-mcp-status',
  setMcpSettings: 'home:set-mcp-settings',
  getMcpLogs: 'home:get-mcp-logs',
  clearMcpLogs: 'home:clear-mcp-logs',
  openMcpLogFile: 'home:open-mcp-log-file',
  getAnalyticsEnabled: 'home:get-analytics-enabled',
  setAnalyticsEnabled: 'home:set-analytics-enabled',
  getAiPanelPrefs: 'home:get-ai-panel-prefs',
  setAiPanelPrefs: 'home:set-ai-panel-prefs',
  getDefaultSaveDir: 'home:get-default-save-dir',
  pickDefaultSaveDir: 'home:pick-default-save-dir',
  openGenTeam: 'home:open-genteam',
  openCreditUsage: 'home:open-credit-usage',
  openGitHubRepo: 'home:open-github-repo',
  githubStars: 'home:github-stars',
  starPromptShouldShow: 'home:star-prompt-should-show',
  starPromptAction: 'home:star-prompt-action',
  cloudProjects: 'home:cloud-projects',
  cloudProjectsCached: 'home:cloud-projects-cached',
  openCloudProject: 'home:open-cloud-project',
  chatSessionsLoad: 'home:chat-sessions-load',
  chatSessionsSave: 'home:chat-sessions-save',
  systemFileSearch: 'home:system-file-search',
} as const

export const PROJECT_CHANNELS = {
  list: 'project:list',
  files: 'project:files',
  create: 'project:create',
  pickFolder: 'project:pickFolder',
  rename: 'project:rename',
  delete: 'project:delete',
  moveFile: 'project:moveFile',
  timeline: 'project:timeline',
} as const
