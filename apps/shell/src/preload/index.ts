import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AiModelEntry, AiSettingsV2, ChaOfficeAccountStatus } from '@chaoffice/ai-provider'
import { normalizeAiPanelPrefs } from '@chaoffice/ui/ai-panel-prefs'
import { installDropOpenBridge } from '@chaoffice/electron-utils/drop-open'
import { createRemoteFilesClient } from '@chaoffice/storage-adapter/remote-ipc'
import type { UpdateUiState } from '../shared/update-api'
import type {
  AccountLoginEvent,
  AccountStatus,
  CloudProjectsSnapshot,
  FeedbackSubmitResult,
  FeedbackUploadResult,
  DefaultAppStatus,
  FolderListing,
  FolderRoot,
  MoveResult,
  AuthorNameSetting,
  HomeApi,
  HomeChatSession,
  RecentEntry,
  RecentPage,
  RenameResult,
  UiLanguage,
  FileSearchPage,
  FileSearchRerank,
  FileSearchSettings,
} from '../shared/home-api'

import { PROJECT_CHANNELS } from '../shared/home-api'
import type { ProjectHomeApi, ProjectSummaryEntry, TimelineEntryItem } from '../shared/home-api'
// upstream #2068: the kb-ask panel keeps its thread through the project:* chat
// channels; the type comes from the local (rebranded) project-store package —
// narrowed to the four chat methods, the same surface the editor preloads use.
import type { ProjectApi } from '@chaoffice/project-store'
import { HOME_CHANNELS } from '../shared/home-api'
import { INTEGRATIONS_CHANNELS } from '../shared/integrations-api'
import type {
  IntegrationsApi,
  IntegrationsStatus,
  SkillInstallState,
} from '../shared/integrations-api'
import type {
  ExternalMcpCallResult,
  ExternalMcpServerConfig,
  ExternalMcpServerTools,
  ExternalMcpVerifyResult,
  McpClientApi,
} from '../shared/mcp-client-api'
import { MCP_CLIENT_CHANNELS } from '../shared/mcp-client-api'
import type { FoundSkill, RecommendedSkill } from '../shared/found-skill'
import type { TabsApi, TabSummary } from '../shared/tabs-api'
import { TABS_CHANNELS, WINDOW_CHANNELS } from '../shared/tabs-api'
// LOCAL(purchase): offline purchase / license bridge (B-zone)
import { PURCHASE_CHANNELS } from '../shared/purchase-api'
import type { PurchaseActivateResult, PurchaseEventPayload, PurchaseSnapshot } from '../shared/purchase-api'
import type { WindowControlsApi } from '../shared/tabs-api'
import type { DockApi, DockTabSummary, PanelTurnReport } from '../shared/dock-api'
import type { RelayEvent } from '../shared/relay-protocol'
import { DOCK_CHANNELS } from '../shared/dock-api'
import { KB_CHANNELS } from '@chaoffice/ai-host/kb-channels'

const UI_LANGUAGES: readonly UiLanguage[] = [
  'zh',
  'en',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'th',
  'id',
  'ru',
  'ar',
  'pt',
  'it',
  'pl',
  'cs',
  'nl',
  'ms',
  'he',
  'hi',
  'zh-TW',
]

function isUiLanguage(value: unknown): value is UiLanguage {
  return UI_LANGUAGES.includes(value as UiLanguage)
}

const EMPTY_PAGE: RecentPage = { entries: [], total: 0, totalAll: 0 }

function asRecentPage(result: unknown): RecentPage {
  if (result && typeof result === 'object' && Array.isArray((result as RecentPage).entries)) {
    return result as RecentPage
  }
  return EMPTY_PAGE
}

const EMPTY_SEARCH: FileSearchPage = {
  hits: [],
  total: 0,
  index: { indexed: 0, pending: 0, scanning: false },
}

function asSearchPage(result: unknown): FileSearchPage {
  if (result && typeof result === 'object' && Array.isArray((result as FileSearchPage).hits)) {
    return result as FileSearchPage
  }
  return EMPTY_SEARCH
}

function normalizeDefaultAppStatus(result: unknown): DefaultAppStatus {
  const r = (result ?? {}) as Partial<DefaultAppStatus>
  const state = r.state
  return {
    state: state === 'default' || state === 'other' || state === 'unknown' ? state : 'unsupported',
    others: Array.isArray(r.others) ? r.others.filter((x) => typeof x === 'string') : [],
    manualOnly: r.manualOnly === true,
  }
}

function normalizeAuthorNameSetting(result: unknown): AuthorNameSetting {
  const r = (result ?? {}) as Partial<AuthorNameSetting>
  return {
    value: typeof r.value === 'string' ? r.value : '',
    fallback: typeof r.fallback === 'string' ? r.fallback : '',
  }
}

// a Settings request (menu click, Cmd+,) can land before Home has subscribed
const pendingOpenSettings: Array<{ section: string }> = []
ipcRenderer.on(HOME_CHANNELS.openSettings, (_event, target: { section: string }) => {
  if (ipcRenderer.listenerCount(HOME_CHANNELS.openSettings) === 1) pendingOpenSettings.push(target)
})

