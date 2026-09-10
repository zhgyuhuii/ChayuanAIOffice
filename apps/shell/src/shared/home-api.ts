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

export interface HomeApi {
  /** unified recents across document types, newest first (paged) */
  recents(query?: RecentQuery): Promise<RecentPage>
  /** starred files (independent of the recent list), newest first (paged) */
  starred(query?: RecentQuery): Promise<RecentPage>
  /** stat a specific set of paths (project view); unstat-able files come back flagged `missing` */
  statPaths(paths: string[]): Promise<RecentEntry[]>
  /** star / unstar a file */
  toggleStar(path: string): Promise<void>
  /** open an existing file, routing to the right module by extension */
  openPath(path: string): Promise<void>
  /** file picker accepting every supported extension, then routes */
  browse(): Promise<void>
  /** open a docs window at its start screen */
  newDoc(opts?: { projectId?: string }): Promise<void>
  /** open a sheets window */
  newSheet(opts?: { projectId?: string }): Promise<void>
  /** open a slides tab at its start screen (open-a-pptx) */
  newSlide(opts?: { projectId?: string }): Promise<void>
  /** open a blank markdown editor tab */
  newMarkdown(opts?: { projectId?: string }): Promise<void>
  /** open a blank html editor tab */
  newHtml(opts?: { projectId?: string }): Promise<void>
  /** create a blank single-page PDF in the default save folder and open it */
  newPdf(opts?: { projectId?: string }): Promise<void>
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
  /** log out (clears the saved API key; the login state is shared globally with the chatoffice CLI) */
  accountLogout(): Promise<void>
  /** app version (from package.json / electron app.getVersion) */
  getAppVersion(): Promise<string>
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
  | { kind: 'doc-created'; title: string; docType: 'docx' | 'md'; filePath?: string | undefined }
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
  /** set when the conversation moved into a document tab's AI panel: the home
   * copy becomes read-only and offers "open that tab" instead of continuing */
  handedOff?: { docTitle: string; filePath?: string | undefined } | undefined
  /** session-scoped model picked in the composer; falls back to the global
   * current model when absent (the picker writes here, never to the global) */
  modelId?: AiModelSelection | undefined
  /** composer mode: 'plan' constrains the agent to advice-only replies */
  mode?: 'default' | 'plan' | undefined
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

export const HOME_CHANNELS = {
  recents: 'home:recents',
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
  getLanguage: 'home:get-language',
  setLanguage: 'home:set-language',
  getUpdateChannel: 'home:get-update-channel',
  setUpdateChannel: 'home:set-update-channel',
  accountStatus: 'home:account-status',
  accountLogin: 'home:account-login',
  accountLoginEvent: 'home:account-login-event',
  accountLoginOpenUrl: 'home:account-login-open-url',
  accountLogout: 'home:account-logout',
  getAppVersion: 'home:get-app-version',
  onboardingSeen: 'home:onboarding-seen',
  setOnboardingSeen: 'home:set-onboarding-seen',
  getTheme: 'home:get-theme',
  setTheme: 'home:set-theme',
  getAutoSaveDefault: 'home:get-auto-save-default',
  setAutoSaveDefault: 'home:set-auto-save-default',
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
