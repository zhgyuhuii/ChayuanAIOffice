import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AiModelEntry, AiSettingsV2, ChatOfficeAccountStatus } from '@chatoffice/ai-provider'
import { normalizeAiPanelPrefs } from '@chatoffice/ui/ai-panel-prefs'
import { installDropOpenBridge } from '@chatoffice/electron-utils/drop-open'
import { createRemoteFilesClient } from '@chatoffice/storage-adapter/remote-ipc'
import type {
  AccountLoginEvent,
  AccountStatus,
  CloudProjectsSnapshot,
  HomeApi,
  HomeChatSession,
  RecentEntry,
  RecentPage,
  RenameResult,
  ProjectHomeApi,
  ProjectSummaryEntry,
  TimelineEntryItem,
  UiLanguage,
} from '../shared/home-api'
import { HOME_CHANNELS, PROJECT_CHANNELS } from '../shared/home-api'
import type { TabsApi, TabSummary } from '../shared/tabs-api'
import { TABS_CHANNELS, WINDOW_CHANNELS } from '../shared/tabs-api'
import type { WindowControlsApi } from '../shared/tabs-api'
import type { DockApi, DockTabSummary } from '../shared/dock-api'
import type { RelayEvent } from '../shared/relay-protocol'
import { DOCK_CHANNELS } from '../shared/dock-api'

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

const homeApi: HomeApi = {
  async recents(query) {
    return asRecentPage(await ipcRenderer.invoke(HOME_CHANNELS.recents, query))
  },
  async starred(query) {
    return asRecentPage(await ipcRenderer.invoke(HOME_CHANNELS.starred, query))
  },
  async statPaths(paths) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.statPaths, paths)
    return Array.isArray(result) ? (result as RecentEntry[]) : []
  },
  async toggleStar(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.toggleStar, path)
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
    // which sandboxed preload scripts cannot load (window.chatOffice would
    // silently disappear). Preload entries must stay single-file bundles.
    if (channel !== 'stable' && channel !== 'beta') throw new Error('Invalid update channel.')
    await ipcRenderer.invoke(HOME_CHANNELS.setUpdateChannel, channel)
  },
  async accountStatus() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.accountStatus)
    return (result ?? { loggedIn: false }) as AccountStatus
  },
  async accountLogin() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.accountLogin)
    return result === true
  },
  onAccountLogin(handler) {
    const listener = (_event: IpcRendererEvent, ev: AccountLoginEvent) => handler(ev)
    ipcRenderer.on(HOME_CHANNELS.accountLoginEvent, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.accountLoginEvent, listener)
  },
  async openLoginUrl() {
    await ipcRenderer.invoke(HOME_CHANNELS.accountLoginOpenUrl)
  },
  async accountLogout() {
    await ipcRenderer.invoke(HOME_CHANNELS.accountLogout)
  },
  async getAppVersion() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getAppVersion)
    return typeof result === 'string' ? result : ''
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
  async getAutoSaveDefault() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getAutoSaveDefault)
    const r = result as { on?: unknown; updatedAt?: unknown } | null
    return {
      on: r?.on === true,
      updatedAt: typeof r?.updatedAt === 'number' ? r.updatedAt : 0,
    }
  },
  async setAutoSaveDefault(on) {
    if (typeof on !== 'boolean') throw new Error('Invalid AutoSave default.')
    await ipcRenderer.invoke(HOME_CHANNELS.setAutoSaveDefault, on)
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
  async chatofficeStatus(withEmail) {
    return (await ipcRenderer.invoke('ai:chatoffice-status', withEmail)) as ChatOfficeAccountStatus
  },
  async chatofficeLogin() {
    await ipcRenderer.invoke('ai:chatoffice-login')
  },
  async aiLocalToolStatus(vendorId: string) {
    return (await ipcRenderer.invoke(
      'ai:local-tool-status',
      vendorId,
    )) as import('@chatoffice/ai-provider').LocalToolStatus
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
    )) as import('@chatoffice/ai-provider').LocalToolOpResult
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

contextBridge.exposeInMainWorld('chatOffice', homeApi)

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

contextBridge.exposeInMainWorld('chatOfficeProject', projectApi)

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
  async showMenu(x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showMenu, x, y)
  },
  async showNewMenu(x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showNewMenu, x, y)
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
contextBridge.exposeInMainWorld('chatOfficeWindow', windowControlsApi)
contextBridge.exposeInMainWorld('chatOfficeTabs', tabsApi)

// Home 右栏停靠契约（P1）——与 chatOfficeTabs 同通道风格
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
}
contextBridge.exposeInMainWorld('chatOfficeDock', dockApi)

// remote storage (MinIO / OSS): settings, listing, object transfer, pending queue
contextBridge.exposeInMainWorld(
  'chatOfficeRemoteFiles',
  createRemoteFilesClient((channel, payload) => ipcRenderer.invoke(channel, payload)),
)

// open documents dragged from the OS anywhere over Home or the tab strip
installDropOpenBridge()