const homeApi: HomeApi = {
  async recents(query) {
    return asRecentPage(await ipcRenderer.invoke(HOME_CHANNELS.recents, query))
  },
  async searchFiles(query) {
    return asSearchPage(await ipcRenderer.invoke(HOME_CHANNELS.searchFiles, query))
  },
  async rerankSearch(query) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.rerankSearch, query)
    return result && typeof result === 'object' && Array.isArray((result as FileSearchRerank).order)
      ? (result as FileSearchRerank)
      : null
  },
  async getFileSearchSettings() {
    return (await ipcRenderer.invoke(HOME_CHANNELS.getFileSearchSettings)) as FileSearchSettings
  },
  async setFileSearchSettings(patch) {
    return (await ipcRenderer.invoke(
      HOME_CHANNELS.setFileSearchSettings,
      patch,
    )) as FileSearchSettings
  },
  async testFileSearchRerank(input) {
    const raw = ((await ipcRenderer.invoke(HOME_CHANNELS.testFileSearchRerank, input)) ?? {}) as {
      ok?: unknown
      error?: unknown
    }
    return raw.ok === true
      ? { ok: true }
      : { ok: false, error: typeof raw.error === 'string' ? raw.error : 'Connection failed' }
  },
  async starred(query) {
    return asRecentPage(await ipcRenderer.invoke(HOME_CHANNELS.starred, query))
  },
  async starredGroups() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.starredGroups)
    return Array.isArray(result) ? result.filter((g): g is string => typeof g === 'string') : []
  },
  async setStarredGroup(paths, group) {
    await ipcRenderer.invoke(HOME_CHANNELS.setStarredGroup, paths, group)
  },
  async statPaths(paths) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.statPaths, paths)
    return Array.isArray(result) ? (result as RecentEntry[]) : []
  },
  async toggleStar(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.toggleStar, path)
  },
  async openHelp() {
    await ipcRenderer.invoke(HOME_CHANNELS.openHelp)
  },
  // knowledge-base ask panel (upstream #1915/#1940; handlers live in the shell
  // main, same process that owns the index and the shared ai:stream registration)
  async kbList() {
    return ipcRenderer.invoke(HOME_CHANNELS.kbList)
  },
  async skillsList() {
    return ipcRenderer.invoke('ai:skills-list')
  },
  async skillText(name) {
    return ipcRenderer.invoke('ai:skill-text', name)
  },
  async openSkillsSettings() {
    await ipcRenderer.invoke('ai:open-skills-settings')
  },
  async kbSearch(query) {
    return ipcRenderer.invoke(HOME_CHANNELS.kbSearch, query)
  },
  async kbRead(path, offset) {
    return ipcRenderer.invoke(HOME_CHANNELS.kbRead, { path, offset })
  },
  async kbCreateDocument(request) {
    return ipcRenderer.invoke(HOME_CHANNELS.kbCreateDocument, request)
  },
  async kbCliContext(sessionId) {
    return ipcRenderer.invoke('kb:cli-context', sessionId)
  },
  async kbRunCli(sessionId, request) {
    return ipcRenderer.invoke('kb:run-cli', { sessionId, ...request })
  },
  async addAttachmentPaths(paths) {
    return ipcRenderer.invoke('files:add', paths)
  },
  async addPastedImage(data, ext) {
    return ipcRenderer.invoke('files:add-pasted-image', data, ext)
  },
  async openPath(path, options) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.openPath, path, options)
  },
  async browse() {
    await ipcRenderer.invoke(HOME_CHANNELS.browse)
  },
  async newDoc(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newDoc, opts)
  },
  async newSheet(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newSheet, opts)
  },
  async newSlide(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newSlide, opts)
  },
  async newMarkdown(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newMarkdown, opts)
  },
  async newHtml(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newHtml, opts)
  },
  async newPdf(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newPdf, opts)
  },
  async listPendingUntitled() {
    return await ipcRenderer.invoke(HOME_CHANNELS.listPendingUntitled)
  },
  async restorePendingUntitled(tempPath) {
    return await ipcRenderer.invoke(HOME_CHANNELS.restorePendingUntitled, tempPath)
  },
  async discardPendingUntitled(tempPath) {
    return await ipcRenderer.invoke(HOME_CHANNELS.discardPendingUntitled, tempPath)
  },
  async removeRecent(paths) {
    await ipcRenderer.invoke(HOME_CHANNELS.removeRecent, paths)
  },
  async unstarPaths(paths) {
    await ipcRenderer.invoke(HOME_CHANNELS.unstarPaths, paths)
  },
  async revealPath(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.revealPath, path)
  },
  async renameFile(path, newName) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.renameFile, path, newName)
    return (result ?? { ok: false, error: 'Rename failed' }) as RenameResult
  },
  async duplicateFile(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.duplicateFile, path)
  },
  async deleteFiles(paths) {
    await ipcRenderer.invoke(HOME_CHANNELS.deleteFiles, paths)
  },
  async folderRoots() {
    return (await ipcRenderer.invoke(HOME_CHANNELS.folderRoots)) as FolderRoot[]
  },
  async addFolderRoot() {
    return (await ipcRenderer.invoke(HOME_CHANNELS.addFolderRoot)) as FolderRoot | null
  },
  async dropFolderRoots(paths) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.dropFolderRoots, paths)) as FolderRoot[]
  },
  async removeFolderRoot(path) {
    await ipcRenderer.invoke(HOME_CHANNELS.removeFolderRoot, path)
  },
  pathForFile(file) {
    return webUtils.getPathForFile(file)
  },
  async listFolder(dir) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.listFolder, dir)) as FolderListing
  },
  async createFolder(parent, name) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.createFolder, parent, name)) as RenameResult
  },
  async renameFolder(dir, newName) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.renameFolder, dir, newName)) as RenameResult
  },
  async movePaths(paths, targetDir, onConflict) {
    return (await ipcRenderer.invoke(
      HOME_CHANNELS.movePaths,
      paths,
      targetDir,
      onConflict,
    )) as MoveResult
  },
  async deleteFolder(dir) {
    await ipcRenderer.invoke(HOME_CHANNELS.deleteFolder, dir)
  },
  onFolderChanged(handler) {
    const listener = (_event: IpcRendererEvent, dirs: unknown) => {
      if (Array.isArray(dirs)) handler(dirs.filter((d): d is string => typeof d === 'string'))
    }
    ipcRenderer.on(HOME_CHANNELS.folderChanged, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.folderChanged, listener)
  },
  async openTrash() {
    await ipcRenderer.invoke(HOME_CHANNELS.openTrash)
  },
  async getLanguage() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getLanguage)
    return isUiLanguage(result) ? result : 'zh'
  },
  async setLanguage(lang) {
    if (!isUiLanguage(lang)) throw new Error('Invalid language.')
    await ipcRenderer.invoke(HOME_CHANNELS.setLanguage, lang)
  },
  async getUpdateChannel() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getUpdateChannel)
    return result === 'beta' ? 'beta' : 'stable'
  },
  async setUpdateChannel(channel) {
    // validated inline: a runtime import from ../shared/update-api would be
    // shared with the update.ts preload entry and get split into a chunk,
    // which sandboxed preload scripts cannot load (window.chaOffice would
    // silently disappear). Preload entries must stay single-file bundles.
    if (channel !== 'stable' && channel !== 'beta') throw new Error('Invalid update channel.')
    await ipcRenderer.invoke(HOME_CHANNELS.setUpdateChannel, channel)
  },
  async getAutoUpdateCheck() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getAutoUpdateCheck)
    return result !== false
  },
  async setAutoUpdateCheck(on) {
    if (typeof on !== 'boolean') throw new Error('Invalid update check setting.')
    await ipcRenderer.invoke(HOME_CHANNELS.setAutoUpdateCheck, on)
  },
  async accountStatus() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.accountStatus)
    return (result ?? { loggedIn: false }) as AccountStatus
  },
  async accountLogin() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.accountLogin)
    return result === true
  },
  onOpenSettings(handler) {
    const listener = (_event: IpcRendererEvent, target: { section: string }) => handler(target)
    ipcRenderer.on(HOME_CHANNELS.openSettings, listener)
    for (const target of pendingOpenSettings.splice(0)) handler(target)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.openSettings, listener)
  },
  onAccountLogin(handler) {
    const listener = (_event: IpcRendererEvent, ev: AccountLoginEvent) => handler(ev)
    ipcRenderer.on(HOME_CHANNELS.accountLoginEvent, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.accountLoginEvent, listener)
  },
  async openLoginUrl() {
    await ipcRenderer.invoke(HOME_CHANNELS.accountLoginOpenUrl)
  },
  async openExternal(url: string) {
    await ipcRenderer.invoke(HOME_CHANNELS.openExternal, url)
  },
  async accountLogout() {
    await ipcRenderer.invoke(HOME_CHANNELS.accountLogout)
  },
  async getAppVersion() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getAppVersion)
    return typeof result === 'string' ? result : ''
  },
  async openChat() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.openChat)
    return result === true
  },
  async feedbackProbe() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.feedbackProbe)
    return result === true
  },
  async feedbackUpload(name, mime, data) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.feedbackUpload, name, mime, data)
    return result as FeedbackUploadResult
  },
  async feedbackSubmit(payload) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.feedbackSubmit, payload)
    return result as FeedbackSubmitResult
  },
  async getUpdateState() {
    const result: unknown = await ipcRenderer.invoke('update:get-state')
    return (result as UpdateUiState | null) ?? null
  },
  async openUpdateDialog() {
    const result: unknown = await ipcRenderer.invoke('update:open-for-update')
    return result === true
  },
  onUpdateStateChanged(handler: (state: UpdateUiState) => void) {
    const listener = (_e: IpcRendererEvent, state: UpdateUiState) => handler(state)
    ipcRenderer.on('update:state-changed', listener)
    return () => ipcRenderer.removeListener('update:state-changed', listener)
  },
  async onboardingSeen() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.onboardingSeen)
    return result === true
  },
  async setOnboardingSeen() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.setOnboardingSeen)
    return result === true
  },
  async getTheme() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getTheme)
    return result === 'dark' || result === 'light' ? result : 'system'
  },
  async setTheme(theme) {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system')
      throw new Error('Invalid theme.')
    await ipcRenderer.invoke(HOME_CHANNELS.setTheme, theme)
  },
  async getDocumentTheme() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getDocumentTheme)
    return result === 'dark' || result === 'light' ? result : 'follow'
  },
  async setDocumentTheme(theme) {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'follow')
      throw new Error('Invalid document theme.')
    await ipcRenderer.invoke(HOME_CHANNELS.setDocumentTheme, theme)
  },
  async getAutoSaveDefault() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getAutoSaveDefault)
    const r = result as { on?: unknown; updatedAt?: unknown } | null
    return {
      on: r?.on === true,
      updatedAt: typeof r?.updatedAt === 'number' ? r.updatedAt : 0,
    }
  },
  async getTabSleepEnabled() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getTabSleepEnabled)
    return result !== false
  },
  async setTabSleepEnabled(on) {
    if (typeof on !== 'boolean') throw new Error('Invalid tab sleep setting.')
    await ipcRenderer.invoke(HOME_CHANNELS.setTabSleepEnabled, on)
  },
  async getRestoreLastSession() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getRestoreLastSession)
    return result === true
  },
  async setRestoreLastSession(on) {
    if (typeof on !== 'boolean') throw new Error('Invalid restore session setting.')
    await ipcRenderer.invoke(HOME_CHANNELS.setRestoreLastSession, on)
  },
  async setAutoSaveDefault(on) {
    if (typeof on !== 'boolean') throw new Error('Invalid AutoSave default.')
    await ipcRenderer.invoke(HOME_CHANNELS.setAutoSaveDefault, on)
  },
  async getMcpStatus() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getMcpStatus)
    const r = result as {
      running?: unknown
      enabled?: unknown
      port?: unknown
      background?: unknown
      logging?: unknown
      url?: unknown
      capabilities?: unknown
      error?: unknown
    } | null
    return {
      running: r?.running === true,
      enabled: r?.enabled === true,
      port: typeof r?.port === 'number' ? r.port : 3093,
      background: r?.background === true,
      logging: r?.logging === true,
      url: typeof r?.url === 'string' ? r.url : null,
      capabilities: Array.isArray(r?.capabilities)
        ? r.capabilities.filter((c): c is string => typeof c === 'string')
        : ['docs'],
      ...(typeof r?.error === 'string' ? { error: r.error } : {}),
    }
  },
  async setMcpSettings(patch: {
    enabled?: boolean
    port?: number
    background?: boolean
    logging?: boolean
  }) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.setMcpSettings, patch)
    const r = result as {
      running?: unknown
      enabled?: unknown
      port?: unknown
      background?: unknown
      logging?: unknown
      url?: unknown
      capabilities?: unknown
      error?: unknown
    } | null
    return {
      running: r?.running === true,
      enabled: r?.enabled === true,
      port: typeof r?.port === 'number' ? r.port : 3093,
      background: r?.background === true,
      logging: r?.logging === true,
      url: typeof r?.url === 'string' ? r.url : null,
      capabilities: Array.isArray(r?.capabilities)
        ? r.capabilities.filter((c): c is string => typeof c === 'string')
        : ['docs'],
      ...(typeof r?.error === 'string' ? { error: r.error } : {}),
    }
  },
  async getMcpLogs() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getMcpLogs)
    return Array.isArray(result) ? result.filter((l): l is string => typeof l === 'string') : []
  },
  async clearMcpLogs() {
    await ipcRenderer.invoke(HOME_CHANNELS.clearMcpLogs)
  },
  async openMcpLogFile() {
    await ipcRenderer.invoke(HOME_CHANNELS.openMcpLogFile)
  },
  async getAnalyticsEnabled() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getAnalyticsEnabled)
    return result !== false
  },
  async setAnalyticsEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid analytics consent.')
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.setAnalyticsEnabled, enabled)
    return result === true
  },
  async getAuthorName() {
    return normalizeAuthorNameSetting(await ipcRenderer.invoke(HOME_CHANNELS.getAuthorName))
  },
  async setAuthorName(value) {
    return normalizeAuthorNameSetting(await ipcRenderer.invoke(HOME_CHANNELS.setAuthorName, value))
  },
  async getAiPanelPrefs() {
    return normalizeAiPanelPrefs(await ipcRenderer.invoke(HOME_CHANNELS.getAiPanelPrefs))
  },
  async setAiPanelPrefs(patch) {
    return normalizeAiPanelPrefs(await ipcRenderer.invoke(HOME_CHANNELS.setAiPanelPrefs, patch))
  },
  async getDefaultSaveDir() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getDefaultSaveDir)
    return typeof result === 'string' ? result : ''
  },
  async getDefaultAppStatus() {
    return normalizeDefaultAppStatus(await ipcRenderer.invoke(HOME_CHANNELS.getDefaultAppStatus))
  },
  async setDefaultApp() {
    return normalizeDefaultAppStatus(await ipcRenderer.invoke(HOME_CHANNELS.setDefaultApp))
  },
  async pickDefaultSaveDir() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.pickDefaultSaveDir)
    return typeof result === 'string' && result ? result : null
  },
  onThemeChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, theme: unknown) => {
      if (theme === 'light' || theme === 'dark' || theme === 'system') handler(theme)
    }
    ipcRenderer.on('app:theme-changed', listener)
    return () => ipcRenderer.removeListener('app:theme-changed', listener)
  },
  onDocumentThemeChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, theme: unknown) => {
      if (theme === 'light' || theme === 'dark' || theme === 'follow') handler(theme)
    }
    ipcRenderer.on('app:document-theme-changed', listener)
    return () => ipcRenderer.removeListener('app:document-theme-changed', listener)
  },
  async openGenTeam() {
    await ipcRenderer.invoke(HOME_CHANNELS.openGenTeam)
  },
  async openCreditUsage() {
    await ipcRenderer.invoke(HOME_CHANNELS.openCreditUsage)
  },
  async openGitHubRepo() {
    await ipcRenderer.invoke(HOME_CHANNELS.openGitHubRepo)
  },
  async githubStars() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.githubStars)
    return typeof result === 'number' && Number.isFinite(result) ? result : null
  },
  async starPromptShouldShow() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.starPromptShouldShow)
    const raw = (result ?? {}) as { show?: unknown; docOpens?: unknown }
    return {
      show: raw.show === true,
      docOpens:
        typeof raw.docOpens === 'number' && Number.isFinite(raw.docOpens) ? raw.docOpens : 0,
    }
  },
  async starPromptAction(action) {
    if (action !== 'starred' && action !== 'later') throw new Error('Invalid star prompt action.')
    await ipcRenderer.invoke(HOME_CHANNELS.starPromptAction, action)
  },
  async cloudProjectsCached() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.cloudProjectsCached)
    return asCloudProjectsSnapshot(result)
  },
  async cloudProjectsSync() {
    // failures (network / CLI) resolve to null so the renderer keeps whatever it has
    try {
      const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.cloudProjects)
      return asCloudProjectsSnapshot(result)
    } catch {
      return null
    }
  },
  async openCloudProject(projectUrl) {
    if (typeof projectUrl !== 'string' || !projectUrl) throw new Error('Invalid project URL.')
    await ipcRenderer.invoke(HOME_CHANNELS.openCloudProject, projectUrl)
  },
  // AI settings channels are registered once by the shell's aggregated docs handlers
  onAiSettingsChanged(handler) {
    const listener = () => handler()
    ipcRenderer.on('ai:settings-changed', listener)
    return () => ipcRenderer.removeListener('ai:settings-changed', listener)
  },
  async getAiSettings() {
    return (await ipcRenderer.invoke('ai:get-settings')) as AiSettingsV2
  },
  async setAiSettings(view) {
    await ipcRenderer.invoke('ai:set-settings', view)
  },
  async setAiCurrentModel(selection) {
    await ipcRenderer.invoke('ai:set-current-model', selection)
  },
  async aiDiscoverModels(target) {
    return (await ipcRenderer.invoke('ai:discover-models', target)) as {
      models: AiModelEntry[]
      error?: string
    }
  },
  async chaofficeStatus(withEmail) {
    return (await ipcRenderer.invoke('ai:chaoffice-status', withEmail)) as ChaOfficeAccountStatus
  },
  async chaofficeLogin() {
    await ipcRenderer.invoke('ai:chaoffice-login')
  },
  async aiLocalToolStatus(vendorId: string) {
    return (await ipcRenderer.invoke(
      'ai:local-tool-status',
      vendorId,
    )) as import('@chaoffice/ai-provider').LocalToolStatus
  },
  async aiLocalToolInstall(vendorId: string, onLine?: (line: string) => void) {
    if (!onLine) return ipcRenderer.invoke('ai:local-tool-install', vendorId)
    const listener = (_event: Electron.IpcRendererEvent, vid: string, line: string) => {
      if (vid === vendorId) onLine(line)
    }
    ipcRenderer.on('ai:local-tool-progress', listener)
    return ipcRenderer
      .invoke('ai:local-tool-install', vendorId)
      .finally(() => ipcRenderer.removeListener('ai:local-tool-progress', listener))
  },
  async aiLocalToolStart(vendorId: string) {
    return (await ipcRenderer.invoke(
      'ai:local-tool-start',
      vendorId,
    )) as import('@chaoffice/ai-provider').LocalToolOpResult
  },
  // 生图、媒体与搜索：搜索平台连通性探测（主进程执行，未保存的 key 也可测）
  async aiTestSearchPlatform(req: { platform: string; key?: string }) {
    return (await ipcRenderer.invoke('ai:test-search-platform', req)) as {
      ok: boolean
      detail?: string
    }
  },
  // 首页对话能力工具：网页搜索 / 生图 / SVG 插画（主进程按全局默认路由）
  async webSearch(query: string, maxResults?: number) {
    return (await ipcRenderer.invoke('ai:web-search', query, maxResults)) as {
      results: { title: string; url: string; snippet: string }[]
      answer?: string
      method: string
      error?: string
    }
  },
  // 搜索通道可用性探测（web_search 工具门控：key 平台已配或免 key 兜底可达）
  async searchCapabilities() {
    return (await ipcRenderer.invoke('ai:search-capabilities')) as { search: boolean }
  },
  async mediaGenerate(req: {
    profileId?: string
    modelId?: string
    prompt: string
    params?: Record<string, unknown>
  }) {
    return (await ipcRenderer.invoke('ai:media-generate', req)) as {
      images?: { dataUrl: string }[]
      error?: string
    }
  },
  async generateSvg(req: { profileId?: string; modelId?: string; prompt: string }) {
    return (await ipcRenderer.invoke('ai:generate-svg', req)) as {
      svg?: string
      modelId?: string
      error?: string
    }
  },
  // LOCAL(2026-09-20): unified media capability channels; upstream: additive-only; converge: never (local feature)
  mediaCapabilities() {
    return ipcRenderer.invoke('ai:media-capabilities') as Promise<{
      flags?: Record<string, boolean>
      models?: Record<string, string>
    }>
  },
  mediaVideo(req: { prompt: string; aspectRatio?: string; durationSeconds?: number }) {
    return ipcRenderer.invoke('ai:media-video', req) as Promise<{
      url?: string
      filePath?: string
      model?: string
      error?: string
    }>
  },
  mediaUnderstand(req: {
    kind: 'image' | 'video' | 'auto'
    sources: string[]
    requirements: string
  }) {
    return ipcRenderer.invoke('ai:media-understand', req) as Promise<{ text?: string; error?: string }>
  },
  mediaAsr(req: { source: string; language?: string }) {
    return ipcRenderer.invoke('ai:media-asr', req) as Promise<{ text?: string; error?: string }>
  },
  mediaTts(req: { text: string; voice?: string }) {
    return ipcRenderer.invoke('ai:media-tts', req) as Promise<{ url?: string; mime?: string; error?: string }>
  },
  // ai:stream / files:* / docs:create-document channels are registered process-wide
  // by the aggregated editor mains the shell loads (ai-host / docs-main)
  async aiStream(request) {
    await ipcRenderer.invoke('ai:stream', request)
  },
  async aiStreamCancel(requestId) {
    await ipcRenderer.invoke('ai:stream-cancel', requestId)
  },
  onAiStream(handler) {
    const listener = (_event: IpcRendererEvent, chunk: Parameters<typeof handler>[0]) =>
      handler(chunk)
    ipcRenderer.on('ai:stream-chunk', listener)
    return () => ipcRenderer.removeListener('ai:stream-chunk', listener)
  },
  async createDocument(request) {
    return (await ipcRenderer.invoke('docs:create-document', request)) as Awaited<
      ReturnType<HomeApi['createDocument']>
    >
  },
  async pickAttachments() {
    return (await ipcRenderer.invoke('files:pick')) as Awaited<
      ReturnType<HomeApi['pickAttachments']>
    >
  },
  async validateAttachments(paths) {
    return (await ipcRenderer.invoke('files:add', paths)) as Awaited<
      ReturnType<HomeApi['validateAttachments']>
    >
  },
  async readAttachment(path, offset, maxChars) {
    return (await ipcRenderer.invoke('files:read', path, offset, maxChars)) as Awaited<
      ReturnType<HomeApi['readAttachment']>
    >
  },
  async readAttachmentImage(path) {
    return (await ipcRenderer.invoke('files:read-image', path)) as Awaited<
      ReturnType<HomeApi['readAttachmentImage']>
    >
  },
  async systemFileSearch(query, ext) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.systemFileSearch, query, ext)) as Awaited<
      ReturnType<HomeApi['systemFileSearch']>
    >
  },
  async chatSessionsLoad() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.chatSessionsLoad)
    return Array.isArray(result) ? (result as HomeChatSession[]) : []
  },
  async chatSessionsSave(sessions) {
    await ipcRenderer.invoke(HOME_CHANNELS.chatSessionsSave, sessions)
  },
}

function asCloudProjectsSnapshot(result: unknown): CloudProjectsSnapshot | null {
  if (
    result &&
    typeof result === 'object' &&
    Array.isArray((result as CloudProjectsSnapshot).projects)
  ) {
    return result as CloudProjectsSnapshot
  }
  return null
}

contextBridge.exposeInMainWorld('chaOffice', homeApi)

const projectApi: ProjectHomeApi = {
  async listProjects() {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.list)
    return Array.isArray(result) ? (result as ProjectSummaryEntry[]) : []
  },
  async listFiles(projectId) {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.files, { projectId })
    return Array.isArray(result)
      ? result.filter((path): path is string => typeof path === 'string')
      : []
  },
  async createProject(name, rootPath) {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.create, { name, rootPath })
    return result as ProjectSummaryEntry
  },
  async pickFolder() {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.pickFolder)
    return typeof result === 'string' ? result : null
  },
  async renameProject(id, name) {
    await ipcRenderer.invoke(PROJECT_CHANNELS.rename, { id, name })
  },
  async deleteProject(id) {
    await ipcRenderer.invoke(PROJECT_CHANNELS.delete, { id })
  },
  async moveFile(filePath, projectId) {
    await ipcRenderer.invoke(PROJECT_CHANNELS.moveFile, { filePath, projectId })
  },
  async getTimeline(projectId, limit) {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.timeline, {
      projectId,
      limit,
    })
    return Array.isArray(result) ? (result as TimelineEntryItem[]) : []
  },
}

contextBridge.exposeInMainWorld('chaOfficeProject', projectApi)

// The same project:* channels the editor preloads use; the home screen's
// knowledge-base ask panel keeps its thread through them. The handlers are
// registered once by the docs main process in shell mode (registerProjectIpc).
// Named projectChatApi here: the project-management bridge above already owns
// the `projectApi` const (exposed as chaOfficeProject).
const projectChatApi: Pick<
  ProjectApi,
  'resolveChat' | 'appendChat' | 'loadChat' | 'rebindChat' | 'listChats' | 'deleteChat'
> = {
  resolveChat: (args) => ipcRenderer.invoke('project:resolveChat', args),
  appendChat: (args) => ipcRenderer.invoke('project:appendChat', args),
  loadChat: (args) => ipcRenderer.invoke('project:loadChat', args),
  rebindChat: (args) => ipcRenderer.invoke('project:rebindChat', args),
  listChats: (args) => ipcRenderer.invoke('project:listChats', args),
  deleteChat: (args) => ipcRenderer.invoke('project:deleteChat', args),
}

contextBridge.exposeInMainWorld('projectApi', projectChatApi)

const integrationsApi: IntegrationsApi = {
  async status() {
    return (await ipcRenderer.invoke(INTEGRATIONS_CHANNELS.status)) as IntegrationsStatus
  },
  async installSkill(target) {
    return (await ipcRenderer.invoke(
      INTEGRATIONS_CHANNELS.installSkill,
      target,
    )) as SkillInstallState
  },
  async uninstallSkill(agentId) {
    return (await ipcRenderer.invoke(
      INTEGRATIONS_CHANNELS.uninstallSkill,
      agentId,
    )) as SkillInstallState
  },
  async pickSkillDir(title) {
    const r: unknown = await ipcRenderer.invoke(INTEGRATIONS_CHANNELS.pickSkillDir, title)
    return typeof r === 'string' ? r : null
  },
  async saveSkillZip(title) {
    const r: unknown = await ipcRenderer.invoke(INTEGRATIONS_CHANNELS.saveSkillZip, title)
    return typeof r === 'string' ? r : null
  },
  async copyText(text) {
    await ipcRenderer.invoke(INTEGRATIONS_CHANNELS.copyText, text)
  },
  async listSkills() {
    return (await ipcRenderer.invoke(INTEGRATIONS_CHANNELS.listSkills)) as FoundSkill[]
  },
  async skillBody(path) {
    return (await ipcRenderer.invoke(INTEGRATIONS_CHANNELS.skillBody, path)) as string
  },
  async importSkillFolder(title) {
    const r: unknown = await ipcRenderer.invoke(INTEGRATIONS_CHANNELS.importSkillFolder, title)
    return (r as FoundSkill | null) ?? null
  },
  async importSkillZip(title) {
    const r: unknown = await ipcRenderer.invoke(INTEGRATIONS_CHANNELS.importSkillZip, title)
    return (r as FoundSkill | null) ?? null
  },
  async listRecommendedSkills() {
    return (await ipcRenderer.invoke(
      INTEGRATIONS_CHANNELS.listRecommendedSkills,
    )) as RecommendedSkill[]
  },
  async removeSkill(name) {
    await ipcRenderer.invoke(INTEGRATIONS_CHANNELS.removeSkill, name)
  },
  async installRecommendedSkill(name) {
    return (await ipcRenderer.invoke(
      INTEGRATIONS_CHANNELS.installRecommendedSkill,
      name,
    )) as FoundSkill
  },
}
contextBridge.exposeInMainWorld('chaOfficeIntegrations', integrationsApi)

// External MCP client (Settings → MCP 管理): add/verify/delete outbound servers,
// and relay their tools to the home chat agent
const mcpClientApi: McpClientApi = {
  async listServers() {
    const result: unknown = await ipcRenderer.invoke(MCP_CLIENT_CHANNELS.listServers)
    return Array.isArray(result) ? (result as ExternalMcpServerConfig[]) : []
  },
  async saveServer(config) {
    const result: unknown = await ipcRenderer.invoke(MCP_CLIENT_CHANNELS.saveServer, config)
    return Array.isArray(result) ? (result as ExternalMcpServerConfig[]) : []
  },
  async deleteServer(id) {
    const result: unknown = await ipcRenderer.invoke(MCP_CLIENT_CHANNELS.deleteServer, id)
    return Array.isArray(result) ? (result as ExternalMcpServerConfig[]) : []
  },
  async setServerEnabled(id, enabled) {
    const result: unknown = await ipcRenderer.invoke(
      MCP_CLIENT_CHANNELS.setServerEnabled,
      id,
      enabled,
    )
    return Array.isArray(result) ? (result as ExternalMcpServerConfig[]) : []
  },
  async verifyServer(id) {
    return (await ipcRenderer.invoke(
      MCP_CLIENT_CHANNELS.verifyServer,
      id,
    )) as ExternalMcpVerifyResult
  },
  async verifyDraft(draft) {
    return (await ipcRenderer.invoke(
      MCP_CLIENT_CHANNELS.verifyDraft,
      draft,
    )) as ExternalMcpVerifyResult
  },
  async listAgentTools() {
    const result: unknown = await ipcRenderer.invoke(MCP_CLIENT_CHANNELS.listAgentTools)
    return Array.isArray(result) ? (result as ExternalMcpServerTools[]) : []
  },
  async callTool(serverId, toolName, args) {
    return (await ipcRenderer.invoke(
      MCP_CLIENT_CHANNELS.callTool,
      serverId,
      toolName,
      args,
    )) as ExternalMcpCallResult
  },
}
contextBridge.exposeInMainWorld('chaOfficeMcp', mcpClientApi)

const tabsApi: TabsApi = {
  async list() {
    const result: unknown = await ipcRenderer.invoke(TABS_CHANNELS.list)
    return Array.isArray(result) ? (result as TabSummary[]) : []
  },
  async activate(id) {
    await ipcRenderer.invoke(TABS_CHANNELS.activate, id)
  },
  async close(id) {
    await ipcRenderer.invoke(TABS_CHANNELS.close, id)
  },
  async showTabContextMenu(x, y, tabId) {
    await ipcRenderer.invoke(TABS_CHANNELS.showTabContextMenu, x, y, tabId)
  },
  async showMenu(x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showMenu, x, y)
  },
  async showNewMenu(x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showNewMenu, x, y)
  },
  async showTabMenu(id, x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showTabMenu, id, x, y)
  },
  async detach(id) {
    await ipcRenderer.invoke(TABS_CHANNELS.detach, id)
  },
  async tearOff(id, screenX, screenY) {
    const result: unknown = await ipcRenderer.invoke(TABS_CHANNELS.tearOff, id, screenX, screenY)
    return result === true
  },
  dragTornWindow(screenX, screenY) {
    ipcRenderer.send(TABS_CHANNELS.dragTornWindow, screenX, screenY)
  },
  async dockTornWindow(index) {
    await ipcRenderer.invoke(TABS_CHANNELS.dockTornWindow, index)
  },
  async endTornDrag() {
    await ipcRenderer.invoke(TABS_CHANNELS.endTornDrag)
  },
  onDockPreview(handler) {
    const listener = (_event: IpcRendererEvent, preview: { x: number } | null) =>
      handler(preview && typeof preview.x === 'number' ? { x: preview.x } : null)
    ipcRenderer.on(TABS_CHANNELS.dockPreview, listener)
    return () => ipcRenderer.removeListener(TABS_CHANNELS.dockPreview, listener)
  },
  reportDockIndex(index) {
    ipcRenderer.send(TABS_CHANNELS.dockIndex, index)
  },
  async showAppMenu(x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showAppMenu, x, y)
  },
  async reorder(id, toIndex) {
    await ipcRenderer.invoke(TABS_CHANNELS.reorder, id, toIndex)
  },
  onChanged(handler) {
    const listener = (_event: IpcRendererEvent, tabs: TabSummary[]) => handler(tabs)
    ipcRenderer.on(TABS_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(TABS_CHANNELS.changed, listener)
  },
  notifyChromePressed() {
    ipcRenderer.send(TABS_CHANNELS.chromePressed)
  },
  setTreeInset(visible) {
    ipcRenderer.send(TABS_CHANNELS.treeInset, visible)
  },
  setTreeWidth(px) {
    ipcRenderer.send(TABS_CHANNELS.treeWidth, px)
  },
  setShellModalOpen(open) {
    ipcRenderer.send(TABS_CHANNELS.shellModal, open)
  },
  onChromePressed(handler) {
    const listener = () => handler()
    ipcRenderer.on('app:chrome-pressed', listener)
    return () => ipcRenderer.removeListener('app:chrome-pressed', listener)
  },
  onStartRename(handler) {
    const listener = (_event: IpcRendererEvent, id: unknown) => {
      if (typeof id === 'string') handler(id)
    }
    ipcRenderer.on(TABS_CHANNELS.startRename, listener)
    return () => ipcRenderer.removeListener(TABS_CHANNELS.startRename, listener)
  },
}

const windowControlsApi: WindowControlsApi = {
  // 桌面自绘窗口控制；mac 的 titleBarStyle:'hidden' 仍显示原生红绿灯，
  // 不再自绘第二套（win/linux 的 hidden 无原生按钮，必须自绘）。
  // web/dsh 无 preload 自然没有。
  controls: process.platform !== 'darwin',
  platform: process.platform,
  minimize: () => ipcRenderer.send(WINDOW_CHANNELS.minimize),
  toggleMaximize: () => ipcRenderer.send(WINDOW_CHANNELS.toggleMaximize),
  close: () => ipcRenderer.send(WINDOW_CHANNELS.close),
  isMaximized: () => ipcRenderer.invoke(WINDOW_CHANNELS.isMaximized) as Promise<boolean>,
  onMaximizeChange(callback: (maximized: boolean) => void) {
    const listener = (_event: unknown, maximized: boolean): void => callback(maximized)
    ipcRenderer.on(WINDOW_CHANNELS.maximizeChanged, listener)
    return () => ipcRenderer.removeListener(WINDOW_CHANNELS.maximizeChanged, listener)
  },
}
contextBridge.exposeInMainWorld('chaOfficeWindow', windowControlsApi)
contextBridge.exposeInMainWorld('chaOfficeTabs', tabsApi)

// Home 右栏停靠契约（P1）——与 chaOfficeTabs 同通道风格
const dockApi: DockApi = {
  async open(kind, options) {
    const result: unknown = await ipcRenderer.invoke(DOCK_CHANNELS.open, kind, options ?? {})
    return (result ?? null) as DockTabSummary | null
  },
  async list() {
    const result: unknown = await ipcRenderer.invoke(DOCK_CHANNELS.list)
    return Array.isArray(result) ? (result as DockTabSummary[]) : []
  },
  async activate(id) {
    await ipcRenderer.invoke(DOCK_CHANNELS.activate, id)
  },
  async close(id) {
    await ipcRenderer.invoke(DOCK_CHANNELS.close, id)
  },
  async undock(id) {
    await ipcRenderer.invoke(DOCK_CHANNELS.undock, id)
  },
  setRect(rect) {
    ipcRenderer.send(DOCK_CHANNELS.setRect, rect)
  },
  onChanged(handler) {
    const listener = (_event: IpcRendererEvent, tabs: DockTabSummary[]) => handler(tabs)
    ipcRenderer.on(DOCK_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(DOCK_CHANNELS.changed, listener)
  },
  relayCommand(dockTabId, command) {
    ipcRenderer.send(DOCK_CHANNELS.relayCommand, dockTabId, command)
  },
  onRelayEvent(handler) {
    const listener = (_event: IpcRendererEvent, dockTabId: string, event: RelayEvent) =>
      handler(dockTabId, event)
    ipcRenderer.on(DOCK_CHANNELS.relayEvent, listener)
    return () => ipcRenderer.removeListener(DOCK_CHANNELS.relayEvent, listener)
  },
  onPanelTurn(handler) {
    const listener = (_event: IpcRendererEvent, turn: PanelTurnReport) => handler(turn)
    ipcRenderer.on(DOCK_CHANNELS.panelTurn, listener)
    return () => ipcRenderer.removeListener(DOCK_CHANNELS.panelTurn, listener)
  },
}
contextBridge.exposeInMainWorld('chaOfficeDock', dockApi)

// remote storage (MinIO / OSS): settings, listing, object transfer, pending queue
contextBridge.exposeInMainWorld(
  'chaOfficeRemoteFiles',
  createRemoteFilesClient((channel, payload) => ipcRenderer.invoke(channel, payload)),
)

// open documents dragged from the OS anywhere over Home or the tab strip
installDropOpenBridge()

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

// LOCAL(purchase): offline purchase / license surface. Its own global (not
// merged into chaOffice) so the web/dsh iframe forms — which have no Electron
// preload — simply lack the bridge and the purchase UI stays silent there.
contextBridge.exposeInMainWorld('chaOfficePurchase', {
  state: (): Promise<PurchaseSnapshot> => ipcRenderer.invoke(PURCHASE_CHANNELS.state),
  activate: (serial: string): Promise<PurchaseActivateResult> =>
    ipcRenderer.invoke(PURCHASE_CHANNELS.activate, serial),
  onEvent: (listener: (payload: PurchaseEventPayload) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: PurchaseEventPayload): void => listener(payload)
    ipcRenderer.on(PURCHASE_CHANNELS.event, wrapped)
    return () => ipcRenderer.removeListener(PURCHASE_CHANNELS.event, wrapped)
  },
})
