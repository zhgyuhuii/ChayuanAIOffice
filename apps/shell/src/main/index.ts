import './dev-identity'
import { execSync, spawn } from 'node:child_process'
import { startSiteSync } from './site-sync'
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import os from 'node:os'
import {
  BrowserWindow,
  Menu,
  MenuItem,
  app,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  session,
  shell,
  webContents,
} from 'electron'
import type { MenuItemConstructorOptions, NativeImage, WebContents } from 'electron'
import { tabStripOverlay } from './title-bar-overlay'
import { createFeedbackClient } from './feedback'
import menuDocxIcon1x from './assets/menu-docx.png?asset'
import menuDocxIcon2x from './assets/menu-docx@2x.png?asset'
import menuXlsxIcon1x from './assets/menu-xlsx.png?asset'
import menuXlsxIcon2x from './assets/menu-xlsx@2x.png?asset'
import menuPptxIcon1x from './assets/menu-pptx.png?asset'
import menuPptxIcon2x from './assets/menu-pptx@2x.png?asset'
import menuPdfIcon1x from './assets/menu-pdf.png?asset'
import menuPdfIcon2x from './assets/menu-pdf@2x.png?asset'
import menuMdIcon1x from './assets/menu-md.png?asset'
import menuMdIcon2x from './assets/menu-md@2x.png?asset'
import menuHtmlIcon1x from './assets/menu-html.png?asset'
import menuHtmlIcon2x from './assets/menu-html@2x.png?asset'
import menuHomeIcon1x from './assets/menu-home.png?asset'
import menuHomeIcon2x from './assets/menu-home@2x.png?asset'
import appIconPath from './assets/app-icon.png?asset'

// Brand icon for every window the shell creates: the taskbar / Alt-Tab / native
// title-bar icon on Windows and Linux, and the macOS dock icon in dev builds
// (packaged mac/win bake the same artwork into the app bundle / exe).
const APP_ICON = nativeImage.createFromPath(appIconPath)
import { createI18n, isLang, normalizeLang, setUiLang, type Lang } from '@chatoffice/i18n'
import {
  DEFAULT_SAVE_DIR_KEY,
  DROP_OPEN_CHANNEL,
  GITHUB_REPO_URL,
  appMenuLabels,
  contextMenuLabels,
  editMenuTemplate,
  installContextMenu,
  installNavigationGuard,
  isUsableSaveDir,
  HEADLESS_EXIT,
  formatHeadlessEnvelope,
  headlessExitCode,
  parseHeadlessExportArgv,
  setHeadlessMode,
  type HeadlessArgvParse,
  showOpenDialogWithMemory,
  showSaveDialogWithMemory,
  windowMenuTemplate,
  aboutMenuItem,
  checkUpdatesMenuItem,
  displayVersion,
  setUpdateCheckInvoker,
  installRendererProtocol,
} from '@chatoffice/electron-utils'
import { readAppSettings, writeAppSetting, writeAppSettings } from './app-settings'
import { OPEN_DOCUMENTS_FILE, clearOpenDocuments, publishOpenDocuments } from './open-documents'
import { startControlServer, type ControlServer } from './control-server'
import { controlHandler } from './control-handlers'
import { installCliLinkBestEffort } from './cli-link'
import { registerIntegrationsIpc } from './integrations-ipc'
import { createExternalMcpManager } from './mcp/external-client'
import { registerMcpClientIpc } from './mcp/external-client-ipc'
import {
  ANALYTICS_ENABLED_KEY,
  analyticsEnabledFrom,
  createAnalytics,
  ensureAnalyticsClientState,
  extractPackagedAnalyticsKeys,
  markAnalyticsFirstLaunchSent,
} from './analytics'
import type { Analytics, AnalyticsKeys } from './analytics'
// LOCAL(purchase): offline purchase / license scheduler + IPC (B-zone module)
import { openPurchasePage, purchaseSnapshot, registerPurchaseIpc, startPurchaseScheduler } from './purchase'
import type { PurchaseSnapshot } from '../shared/purchase-api'
import {
  LAST_RUN_VERSION_KEY,
  STAR_PROMPT_KEY,
  asStarPromptState,
  isUpgradeLaunch,
  shouldShowStarPrompt,
  shouldShowUpgradeStarPrompt,
  withDocOpen,
  withFirstRun,
  withResolved,
  withShown,
} from './star-prompt'
import {
  clearCloudProjectsStore,
  cloudProjectExternalUrl,
  readCloudProjectsStore,
  syncCloudProjects,
} from './cloud-projects'
import { handleDroppedFiles } from './dropped-files'
import { ProjectStore } from '@chatoffice/project-store'
import { bindRemoteFilesIpc, isRemoteUri, parseRemoteUri } from '@chatoffice/storage-adapter'
import {
  ensureChatofficeLogin,
  chatofficeLogout,
  chatofficeConvertPdfToDocx,
  chatofficeLoginInfo,
  hasChatOfficeAuth,
  loadChatofficeAuth,
  resolveChatOfficeEntry,
  setChatOfficeProxyUrl,
  startChatofficeLogin,
  watchChatofficeApiKey,
} from '@chatoffice/ai-search'
import { setRescueFetch } from '@chatoffice/ai-provider'

import {
  buildDocsMenu,
  configureDocsRuntime,
  docsFileRenamed,
  docsQueryDirty,
  requestDocsClose,
  readRecentFiles,
  readStarredFiles,
  recordRecentFile,
  removeRecentFiles,
  removeStarredFiles,
  replaceRecentFile,
  registerAiIpc,
  registerProjectIpc,
  toggleStarredFile,
  forwardRelayCommand,
  queueDocsSaveDir,
  setPanelTurnForwarder,
  registerDocsIpc,
  setRelayEventForwarder,
  exportDocsHeadless,
  setDocsExtraFileMenuItems,
  setDocsMenuGate,
  setDocsShellHooks,
  createAiDocument,
  projectFilePaths,
  projectFileRenamed,
  setDocsHostWindowHook,
  setDocsShellWindow,
  setDocsFileSavedHook,
  setDocsFileOpenedHook,
  setSessionPathResolver,
  defaultSaveDir,
  uniquePathIn,
  remoteFiles,
  openRemoteDocument,
  deleteRemoteDocument,
  renameRemoteDocument,
  authorizeMcpDocWrite,
} from '../../../docs/src/main/docs-main'
import { blankPdfBuffer } from '../../../pdf/src/main/blank-pdf'
import { blankXlsxBuffer } from '@chatoffice/xlsx-gateway/gateway/csv-import'
import {
  applyMcpSettings,
  clearMcpLogs,
  configureMcpRuntime,
  getMcpRecentLogs,
  mcpLogFilePath,
  mcpStatus,
  revealMcpLogFile,
  startMcpFromSettings,
  stopMcpSync,
  type McpSettings,
} from './mcp/app-mcp'
import { createCliRunner } from './mcp/cli-runner'
import { DEFAULT_MCP_PORT } from './mcp/mcp-server'
import { createDocsControl, installDocsBridge } from './mcp/docs-bridge'
import { initAiFetchProxy, cleanupAiFetchProxy } from './ai-fetch-proxy'
import { createSlidesControl } from './mcp/slides-bridge'
import { createSheetsControl, installSheetsBridge } from './mcp/sheets-bridge'
import { createOpenDocumentsControl, createOpenTargetResolver } from './mcp/open-documents-bridge'
import {
  configureSheetsRuntime,
  exportSheetsPdfHeadless,
  hasActiveQueuedWorkbook,
  installSheetsMenu,
  markSheetsShuttingDown,
  requestSheetsClose,
  resolveSheetsSessionPath,
  authorizeMcpSheetWrite,
  sendSheetsMenuAction,
  setSheetsBlankDraftHook,
  sheetsBlankRecoveryCopy,
  sheetsFileRenamed,
  setSheetsCloseTabHook,
  setSheetsExtraFileMenuItems,
  setSheetsHostWindowHook,
  setSheetsShellWindow,
  setSheetsWorkbookOpenedHook,
  startSheetsCaptureServer,
  stopSheetsSidecar,
} from '../../../sheets/src/main/sheets-main'
import {
  configureSlidesRuntime,
  discardSlidesRecovery,
  exportSlidesPdfHeadless,
  installSlidesMenu,
  readSlidesRecentFiles,
  replaceSlidesRecentFile,
  requestSlidesClose,
  setSlidesCloseTabHook,
  setSlidesExtraFileMenuItems,
  setSlidesOpenedHook,
  setSlidesShellWindow,
  setSlidesShowBleed,
  slidesFileRenamed,
} from '../../../slides/src/main/slides-main'
import {
  configurePdfRuntime,
  finalizePdfUntitled,
  flushPdfSave,
  markPdfUntitledPath,
  pdfFileRenamed,
  pdfIsDirty,
  pdfUntitledDialogDefault,
  requestPdfClose,
  requestPdfSaveAs,
  sendPdfPrintRequest,
  setPdfRenamedHook,
  setPdfSaveAsInFlight,
  pdfUntitledRecoveryCopy,
} from '../../../pdf/src/main/pdf-main'
import { PDF_CHANNELS } from '../../../pdf/src/shared/ipc'
import { convertPdfFileToDocxLocalWithPrompt, PdfLoadError } from './pdf2docx-local'
import { convertPdfFileToPptxLocalWithPrompt } from './pdf2pptx-local'
import { convertPdfFileToXlsxLocalWithPrompt } from './pdf2xlsx-local'
import { closePdfPasswordDialog, promptPdfPassword } from './pdf-password-dialog'
import {
  configureMarkdownRuntime,
  exportMarkdownPdfHeadless,
  markdownDiscardPendingAssets,
  markdownFileRenamed,
  markdownReadText,
  markdownSaveToPath,
  requestMarkdownClose,
  requestMarkdownSave,
  sendMarkdownExportRequest,
  sendMarkdownPrintRequest,
  setMarkdownDocxExportedHook,
  setMarkdownFileSavedHook,
} from '../../../markdown/src/main/markdown-main'
import {
  configureHtmlRuntime,
  exportHtmlHeadless,
  htmlDiscardPendingAssets,
  htmlFileRenamed,
  htmlReadText,
  htmlSaveToPath,
  registerPrivilegedSchemes,
  requestHtmlClose,
  requestHtmlSave,
  sendHtmlExportRequest,
  sendHtmlPrintRequest,
  setHtmlDocxExportPrepareHook,
  setHtmlDocxExportedHook,
  setHtmlFileSavedHook,
  setHtmlPresentHooks,
  setHtmlProvisionalTitleHook,
} from '../../../html/src/main/html-main'
import type {
  AccountLoginEvent,
  AutoSaveDefault,
  FeedbackAttachmentMeta,
  FolderListing,
  FolderRoot,
  MoveConflictPolicy,
  MoveResult,
  NewFileOpts,
  RecentEntry,
  RecentPage,
  RenameResult,
  StarPromptShow,
  UiTheme,
  FileSearchPage,
  FileSearchQuery,
  FileSearchRerank,
  FileSearchSettings,
} from '../shared/home-api'
import { HOME_CHANNELS, type SystemSearchEntry, type SystemSearchResult } from '../shared/home-api'
import {
  normalizeAiPanelPrefs,
  sameAiPanelPrefs,
  type AiPanelPrefs,
} from '@chatoffice/ui/ai-panel-prefs'
import type { TabKind } from '../shared/tabs-api'
import { TABS_CHANNELS, WINDOW_CHANNELS } from '../shared/tabs-api'
import type { DockEditorOptions, DockKind, DockRect } from '../shared/dock-api'
import { DOCK_CHANNELS } from '../shared/dock-api'
import { showErrorDialog } from './error-dialog'
import {
  matchesExtFamily,
  normalizeRecentQuery,
  pageRecentPaths,
  statPathEntries,
} from './recent-files'
import { isSameFile, isValidRawRenameName } from './rename-validation'
import {
  FolderWatcher,
  createFolder,
  describeRoot,
  isInsideRoot,
  pathsUnder,
  listFolder,
  movePathsInto,
  rebasePath,
  renameFolder,
  uniqueNameIn,
  type FolderErrors,
} from './folder-tree'
import {
  FOLDER_ROOTS_KEY,
  describeExtraRoot,
  readExtraRoots,
  withExtraRoot,
  withoutExtraRoot,
} from './folder-roots'
import extractWorkerPath from './file-index/extract-worker?modulePath'
import { FileIndexer } from './file-index/indexer'
import { FileIndexStore } from './file-index/store'
import {
  jevEndpointOf,
  normalizeFileSearchSettings,
  probeJev,
  SearchReranker,
} from './file-index/rerank'
import { runHeadlessExport, type HeadlessExporters } from './headless-export'
import { TabManager } from './tab-manager'
import {
  activateDetached,
  closeDetachedWithoutPrompt,
  createDetachedEditorWindow,
  detachedFilePaths,
  detachedOpenDocuments,
  detachedRenameFile,
  detachedSetFileFor,
  detachedWebContentsFor,
  detachedWindowForWebContents,
  findDetachedTabByPath,
  focusDetachedByPath,
  focusedDetachedKind,
  isDetachedTabId,
  setDetachedChangedListener,
} from './detached-windows'
import { applyUpdateChannel, checkForUpdatesNow, initAutoUpdater } from './updater'
import { isUpdateChannel, type UpdateChannel } from '../shared/update-api'

/**
 * ChatOffice unified shell: ONE Electron app, ONE BrowserWindow, hosting the
 * docs and sheets modules as WebContentsView tabs behind a WPS-style tab
 * strip. The shell owns the lifecycle — single-instance lock, file-
 * association routing by extension, and per-active-tab menu switching.
 * Renderers load from each module's build output (apps/docs/out,
 * apps/sheets/out), so build those before running the shell.
 */

// ANY unpacked run (`npm run shell`, `npm run dev`, `npx electron .`) must not
// share the installed app's userData or single-instance lock — otherwise a dev
// run silently quits and forwards its argv to the running installed ChatOffice.
// CHATOFFICE_USER_DATA: test drivers point this at a scratch dir so an
// automated instance can run alongside the dev instance (separate lock).
if (!app.isPackaged)
  app.setPath(
    'userData',
    process.env.CHATOFFICE_USER_DATA ?? join(app.getPath('appData'), 'ChatOffice Dev'),
  )

/**
 * `--headless-export <file> --to <format> --out <path> [--json]`: one document, no
 * window, one stdout line, then exit. Parsed at module scope so the dock icon
 * is gone before the app can bounce it and so every editor module sees the
 * headless flag before it registers anything.
 */
const headlessArgv = parseHeadlessExportArgv(process.argv)
if (headlessArgv.kind !== 'none') {
  setHeadlessMode(true)
  app.dock?.hide()
}

// Product renames changed the userData path ("AI Office" → "ChatOffice" → "ChaAI Office"); migrate old user data once on each rename hop.
if (app.isPackaged) {
  const newDir = app.getPath('userData')
  const newEmpty = !existsSync(newDir) || readdirSync(newDir).length === 0
  if (newEmpty) {
    for (const oldName of ['ChatOffice', 'AI Office']) {
      const oldDir = join(app.getPath('appData'), oldName)
      // The current name sits in the hop list from an earlier rename; copying
      // it onto itself throws "src and dest cannot be the same" as an uncaught
      // exception and kills the packaged app's very first launch.
      if (oldDir === newDir) continue
      if (existsSync(oldDir)) {
        // cpSync nests src under an existing dest dir — copy entry-by-entry so
        // the old profile's contents land at the root of the new one.
        mkdirSync(newDir, { recursive: true })
        for (const entry of readdirSync(oldDir)) {
          cpSync(join(oldDir, entry), join(newDir, entry), { recursive: true })
        }
        break
      }
    }
  }
}

// module build outputs: packaged builds carry them as extraResources
// (resources/modules/*, resources/native/*); dev/unpacked resolves them
// relative to apps/shell in the monorepo layout.
const SIDECAR_EXE = process.platform === 'win32' ? 'xlsx-sidecar.exe' : 'xlsx-sidecar'
const APPS_ROOT = join(app.getAppPath(), '..')
const DOCS_OUT = app.isPackaged
  ? join(process.resourcesPath, 'modules', 'docs')
  : join(APPS_ROOT, 'docs', 'out')
const SHEETS_OUT = app.isPackaged
  ? join(process.resourcesPath, 'modules', 'sheets')
  : join(APPS_ROOT, 'sheets', 'out')
const SLIDES_OUT = app.isPackaged
  ? join(process.resourcesPath, 'modules', 'slides')
  : join(APPS_ROOT, 'slides', 'out')
const PDF_OUT = app.isPackaged
  ? join(process.resourcesPath, 'modules', 'pdf')
  : join(APPS_ROOT, 'pdf', 'out')
const MARKDOWN_OUT = app.isPackaged
  ? join(process.resourcesPath, 'modules', 'markdown')
  : join(APPS_ROOT, 'markdown', 'out')
const HTML_OUT = app.isPackaged
  ? join(process.resourcesPath, 'modules', 'html')
  : join(APPS_ROOT, 'html', 'out')
const SIDECAR_BIN = app.isPackaged
  ? join(process.resourcesPath, 'native', SIDECAR_EXE)
  : join(APPS_ROOT, 'sheets', 'native', 'xlsx-engine', 'target', 'release', SIDECAR_EXE)

configureDocsRuntime({
  preloadPath: join(DOCS_OUT, 'preload', 'index.js'),
  rendererUrl: process.env.DOCS_RENDERER_URL,
  rendererFile: join(DOCS_OUT, 'renderer', 'index.html'),
})
configureSheetsRuntime({
  preloadPath: join(SHEETS_OUT, 'preload', 'index.js'),
  rendererUrl: process.env.SHEETS_RENDERER_URL,
  rendererFile: join(SHEETS_OUT, 'renderer', 'index.html'),
  sidecarPath: SIDECAR_BIN,
  openGeneratedPath: (path) => openGeneratedDocument(path),
  // The sheets AI's create_document (docx/pdf/md) funnels into the docs-owned
  // creation flow, like the pdf app below.
  createDocument: createAiDocument,
})
configureSlidesRuntime({
  preloadPath: join(SLIDES_OUT, 'preload', 'index.js'),
  rendererDevUrl: process.env.SLIDES_RENDERER_URL,
  rendererFilePath: join(SLIDES_OUT, 'renderer', 'index.html'),
  openGeneratedPath: (path) => openGeneratedDocument(path),
  untitledSaveDir: () => pendingProjectSaveDir('slide'),
})
configurePdfRuntime({
  preloadPath: join(PDF_OUT, 'preload', 'index.js'),
  rendererUrl: process.env.PDF_RENDERER_URL,
  rendererFile: join(PDF_OUT, 'renderer', 'index.html'),
  openGeneratedPath: (path) => openGeneratedDocument(path),
  createDocument: createAiDocument,
})
configureMarkdownRuntime({
  preloadPath: join(MARKDOWN_OUT, 'preload', 'index.js'),
  rendererUrl: process.env.MARKDOWN_RENDERER_URL,
  rendererFile: join(MARKDOWN_OUT, 'renderer', 'index.html'),
  openGeneratedPath: (path) => openGeneratedDocument(path),
})
configureHtmlRuntime({
  preloadPath: join(HTML_OUT, 'preload', 'index.js'),
  rendererUrl: process.env.HTML_RENDERER_URL,
  rendererFile: join(HTML_OUT, 'renderer', 'index.html'),
  openGeneratedPath: (path) => openGeneratedDocument(path),
})
// privileged-scheme registration is only legal before app ready
registerPrivilegedSchemes()

// ---- UI language ----
// Persisted in userData/app-settings.json so the editor modules can read the
// same file when they pick up i18n later. CHATOFFICE_LANG overrides for tests.

const APP_SETTINGS_PATH = () => join(app.getPath('userData'), 'app-settings.json')
const OPEN_DOCUMENTS_PATH = () => join(app.getPath('userData'), OPEN_DOCUMENTS_FILE)
/** only the instance holding the single-instance lock may write or remove the registry */
let ownsOpenDocumentsRegistry = false
let stopAuthWatch: (() => void) | null = null
const publishOpenDocumentsIfOwner = (paths: readonly string[]) => {
  if (ownsOpenDocumentsRegistry) publishOpenDocuments(OPEN_DOCUMENTS_PATH(), paths)
}

/** every open file: the shell's tabs plus the detached editor windows */
function publishAllOpenDocuments(): void {
  publishOpenDocumentsIfOwner([...(tabManager?.openFilePaths() ?? []), ...detachedFilePaths()])
}
setDetachedChangedListener(publishAllOpenDocuments)

let uiLang: Lang | null = null

function currentLang(): Lang {
  if (uiLang) return uiLang
  if (process.env.CHATOFFICE_LANG) {
    uiLang = normalizeLang(process.env.CHATOFFICE_LANG)
    setUiLang(uiLang)
    return uiLang
  }
  const saved = readAppSettings(APP_SETTINGS_PATH()).language
  if (isLang(saved)) uiLang = saved
  uiLang ??= normalizeLang(app.getLocale())
  setUiLang(uiLang)
  return uiLang
}

function persistLang(lang: Lang): void {
  uiLang = lang
  setUiLang(lang)
  writeAppSetting(APP_SETTINGS_PATH(), 'language', lang)
}

let cachedUpdateChannel: UpdateChannel | null = null

function currentUpdateChannel(): UpdateChannel {
  if (cachedUpdateChannel) return cachedUpdateChannel
  const saved = readAppSettings(APP_SETTINGS_PATH()).updateChannel
  cachedUpdateChannel = isUpdateChannel(saved) ? saved : 'stable'
  return cachedUpdateChannel
}

let cachedTheme: UiTheme | null = null

function currentTheme(): UiTheme {
  if (cachedTheme) return cachedTheme
  const saved = readAppSettings(APP_SETTINGS_PATH()).theme
  cachedTheme = saved === 'light' || saved === 'dark' ? saved : 'system'
  return cachedTheme
}

let cachedAutoSaveDefault: AutoSaveDefault | null = null

function currentAutoSaveDefault(): AutoSaveDefault {
  if (cachedAutoSaveDefault) return cachedAutoSaveDefault
  const saved = readAppSettings(APP_SETTINGS_PATH())
  const updatedAt = saved.autoSaveDefaultUpdatedAt
  cachedAutoSaveDefault = {
    on: saved.autoSaveDefault === true,
    updatedAt: typeof updatedAt === 'number' && updatedAt > 0 ? updatedAt : 0,
  }
  return cachedAutoSaveDefault
}

/** MCP server settings (persisted in userData/app-settings.json; default off). */
function currentMcpSettings(): McpSettings {
  const saved = readAppSettings(APP_SETTINGS_PATH())
  const port = saved.mcpPort
  return {
    enabled: saved.mcpEnabled === true,
    port:
      typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536
        ? port
        : DEFAULT_MCP_PORT,
    background: saved.mcpBackground === true,
    logging: saved.mcpLogging === true,
  }
}

let cachedAiPanelPrefs: AiPanelPrefs | null = null
function currentAiPanelPrefs(): AiPanelPrefs {
  if (cachedAiPanelPrefs) return cachedAiPanelPrefs
  const saved = readAppSettings(APP_SETTINGS_PATH())
  cachedAiPanelPrefs = normalizeAiPanelPrefs({
    side: saved.aiPanelSide,
    fontSize: saved.aiPanelFontSize,
    customFontSize: saved.aiPanelCustomFontSize,
    spellcheck: saved.aiPanelSpellcheck,
  })
  return cachedAiPanelPrefs
}

// ---- anonymous usage analytics (see src/main/analytics.ts) ----
// Stays a no-op until initAnalytics() runs at startup; keyless builds
// (source/forks) keep the no-op forever, so every track() call is safe.

let analytics: Analytics = { active: false, track: () => {} }

let cachedAnalyticsEnabled: boolean | null = null

function analyticsEnabled(): boolean {
  cachedAnalyticsEnabled ??= analyticsEnabledFrom(readAppSettings(APP_SETTINGS_PATH()))
  return cachedAnalyticsEnabled
}

function resolveAnalyticsKeys(): AnalyticsKeys | null {
  // Only packaged extraMetadata is authoritative. Source/dev runs never read
  // runtime credentials and therefore remain a strict no-op.
  if (!app.isPackaged) return null
  try {
    return extractPackagedAnalyticsKeys(
      JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')),
      app.isPackaged,
    )
  } catch {
    return null
  }
}

function persistAnalyticsPreference(enabled: boolean): boolean {
  const previous = cachedAnalyticsEnabled
  // Change the in-memory gate before touching disk. The synchronous atomic
  // write prevents another event from being handled in between.
  cachedAnalyticsEnabled = enabled
  try {
    writeAppSettings(APP_SETTINGS_PATH(), { [ANALYTICS_ENABLED_KEY]: enabled })
    return true
  } catch (error) {
    cachedAnalyticsEnabled = previous
    throw error
  }
}

function initAnalytics(): void {
  try {
    let clientState: ReturnType<typeof ensureAnalyticsClientState> | null = null
    const getClientState = () => (clientState ??= ensureAnalyticsClientState(APP_SETTINGS_PATH()))
    analytics = createAnalytics({
      keys: resolveAnalyticsKeys(),
      getClientId: () => getClientState().clientId,
      isEnabled: analyticsEnabled,
      shouldTrackFirstLaunch: () => getClientState().firstLaunchPending,
      onFirstLaunchSent: () => markAnalyticsFirstLaunchSent(APP_SETTINGS_PATH()),
      // Country-only approximation from OS regional settings. This avoids an
      // IP lookup while populating GA4's built-in Country dimension.
      getCountryCode: () => app.getLocaleCountryCode(),
      // evaluated per event: ui_lang follows live language switches
      baseParams: () => ({
        app_version: app.getVersion(),
        platform: process.platform,
        os_version: process.getSystemVersion(),
        ui_lang: currentLang(),
      }),
    })
  } catch {
    // analytics must never block startup
  }
}

// ---- first-run onboarding ----
// The GenTeam community page opened from the onboarding's second slide.
// Stable short link served by the genspark.ai site; it 302s to the tokened
// invite link, which stays out of this repo and rotates server-side.
const GENTEAM_URL = 'https://genspark.ai/join'

// ChatOffice credit-usage page opened from the account menu's credits row.
// Kept main-side so the renderer never supplies the URL.
const CREDIT_USAGE_URL = 'https://www.genspark.ai/credit-usage'

// ---- "star us on GitHub" prompt (see star-prompt.ts for the rules) ----

const readStarPrompt = () =>
  asStarPromptState(readAppSettings(APP_SETTINGS_PATH())[STAR_PROMPT_KEY])
const writeStarPrompt = (state: ReturnType<typeof readStarPrompt>) =>
  writeAppSetting(APP_SETTINGS_PATH(), STAR_PROMPT_KEY, state)

/** set at startup when this is the first launch after an upgrade; consumed by
 * the first starPromptShouldShow query of the session */
let upgradeStarPromptPending = false

/** a granted show, cached for the session: repeated queries (React StrictMode
 * double-effects, AppFrame remounts) must return the same answer instead of
 * burning another lifetime show or flipping to a snoozed "false" */
let starPromptSessionGrant: StarPromptShow | null = null

/** every successful document open counts toward the prompt's value threshold */
function recordStarPromptDocOpen(): void {
  try {
    const state = readStarPrompt()
    const next = withDocOpen(state)
    if (next !== state) writeStarPrompt(next)
  } catch {
    // settings write failures must never break opening a document
  }
}

// Stargazer count for the settings About pane; fetched main-side (the
// renderer CSP has no api.github.com) and cached per session — the exact
// number is decoration, staleness is fine.
let cachedGithubStars: number | null = null

async function fetchGithubStars(): Promise<number | null> {
  if (cachedGithubStars !== null) return cachedGithubStars
  try {
    const response = await fetch('https://api.github.com/repos/zhgyuhuii/ChayuanAIOffice', {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null
    const body: unknown = await response.json()
    const count = (body as { stargazers_count?: unknown }).stargazers_count
    if (typeof count !== 'number' || !Number.isFinite(count)) return null
    cachedGithubStars = count
    return count
  } catch {
    return null
  }
}

const tMain = createI18n({
  zh: {
    dlgAddFolderRoot: '添加文件夹到首页',
    errFolderRootUnusable: '无法读取所选文件夹',
    menuFile: '文件',
    menuSectionNew: '新建',
    menuOpenInNewWindow: '在新窗口中打开',
    menuNewDoc: '文档',
    menuNewSheet: '表格',
    untitledSheet: '未命名表格',
    untitledDoc: '未命名文档',
    untitledDeck: '未命名演示文稿',
    untitledMarkdown: '未命名 Markdown',
    untitledHtml: '未命名 HTML',
    untitledPdf: '未命名 PDF',
    menuNewSlide: '演示稿',
    menuNewMarkdown: 'MD文档',
    menuNewPdf: 'PDF文档',
    menuNewHtml: 'HTML文档',
    menuExportPdf: '导出为 PDF…',
    menuExportImages: '导出为图片…',
    menuExportHtml: '导出为单文件 HTML…',
    menuOpenInDocs: '转换为 Docs 文档并打开',
    menuPrint: '打印…',
    menuOpen: '打开…',
    menuSave: '保存',
    menuSaveAs: '另存为…',
    menuClose: '关闭',
    menuEdit: '编辑',
    menuWindow: '窗口',
    menuHome: '首页',
    backToHome: '返回首页',
    dlgOpenTitle: '打开文件',
    filterSupported: '支持的文件',
    filterWord: 'Word 文档',
    filterExcel: 'Excel 工作簿',
    filterPpt: 'PowerPoint 演示文稿',
    filterMarkdown: 'Markdown 文档',
    filterHtml: 'HTML 文档',
    filterPdf: 'PDF 文档',
    errBadArgs: '参数无效',
    errBadName: '文件名不合法',
    errMissing: '文件不存在',
    errExists: '同名文件已存在',
    errRenameFailed: '重命名失败',
    errNewTabFailed: '新建文档失败',
    errUnsupportedExt: '暂不支持 .{ext} 类型',
    copySuffix: '副本',
    menuHelp: '帮助',
    menuActivate: '激活',
    menuActivateLoading: '正在读取授权状态…',
    menuActivateEntitled: '已激活 · 有效期至 {date}',
    menuActivateFree: '免费体验中 · 剩 {n} 天',
    menuActivateExpired: '体验期已结束 · 购买后提醒消失',
    menuPurchaseActivate: '购买 / 激活…',
    thirdPartyNotices: '第三方软件声明',
    menuExportDocx: '导出为 Word…',
    menuExportDocxLocal: '导出为 Word（本地）…',
    pdfDocxLoginMsg: '导出为 Word 需要登录 察元AIOffice 账号。',
    pdfDocxLoginDetail: '点击“登录”将打开浏览器完成授权，完成后请重新点击导出。',
    pdfDocxBtnLogin: '登录',
    pdfDocxConfirmMsg: '将此 PDF 上传到 察元AIOffice 云端转换为 Word？',
    pdfDocxConfirmDetail: '本次转换将消耗 5 credits，文件将上传至云端处理。',
    pdfDocxConfirmBalance: '当前余额 {balance} credits。',
    pdfDocxBtnConvert: '继续',
    btnCancel: '取消',
    pdfDocxFailedMsg: '导出为 Word 失败',
    pdfDocxNoCliMsg: '无法登录 察元AIOffice：缺少必需组件（chatoffice），请重新安装应用。',
    pdfDocxBusyMsg: '正在转换中，请等待当前导出完成。',
    menuExportPptx: '导出为 PPT…',
    pdfPptxFailedMsg: '导出为 PPT 失败',
    pdfPptxBusyMsg: '正在转换中，请等待当前导出完成。',
    pdfPptxLocalScannedDetail: '本地转换已按图片保真导出各页，幻灯片中的文字不可编辑。',
    menuExportXlsx: '导出为 Excel…',
    pdfXlsxFailedMsg: '导出为 Excel 失败',
    pdfXlsxBusyMsg: '正在转换中，请等待当前导出完成。',
    pdfXlsxLocalScannedDetail: '扫描页无法转换为单元格，对应工作表中已写入提示行。',
    pdfXlsxLocalSkippedMsg: '部分页面未转换为单元格',
    pdfXlsxLocalSkippedDetail: '第 {pages} 页无法转换为单元格，对应工作表中已写入提示行。',
    pdfDocxLocalScannedMsg: '检测到扫描件',
    pdfDocxLocalScannedDetail: '本地转换已按图片保真导出各页，未能识别出可编辑的文本。',
    pdfDocxLocalDegradedMsg: '部分页面已按图片导出',
    pdfDocxLocalDegradedDetail: '第 {pages} 页版面无法可靠重建，已按整页图片保真导出。',
    pdfDocxLocalOcrMsg: '扫描页已转换为可编辑文本',
    pdfDocxLocalOcrDetail:
      '第 {pages} 页为扫描件，已通过本地 OCR 识别为可编辑文字，建议校对识别结果。',
    pdfDocxLocalEncryptedDetail: '此 PDF 已加密，未提供正确的密码，无法转换。',
    pdfDocxLocalUnsupportedEncDetail: '该文件使用证书加密或不支持的加密方式，无法转换。',
    pdfPwdTitle: '输入密码',
    pdfPwdPrompt: '此 PDF 已加密，请输入打开密码：',
    pdfPwdRetryPrompt: '密码不正确，请重试。',
    pdfPwdOk: '确定',
    pdfPwdVerifying: '正在验证密码…',
    pdfPwdLabel: '密码',
    pdfPwdPlaceholder: '输入打开密码',
    pdfPwdShow: '显示密码',
    pdfPwdHide: '隐藏密码',
    pdfDocxLocalCorruptDetail: '文件已损坏或不是有效的 PDF，无法转换。',
    dlgPickSaveDir: '选择默认保存位置',
    errSaveDirUnusable: '所选文件夹不可写，无法用作默认保存位置',
    tabCtxClose: '关闭',
    tabCtxCloseOthers: '关闭其他',
    tabCtxCloseLeft: '关闭左侧',
    tabCtxCloseRight: '关闭右侧',
    tabCtxCloseAll: '关闭全部',
  },
  en: {
    dlgAddFolderRoot: 'Add Folder to Home',
    errFolderRootUnusable: 'The selected folder cannot be read',
    menuFile: 'File',
    menuSectionNew: 'New',
    menuOpenInNewWindow: 'Open in New Window',
    menuNewDoc: 'Doc',
    menuNewSheet: 'Sheet',
    untitledSheet: 'Untitled Spreadsheet',
    untitledDoc: 'Untitled Document',
    untitledDeck: 'Untitled Presentation',
    untitledMarkdown: 'Untitled Markdown',
    untitledHtml: 'Untitled HTML',
    untitledPdf: 'Untitled PDF',
    menuNewSlide: 'Slides',
    menuNewMarkdown: 'MD Doc',
    menuNewPdf: 'PDF Doc',
    menuNewHtml: 'AI HTML',
    menuExportPdf: 'Export as PDF…',
    menuExportImages: 'Export as Images…',
    menuExportHtml: 'Export as Single-File HTML…',
    menuOpenInDocs: 'Convert and Open in Docs',
    menuPrint: 'Print…',
    menuOpen: 'Open…',
    menuSave: 'Save',
    menuSaveAs: 'Save As…',
    menuClose: 'Close',
    menuEdit: 'Edit',
    menuWindow: 'Window',
    menuHome: 'Home',
    backToHome: 'Back to Home',
    dlgOpenTitle: 'Open File',
    filterSupported: 'Supported Files',
    filterWord: 'Word Documents',
    filterExcel: 'Excel Workbooks',
    filterPpt: 'PowerPoint Presentations',
    filterMarkdown: 'Markdown Documents',
    filterHtml: 'HTML Documents',
    filterPdf: 'PDF Documents',
    errBadArgs: 'Invalid arguments',
    errBadName: 'Invalid file name',
    errMissing: 'File not found',
    errExists: 'A file with that name already exists',
    errRenameFailed: 'Rename failed',
    errNewTabFailed: 'Could not create the new document',
    errUnsupportedExt: '.{ext} files are not supported',
    copySuffix: 'copy',
    menuHelp: 'Help',
    menuActivate: 'License',
    menuActivateLoading: 'Loading license status…',
    menuActivateEntitled: 'Activated · valid until {date}',
    menuActivateFree: 'Free trial · {n} days left',
    menuActivateExpired: 'Trial ended · buy to stop reminders',
    menuPurchaseActivate: 'Purchase / Activate…',
    thirdPartyNotices: 'Third-Party Notices',
    menuExportDocx: 'Export as Word…',
    menuExportDocxLocal: 'Export as Word（本地）…',
    pdfDocxLoginMsg: 'Exporting as Word requires signing in to ChaAI Office.',
    pdfDocxLoginDetail:
      'Clicking “Sign In” opens your browser to authorize; once done, click Export again.',
    pdfDocxBtnLogin: 'Sign In',
    pdfDocxConfirmMsg: 'Upload this PDF to ChaAI Office cloud and convert it to Word?',
    pdfDocxConfirmDetail:
      'The conversion costs 5 credits. The file will be uploaded for cloud processing.',
    pdfDocxConfirmBalance: 'Current balance: {balance} credits.',
    pdfDocxBtnConvert: 'Continue',
    btnCancel: 'Cancel',
    pdfDocxFailedMsg: 'Export as Word failed',
    pdfDocxNoCliMsg:
      'Cannot sign in to ChaAI Office: a required component (chatoffice) is missing. Please reinstall the app.',
    pdfDocxBusyMsg: 'A Word export is already in progress. Please wait for it to finish.',
    menuExportPptx: 'Export as PowerPoint…',
    pdfPptxFailedMsg: 'Export as PowerPoint failed',
    pdfPptxBusyMsg: 'An export is already in progress. Please wait for it to finish.',
    pdfPptxLocalScannedDetail:
      'Each page was exported as a full-page image; the text on the slides is not editable.',
    menuExportXlsx: 'Export as Excel…',
    pdfXlsxFailedMsg: 'Export as Excel failed',
    pdfXlsxBusyMsg: 'An export is already in progress. Please wait for it to finish.',
    pdfXlsxLocalScannedDetail:
      "Scanned pages cannot be converted to cells; each page's worksheet carries a notice row instead.",
    pdfXlsxLocalSkippedMsg: 'Some pages were not converted to cells',
    pdfXlsxLocalSkippedDetail:
      'Pages {pages} could not be converted to cells; their worksheets carry a notice row instead.',
    pdfDocxLocalScannedMsg: 'Scanned document detected',
    pdfDocxLocalScannedDetail:
      'The pages were exported as images to preserve their appearance; no editable text could be recognized.',
    pdfDocxLocalDegradedMsg: 'Some pages were exported as images',
    pdfDocxLocalDegradedDetail:
      'Page(s) {pages} could not be reliably reconstructed and were exported as full-page images.',
    pdfDocxLocalOcrMsg: 'Scanned pages converted to editable text',
    pdfDocxLocalOcrDetail:
      'Page(s) {pages} were scans; their text was recovered with on-device OCR. Please proofread the result.',
    pdfDocxLocalEncryptedDetail:
      'This PDF is encrypted and could not be opened without the correct password.',
    pdfDocxLocalUnsupportedEncDetail:
      'This PDF uses certificate-based or otherwise unsupported encryption and cannot be converted.',
    pdfPwdTitle: 'Enter Password',
    pdfPwdPrompt: 'This PDF is encrypted. Enter the password to open it:',
    pdfPwdRetryPrompt: 'Incorrect password. Please try again.',
    pdfPwdOk: 'OK',
    pdfPwdVerifying: 'Verifying password…',
    pdfPwdLabel: 'Password',
    pdfPwdPlaceholder: 'Enter the open password',
    pdfPwdShow: 'Show password',
    pdfPwdHide: 'Hide password',
    pdfDocxLocalCorruptDetail: 'The file is damaged or not a valid PDF and cannot be converted.',
    dlgPickSaveDir: 'Choose Default Save Location',
    errSaveDirUnusable:
      'The selected folder is not writable and cannot be used as the default save location',
    tabCtxClose: 'Close',
    tabCtxCloseOthers: 'Close Others',
    tabCtxCloseLeft: 'Close to the Left',
    tabCtxCloseRight: 'Close to the Right',
    tabCtxCloseAll: 'Close All',
  },
  ja: {
    dlgAddFolderRoot: 'フォルダーをホームに追加',
    errFolderRootUnusable: '選択したフォルダーを読み取れません',
    menuFile: 'ファイル',
    menuSectionNew: '新規作成',
    menuOpenInNewWindow: '新しいウィンドウで開く',
    menuNewDoc: '文書',
    menuNewSheet: '表計算',
    untitledSheet: '無題のスプレッドシート',
    untitledDoc: '無題のドキュメント',
    untitledDeck: '無題のプレゼンテーション',
    untitledMarkdown: '無題の Markdown',
    untitledHtml: '無題の HTML',
    untitledPdf: '無題の PDF',
    menuNewSlide: 'スライド',
    menuNewMarkdown: 'MD文書',
    menuNewPdf: 'PDF文書',
    menuNewHtml: 'AI HTML',
    menuExportPdf: 'PDF として書き出す…',
    menuExportImages: '画像としてエクスポート…',
    menuExportHtml: '単一ファイル HTML として書き出す…',
    menuOpenInDocs: 'Docs 文書に変換して開く',
    menuPrint: '印刷…',
    menuOpen: '開く…',
    menuSave: '保存',
    menuSaveAs: '名前を付けて保存…',
    menuClose: '閉じる',
    menuEdit: '編集',
    menuWindow: 'ウィンドウ',
    menuHome: 'ホーム',
    backToHome: 'ホームに戻る',
    dlgOpenTitle: 'ファイルを開く',
    filterSupported: '対応ファイル',
    filterWord: 'Word 文書',
    filterExcel: 'Excel ブック',
    filterPpt: 'PowerPoint プレゼンテーション',
    filterMarkdown: 'Markdown ドキュメント',
    filterHtml: 'HTML ドキュメント',
    filterPdf: 'PDF ドキュメント',
    errBadArgs: '引数が無効です',
    errBadName: 'ファイル名が無効です',
    errMissing: 'ファイルが見つかりません',
    errExists: '同名のファイルが既に存在します',
    errRenameFailed: '名前の変更に失敗しました',
    errNewTabFailed: '新規ドキュメントを作成できませんでした',
    errUnsupportedExt: '.{ext} 形式には対応していません',
    copySuffix: 'コピー',
    menuHelp: 'ヘルプ',
    menuActivate: 'ライセンス',
    menuActivateLoading: 'ライセンス状態を取得中…',
    menuActivateEntitled: '認証済み · {date} まで有効',
    menuActivateFree: '無料体験中 · 残り {n} 日',
    menuActivateExpired: '体験期間終了 · 購入で通知が消えます',
    menuPurchaseActivate: '購入 / アクティベート…',
    thirdPartyNotices: 'サードパーティソフトウェアに関する通知',
    menuExportDocx: 'Word として書き出す…',
    menuExportDocxLocal: 'Word として書き出す（本地）…',
    pdfDocxLoginMsg: 'Word への書き出しには ChaAI Office へのログインが必要です。',
    pdfDocxLoginDetail:
      '「ログイン」をクリックするとブラウザで認証します。完了後、もう一度書き出しを実行してください。',
    pdfDocxBtnLogin: 'ログイン',
    pdfDocxConfirmMsg: 'この PDF を ChaAI Office クラウドにアップロードして Word に変換しますか？',
    pdfDocxConfirmDetail:
      '変換には 5 クレジットを消費します。ファイルはクラウドにアップロードされ処理されます。',
    pdfDocxConfirmBalance: '現在の残高：{balance} クレジット。',
    pdfDocxBtnConvert: '続行',
    btnCancel: 'キャンセル',
    pdfDocxFailedMsg: 'Word への書き出しに失敗しました',
    pdfDocxNoCliMsg:
      'ChaAI Office にサインインできません：必要なコンポーネント（chatoffice）が見つかりません。アプリを再インストールしてください。',
    pdfDocxBusyMsg: 'Word への書き出しが進行中です。完了までお待ちください。',
    menuExportPptx: 'PowerPoint として書き出す…',
    pdfPptxFailedMsg: 'PowerPoint への書き出しに失敗しました',
    pdfPptxBusyMsg: '変換が進行中です。現在の書き出しが完了するまでお待ちください。',
    pdfPptxLocalScannedDetail:
      '各ページは画像として書き出されたため、スライド内のテキストは編集できません。',
    menuExportXlsx: 'Excel として書き出す…',
    pdfXlsxFailedMsg: 'Excel への書き出しに失敗しました',
    pdfXlsxBusyMsg: '変換が進行中です。現在の書き出しが完了するまでお待ちください。',
    pdfXlsxLocalScannedDetail:
      'スキャンされたページはセルに変換できないため、各ページのワークシートに通知行を書き込みました。',
    pdfXlsxLocalSkippedMsg: '一部のページはセルに変換されませんでした',
    pdfXlsxLocalSkippedDetail:
      'ページ {pages} はセルに変換できなかったため、対応するワークシートに通知行を書き込みました。',
    pdfDocxLocalScannedMsg: 'スキャン文書を検出しました',
    pdfDocxLocalScannedDetail:
      '見た目を保つため各ページを画像として書き出しました。編集可能なテキストは認識できませんでした。',
    pdfDocxLocalDegradedMsg: '一部のページを画像として書き出しました',
    pdfDocxLocalDegradedDetail:
      'ページ {pages} はレイアウトを正確に再構築できなかったため、ページ全体を画像として書き出しました。',
    pdfDocxLocalOcrMsg: 'スキャンページを編集可能なテキストに変換しました',
    pdfDocxLocalOcrDetail:
      'ページ {pages} はスキャン画像のため、ローカル OCR でテキストを復元しました。内容の確認をおすすめします。',
    pdfDocxLocalEncryptedDetail:
      'このPDFは暗号化されており、正しいパスワードがないため変換できませんでした。',
    pdfDocxLocalUnsupportedEncDetail:
      'このPDFは証明書ベースまたは未対応の暗号化方式を使用しているため、変換できません。',
    pdfPwdTitle: 'パスワードを入力',
    pdfPwdPrompt: 'このPDFは暗号化されています。開くためのパスワードを入力してください：',
    pdfPwdRetryPrompt: 'パスワードが正しくありません。もう一度お試しください。',
    pdfPwdOk: 'OK',
    pdfPwdVerifying: 'パスワードを確認しています…',
    pdfPwdLabel: 'パスワード',
    pdfPwdPlaceholder: '開くパスワードを入力',
    pdfPwdShow: 'パスワードを表示',
    pdfPwdHide: 'パスワードを非表示',
    pdfDocxLocalCorruptDetail: 'ファイルが破損しているか有効なPDFではないため、変換できません。',
    dlgPickSaveDir: '既定の保存先を選択',
    errSaveDirUnusable:
      '選択したフォルダーは書き込みできないため、既定の保存先として使用できません',
    tabCtxClose: '閉じる',
    tabCtxCloseOthers: '他を閉じる',
    tabCtxCloseLeft: '左を閉じる',
    tabCtxCloseRight: '右を閉じる',
    tabCtxCloseAll: 'すべて閉じる',
  },
  ko: {
    dlgAddFolderRoot: '홈에 폴더 추가',
    errFolderRootUnusable: '선택한 폴더를 읽을 수 없습니다',
    menuFile: '파일',
    menuSectionNew: '새로 만들기',
    menuOpenInNewWindow: '새 창에서 열기',
    menuNewDoc: '문서',
    menuNewSheet: '표',
    untitledSheet: '제목 없는 스프레드시트',
    untitledDoc: '제목 없는 문서',
    untitledDeck: '제목 없는 프레젠테이션',
    untitledMarkdown: '제목 없는 Markdown',
    untitledHtml: '제목 없는 HTML',
    untitledPdf: '제목 없는 PDF',
    menuNewSlide: '슬라이드',
    menuNewMarkdown: 'MD 문서',
    menuNewPdf: 'PDF 문서',
    menuNewHtml: 'AI HTML',
    menuExportPdf: 'PDF로 내보내기…',
    menuExportImages: '이미지로 내보내기…',
    menuExportHtml: '단일 파일 HTML로 내보내기…',
    menuOpenInDocs: 'Docs 문서로 변환하여 열기',
    menuPrint: '인쇄…',
    menuOpen: '열기…',
    menuSave: '저장',
    menuSaveAs: '다른 이름으로 저장…',
    menuClose: '닫기',
    menuEdit: '편집',
    menuWindow: '창',
    menuHome: '홈',
    backToHome: '홈으로 돌아가기',
    dlgOpenTitle: '파일 열기',
    filterSupported: '지원되는 파일',
    filterWord: 'Word 문서',
    filterExcel: 'Excel 통합 문서',
    filterPpt: 'PowerPoint 프레젠테이션',
    filterMarkdown: 'Markdown 문서',
    filterHtml: 'HTML 문서',
    filterPdf: 'PDF 문서',
    errBadArgs: '잘못된 인수입니다',
    errBadName: '파일 이름이 잘못되었습니다',
    errMissing: '파일을 찾을 수 없습니다',
    errExists: '같은 이름의 파일이 이미 있습니다',
    errRenameFailed: '이름 바꾸기에 실패했습니다',
    errNewTabFailed: '새 문서를 만들지 못했습니다',
    errUnsupportedExt: '.{ext} 형식은 지원되지 않습니다',
    copySuffix: '복사본',
    menuHelp: '도움말',
    menuActivate: '라이선스',
    menuActivateLoading: '라이선스 상태 확인 중…',
    menuActivateEntitled: '활성화됨 · {date}까지 유효',
    menuActivateFree: '무료 체험 중 · {n}일 남음',
    menuActivateExpired: '체험 기간 종료 · 구매 시 알림이 사라집니다',
    menuPurchaseActivate: '구매 / 활성화…',
    thirdPartyNotices: '타사 소프트웨어 고지',
    menuExportDocx: 'Word로 내보내기…',
    menuExportDocxLocal: 'Word로 내보내기（本地）…',
    pdfDocxLoginMsg: 'Word로 내보내려면 ChaAI Office 로그인이 필요합니다.',
    pdfDocxLoginDetail:
      '“로그인”을 클릭하면 브라우저에서 인증합니다. 완료 후 내보내기를 다시 클릭하세요.',
    pdfDocxBtnLogin: '로그인',
    pdfDocxConfirmMsg: '이 PDF를 ChaAI Office 클라우드에 업로드하여 Word로 변환할까요?',
    pdfDocxConfirmDetail:
      '변환에는 5 크레딧이 소모됩니다. 파일은 클라우드로 업로드되어 처리됩니다.',
    pdfDocxConfirmBalance: '현재 잔액: {balance} 크레딧.',
    pdfDocxBtnConvert: '계속',
    btnCancel: '취소',
    pdfDocxFailedMsg: 'Word로 내보내기 실패',
    pdfDocxNoCliMsg:
      'ChaAI Office에 로그인할 수 없습니다. 필수 구성 요소(chatoffice)가 없습니다. 앱을 다시 설치해 주세요.',
    pdfDocxBusyMsg: 'Word 내보내기가 이미 진행 중입니다. 완료될 때까지 기다려 주세요.',
    menuExportPptx: 'PowerPoint로 내보내기…',
    pdfPptxFailedMsg: 'PowerPoint 내보내기 실패',
    pdfPptxBusyMsg: '변환이 진행 중입니다. 현재 내보내기가 완료될 때까지 기다려 주세요.',
    pdfPptxLocalScannedDetail:
      '각 페이지가 이미지로 내보내져 슬라이드의 텍스트를 편집할 수 없습니다.',
    menuExportXlsx: 'Excel로 내보내기…',
    pdfXlsxFailedMsg: 'Excel 내보내기 실패',
    pdfXlsxBusyMsg: '변환이 진행 중입니다. 현재 내보내기가 완료될 때까지 기다려 주세요.',
    pdfXlsxLocalScannedDetail:
      '스캔된 페이지는 셀로 변환할 수 없어 각 페이지의 워크시트에 알림 행을 기록했습니다.',
    pdfXlsxLocalSkippedMsg: '일부 페이지가 셀로 변환되지 않았습니다',
    pdfXlsxLocalSkippedDetail:
      '{pages} 페이지는 셀로 변환할 수 없어 해당 워크시트에 알림 행을 기록했습니다.',
    pdfDocxLocalScannedMsg: '스캔 문서가 감지되었습니다',
    pdfDocxLocalScannedDetail:
      '모양을 유지하기 위해 각 페이지를 이미지로 내보냈습니다. 편집 가능한 텍스트를 인식할 수 없었습니다.',
    pdfDocxLocalDegradedMsg: '일부 페이지가 이미지로 내보내졌습니다',
    pdfDocxLocalDegradedDetail:
      '{pages}쪽은 레이아웃을 안정적으로 재구성할 수 없어 전체 페이지 이미지로 내보냈습니다.',
    pdfDocxLocalOcrMsg: '스캔 페이지를 편집 가능한 텍스트로 변환했습니다',
    pdfDocxLocalOcrDetail:
      '{pages}페이지는 스캔 이미지로, 로컬 OCR로 텍스트를 복원했습니다. 결과를 검토해 주세요.',
    pdfDocxLocalEncryptedDetail:
      '이 PDF는 암호화되어 있으며 올바른 비밀번호가 없어 변환할 수 없습니다.',
    pdfDocxLocalUnsupportedEncDetail:
      '이 PDF는 인증서 기반이거나 지원되지 않는 암호화 방식을 사용하므로 변환할 수 없습니다.',
    pdfPwdTitle: '비밀번호 입력',
    pdfPwdPrompt: '이 PDF는 암호화되어 있습니다. 열기 위한 비밀번호를 입력하세요:',
    pdfPwdRetryPrompt: '비밀번호가 올바르지 않습니다. 다시 시도하세요.',
    pdfPwdOk: '확인',
    pdfPwdVerifying: '비밀번호 확인 중…',
    pdfPwdLabel: '암호',
    pdfPwdPlaceholder: '열기 암호 입력',
    pdfPwdShow: '암호 표시',
    pdfPwdHide: '암호 숨기기',
    pdfDocxLocalCorruptDetail: '파일이 손상되었거나 유효한 PDF가 아니어서 변환할 수 없습니다.',
    dlgPickSaveDir: '기본 저장 위치 선택',
    errSaveDirUnusable: '선택한 폴더에 쓸 수 없어 기본 저장 위치로 사용할 수 없습니다',
    tabCtxClose: '닫기',
    tabCtxCloseOthers: '다른 탭 닫기',
    tabCtxCloseLeft: '왼쪽 탭 닫기',
    tabCtxCloseRight: '오른쪽 탭 닫기',
    tabCtxCloseAll: '모두 닫기',
  },
  fr: {
    dlgAddFolderRoot: "Ajouter un dossier à l'accueil",
    errFolderRootUnusable: 'Le dossier sélectionné ne peut pas être lu',
    menuFile: 'Fichier',
    menuSectionNew: 'Nouveau',
    menuOpenInNewWindow: 'Ouvrir dans une nouvelle fenêtre',
    menuNewDoc: 'Doc',
    menuNewSheet: 'Tableur',
    untitledSheet: 'Feuille de calcul sans titre',
    untitledDoc: 'Document sans titre',
    untitledDeck: 'Présentation sans titre',
    untitledMarkdown: 'Markdown sans titre',
    untitledHtml: 'HTML sans titre',
    untitledPdf: 'PDF sans titre',
    menuNewSlide: 'Diapos',
    menuNewMarkdown: 'Doc MD',
    menuNewPdf: 'Doc PDF',
    menuNewHtml: 'AI HTML',
    menuExportPdf: 'Exporter en PDF…',
    menuExportImages: 'Exporter en images…',
    menuExportHtml: 'Exporter en HTML (fichier unique)…',
    menuOpenInDocs: 'Convertir et ouvrir dans Docs',
    menuPrint: 'Imprimer…',
    menuOpen: 'Ouvrir…',
    menuSave: 'Enregistrer',
    menuSaveAs: 'Enregistrer sous…',
    menuClose: 'Fermer',
    menuEdit: 'Édition',
    menuWindow: 'Fenêtre',
    menuHome: 'Accueil',
    backToHome: "Retour à l'accueil",
    dlgOpenTitle: 'Ouvrir un fichier',
    filterSupported: 'Fichiers pris en charge',
    filterWord: 'Documents Word',
    filterExcel: 'Classeurs Excel',
    filterPpt: 'Présentations PowerPoint',
    filterMarkdown: 'Documents Markdown',
    filterHtml: 'Documents HTML',
    filterPdf: 'Documents PDF',
    errBadArgs: 'Arguments non valides',
    errBadName: 'Nom de fichier non valide',
    errMissing: 'Fichier introuvable',
    errExists: 'Un fichier du même nom existe déjà',
    errRenameFailed: 'Échec du renommage',
    errNewTabFailed: 'Impossible de créer le nouveau document',
    errUnsupportedExt: 'les fichiers .{ext} ne sont pas pris en charge',
    copySuffix: 'copie',
    menuHelp: 'Aide',
    menuActivate: 'Licence',
    menuActivateLoading: 'Chargement de l\'état de la licence…',
    menuActivateEntitled: 'Activée · valide jusqu\'au {date}',
    menuActivateFree: 'Essai gratuit · {n} jours restants',
    menuActivateExpired: 'Essai terminé · achetez pour arrêter les rappels',
    menuPurchaseActivate: 'Acheter / Activer…',
    thirdPartyNotices: 'Mentions relatives aux logiciels tiers',
    menuExportDocx: 'Exporter en Word…',
    menuExportDocxLocal: 'Exporter en Word（本地）…',
    pdfDocxLoginMsg: "L'export en Word nécessite une connexion à ChaAI Office.",
    pdfDocxLoginDetail:
      "Cliquez sur « Se connecter » pour autoriser dans le navigateur, puis relancez l'export.",
    pdfDocxBtnLogin: 'Se connecter',
    pdfDocxConfirmMsg: 'Téléverser ce PDF vers le cloud ChaAI Office pour le convertir en Word ?',
    pdfDocxConfirmDetail:
      'La conversion coûte 5 crédits. Le fichier sera téléversé pour traitement dans le cloud.',
    pdfDocxConfirmBalance: 'Solde actuel : {balance} crédits.',
    pdfDocxBtnConvert: 'Continuer',
    btnCancel: 'Annuler',
    pdfDocxFailedMsg: "Échec de l'export en Word",
    pdfDocxNoCliMsg:
      "Connexion à ChaAI Office impossible : un composant requis (chatoffice) est manquant. Veuillez réinstaller l'application.",
    pdfDocxBusyMsg: "Un export en Word est déjà en cours. Veuillez attendre qu'il se termine.",
    menuExportPptx: 'Exporter en PowerPoint…',
    pdfPptxFailedMsg: "Échec de l'exportation en PowerPoint",
    pdfPptxBusyMsg: "Une exportation est déjà en cours. Veuillez attendre qu'elle se termine.",
    pdfPptxLocalScannedDetail:
      "Chaque page a été exportée sous forme d'image ; le texte des diapositives n'est pas modifiable.",
    menuExportXlsx: 'Exporter en Excel…',
    pdfXlsxFailedMsg: "Échec de l'exportation en Excel",
    pdfXlsxBusyMsg: "Une exportation est déjà en cours. Veuillez attendre qu'elle se termine.",
    pdfXlsxLocalScannedDetail:
      "Les pages numérisées ne peuvent pas être converties en cellules ; la feuille de chaque page contient une ligne d'avertissement.",
    pdfXlsxLocalSkippedMsg: "Certaines pages n'ont pas été converties en cellules",
    pdfXlsxLocalSkippedDetail:
      "Les pages {pages} n'ont pas pu être converties en cellules ; leurs feuilles contiennent une ligne d'avertissement.",
    pdfDocxLocalScannedMsg: 'Document numérisé détecté',
    pdfDocxLocalScannedDetail:
      "Les pages ont été exportées sous forme d'images pour préserver leur apparence ; aucun texte modifiable n'a pu être reconnu.",
    pdfDocxLocalDegradedMsg: 'Certaines pages ont été exportées en images',
    pdfDocxLocalDegradedDetail:
      "Les pages {pages} n'ont pas pu être reconstruites de manière fiable et ont été exportées en images pleine page.",
    pdfDocxLocalOcrMsg: 'Pages numérisées converties en texte modifiable',
    pdfDocxLocalOcrDetail:
      'Les pages {pages} étaient des numérisations ; leur texte a été restitué par OCR local. Veuillez relire le résultat.',
    pdfDocxLocalEncryptedDetail:
      "Ce PDF est chiffré et n'a pas pu être ouvert sans le mot de passe correct.",
    pdfDocxLocalUnsupportedEncDetail:
      'Ce PDF utilise un chiffrement par certificat ou un chiffrement non pris en charge et ne peut pas être converti.',
    pdfPwdTitle: 'Saisir le mot de passe',
    pdfPwdPrompt: "Ce PDF est chiffré. Saisissez le mot de passe pour l'ouvrir :",
    pdfPwdRetryPrompt: 'Mot de passe incorrect. Veuillez réessayer.',
    pdfPwdOk: 'OK',
    pdfPwdVerifying: 'Vérification du mot de passe…',
    pdfPwdLabel: 'Mot de passe',
    pdfPwdPlaceholder: 'Saisissez le mot de passe d’ouverture',
    pdfPwdShow: 'Afficher le mot de passe',
    pdfPwdHide: 'Masquer le mot de passe',
    pdfDocxLocalCorruptDetail:
      "Le fichier est endommagé ou n'est pas un PDF valide et ne peut pas être converti.",
    dlgPickSaveDir: "Choisir l'emplacement d'enregistrement par défaut",
    errSaveDirUnusable:
      "Le dossier sélectionné n'est pas accessible en écriture et ne peut pas servir d'emplacement d'enregistrement par défaut",
    tabCtxClose: 'Fermer',
    tabCtxCloseOthers: 'Fermer les autres',
    tabCtxCloseLeft: 'Fermer à gauche',
    tabCtxCloseRight: 'Fermer à droite',
    tabCtxCloseAll: 'Tout fermer',
  },
  de: {
    dlgAddFolderRoot: 'Ordner zur Startseite hinzufügen',
    errFolderRootUnusable: 'Der ausgewählte Ordner kann nicht gelesen werden',
    menuFile: 'Datei',
    menuSectionNew: 'Neu',
    menuOpenInNewWindow: 'In neuem Fenster öffnen',
    menuNewDoc: 'Doc',
    menuNewSheet: 'Tabelle',
    untitledSheet: 'Unbenannte Tabelle',
    untitledDoc: 'Unbenanntes Dokument',
    untitledDeck: 'Unbenannte Präsentation',
    untitledMarkdown: 'Unbenanntes Markdown',
    untitledHtml: 'Unbenanntes HTML',
    untitledPdf: 'Unbenanntes PDF',
    menuNewSlide: 'Folien',
    menuNewMarkdown: 'MD-Dok',
    menuNewPdf: 'PDF-Dok',
    menuNewHtml: 'AI HTML',
    menuExportPdf: 'Als PDF exportieren…',
    menuExportImages: 'Als Bilder exportieren…',
    menuExportHtml: 'Als Einzeldatei-HTML exportieren…',
    menuOpenInDocs: 'In Docs umwandeln und öffnen',
    menuPrint: 'Drucken…',
    menuOpen: 'Öffnen…',
    menuSave: 'Speichern',
    menuSaveAs: 'Speichern unter…',
    menuClose: 'Schließen',
    menuEdit: 'Bearbeiten',
    menuWindow: 'Fenster',
    menuHome: 'Startseite',
    backToHome: 'Zurück zur Startseite',
    dlgOpenTitle: 'Datei öffnen',
    filterSupported: 'Unterstützte Dateien',
    filterWord: 'Word-Dokumente',
    filterExcel: 'Excel-Arbeitsmappen',
    filterPpt: 'PowerPoint-Präsentationen',
    filterMarkdown: 'Markdown-Dokumente',
    filterHtml: 'HTML-Dokumente',
    filterPdf: 'PDF-Dokumente',
    errBadArgs: 'Ungültige Argumente',
    errBadName: 'Ungültiger Dateiname',
    errMissing: 'Datei nicht gefunden',
    errExists: 'Eine Datei mit diesem Namen existiert bereits',
    errRenameFailed: 'Umbenennen fehlgeschlagen',
    errNewTabFailed: 'Neues Dokument konnte nicht erstellt werden',
    errUnsupportedExt: '.{ext}-Dateien werden nicht unterstützt',
    copySuffix: 'Kopie',
    menuHelp: 'Hilfe',
    menuActivate: 'Lizenz',
    menuActivateLoading: 'Lizenzstatus wird geladen…',
    menuActivateEntitled: 'Aktiviert · gültig bis {date}',
    menuActivateFree: 'Kostenlose Testphase · {n} Tage übrig',
    menuActivateExpired: 'Testphase beendet · Kauf stoppt die Erinnerungen',
    menuPurchaseActivate: 'Kaufen / Aktivieren…',
    thirdPartyNotices: 'Hinweise zu Drittanbietersoftware',
    menuExportDocx: 'Als Word exportieren…',
    menuExportDocxLocal: 'Als Word exportieren（本地）…',
    pdfDocxLoginMsg: 'Für den Word-Export ist eine Anmeldung bei ChaAI Office erforderlich.',
    pdfDocxLoginDetail:
      'Klicken Sie auf „Anmelden“, um die Autorisierung im Browser abzuschließen, und starten Sie den Export danach erneut.',
    pdfDocxBtnLogin: 'Anmelden',
    pdfDocxConfirmMsg: 'Dieses PDF in die ChaAI Office-Cloud hochladen und in Word konvertieren?',
    pdfDocxConfirmDetail:
      'Die Konvertierung kostet 5 Credits. Die Datei wird zur Verarbeitung in die Cloud hochgeladen.',
    pdfDocxConfirmBalance: 'Aktuelles Guthaben: {balance} Credits.',
    pdfDocxBtnConvert: 'Fortfahren',
    btnCancel: 'Abbrechen',
    pdfDocxFailedMsg: 'Word-Export fehlgeschlagen',
    pdfDocxNoCliMsg:
      'Anmeldung bei ChaAI Office nicht möglich: Eine erforderliche Komponente (chatoffice) fehlt. Bitte installieren Sie die App neu.',
    pdfDocxBusyMsg: 'Ein Word-Export läuft bereits. Bitte warten Sie, bis er abgeschlossen ist.',
    menuExportPptx: 'Als PowerPoint exportieren…',
    pdfPptxFailedMsg: 'Export als PowerPoint fehlgeschlagen',
    pdfPptxBusyMsg: 'Ein Export läuft bereits. Bitte warten Sie, bis er abgeschlossen ist.',
    pdfPptxLocalScannedDetail:
      'Jede Seite wurde als Bild exportiert; der Text auf den Folien ist nicht bearbeitbar.',
    menuExportXlsx: 'Als Excel exportieren…',
    pdfXlsxFailedMsg: 'Export als Excel fehlgeschlagen',
    pdfXlsxBusyMsg: 'Ein Export läuft bereits. Bitte warten Sie, bis er abgeschlossen ist.',
    pdfXlsxLocalScannedDetail:
      'Gescannte Seiten können nicht in Zellen umgewandelt werden; das Arbeitsblatt jeder Seite enthält stattdessen eine Hinweiszeile.',
    pdfXlsxLocalSkippedMsg: 'Einige Seiten wurden nicht in Zellen umgewandelt',
    pdfXlsxLocalSkippedDetail:
      'Die Seiten {pages} konnten nicht in Zellen umgewandelt werden; ihre Arbeitsblätter enthalten stattdessen eine Hinweiszeile.',
    pdfDocxLocalScannedMsg: 'Gescanntes Dokument erkannt',
    pdfDocxLocalScannedDetail:
      'Die Seiten wurden als Bilder exportiert, um ihr Aussehen zu erhalten. Es konnte kein bearbeitbarer Text erkannt werden.',
    pdfDocxLocalDegradedMsg: 'Einige Seiten wurden als Bilder exportiert',
    pdfDocxLocalDegradedDetail:
      'Seite(n) {pages} konnten nicht zuverlässig rekonstruiert werden und wurden als ganzseitige Bilder exportiert.',
    pdfDocxLocalOcrMsg: 'Gescannte Seiten in bearbeitbaren Text umgewandelt',
    pdfDocxLocalOcrDetail:
      'Seite(n) {pages} waren Scans; der Text wurde per lokaler OCR wiederhergestellt. Bitte prüfen Sie das Ergebnis.',
    pdfDocxLocalEncryptedDetail:
      'Diese PDF ist verschlüsselt und konnte ohne das richtige Passwort nicht geöffnet werden.',
    pdfDocxLocalUnsupportedEncDetail:
      'Diese PDF verwendet eine zertifikatsbasierte oder nicht unterstützte Verschlüsselung und kann nicht konvertiert werden.',
    pdfPwdTitle: 'Passwort eingeben',
    pdfPwdPrompt: 'Diese PDF ist verschlüsselt. Geben Sie das Passwort zum Öffnen ein:',
    pdfPwdRetryPrompt: 'Falsches Passwort. Bitte versuchen Sie es erneut.',
    pdfPwdOk: 'OK',
    pdfPwdVerifying: 'Passwort wird überprüft…',
    pdfPwdLabel: 'Passwort',
    pdfPwdPlaceholder: 'Passwort zum Öffnen eingeben',
    pdfPwdShow: 'Passwort anzeigen',
    pdfPwdHide: 'Passwort ausblenden',
    pdfDocxLocalCorruptDetail:
      'Die Datei ist beschädigt oder keine gültige PDF und kann nicht konvertiert werden.',
    dlgPickSaveDir: 'Standard-Speicherort auswählen',
    errSaveDirUnusable:
      'Der ausgewählte Ordner ist nicht beschreibbar und kann nicht als Standard-Speicherort verwendet werden',
    tabCtxClose: 'Schließen',
    tabCtxCloseOthers: 'Andere schließen',
    tabCtxCloseLeft: 'Links schließen',
    tabCtxCloseRight: 'Rechts schließen',
    tabCtxCloseAll: 'Alle schließen',
  },
  es: {
    dlgAddFolderRoot: 'Añadir carpeta al inicio',
    errFolderRootUnusable: 'No se puede leer la carpeta seleccionada',
    menuFile: 'Archivo',
    menuSectionNew: 'Nuevo',
    menuOpenInNewWindow: 'Abrir en una ventana nueva',
    menuNewDoc: 'Doc',
    menuNewSheet: 'Hoja',
    untitledSheet: 'Hoja de cálculo sin título',
    untitledDoc: 'Documento sin título',
    untitledDeck: 'Presentación sin título',
    untitledMarkdown: 'Markdown sin título',
    untitledHtml: 'HTML sin título',
    untitledPdf: 'PDF sin título',
    menuNewSlide: 'Diapos',
    menuNewMarkdown: 'Doc MD',
    menuNewPdf: 'Doc PDF',
    menuNewHtml: 'AI HTML',
    menuExportPdf: 'Exportar como PDF…',
    menuExportImages: 'Exportar como imágenes…',
    menuExportHtml: 'Exportar como HTML de archivo único…',
    menuOpenInDocs: 'Convertir y abrir en Docs',
    menuPrint: 'Imprimir…',
    menuOpen: 'Abrir…',
    menuSave: 'Guardar',
    menuSaveAs: 'Guardar como…',
    menuClose: 'Cerrar',
    menuEdit: 'Edición',
    menuWindow: 'Ventana',
    menuHome: 'Inicio',
    backToHome: 'Volver al inicio',
    dlgOpenTitle: 'Abrir archivo',
    filterSupported: 'Archivos compatibles',
    filterWord: 'Documentos de Word',
    filterExcel: 'Libros de Excel',
    filterPpt: 'Presentaciones de PowerPoint',
    filterMarkdown: 'Documentos Markdown',
    filterHtml: 'Documentos HTML',
    filterPdf: 'Documentos PDF',
    errBadArgs: 'Argumentos no válidos',
    errBadName: 'Nombre de archivo no válido',
    errMissing: 'Archivo no encontrado',
    errExists: 'Ya existe un archivo con ese nombre',
    errRenameFailed: 'No se pudo cambiar el nombre',
    errNewTabFailed: 'No se pudo crear el nuevo documento',
    errUnsupportedExt: 'los archivos .{ext} no son compatibles',
    copySuffix: 'copia',
    menuHelp: 'Ayuda',
    menuActivate: 'Licencia',
    menuActivateLoading: 'Cargando estado de licencia…',
    menuActivateEntitled: 'Activada · válida hasta {date}',
    menuActivateFree: 'Prueba gratis · quedan {n} días',
    menuActivateExpired: 'Prueba terminada · compra para quitar recordatorios',
    menuPurchaseActivate: 'Comprar / Activar…',
    thirdPartyNotices: 'Avisos de software de terceros',
    menuExportDocx: 'Exportar como Word…',
    menuExportDocxLocal: 'Exportar como Word（本地）…',
    pdfDocxLoginMsg: 'Para exportar como Word es necesario iniciar sesión en ChaAI Office.',
    pdfDocxLoginDetail:
      'Al hacer clic en «Iniciar sesión» se abrirá el navegador para autorizar; después, vuelve a hacer clic en Exportar.',
    pdfDocxBtnLogin: 'Iniciar sesión',
    pdfDocxConfirmMsg: '¿Subir este PDF a la nube de ChaAI Office para convertirlo a Word?',
    pdfDocxConfirmDetail:
      'La conversión cuesta 5 créditos. El archivo se subirá para procesarse en la nube.',
    pdfDocxConfirmBalance: 'Saldo actual: {balance} créditos.',
    pdfDocxBtnConvert: 'Continuar',
    btnCancel: 'Cancelar',
    pdfDocxFailedMsg: 'Error al exportar como Word',
    pdfDocxNoCliMsg:
      'No se puede iniciar sesión en ChaAI Office: falta un componente necesario (chatoffice). Reinstale la aplicación.',
    pdfDocxBusyMsg: 'Ya hay una exportación a Word en curso. Espera a que termine.',
    menuExportPptx: 'Exportar como PowerPoint…',
    pdfPptxFailedMsg: 'Error al exportar como PowerPoint',
    pdfPptxBusyMsg: 'Ya hay una exportación en curso. Espere a que termine.',
    pdfPptxLocalScannedDetail:
      'Cada página se exportó como imagen; el texto de las diapositivas no es editable.',
    menuExportXlsx: 'Exportar como Excel…',
    pdfXlsxFailedMsg: 'Error al exportar como Excel',
    pdfXlsxBusyMsg: 'Ya hay una exportación en curso. Espere a que termine.',
    pdfXlsxLocalScannedDetail:
      'Las páginas escaneadas no se pueden convertir en celdas; la hoja de cada página incluye una fila de aviso.',
    pdfXlsxLocalSkippedMsg: 'Algunas páginas no se convirtieron en celdas',
    pdfXlsxLocalSkippedDetail:
      'Las páginas {pages} no se pudieron convertir en celdas; sus hojas incluyen una fila de aviso.',
    pdfDocxLocalScannedMsg: 'Documento escaneado detectado',
    pdfDocxLocalScannedDetail:
      'Las páginas se exportaron como imágenes para conservar su aspecto. No se pudo reconocer texto editable.',
    pdfDocxLocalDegradedMsg: 'Algunas páginas se exportaron como imágenes',
    pdfDocxLocalDegradedDetail:
      'Las páginas {pages} no se pudieron reconstruir de forma fiable y se exportaron como imágenes de página completa.',
    pdfDocxLocalOcrMsg: 'Páginas escaneadas convertidas en texto editable',
    pdfDocxLocalOcrDetail:
      'Las páginas {pages} eran escaneos; su texto se recuperó con OCR local. Revise el resultado.',
    pdfDocxLocalEncryptedDetail:
      'Este PDF está cifrado y no se pudo abrir sin la contraseña correcta.',
    pdfDocxLocalUnsupportedEncDetail:
      'Este PDF usa cifrado basado en certificados u otro cifrado no compatible y no se puede convertir.',
    pdfPwdTitle: 'Introducir contraseña',
    pdfPwdPrompt: 'Este PDF está cifrado. Introduzca la contraseña para abrirlo:',
    pdfPwdRetryPrompt: 'Contraseña incorrecta. Inténtelo de nuevo.',
    pdfPwdOk: 'Aceptar',
    pdfPwdVerifying: 'Verificando la contraseña…',
    pdfPwdLabel: 'Contraseña',
    pdfPwdPlaceholder: 'Escriba la contraseña de apertura',
    pdfPwdShow: 'Mostrar contraseña',
    pdfPwdHide: 'Ocultar contraseña',
    pdfDocxLocalCorruptDetail:
      'El archivo está dañado o no es un PDF válido y no se puede convertir.',
    dlgPickSaveDir: 'Elegir ubicación de guardado predeterminada',
    errSaveDirUnusable:
      'La carpeta seleccionada no admite escritura y no puede usarse como ubicación de guardado predeterminada',
    tabCtxClose: 'Cerrar',
    tabCtxCloseOthers: 'Cerrar otros',
    tabCtxCloseLeft: 'Cerrar a la izquierda',
    tabCtxCloseRight: 'Cerrar a la derecha',
    tabCtxCloseAll: 'Cerrar todos',
  },
  th: {
    dlgAddFolderRoot: 'เพิ่มโฟลเดอร์ไปยังหน้าแรก',
    errFolderRootUnusable: 'ไม่สามารถอ่านโฟลเดอร์ที่เลือกได้',
    menuFile: 'ไฟล์',
    menuSectionNew: 'สร้างใหม่',
    menuOpenInNewWindow: 'เปิดในหน้าต่างใหม่',
    menuNewDoc: 'เอกสาร',
    menuNewSheet: 'ตาราง',
    untitledSheet: 'สเปรดชีตไม่มีชื่อ',
    untitledDoc: 'เอกสารไม่มีชื่อ',
    untitledDeck: 'งานนำเสนอไม่มีชื่อ',
    untitledMarkdown: 'Markdown ไม่มีชื่อ',
    untitledHtml: 'HTML ไม่มีชื่อ',
    untitledPdf: 'PDF ไม่มีชื่อ',
    menuNewSlide: 'สไลด์',
    menuNewMarkdown: 'เอกสาร MD',
    menuNewPdf: 'เอกสาร PDF',
    menuNewHtml: 'AI HTML',
    menuExportPdf: 'ส่งออกเป็น PDF…',
    menuExportImages: 'ส่งออกเป็นรูปภาพ…',
    menuExportHtml: 'ส่งออกเป็น HTML ไฟล์เดียว…',
    menuOpenInDocs: 'แปลงและเปิดใน Docs',
    menuPrint: 'พิมพ์…',
    menuOpen: 'เปิด…',
    menuSave: 'บันทึก',
    menuSaveAs: 'บันทึกเป็น…',
    menuClose: 'ปิด',
    menuEdit: 'แก้ไข',
    menuWindow: 'หน้าต่าง',
    menuHome: 'หน้าแรก',
    backToHome: 'กลับไปหน้าแรก',
    dlgOpenTitle: 'เปิดไฟล์',
    filterSupported: 'ไฟล์ที่รองรับ',
    filterWord: 'เอกสาร Word',
    filterExcel: 'เวิร์กบุ๊ก Excel',
    filterPpt: 'งานนำเสนอ PowerPoint',
    filterMarkdown: 'เอกสาร Markdown',
    filterHtml: 'เอกสาร HTML',
    filterPdf: 'เอกสาร PDF',
    errBadArgs: 'อาร์กิวเมนต์ไม่ถูกต้อง',
    errBadName: 'ชื่อไฟล์ไม่ถูกต้อง',
    errMissing: 'ไม่พบไฟล์',
    errExists: 'มีไฟล์ชื่อเดียวกันอยู่แล้ว',
    errRenameFailed: 'เปลี่ยนชื่อไม่สำเร็จ',
    errNewTabFailed: 'สร้างเอกสารใหม่ไม่สำเร็จ',
    errUnsupportedExt: 'ไม่รองรับไฟล์ .{ext}',
    copySuffix: 'สำเนา',
    menuHelp: 'วิธีใช้',
    menuActivate: 'License',
    menuActivateLoading: 'Loading license status…',
    menuActivateEntitled: 'Activated · valid until {date}',
    menuActivateFree: 'Free trial · {n} days left',
    menuActivateExpired: 'Trial ended · buy to stop reminders',
    menuPurchaseActivate: 'Purchase / Activate…',
    thirdPartyNotices: 'ประกาศเกี่ยวกับซอฟต์แวร์ของบุคคลที่สาม',
    menuExportDocx: 'ส่งออกเป็น Word…',
    menuExportDocxLocal: 'ส่งออกเป็น Word（本地）…',
    pdfDocxLoginMsg: 'การส่งออกเป็น Word ต้องเข้าสู่ระบบ ChaAI Office',
    pdfDocxLoginDetail:
      'คลิก “เข้าสู่ระบบ” เพื่อเปิดเบราว์เซอร์ยืนยันตัวตน เสร็จแล้วให้คลิกส่งออกอีกครั้ง',
    pdfDocxBtnLogin: 'เข้าสู่ระบบ',
    pdfDocxConfirmMsg: 'อัปโหลด PDF นี้ไปยังคลาวด์ ChaAI Office เพื่อแปลงเป็น Word หรือไม่?',
    pdfDocxConfirmDetail: 'การแปลงใช้ 5 เครดิต ไฟล์จะถูกอัปโหลดเพื่อประมวลผลบนคลาวด์',
    pdfDocxConfirmBalance: 'ยอดคงเหลือปัจจุบัน: {balance} เครดิต',
    pdfDocxBtnConvert: 'ดำเนินการต่อ',
    btnCancel: 'ยกเลิก',
    pdfDocxFailedMsg: 'ส่งออกเป็น Word ไม่สำเร็จ',
    pdfDocxNoCliMsg:
      'ไม่สามารถลงชื่อเข้าใช้ ChaAI Office ได้: ไม่พบคอมโพเนนต์ที่จำเป็น (chatoffice) โปรดติดตั้งแอปใหม่',
    pdfDocxBusyMsg: 'กำลังส่งออกเป็น Word อยู่ โปรดรอให้เสร็จสิ้นก่อน',
    menuExportPptx: 'ส่งออกเป็น PowerPoint…',
    pdfPptxFailedMsg: 'การส่งออกเป็น PowerPoint ล้มเหลว',
    pdfPptxBusyMsg: 'กำลังแปลงอยู่ โปรดรอให้การส่งออกปัจจุบันเสร็จสิ้น',
    pdfPptxLocalScannedDetail: 'แต่ละหน้าถูกส่งออกเป็นรูปภาพ ข้อความในสไลด์จึงแก้ไขไม่ได้',
    menuExportXlsx: 'ส่งออกเป็น Excel…',
    pdfXlsxFailedMsg: 'การส่งออกเป็น Excel ล้มเหลว',
    pdfXlsxBusyMsg: 'กำลังแปลงอยู่ โปรดรอให้การส่งออกปัจจุบันเสร็จสิ้น',
    pdfXlsxLocalScannedDetail:
      'หน้าที่สแกนไม่สามารถแปลงเป็นเซลล์ได้ เวิร์กชีตของแต่ละหน้าจึงมีแถวแจ้งเตือนแทน',
    pdfXlsxLocalSkippedMsg: 'บางหน้าไม่ได้ถูกแปลงเป็นเซลล์',
    pdfXlsxLocalSkippedDetail:
      'หน้า {pages} ไม่สามารถแปลงเป็นเซลล์ได้ เวิร์กชีตของหน้าดังกล่าวมีแถวแจ้งเตือนแทน',
    pdfDocxLocalScannedMsg: 'ตรวจพบเอกสารสแกน',
    pdfDocxLocalScannedDetail:
      'ส่งออกแต่ละหน้าเป็นรูปภาพเพื่อคงรูปลักษณ์เดิม ไม่สามารถจดจำข้อความที่แก้ไขได้',
    pdfDocxLocalDegradedMsg: 'บางหน้าถูกส่งออกเป็นรูปภาพ',
    pdfDocxLocalDegradedDetail:
      'หน้า {pages} ไม่สามารถสร้างเลย์เอาต์ใหม่ได้อย่างน่าเชื่อถือ จึงส่งออกเป็นรูปภาพทั้งหน้า',
    pdfDocxLocalOcrMsg: 'แปลงหน้าสแกนเป็นข้อความที่แก้ไขได้แล้ว',
    pdfDocxLocalOcrDetail:
      'หน้า {pages} เป็นภาพสแกน ระบบกู้คืนข้อความด้วย OCR ในเครื่องแล้ว โปรดตรวจทานผลลัพธ์',
    pdfDocxLocalEncryptedDetail: 'PDF นี้ถูกเข้ารหัสและไม่สามารถเปิดได้โดยไม่มีรหัสผ่านที่ถูกต้อง',
    pdfDocxLocalUnsupportedEncDetail:
      'PDF นี้ใช้การเข้ารหัสแบบใบรับรองหรือการเข้ารหัสที่ไม่รองรับ จึงไม่สามารถแปลงได้',
    pdfPwdTitle: 'ป้อนรหัสผ่าน',
    pdfPwdPrompt: 'PDF นี้ถูกเข้ารหัส โปรดป้อนรหัสผ่านเพื่อเปิด:',
    pdfPwdRetryPrompt: 'รหัสผ่านไม่ถูกต้อง โปรดลองอีกครั้ง',
    pdfPwdOk: 'ตกลง',
    pdfPwdVerifying: 'กำลังตรวจสอบรหัสผ่าน…',
    pdfPwdLabel: 'รหัสผ่าน',
    pdfPwdPlaceholder: 'ป้อนรหัสผ่านเพื่อเปิด',
    pdfPwdShow: 'แสดงรหัสผ่าน',
    pdfPwdHide: 'ซ่อนรหัสผ่าน',
    pdfDocxLocalCorruptDetail: 'ไฟล์เสียหายหรือไม่ใช่ PDF ที่ถูกต้อง จึงไม่สามารถแปลงได้',
    dlgPickSaveDir: 'เลือกตำแหน่งบันทึกเริ่มต้น',
    errSaveDirUnusable: 'โฟลเดอร์ที่เลือกไม่สามารถเขียนได้ จึงใช้เป็นตำแหน่งบันทึกเริ่มต้นไม่ได้',
    tabCtxClose: 'ปิด',
    tabCtxCloseOthers: 'ปิดแท็บอื่น',
    tabCtxCloseLeft: 'ปิดแท็บซ้าย',
    tabCtxCloseRight: 'ปิดแท็บขวา',
    tabCtxCloseAll: 'ปิดทั้งหมด',
  },
  id: {
    dlgAddFolderRoot: 'Tambahkan Folder ke Beranda',
    errFolderRootUnusable: 'Folder yang dipilih tidak dapat dibaca',
    menuFile: 'File',
    menuSectionNew: 'Baru',
    menuOpenInNewWindow: 'Buka di Jendela Baru',
    menuNewDoc: 'Dok',
    menuNewSheet: 'Lembar',
    untitledSheet: 'Spreadsheet tanpa judul',
    untitledDoc: 'Dokumen tanpa judul',
    untitledDeck: 'Presentasi tanpa judul',
    untitledMarkdown: 'Markdown tanpa judul',
    untitledHtml: 'HTML tanpa judul',
    untitledPdf: 'PDF tanpa judul',
    menuNewSlide: 'Slide',
    menuNewMarkdown: 'Dok MD',
    menuNewPdf: 'Dok PDF',
    menuNewHtml: 'AI HTML',
    menuExportPdf: 'Ekspor sebagai PDF…',
    menuExportImages: 'Ekspor sebagai gambar…',
    menuExportHtml: 'Ekspor sebagai HTML satu file…',
    menuOpenInDocs: 'Konversi dan buka di Docs',
    menuPrint: 'Cetak…',
    menuOpen: 'Buka…',
    menuSave: 'Simpan',
    menuSaveAs: 'Simpan Sebagai…',
    menuClose: 'Tutup',
    menuEdit: 'Edit',
    menuWindow: 'Jendela',
    menuHome: 'Beranda',
    backToHome: 'Kembali ke Beranda',
    dlgOpenTitle: 'Buka File',
    filterSupported: 'File yang Didukung',
    filterWord: 'Dokumen Word',
    filterExcel: 'Buku Kerja Excel',
    filterPpt: 'Presentasi PowerPoint',
    filterMarkdown: 'Dokumen Markdown',
    filterHtml: 'Dokumen HTML',
    filterPdf: 'Dokumen PDF',
    errBadArgs: 'Argumen tidak valid',
    errBadName: 'Nama file tidak valid',
    errMissing: 'File tidak ditemukan',
    errExists: 'File dengan nama tersebut sudah ada',
    errRenameFailed: 'Gagal mengganti nama',
    errNewTabFailed: 'Gagal membuat dokumen baru',
    errUnsupportedExt: 'file .{ext} tidak didukung',
    copySuffix: 'salinan',
    menuHelp: 'Bantuan',
    menuActivate: 'License',
    menuActivateLoading: 'Loading license status…',
    menuActivateEntitled: 'Activated · valid until {date}',
    menuActivateFree: 'Free trial · {n} days left',
    menuActivateExpired: 'Trial ended · buy to stop reminders',
    menuPurchaseActivate: 'Purchase / Activate…',
    thirdPartyNotices: 'Pemberitahuan Perangkat Lunak Pihak Ketiga',
    menuExportDocx: 'Ekspor sebagai Word…',
    menuExportDocxLocal: 'Ekspor sebagai Word（本地）…',
    pdfDocxLoginMsg: 'Ekspor sebagai Word memerlukan login ke ChaAI Office.',
    pdfDocxLoginDetail:
      'Klik “Masuk” untuk membuka browser dan memberi otorisasi; setelah selesai, klik Ekspor lagi.',
    pdfDocxBtnLogin: 'Masuk',
    pdfDocxConfirmMsg: 'Unggah PDF ini ke cloud ChaAI Office untuk dikonversi ke Word?',
    pdfDocxConfirmDetail:
      'Konversi ini menggunakan 5 kredit. File akan diunggah untuk diproses di cloud.',
    pdfDocxConfirmBalance: 'Saldo saat ini: {balance} kredit.',
    pdfDocxBtnConvert: 'Lanjutkan',
    btnCancel: 'Batal',
    pdfDocxFailedMsg: 'Gagal mengekspor sebagai Word',
    pdfDocxNoCliMsg:
      'Tidak dapat masuk ke ChaAI Office: komponen yang diperlukan (chatoffice) tidak ditemukan. Silakan instal ulang aplikasi.',
    pdfDocxBusyMsg: 'Ekspor ke Word sedang berlangsung. Harap tunggu hingga selesai.',
    menuExportPptx: 'Ekspor sebagai PowerPoint…',
    pdfPptxFailedMsg: 'Gagal mengekspor sebagai PowerPoint',
    pdfPptxBusyMsg: 'Ekspor sedang berlangsung. Harap tunggu hingga selesai.',
    pdfPptxLocalScannedDetail:
      'Setiap halaman diekspor sebagai gambar; teks pada slide tidak dapat diedit.',
    menuExportXlsx: 'Ekspor sebagai Excel…',
    pdfXlsxFailedMsg: 'Gagal mengekspor sebagai Excel',
    pdfXlsxBusyMsg: 'Ekspor sedang berlangsung. Harap tunggu hingga selesai.',
    pdfXlsxLocalScannedDetail:
      'Halaman hasil pindaian tidak dapat diubah menjadi sel; lembar kerja setiap halaman berisi baris pemberitahuan.',
    pdfXlsxLocalSkippedMsg: 'Beberapa halaman tidak diubah menjadi sel',
    pdfXlsxLocalSkippedDetail:
      'Halaman {pages} tidak dapat diubah menjadi sel; lembar kerjanya berisi baris pemberitahuan.',
    pdfDocxLocalScannedMsg: 'Dokumen hasil pindaian terdeteksi',
    pdfDocxLocalScannedDetail:
      'Halaman diekspor sebagai gambar untuk mempertahankan tampilannya. Tidak ada teks yang dapat diedit yang berhasil dikenali.',
    pdfDocxLocalDegradedMsg: 'Beberapa halaman diekspor sebagai gambar',
    pdfDocxLocalDegradedDetail:
      'Halaman {pages} tidak dapat direkonstruksi dengan andal dan diekspor sebagai gambar satu halaman penuh.',
    pdfDocxLocalOcrMsg: 'Halaman pindaian diubah menjadi teks yang dapat diedit',
    pdfDocxLocalOcrDetail:
      'Halaman {pages} adalah hasil pindaian; teksnya dipulihkan dengan OCR lokal. Harap periksa hasilnya.',
    pdfDocxLocalEncryptedDetail:
      'PDF ini terenkripsi dan tidak dapat dibuka tanpa kata sandi yang benar.',
    pdfDocxLocalUnsupportedEncDetail:
      'PDF ini menggunakan enkripsi berbasis sertifikat atau enkripsi yang tidak didukung dan tidak dapat dikonversi.',
    pdfPwdTitle: 'Masukkan Kata Sandi',
    pdfPwdPrompt: 'PDF ini terenkripsi. Masukkan kata sandi untuk membukanya:',
    pdfPwdRetryPrompt: 'Kata sandi salah. Silakan coba lagi.',
    pdfPwdOk: 'OK',
    pdfPwdVerifying: 'Memverifikasi kata sandi…',
    pdfPwdLabel: 'Kata sandi',
    pdfPwdPlaceholder: 'Masukkan kata sandi buka',
    pdfPwdShow: 'Tampilkan kata sandi',
    pdfPwdHide: 'Sembunyikan kata sandi',
    pdfDocxLocalCorruptDetail:
      'File rusak atau bukan PDF yang valid sehingga tidak dapat dikonversi.',
    dlgPickSaveDir: 'Pilih Lokasi Penyimpanan Default',
    errSaveDirUnusable:
      'Folder yang dipilih tidak dapat ditulis dan tidak bisa digunakan sebagai lokasi penyimpanan default',
    tabCtxClose: 'Tutup',
    tabCtxCloseOthers: 'Tutup yang lain',
    tabCtxCloseLeft: 'Tutup di kiri',
    tabCtxCloseRight: 'Tutup di kanan',
    tabCtxCloseAll: 'Tutup semua',
  },
  ru: {
    dlgAddFolderRoot: 'Добавить папку на главную',
    errFolderRootUnusable: 'Не удалось прочитать выбранную папку',
    menuFile: 'Файл',
    menuSectionNew: 'Создать',
    menuOpenInNewWindow: 'Открыть в новом окне',
    menuNewDoc: 'Док',
    menuNewSheet: 'Таблица',
    untitledSheet: 'Таблица без названия',
    untitledDoc: 'Документ без названия',
    untitledDeck: 'Презентация без названия',
    untitledMarkdown: 'Markdown без названия',
    untitledHtml: 'HTML без названия',
    untitledPdf: 'PDF без названия',
    menuNewSlide: 'Слайды',
    menuNewMarkdown: 'Док MD',
    menuNewPdf: 'Док PDF',
    menuNewHtml: 'AI HTML',
    menuExportPdf: 'Экспортировать в PDF…',
    menuExportImages: 'Экспорт в изображения…',
    menuExportHtml: 'Экспортировать в один файл HTML…',
    menuOpenInDocs: 'Преобразовать и открыть в Docs',
    menuPrint: 'Печать…',
    menuOpen: 'Открыть…',
    menuSave: 'Сохранить',
    menuSaveAs: 'Сохранить как…',
    menuClose: 'Закрыть',
    menuEdit: 'Правка',
    menuWindow: 'Окно',
    menuHome: 'Главная',
    backToHome: 'Вернуться на главную',
    dlgOpenTitle: 'Открытие файла',
    filterSupported: 'Поддерживаемые файлы',
    filterWord: 'Документы Word',
    filterExcel: 'Книги Excel',
    filterPpt: 'Презентации PowerPoint',
    filterMarkdown: 'Документы Markdown',
    filterHtml: 'Документы HTML',
    filterPdf: 'Документы PDF',
    errBadArgs: 'Недопустимые аргументы',
    errBadName: 'Недопустимое имя файла',
    errMissing: 'Файл не найден',
    errExists: 'Файл с таким именем уже существует',
    errRenameFailed: 'Не удалось переименовать',
    errNewTabFailed: 'Не удалось создать новый документ',
    errUnsupportedExt: 'файлы .{ext} не поддерживаются',
    copySuffix: 'копия',
    menuHelp: 'Справка',
    menuActivate: 'Лицензия',
    menuActivateLoading: 'Загрузка статуса лицензии…',
    menuActivateEntitled: 'Активирована · до {date}',
    menuActivateFree: 'Бесплатный период · осталось {n} дн.',
    menuActivateExpired: 'Период закончился · покупка уберёт напоминания',
    menuPurchaseActivate: 'Купить / Активировать…',
    thirdPartyNotices: 'Уведомления о стороннем ПО',
    menuExportDocx: 'Экспортировать в Word…',
    menuExportDocxLocal: 'Экспортировать в Word（本地）…',
    pdfDocxLoginMsg: 'Для экспорта в Word требуется вход в ChaAI Office.',
    pdfDocxLoginDetail:
      'Нажмите «Войти», чтобы авторизоваться в браузере, затем снова запустите экспорт.',
    pdfDocxBtnLogin: 'Войти',
    pdfDocxConfirmMsg: 'Загрузить этот PDF в облако ChaAI Office и конвертировать в Word?',
    pdfDocxConfirmDetail:
      'Конвертация стоит 5 кредитов. Файл будет загружен для обработки в облаке.',
    pdfDocxConfirmBalance: 'Текущий баланс: {balance} кредитов.',
    pdfDocxBtnConvert: 'Продолжить',
    btnCancel: 'Отмена',
    pdfDocxFailedMsg: 'Не удалось экспортировать в Word',
    pdfDocxNoCliMsg:
      'Не удаётся войти в ChaAI Office: отсутствует необходимый компонент (chatoffice). Переустановите приложение.',
    pdfDocxBusyMsg: 'Экспорт в Word уже выполняется. Дождитесь его завершения.',
    menuExportPptx: 'Экспортировать в PowerPoint…',
    pdfPptxFailedMsg: 'Не удалось экспортировать в PowerPoint',
    pdfPptxBusyMsg: 'Экспорт уже выполняется. Дождитесь его завершения.',
    pdfPptxLocalScannedDetail:
      'Каждая страница экспортирована как изображение; текст на слайдах нельзя редактировать.',
    menuExportXlsx: 'Экспортировать в Excel…',
    pdfXlsxFailedMsg: 'Не удалось экспортировать в Excel',
    pdfXlsxBusyMsg: 'Экспорт уже выполняется. Дождитесь его завершения.',
    pdfXlsxLocalScannedDetail:
      'Отсканированные страницы нельзя преобразовать в ячейки; на листе каждой страницы добавлена строка с уведомлением.',
    pdfXlsxLocalSkippedMsg: 'Некоторые страницы не были преобразованы в ячейки',
    pdfXlsxLocalSkippedDetail:
      'Страницы {pages} не удалось преобразовать в ячейки; на их листах добавлена строка с уведомлением.',
    pdfDocxLocalScannedMsg: 'Обнаружен отсканированный документ',
    pdfDocxLocalScannedDetail:
      'Страницы экспортированы как изображения, чтобы сохранить их вид. Редактируемый текст распознать не удалось.',
    pdfDocxLocalDegradedMsg: 'Некоторые страницы экспортированы как изображения',
    pdfDocxLocalDegradedDetail:
      'Страницы {pages} не удалось надёжно реконструировать; они экспортированы как полностраничные изображения.',
    pdfDocxLocalOcrMsg: 'Отсканированные страницы преобразованы в редактируемый текст',
    pdfDocxLocalOcrDetail:
      'Страницы {pages} были сканами; текст восстановлен локальным OCR. Проверьте результат.',
    pdfDocxLocalEncryptedDetail:
      'Этот PDF зашифрован, и его не удалось открыть без правильного пароля.',
    pdfDocxLocalUnsupportedEncDetail:
      'Этот PDF использует шифрование на основе сертификата или другое неподдерживаемое шифрование и не может быть преобразован.',
    pdfPwdTitle: 'Введите пароль',
    pdfPwdPrompt: 'Этот PDF зашифрован. Введите пароль, чтобы открыть его:',
    pdfPwdRetryPrompt: 'Неверный пароль. Попробуйте ещё раз.',
    pdfPwdOk: 'ОК',
    pdfPwdVerifying: 'Проверка пароля…',
    pdfPwdLabel: 'Пароль',
    pdfPwdPlaceholder: 'Введите пароль для открытия',
    pdfPwdShow: 'Показать пароль',
    pdfPwdHide: 'Скрыть пароль',
    pdfDocxLocalCorruptDetail:
      'Файл повреждён или не является корректным PDF, преобразование невозможно.',
    dlgPickSaveDir: 'Выбрать папку сохранения по умолчанию',
    errSaveDirUnusable:
      'Выбранная папка недоступна для записи и не может использоваться как папка сохранения по умолчанию',
    tabCtxClose: 'Закрыть',
    tabCtxCloseOthers: 'Закрыть другие',
    tabCtxCloseLeft: 'Закрыть слева',
    tabCtxCloseRight: 'Закрыть справа',
    tabCtxCloseAll: 'Закрыть все',
  },
  ar: {
    dlgAddFolderRoot: 'إضافة مجلد إلى الصفحة الرئيسية',
    errFolderRootUnusable: 'لا يمكن قراءة المجلد المحدد',
    menuFile: 'ملف',
    menuSectionNew: 'جديد',
    menuOpenInNewWindow: 'فتح في نافذة جديدة',
    menuNewDoc: 'مستند',
    menuNewSheet: 'جدول',
    untitledSheet: 'جدول بيانات بلا عنوان',
    untitledDoc: 'مستند بدون عنوان',
    untitledDeck: 'عرض تقديمي بدون عنوان',
    untitledMarkdown: 'Markdown بدون عنوان',
    untitledHtml: 'HTML بدون عنوان',
    untitledPdf: 'PDF بدون عنوان',
    menuNewSlide: 'شرائح',
    menuNewMarkdown: 'مستند MD',
    menuNewPdf: 'مستند PDF',
    menuNewHtml: 'AI HTML',
    menuExportPdf: 'تصدير بتنسيق PDF…',
    menuExportImages: 'تصدير كصور…',
    menuExportHtml: 'تصدير كملف HTML واحد…',
    menuOpenInDocs: 'التحويل والفتح في Docs',
    menuPrint: 'طباعة…',
    menuOpen: 'فتح…',
    menuSave: 'حفظ',
    menuSaveAs: 'حفظ باسم…',
    menuClose: 'إغلاق',
    menuEdit: 'تحرير',
    menuWindow: 'نافذة',
    menuHome: 'الصفحة الرئيسية',
    backToHome: 'العودة إلى الصفحة الرئيسية',
    dlgOpenTitle: 'فتح ملف',
    filterSupported: 'الملفات المدعومة',
    filterWord: 'مستندات Word',
    filterExcel: 'مصنفات Excel',
    filterPpt: 'عروض PowerPoint التقديمية',
    filterMarkdown: 'مستندات Markdown',
    filterHtml: 'مستندات HTML',
    filterPdf: 'مستندات PDF',
    errBadArgs: 'وسيطات غير صالحة',
    errBadName: 'اسم ملف غير صالح',
    errMissing: 'الملف غير موجود',
    errExists: 'يوجد ملف بالاسم نفسه بالفعل',
    errRenameFailed: 'فشلت إعادة التسمية',
    errNewTabFailed: 'تعذّر إنشاء المستند الجديد',
    errUnsupportedExt: 'ملفات .{ext} غير مدعومة',
    copySuffix: 'نسخة',
    menuHelp: 'تعليمات',
    menuActivate: 'License',
    menuActivateLoading: 'Loading license status…',
    menuActivateEntitled: 'Activated · valid until {date}',
    menuActivateFree: 'Free trial · {n} days left',
    menuActivateExpired: 'Trial ended · buy to stop reminders',
    menuPurchaseActivate: 'Purchase / Activate…',
    thirdPartyNotices: 'إشعارات برامج الجهات الخارجية',
    menuExportDocx: 'تصدير كملف Word…',
    menuExportDocxLocal: 'تصدير كملف Word（本地）…',
    pdfDocxLoginMsg: 'يتطلب التصدير كملف Word تسجيل الدخول إلى ChaAI Office.',
    pdfDocxLoginDetail:
      'انقر على «تسجيل الدخول» لفتح المتصفح وإتمام التفويض، ثم انقر على التصدير مرة أخرى.',
    pdfDocxBtnLogin: 'تسجيل الدخول',
    pdfDocxConfirmMsg: 'رفع هذا الـ PDF إلى سحابة ChaAI Office وتحويله إلى Word؟',
    pdfDocxConfirmDetail: 'يكلف التحويل 5 أرصدة. سيتم رفع الملف للمعالجة في السحابة.',
    pdfDocxConfirmBalance: 'الرصيد الحالي: {balance} من الأرصدة.',
    pdfDocxBtnConvert: 'متابعة',
    btnCancel: 'إلغاء',
    pdfDocxFailedMsg: 'فشل التصدير كملف Word',
    pdfDocxNoCliMsg:
      'تعذّر تسجيل الدخول إلى ChaAI Office: المكوّن المطلوب (chatoffice) مفقود. يُرجى إعادة تثبيت التطبيق.',
    pdfDocxBusyMsg: 'يجري حاليًا تصدير إلى Word. يُرجى الانتظار حتى يكتمل.',
    menuExportPptx: 'تصدير كملف PowerPoint…',
    pdfPptxFailedMsg: 'فشل التصدير كملف PowerPoint',
    pdfPptxBusyMsg: 'هناك عملية تصدير قيد التنفيذ. يرجى الانتظار حتى تكتمل.',
    pdfPptxLocalScannedDetail: 'تم تصدير كل صفحة كصورة؛ النص في الشرائح غير قابل للتحرير.',
    menuExportXlsx: 'تصدير كملف Excel…',
    pdfXlsxFailedMsg: 'فشل التصدير كملف Excel',
    pdfXlsxBusyMsg: 'هناك عملية تصدير قيد التنفيذ. يرجى الانتظار حتى تكتمل.',
    pdfXlsxLocalScannedDetail:
      'لا يمكن تحويل الصفحات الممسوحة ضوئيًا إلى خلايا؛ تحتوي ورقة كل صفحة على صف تنبيه بدلاً من ذلك.',
    pdfXlsxLocalSkippedMsg: 'لم يتم تحويل بعض الصفحات إلى خلايا',
    pdfXlsxLocalSkippedDetail:
      'تعذر تحويل الصفحات {pages} إلى خلايا؛ تحتوي أوراقها على صف تنبيه بدلاً من ذلك.',
    pdfDocxLocalScannedMsg: 'تم اكتشاف مستند ممسوح ضوئيًا',
    pdfDocxLocalScannedDetail:
      'تم تصدير الصفحات كصور للحفاظ على مظهرها. لم يتم التعرف على أي نص قابل للتحرير.',
    pdfDocxLocalDegradedMsg: 'تم تصدير بعض الصفحات كصور',
    pdfDocxLocalDegradedDetail:
      'تعذّرت إعادة بناء الصفحات {pages} بشكل موثوق، وتم تصديرها كصور لكامل الصفحة.',
    pdfDocxLocalOcrMsg: 'تم تحويل الصفحات الممسوحة ضوئيًا إلى نص قابل للتحرير',
    pdfDocxLocalOcrDetail:
      'الصفحات {pages} كانت صورًا ممسوحة؛ تم استرداد النص عبر OCR المحلي. يُرجى مراجعة النتيجة.',
    pdfDocxLocalEncryptedDetail: 'هذا الملف PDF مشفّر وتعذّر فتحه دون كلمة المرور الصحيحة.',
    pdfDocxLocalUnsupportedEncDetail:
      'يستخدم ملف PDF هذا تشفيرًا قائمًا على الشهادات أو تشفيرًا غير مدعوم ولا يمكن تحويله.',
    pdfPwdTitle: 'إدخال كلمة المرور',
    pdfPwdPrompt: 'هذا الملف PDF مشفّر. أدخل كلمة المرور لفتحه:',
    pdfPwdRetryPrompt: 'كلمة المرور غير صحيحة. حاول مرة أخرى.',
    pdfPwdOk: 'موافق',
    pdfPwdVerifying: 'جارٍ التحقق من كلمة المرور…',
    pdfPwdLabel: 'كلمة المرور',
    pdfPwdPlaceholder: 'أدخل كلمة مرور الفتح',
    pdfPwdShow: 'إظهار كلمة المرور',
    pdfPwdHide: 'إخفاء كلمة المرور',
    pdfDocxLocalCorruptDetail: 'الملف تالف أو ليس ملف PDF صالحًا ولا يمكن تحويله.',
    dlgPickSaveDir: 'اختيار موقع الحفظ الافتراضي',
    errSaveDirUnusable: 'المجلد المحدد غير قابل للكتابة ولا يمكن استخدامه كموقع حفظ افتراضي',
    tabCtxClose: 'إغلاق',
    tabCtxCloseOthers: 'إغلاق الأخرى',
    tabCtxCloseLeft: 'إغلاق اليسار',
    tabCtxCloseRight: 'إغلاق اليمين',
    tabCtxCloseAll: 'إغلاق الكل',
  },
  pt: {
    dlgAddFolderRoot: 'Adicionar pasta à página inicial',
    errFolderRootUnusable: 'Não é possível ler a pasta selecionada',
    menuFile: 'Arquivo',
    menuSectionNew: 'Novo',
    menuOpenInNewWindow: 'Abrir em nova janela',
    menuNewDoc: 'Doc',
    menuNewSheet: 'Planilha',
    untitledSheet: 'Planilha sem título',
    untitledDoc: 'Documento sem título',
    untitledDeck: 'Apresentação sem título',
    untitledMarkdown: 'Markdown sem título',
    untitledHtml: 'HTML sem título',
    untitledPdf: 'PDF sem título',
    menuNewSlide: 'Slides',
    menuNewMarkdown: 'Doc MD',
    menuNewPdf: 'Doc PDF',
    menuNewHtml: 'AI HTML',
    menuExportPdf: 'Exportar como PDF…',
    menuExportImages: 'Exportar como imagens…',
    menuExportHtml: 'Exportar como HTML de arquivo único…',
    menuOpenInDocs: 'Converter e abrir no Docs',
    menuPrint: 'Imprimir…',
    menuOpen: 'Abrir…',
    menuSave: 'Salvar',
    menuSaveAs: 'Salvar Como…',
    menuClose: 'Fechar',
    menuEdit: 'Editar',
    menuWindow: 'Janela',
    menuHome: 'Início',
    backToHome: 'Voltar ao início',
    dlgOpenTitle: 'Abrir arquivo',
    filterSupported: 'Arquivos compatíveis',
    filterWord: 'Documentos do Word',
    filterExcel: 'Pastas de trabalho do Excel',
    filterPpt: 'Apresentações do PowerPoint',
    filterMarkdown: 'Documentos Markdown',
    filterHtml: 'Documentos HTML',
    filterPdf: 'Documentos PDF',
    errBadArgs: 'Argumentos inválidos',
    errBadName: 'Nome de arquivo inválido',
    errMissing: 'Arquivo não encontrado',
    errExists: 'Já existe um arquivo com esse nome',
    errRenameFailed: 'Falha ao renomear',
    errNewTabFailed: 'Falha ao criar o novo documento',
    errUnsupportedExt: 'arquivos .{ext} não são suportados',
    copySuffix: 'cópia',
    menuHelp: 'Ajuda',
    menuActivate: 'Licença',
    menuActivateLoading: 'Carregando estado da licença…',
    menuActivateEntitled: 'Ativada · válida até {date}',
    menuActivateFree: 'Teste grátis · {n} dias restantes',
    menuActivateExpired: 'Teste encerrado · compre para parar os lembretes',
    menuPurchaseActivate: 'Comprar / Ativar…',
    thirdPartyNotices: 'Avisos de software de terceiros',
    menuExportDocx: 'Exportar como Word…',
    menuExportDocxLocal: 'Exportar como Word（本地）…',
    pdfDocxLoginMsg: 'Exportar como Word requer login no ChaAI Office.',
    pdfDocxLoginDetail:
      'Clique em “Entrar” para autorizar no navegador; depois, clique em Exportar novamente.',
    pdfDocxBtnLogin: 'Entrar',
    pdfDocxConfirmMsg: 'Enviar este PDF para a nuvem do ChaAI Office e convertê-lo em Word?',
    pdfDocxConfirmDetail:
      'A conversão custa 5 créditos. O arquivo será enviado para processamento na nuvem.',
    pdfDocxConfirmBalance: 'Saldo atual: {balance} créditos.',
    pdfDocxBtnConvert: 'Continuar',
    btnCancel: 'Cancelar',
    pdfDocxFailedMsg: 'Falha ao exportar como Word',
    pdfDocxNoCliMsg:
      'Não é possível iniciar sessão no ChaAI Office: falta um componente necessário (chatoffice). Reinstale o aplicativo.',
    pdfDocxBusyMsg: 'Já há uma exportação para Word em andamento. Aguarde a conclusão.',
    menuExportPptx: 'Exportar como PowerPoint…',
    pdfPptxFailedMsg: 'Falha ao exportar como PowerPoint',
    pdfPptxBusyMsg: 'Já há uma exportação em andamento. Aguarde a conclusão.',
    pdfPptxLocalScannedDetail:
      'Cada página foi exportada como imagem; o texto dos slides não é editável.',
    menuExportXlsx: 'Exportar como Excel…',
    pdfXlsxFailedMsg: 'Falha ao exportar como Excel',
    pdfXlsxBusyMsg: 'Já há uma exportação em andamento. Aguarde a conclusão.',
    pdfXlsxLocalScannedDetail:
      'Páginas digitalizadas não podem ser convertidas em células; a planilha de cada página contém uma linha de aviso.',
    pdfXlsxLocalSkippedMsg: 'Algumas páginas não foram convertidas em células',
    pdfXlsxLocalSkippedDetail:
      'As páginas {pages} não puderam ser convertidas em células; suas planilhas contêm uma linha de aviso.',
    pdfDocxLocalScannedMsg: 'Documento digitalizado detectado',
    pdfDocxLocalScannedDetail:
      'As páginas foram exportadas como imagens para preservar a aparência. Não foi possível reconhecer texto editável.',
    pdfDocxLocalDegradedMsg: 'Algumas páginas foram exportadas como imagens',
    pdfDocxLocalDegradedDetail:
      'As páginas {pages} não puderam ser reconstruídas de forma confiável e foram exportadas como imagens de página inteira.',
    pdfDocxLocalOcrMsg: 'Páginas digitalizadas convertidas em texto editável',
    pdfDocxLocalOcrDetail:
      'As páginas {pages} eram digitalizações; o texto foi recuperado com OCR local. Revise o resultado.',
    pdfDocxLocalEncryptedDetail:
      'Este PDF está criptografado e não pôde ser aberto sem a senha correta.',
    pdfDocxLocalUnsupportedEncDetail:
      'Este PDF usa criptografia baseada em certificado ou outra criptografia sem suporte e não pode ser convertido.',
    pdfPwdTitle: 'Digitar senha',
    pdfPwdPrompt: 'Este PDF está criptografado. Digite a senha para abri-lo:',
    pdfPwdRetryPrompt: 'Senha incorreta. Tente novamente.',
    pdfPwdOk: 'OK',
    pdfPwdVerifying: 'Verificando a senha…',
    pdfPwdLabel: 'Senha',
    pdfPwdPlaceholder: 'Digite a senha de abertura',
    pdfPwdShow: 'Mostrar senha',
    pdfPwdHide: 'Ocultar senha',
    pdfDocxLocalCorruptDetail:
      'O arquivo está danificado ou não é um PDF válido e não pode ser convertido.',
    dlgPickSaveDir: 'Escolher local de salvamento padrão',
    errSaveDirUnusable:
      'A pasta selecionada não permite gravação e não pode ser usada como local de salvamento padrão',
    tabCtxClose: 'Fechar',
    tabCtxCloseOthers: 'Fechar outros',
    tabCtxCloseLeft: 'Fechar à esquerda',
    tabCtxCloseRight: 'Fechar à direita',
    tabCtxCloseAll: 'Fechar todos',
  },
  it: {
    dlgAddFolderRoot: 'Aggiungi cartella alla Home',
    errFolderRootUnusable: 'Impossibile leggere la cartella selezionata',
    menuFile: 'File',
    menuSectionNew: 'Nuovo',
    menuOpenInNewWindow: 'Apri in una nuova finestra',
    menuNewDoc: 'Doc',
    menuNewSheet: 'Foglio',
    untitledSheet: 'Foglio di calcolo senza titolo',
    untitledDoc: 'Documento senza titolo',
    untitledDeck: 'Presentazione senza titolo',
    untitledMarkdown: 'Markdown senza titolo',
    untitledHtml: 'HTML senza titolo',
    untitledPdf: 'PDF senza titolo',
    menuNewSlide: 'Slide',
    menuNewMarkdown: 'Doc MD',
    menuNewPdf: 'Doc PDF',
    menuNewHtml: 'AI HTML',
    menuExportPdf: 'Esporta come PDF…',
    menuExportImages: 'Esporta come immagini…',
    menuExportHtml: 'Esporta come HTML a file singolo…',
    menuOpenInDocs: 'Converti e apri in Docs',
    menuPrint: 'Stampa…',
    menuOpen: 'Apri…',
    menuSave: 'Salva',
    menuSaveAs: 'Salva con nome…',
    menuClose: 'Chiudi',
    menuEdit: 'Modifica',
    menuWindow: 'Finestra',
    menuHome: 'Home',
    backToHome: 'Torna alla Home',
    dlgOpenTitle: 'Apri file',
    filterSupported: 'File supportati',
    filterWord: 'Documenti Word',
    filterExcel: 'Cartelle di lavoro Excel',
    filterPpt: 'Presentazioni PowerPoint',
    filterMarkdown: 'Documenti Markdown',
    filterHtml: 'Documenti HTML',
    filterPdf: 'Documenti PDF',
    errBadArgs: 'Argomenti non validi',
    errBadName: 'Nome file non valido',
    errMissing: 'File non trovato',
    errExists: 'Esiste già un file con questo nome',
    errRenameFailed: 'Impossibile rinominare',
    errNewTabFailed: 'Impossibile creare il nuovo documento',
    errUnsupportedExt: 'i file .{ext} non sono supportati',
    copySuffix: 'copia',
    menuHelp: 'Aiuto',
    menuActivate: 'Licenza',
    menuActivateLoading: 'Caricamento stato licenza…',
    menuActivateEntitled: 'Attivata · valida fino al {date}',
    menuActivateFree: 'Prova gratuita · {n} giorni rimasti',
    menuActivateExpired: 'Prova terminata · acquista per fermare i promemoria',
    menuPurchaseActivate: 'Acquista / Attiva…',
    thirdPartyNotices: 'Note sul software di terze parti',
    menuExportDocx: 'Esporta come Word…',
    menuExportDocxLocal: 'Esporta come Word（本地）…',
    pdfDocxLoginMsg: 'Per esportare come Word è necessario accedere a ChaAI Office.',
    pdfDocxLoginDetail:
      'Fai clic su “Accedi” per autorizzare nel browser; al termine, fai di nuovo clic su Esporta.',
    pdfDocxBtnLogin: 'Accedi',
    pdfDocxConfirmMsg: 'Caricare questo PDF sul cloud ChaAI Office e convertirlo in Word?',
    pdfDocxConfirmDetail:
      "La conversione costa 5 crediti. Il file verrà caricato per l'elaborazione nel cloud.",
    pdfDocxConfirmBalance: 'Saldo attuale: {balance} crediti.',
    pdfDocxBtnConvert: 'Continua',
    btnCancel: 'Annulla',
    pdfDocxFailedMsg: 'Esportazione in Word non riuscita',
    pdfDocxNoCliMsg:
      "Impossibile accedere a ChaAI Office: manca un componente necessario (chatoffice). Reinstallare l'app.",
    pdfDocxBusyMsg: "Un'esportazione in Word è già in corso. Attendi il completamento.",
    menuExportPptx: 'Esporta come PowerPoint…',
    pdfPptxFailedMsg: 'Esportazione come PowerPoint non riuscita',
    pdfPptxBusyMsg: "Un'esportazione è già in corso. Attendere che finisca.",
    pdfPptxLocalScannedDetail:
      'Ogni pagina è stata esportata come immagine; il testo delle diapositive non è modificabile.',
    menuExportXlsx: 'Esporta come Excel…',
    pdfXlsxFailedMsg: 'Esportazione come Excel non riuscita',
    pdfXlsxBusyMsg: "Un'esportazione è già in corso. Attendere che finisca.",
    pdfXlsxLocalScannedDetail:
      'Le pagine scansionate non possono essere convertite in celle; il foglio di ogni pagina contiene una riga di avviso.',
    pdfXlsxLocalSkippedMsg: 'Alcune pagine non sono state convertite in celle',
    pdfXlsxLocalSkippedDetail:
      'Le pagine {pages} non hanno potuto essere convertite in celle; i loro fogli contengono una riga di avviso.',
    pdfDocxLocalScannedMsg: 'Rilevato documento scansionato',
    pdfDocxLocalScannedDetail:
      "Le pagine sono state esportate come immagini per preservarne l'aspetto. Non è stato possibile riconoscere testo modificabile.",
    pdfDocxLocalDegradedMsg: 'Alcune pagine sono state esportate come immagini',
    pdfDocxLocalDegradedDetail:
      'Non è stato possibile ricostruire in modo affidabile le pagine {pages}; sono state esportate come immagini a pagina intera.',
    pdfDocxLocalOcrMsg: 'Pagine scansionate convertite in testo modificabile',
    pdfDocxLocalOcrDetail:
      'Le pagine {pages} erano scansioni; il testo è stato recuperato con OCR locale. Si consiglia di rileggere il risultato.',
    pdfDocxLocalEncryptedDetail:
      'Questo PDF è crittografato e non è stato possibile aprirlo senza la password corretta.',
    pdfDocxLocalUnsupportedEncDetail:
      'Questo PDF usa una crittografia basata su certificati o comunque non supportata e non può essere convertito.',
    pdfPwdTitle: 'Inserisci password',
    pdfPwdPrompt: 'Questo PDF è crittografato. Inserisci la password per aprirlo:',
    pdfPwdRetryPrompt: 'Password errata. Riprova.',
    pdfPwdOk: 'OK',
    pdfPwdVerifying: 'Verifica della password…',
    pdfPwdLabel: 'Password',
    pdfPwdPlaceholder: 'Inserisci la password di apertura',
    pdfPwdShow: 'Mostra password',
    pdfPwdHide: 'Nascondi password',
    pdfDocxLocalCorruptDetail:
      'Il file è danneggiato o non è un PDF valido e non può essere convertito.',
    dlgPickSaveDir: 'Scegli la posizione di salvataggio predefinita',
    errSaveDirUnusable:
      'La cartella selezionata non è scrivibile e non può essere usata come posizione di salvataggio predefinita',
    tabCtxClose: 'Chiudi',
    tabCtxCloseOthers: 'Chiudi gli altri',
    tabCtxCloseLeft: 'Chiudi a sinistra',
    tabCtxCloseRight: 'Chiudi a destra',
    tabCtxCloseAll: 'Chiudi tutto',
  },
  pl: {
    dlgAddFolderRoot: 'Dodaj folder do strony głównej',
    errFolderRootUnusable: 'Nie można odczytać wybranego folderu',
    menuFile: 'Plik',
    menuSectionNew: 'Nowy',
    menuOpenInNewWindow: 'Otwórz w nowym oknie',
    menuNewDoc: 'Dok',
    menuNewSheet: 'Arkusz',
    untitledSheet: 'Arkusz bez tytułu',
    untitledDoc: 'Dokument bez tytułu',
    untitledDeck: 'Prezentacja bez tytułu',
    untitledMarkdown: 'Markdown bez tytułu',
    untitledHtml: 'HTML bez tytułu',
    untitledPdf: 'PDF bez tytułu',
    menuNewSlide: 'Slajdy',
    menuNewMarkdown: 'Dok MD',
    menuNewPdf: 'Dok PDF',
    menuNewHtml: 'AI HTML',
    menuExportPdf: 'Eksportuj jako PDF…',
    menuExportImages: 'Eksportuj jako obrazy…',
    menuExportHtml: 'Eksportuj jako pojedynczy plik HTML…',
    menuOpenInDocs: 'Konwertuj i otwórz w Docs',
    menuPrint: 'Drukuj…',
    menuOpen: 'Otwórz…',
    menuSave: 'Zapisz',
    menuSaveAs: 'Zapisz jako…',
    menuClose: 'Zamknij',
    menuEdit: 'Edycja',
    menuWindow: 'Okno',
    menuHome: 'Strona główna',
    backToHome: 'Wróć do strony głównej',
    dlgOpenTitle: 'Otwieranie pliku',
    filterSupported: 'Obsługiwane pliki',
    filterWord: 'Dokumenty programu Word',
    filterExcel: 'Skoroszyty programu Excel',
    filterPpt: 'Prezentacje programu PowerPoint',
    filterMarkdown: 'Dokumenty Markdown',
    filterHtml: 'Dokumenty HTML',
    filterPdf: 'Dokumenty PDF',
    errBadArgs: 'Nieprawidłowe argumenty',
    errBadName: 'Nieprawidłowa nazwa pliku',
    errMissing: 'Nie znaleziono pliku',
    errExists: 'Plik o tej nazwie już istnieje',
    errRenameFailed: 'Nie udało się zmienić nazwy',
    errNewTabFailed: 'Nie udało się utworzyć nowego dokumentu',
    errUnsupportedExt: 'pliki .{ext} nie są obsługiwane',
    copySuffix: 'kopia',
    menuHelp: 'Pomoc',
    menuActivate: 'Licencja',
    menuActivateLoading: 'Ładowanie stanu licencji…',
    menuActivateEntitled: 'Aktywna · ważna do {date}',
    menuActivateFree: 'Darmowy okres · pozostało {n} dni',
    menuActivateExpired: 'Okres próbny zakończony · zakup wyłącza przypomnienia',
    menuPurchaseActivate: 'Kup / Aktywuj…',
    thirdPartyNotices: 'Informacje o oprogramowaniu innych firm',
    menuExportDocx: 'Eksportuj jako Word…',
    menuExportDocxLocal: 'Eksportuj jako Word（本地）…',
    pdfDocxLoginMsg: 'Eksport do formatu Word wymaga zalogowania do ChaAI Office.',
    pdfDocxLoginDetail:
      'Kliknij „Zaloguj się”, aby autoryzować w przeglądarce; po zakończeniu kliknij Eksportuj ponownie.',
    pdfDocxBtnLogin: 'Zaloguj się',
    pdfDocxConfirmMsg: 'Przesłać ten PDF do chmury ChaAI Office i przekonwertować na Word?',
    pdfDocxConfirmDetail:
      'Konwersja kosztuje 5 kredytów. Plik zostanie przesłany do przetworzenia w chmurze.',
    pdfDocxConfirmBalance: 'Aktualne saldo: {balance} kredytów.',
    pdfDocxBtnConvert: 'Kontynuuj',
    btnCancel: 'Anuluj',
    pdfDocxFailedMsg: 'Eksport do formatu Word nie powiódł się',
    pdfDocxNoCliMsg:
      'Nie można zalogować się do ChaAI Office: brakuje wymaganego komponentu (chatoffice). Zainstaluj aplikację ponownie.',
    pdfDocxBusyMsg: 'Eksport do formatu Word już trwa. Poczekaj na jego zakończenie.',
    menuExportPptx: 'Eksportuj jako PowerPoint…',
    pdfPptxFailedMsg: 'Eksport jako PowerPoint nie powiódł się',
    pdfPptxBusyMsg: 'Eksport już trwa. Poczekaj na jego zakończenie.',
    pdfPptxLocalScannedDetail:
      'Każda strona została wyeksportowana jako obraz; tekst na slajdach nie jest edytowalny.',
    menuExportXlsx: 'Eksportuj jako Excel…',
    pdfXlsxFailedMsg: 'Eksport jako Excel nie powiódł się',
    pdfXlsxBusyMsg: 'Eksport już trwa. Poczekaj na jego zakończenie.',
    pdfXlsxLocalScannedDetail:
      'Zeskanowanych stron nie można przekształcić w komórki; arkusz każdej strony zawiera wiersz z informacją.',
    pdfXlsxLocalSkippedMsg: 'Niektóre strony nie zostały przekształcone w komórki',
    pdfXlsxLocalSkippedDetail:
      'Stron {pages} nie udało się przekształcić w komórki; ich arkusze zawierają wiersz z informacją.',
    pdfDocxLocalScannedMsg: 'Wykryto zeskanowany dokument',
    pdfDocxLocalScannedDetail:
      'Strony zostały wyeksportowane jako obrazy, aby zachować ich wygląd. Nie udało się rozpoznać edytowalnego tekstu.',
    pdfDocxLocalDegradedMsg: 'Niektóre strony wyeksportowano jako obrazy',
    pdfDocxLocalDegradedDetail:
      'Stron {pages} nie udało się wiarygodnie odtworzyć; wyeksportowano je jako obrazy całych stron.',
    pdfDocxLocalOcrMsg: 'Zeskanowane strony przekonwertowano na edytowalny tekst',
    pdfDocxLocalOcrDetail:
      'Strony {pages} były skanami; tekst odzyskano lokalnym OCR. Sprawdź wynik.',
    pdfDocxLocalEncryptedDetail:
      'Ten PDF jest zaszyfrowany i nie można go otworzyć bez prawidłowego hasła.',
    pdfDocxLocalUnsupportedEncDetail:
      'Ten PDF używa szyfrowania opartego na certyfikatach lub innego nieobsługiwanego szyfrowania i nie można go przekonwertować.',
    pdfPwdTitle: 'Wprowadź hasło',
    pdfPwdPrompt: 'Ten PDF jest zaszyfrowany. Wprowadź hasło, aby go otworzyć:',
    pdfPwdRetryPrompt: 'Nieprawidłowe hasło. Spróbuj ponownie.',
    pdfPwdOk: 'OK',
    pdfPwdVerifying: 'Weryfikowanie hasła…',
    pdfPwdLabel: 'Hasło',
    pdfPwdPlaceholder: 'Wprowadź hasło otwarcia',
    pdfPwdShow: 'Pokaż hasło',
    pdfPwdHide: 'Ukryj hasło',
    pdfDocxLocalCorruptDetail:
      'Plik jest uszkodzony lub nie jest prawidłowym plikiem PDF i nie można go przekonwertować.',
    dlgPickSaveDir: 'Wybierz domyślną lokalizację zapisu',
    errSaveDirUnusable:
      'Wybrany folder nie pozwala na zapis i nie może być domyślną lokalizacją zapisu',
    tabCtxClose: 'Zamknij',
    tabCtxCloseOthers: 'Zamknij inne',
    tabCtxCloseLeft: 'Zamknij po lewej',
    tabCtxCloseRight: 'Zamknij po prawej',
    tabCtxCloseAll: 'Zamknij wszystkie',
  },
  cs: {
    dlgAddFolderRoot: 'Přidat složku na domovskou stránku',
    errFolderRootUnusable: 'Vybranou složku nelze načíst',
    menuFile: 'Soubor',
    menuSectionNew: 'Nový',
    menuOpenInNewWindow: 'Otevřít v novém okně',
    menuNewDoc: 'AI Docs',
    menuNewSheet: 'AI Sheets',
    untitledSheet: 'Sešit bez názvu',
    untitledDoc: 'Dokument bez názvu',
    untitledDeck: 'Prezentace bez názvu',
    untitledMarkdown: 'Markdown bez názvu',
    untitledHtml: 'HTML bez názvu',
    untitledPdf: 'PDF bez názvu',
    menuNewSlide: 'AI Slides',
    menuNewMarkdown: 'AI Markdown',
    menuNewHtml: 'AI HTML',
    menuNewPdf: 'AI PDF',
    menuExportPdf: 'Exportovat jako PDF…',
    menuExportImages: 'Exportovat jako obrázky…',
    menuExportHtml: 'Exportovat jako samostatné HTML…',
    menuOpenInDocs: 'Převést a otevřít v Docs',
    menuPrint: 'Tisk…',
    menuOpen: 'Otevřít…',
    menuSave: 'Uložit',
    menuSaveAs: 'Uložit jako…',
    menuClose: 'Zavřít',
    menuEdit: 'Úpravy',
    menuWindow: 'Okno',
    menuHome: 'Domů',
    backToHome: 'Zpět na domovskou stránku',
    dlgOpenTitle: 'Otevřít soubor',
    filterSupported: 'Podporované soubory',
    filterWord: 'Dokumenty Word',
    filterExcel: 'Sešity Excel',
    filterPpt: 'Prezentace PowerPoint',
    filterMarkdown: 'Dokumenty Markdown',
    filterHtml: 'Dokumenty HTML',
    filterPdf: 'Dokumenty PDF',
    errBadArgs: 'Neplatné argumenty',
    errBadName: 'Neplatný název souboru',
    errMissing: 'Soubor nebyl nalezen',
    errExists: 'Soubor s tímto názvem už existuje',
    errRenameFailed: 'Přejmenování se nezdařilo',
    errNewTabFailed: 'Nový dokument se nepodařilo vytvořit',
    errUnsupportedExt: 'Soubory .{ext} nejsou podporovány',
    copySuffix: 'kopie',
    menuHelp: 'Nápověda',
    menuActivate: 'License',
    menuActivateLoading: 'Loading license status…',
    menuActivateEntitled: 'Activated · valid until {date}',
    menuActivateFree: 'Free trial · {n} days left',
    menuActivateExpired: 'Trial ended · buy to stop reminders',
    menuPurchaseActivate: 'Purchase / Activate…',
    thirdPartyNotices: 'Informace o softwaru třetích stran',
    menuExportDocx: 'Exportovat jako Word…',
    btnCancel: 'Zrušit',
    pdfDocxFailedMsg: 'Export do Wordu se nezdařil',
    pdfDocxBusyMsg: 'Export do Wordu už probíhá. Počkejte, až se dokončí.',
    menuExportPptx: 'Exportovat jako PowerPoint…',
    pdfPptxFailedMsg: 'Export do PowerPointu se nezdařil',
    pdfPptxBusyMsg: 'Export už probíhá. Počkejte, až se dokončí.',
    pdfPptxLocalScannedDetail:
      'Každá stránka byla exportována jako celostránkový obrázek; text na snímcích nelze upravovat.',
    menuExportXlsx: 'Exportovat jako Excel…',
    pdfXlsxFailedMsg: 'Export do Excelu se nezdařil',
    pdfXlsxBusyMsg: 'Export už probíhá. Počkejte, až se dokončí.',
    pdfXlsxLocalScannedDetail:
      'Naskenované stránky nelze převést na buňky; list každé stránky místo toho obsahuje řádek s upozorněním.',
    pdfXlsxLocalSkippedMsg: 'Některé stránky nebyly převedeny na buňky',
    pdfXlsxLocalSkippedDetail:
      'Stránky {pages} nebylo možné převést na buňky; jejich listy místo toho obsahují řádek s upozorněním.',
    pdfDocxLocalScannedMsg: 'Zjištěn naskenovaný dokument',
    pdfDocxLocalScannedDetail:
      'Stránky byly exportovány jako obrázky, aby se zachoval jejich vzhled; nepodařilo se rozpoznat žádný upravitelný text.',
    pdfDocxLocalDegradedMsg: 'Některé stránky byly exportovány jako obrázky',
    pdfDocxLocalDegradedDetail:
      'Stránky {pages} nebylo možné spolehlivě rekonstruovat a byly exportovány jako celostránkové obrázky.',
    pdfDocxLocalOcrMsg: 'Naskenované stránky převedeny na upravitelný text',
    pdfDocxLocalOcrDetail:
      'Stránky {pages} byly skeny; jejich text byl obnoven pomocí OCR v zařízení. Výsledek si prosím zkontrolujte.',
    pdfDocxLocalEncryptedDetail: 'Toto PDF je šifrované a bez správného hesla ho nelze otevřít.',
    pdfDocxLocalUnsupportedEncDetail:
      'Toto PDF používá šifrování založené na certifikátu nebo jiné nepodporované šifrování a nelze ho převést.',
    pdfPwdTitle: 'Zadejte heslo',
    pdfPwdPrompt: 'Toto PDF je šifrované. Pro otevření zadejte heslo:',
    pdfPwdRetryPrompt: 'Nesprávné heslo. Zkuste to znovu.',
    pdfPwdOk: 'OK',
    pdfPwdVerifying: 'Ověřování hesla…',
    pdfPwdLabel: 'Heslo',
    pdfPwdPlaceholder: 'Zadejte heslo pro otevření',
    pdfPwdShow: 'Zobrazit heslo',
    pdfPwdHide: 'Skrýt heslo',
    pdfDocxLocalCorruptDetail: 'Soubor je poškozený nebo není platným PDF a nelze ho převést.',
    dlgPickSaveDir: 'Zvolte výchozí umístění pro ukládání',
    errSaveDirUnusable:
      'Do vybrané složky nelze zapisovat a nelze ji použít jako výchozí umístění pro ukládání',
    menuExportDocxLocal: '导出为 Word（本地）…',
    pdfDocxLoginMsg: '导出为 Word 需要登录 ChaAI Office 账号。',
    pdfDocxLoginDetail: '点击“登录”将打开浏览器完成授权，完成后请重新点击导出。',
    pdfDocxBtnLogin: '登录',
    pdfDocxConfirmMsg: '将此 PDF 上传到 ChaAI Office 云端转换为 Word？',
    pdfDocxConfirmDetail: '本次转换将消耗 5 credits，文件将上传至云端处理。',
    pdfDocxConfirmBalance: '当前余额 {balance} credits。',
    pdfDocxBtnConvert: '继续',
    pdfDocxNoCliMsg: '无法登录 ChaAI Office：缺少必需组件（chatoffice），请重新安装应用。',
    tabCtxClose: 'Zavřít',
    tabCtxCloseOthers: 'Zavřít ostatní',
    tabCtxCloseLeft: 'Zavřít vlevo',
    tabCtxCloseRight: 'Zavřít vpravo',
    tabCtxCloseAll: 'Zavřít vše',
  },
  nl: {
    dlgAddFolderRoot: 'Map toevoegen aan startpagina',
    errFolderRootUnusable: 'De geselecteerde map kan niet worden gelezen',
    menuFile: 'Bestand',
    menuSectionNew: 'Nieuw',
    menuOpenInNewWindow: 'Openen in nieuw venster',
    menuNewDoc: 'Doc',
    menuNewSheet: 'Werkblad',
    untitledSheet: 'Naamloze spreadsheet',
    untitledDoc: 'Naamloos document',
    untitledDeck: 'Naamloze presentatie',
    untitledMarkdown: 'Naamloos Markdown',
    untitledHtml: 'Naamloos HTML',
    untitledPdf: 'Naamloze PDF',
    menuNewSlide: 'Dia',
    menuNewMarkdown: 'Doc MD',
    menuNewPdf: 'Doc PDF',
    menuNewHtml: 'AI HTML',
    menuExportPdf: 'Exporteren als PDF…',
    menuExportImages: 'Exporteren als afbeeldingen…',
    menuExportHtml: 'Exporteren als één HTML-bestand…',
    menuOpenInDocs: 'Converteren en openen in Docs',
    menuPrint: 'Afdrukken…',
    menuOpen: 'Openen…',
    menuSave: 'Opslaan',
    menuSaveAs: 'Opslaan als…',
    menuClose: 'Sluiten',
    menuEdit: 'Bewerken',
    menuWindow: 'Venster',
    menuHome: 'Start',
    backToHome: 'Terug naar start',
    dlgOpenTitle: 'Bestand openen',
    filterSupported: 'Ondersteunde bestanden',
    filterWord: 'Word-documenten',
    filterExcel: 'Excel-werkmappen',
    filterPpt: 'PowerPoint-presentaties',
    filterMarkdown: 'Markdown-documenten',
    filterHtml: 'HTML-documenten',
    filterPdf: 'PDF-documenten',
    errBadArgs: 'Ongeldige argumenten',
    errBadName: 'Ongeldige bestandsnaam',
    errMissing: 'Bestand niet gevonden',
    errExists: 'Er bestaat al een bestand met die naam',
    errRenameFailed: 'Naam wijzigen mislukt',
    errNewTabFailed: 'Kan het nieuwe document niet maken',
    errUnsupportedExt: '.{ext}-bestanden worden niet ondersteund',
    copySuffix: 'kopie',
    menuHelp: 'Help',
    menuActivate: 'License',
    menuActivateLoading: 'Loading license status…',
    menuActivateEntitled: 'Activated · valid until {date}',
    menuActivateFree: 'Free trial · {n} days left',
    menuActivateExpired: 'Trial ended · buy to stop reminders',
    menuPurchaseActivate: 'Purchase / Activate…',
    thirdPartyNotices: 'Kennisgevingen over software van derden',
    menuExportDocx: 'Exporteren als Word…',
    menuExportDocxLocal: 'Exporteren als Word（本地）…',
    pdfDocxLoginMsg: 'Exporteren als Word vereist inloggen bij ChaAI Office.',
    pdfDocxLoginDetail:
      'Klik op “Inloggen” om in de browser te autoriseren; klik daarna opnieuw op Exporteren.',
    pdfDocxBtnLogin: 'Inloggen',
    pdfDocxConfirmMsg: 'Deze PDF uploaden naar de ChaAI Office-cloud en converteren naar Word?',
    pdfDocxConfirmDetail:
      'De conversie kost 5 credits. Het bestand wordt geüpload voor verwerking in de cloud.',
    pdfDocxConfirmBalance: 'Huidig saldo: {balance} credits.',
    pdfDocxBtnConvert: 'Doorgaan',
    btnCancel: 'Annuleren',
    pdfDocxFailedMsg: 'Exporteren als Word mislukt',
    pdfDocxNoCliMsg:
      'Kan niet inloggen bij ChaAI Office: een vereist onderdeel (chatoffice) ontbreekt. Installeer de app opnieuw.',
    pdfDocxBusyMsg: 'Er is al een Word-export bezig. Wacht tot deze is voltooid.',
    menuExportPptx: 'Exporteren als PowerPoint…',
    pdfPptxFailedMsg: 'Exporteren als PowerPoint mislukt',
    pdfPptxBusyMsg: 'Er is al een export bezig. Wacht tot deze is voltooid.',
    pdfPptxLocalScannedDetail:
      'Elke pagina is als afbeelding geëxporteerd; de tekst op de dia’s is niet bewerkbaar.',
    menuExportXlsx: 'Exporteren als Excel…',
    pdfXlsxFailedMsg: 'Exporteren als Excel mislukt',
    pdfXlsxBusyMsg: 'Er is al een export bezig. Wacht tot deze is voltooid.',
    pdfXlsxLocalScannedDetail:
      "Gescande pagina's kunnen niet naar cellen worden omgezet; het werkblad van elke pagina bevat een meldingsrij.",
    pdfXlsxLocalSkippedMsg: "Sommige pagina's zijn niet naar cellen omgezet",
    pdfXlsxLocalSkippedDetail:
      "Pagina's {pages} konden niet naar cellen worden omgezet; hun werkbladen bevatten een meldingsrij.",
    pdfDocxLocalScannedMsg: 'Gescand document gedetecteerd',
    pdfDocxLocalScannedDetail:
      "De pagina's zijn als afbeeldingen geëxporteerd om hun uiterlijk te behouden. Er kon geen bewerkbare tekst worden herkend.",
    pdfDocxLocalDegradedMsg: "Sommige pagina's zijn als afbeeldingen geëxporteerd",
    pdfDocxLocalDegradedDetail:
      "Pagina's {pages} konden niet betrouwbaar worden gereconstrueerd en zijn als paginagrote afbeeldingen geëxporteerd.",
    pdfDocxLocalOcrMsg: 'Gescande pagina’s omgezet naar bewerkbare tekst',
    pdfDocxLocalOcrDetail:
      'Pagina(’s) {pages} waren scans; de tekst is hersteld met lokale OCR. Controleer het resultaat.',
    pdfDocxLocalEncryptedDetail:
      'Deze PDF is versleuteld en kon niet worden geopend zonder het juiste wachtwoord.',
    pdfDocxLocalUnsupportedEncDetail:
      'Deze PDF gebruikt certificaatgebaseerde of anderszins niet-ondersteunde versleuteling en kan niet worden geconverteerd.',
    pdfPwdTitle: 'Wachtwoord invoeren',
    pdfPwdPrompt: 'Deze PDF is versleuteld. Voer het wachtwoord in om te openen:',
    pdfPwdRetryPrompt: 'Onjuist wachtwoord. Probeer het opnieuw.',
    pdfPwdOk: 'OK',
    pdfPwdVerifying: 'Wachtwoord controleren…',
    pdfPwdLabel: 'Wachtwoord',
    pdfPwdPlaceholder: 'Voer het openingswachtwoord in',
    pdfPwdShow: 'Wachtwoord tonen',
    pdfPwdHide: 'Wachtwoord verbergen',
    pdfDocxLocalCorruptDetail:
      'Het bestand is beschadigd of geen geldige PDF en kan niet worden geconverteerd.',
    dlgPickSaveDir: 'Standaard opslaglocatie kiezen',
    errSaveDirUnusable:
      'De geselecteerde map is niet beschrijfbaar en kan niet als standaard opslaglocatie worden gebruikt',
    tabCtxClose: 'Sluiten',
    tabCtxCloseOthers: 'Andere sluiten',
    tabCtxCloseLeft: 'Links sluiten',
    tabCtxCloseRight: 'Rechts sluiten',
    tabCtxCloseAll: 'Alles sluiten',
  },
  ms: {
    dlgAddFolderRoot: 'Tambah Folder ke Laman Utama',
    errFolderRootUnusable: 'Folder yang dipilih tidak dapat dibaca',
    menuFile: 'Fail',
    menuSectionNew: 'Baharu',
    menuOpenInNewWindow: 'Buka dalam Tetingkap Baharu',
    menuNewDoc: 'Dok',
    menuNewSheet: 'Helaian',
    untitledSheet: 'Hamparan tanpa tajuk',
    untitledDoc: 'Dokumen tanpa tajuk',
    untitledDeck: 'Persembahan tanpa tajuk',
    untitledMarkdown: 'Markdown tanpa tajuk',
    untitledHtml: 'HTML tanpa tajuk',
    untitledPdf: 'PDF tanpa tajuk',
    menuNewSlide: 'Slaid',
    menuNewMarkdown: 'Dok MD',
    menuNewPdf: 'Dok PDF',
    menuNewHtml: 'AI HTML',
    menuExportPdf: 'Eksport sebagai PDF…',
    menuExportImages: 'Eksport sebagai imej…',
    menuExportHtml: 'Eksport sebagai HTML fail tunggal…',
    menuOpenInDocs: 'Tukar dan buka dalam Docs',
    menuPrint: 'Cetak…',
    menuOpen: 'Buka…',
    menuSave: 'Simpan',
    menuSaveAs: 'Simpan Sebagai…',
    menuClose: 'Tutup',
    menuEdit: 'Edit',
    menuWindow: 'Tetingkap',
    menuHome: 'Laman Utama',
    backToHome: 'Kembali ke Laman Utama',
    dlgOpenTitle: 'Buka Fail',
    filterSupported: 'Fail yang Disokong',
    filterWord: 'Dokumen Word',
    filterExcel: 'Buku Kerja Excel',
    filterPpt: 'Persembahan PowerPoint',
    filterMarkdown: 'Dokumen Markdown',
    filterHtml: 'Dokumen HTML',
    filterPdf: 'Dokumen PDF',
    errBadArgs: 'Argumen tidak sah',
    errBadName: 'Nama fail tidak sah',
    errMissing: 'Fail tidak ditemui',
    errExists: 'Fail dengan nama yang sama sudah wujud',
    errRenameFailed: 'Gagal menamakan semula',
    errNewTabFailed: 'Gagal mencipta dokumen baharu',
    errUnsupportedExt: 'fail .{ext} tidak disokong',
    copySuffix: 'salinan',
    menuHelp: 'Bantuan',
    menuActivate: 'License',
    menuActivateLoading: 'Loading license status…',
    menuActivateEntitled: 'Activated · valid until {date}',
    menuActivateFree: 'Free trial · {n} days left',
    menuActivateExpired: 'Trial ended · buy to stop reminders',
    menuPurchaseActivate: 'Purchase / Activate…',
    thirdPartyNotices: 'Notis Perisian Pihak Ketiga',
    menuExportDocx: 'Eksport sebagai Word…',
    menuExportDocxLocal: 'Eksport sebagai Word（本地）…',
    pdfDocxLoginMsg: 'Eksport sebagai Word memerlukan log masuk ke ChaAI Office.',
    pdfDocxLoginDetail:
      'Klik “Log Masuk” untuk membuka pelayar dan memberi kebenaran; selepas selesai, klik Eksport sekali lagi.',
    pdfDocxBtnLogin: 'Log Masuk',
    pdfDocxConfirmMsg: 'Muat naik PDF ini ke awan ChaAI Office untuk ditukar kepada Word?',
    pdfDocxConfirmDetail:
      'Penukaran ini menggunakan 5 kredit. Fail akan dimuat naik untuk diproses di awan.',
    pdfDocxConfirmBalance: 'Baki semasa: {balance} kredit.',
    pdfDocxBtnConvert: 'Teruskan',
    btnCancel: 'Batal',
    pdfDocxFailedMsg: 'Gagal mengeksport sebagai Word',
    pdfDocxNoCliMsg:
      'Tidak dapat log masuk ke ChaAI Office: komponen yang diperlukan (chatoffice) tiada. Sila pasang semula aplikasi.',
    pdfDocxBusyMsg: 'Eksport ke Word sedang dijalankan. Sila tunggu sehingga selesai.',
    menuExportPptx: 'Eksport sebagai PowerPoint…',
    pdfPptxFailedMsg: 'Eksport sebagai PowerPoint gagal',
    pdfPptxBusyMsg: 'Eksport sedang berjalan. Sila tunggu sehingga selesai.',
    pdfPptxLocalScannedDetail:
      'Setiap halaman dieksport sebagai imej; teks pada slaid tidak boleh diedit.',
    menuExportXlsx: 'Eksport sebagai Excel…',
    pdfXlsxFailedMsg: 'Eksport sebagai Excel gagal',
    pdfXlsxBusyMsg: 'Eksport sedang berjalan. Sila tunggu sehingga selesai.',
    pdfXlsxLocalScannedDetail:
      'Halaman imbasan tidak boleh ditukar kepada sel; helaian setiap halaman mengandungi baris makluman.',
    pdfXlsxLocalSkippedMsg: 'Sesetengah halaman tidak ditukar kepada sel',
    pdfXlsxLocalSkippedDetail:
      'Halaman {pages} tidak dapat ditukar kepada sel; helaiannya mengandungi baris makluman.',
    pdfDocxLocalScannedMsg: 'Dokumen imbasan dikesan',
    pdfDocxLocalScannedDetail:
      'Halaman dieksport sebagai imej untuk mengekalkan rupanya. Tiada teks boleh edit yang dapat dikenali.',
    pdfDocxLocalDegradedMsg: 'Sesetengah halaman dieksport sebagai imej',
    pdfDocxLocalDegradedDetail:
      'Halaman {pages} tidak dapat dibina semula dengan pasti dan telah dieksport sebagai imej halaman penuh.',
    pdfDocxLocalOcrMsg: 'Halaman imbasan ditukar kepada teks boleh edit',
    pdfDocxLocalOcrDetail:
      'Halaman {pages} ialah imbasan; teksnya dipulihkan dengan OCR setempat. Sila semak hasilnya.',
    pdfDocxLocalEncryptedDetail:
      'PDF ini disulitkan dan tidak dapat dibuka tanpa kata laluan yang betul.',
    pdfDocxLocalUnsupportedEncDetail:
      'PDF ini menggunakan penyulitan berasaskan sijil atau penyulitan yang tidak disokong dan tidak boleh ditukar.',
    pdfPwdTitle: 'Masukkan Kata Laluan',
    pdfPwdPrompt: 'PDF ini disulitkan. Masukkan kata laluan untuk membukanya:',
    pdfPwdRetryPrompt: 'Kata laluan salah. Sila cuba lagi.',
    pdfPwdOk: 'OK',
    pdfPwdVerifying: 'Mengesahkan kata laluan…',
    pdfPwdLabel: 'Kata laluan',
    pdfPwdPlaceholder: 'Masukkan kata laluan buka',
    pdfPwdShow: 'Tunjukkan kata laluan',
    pdfPwdHide: 'Sembunyikan kata laluan',
    pdfDocxLocalCorruptDetail: 'Fail rosak atau bukan PDF yang sah dan tidak dapat ditukar.',
    dlgPickSaveDir: 'Pilih Lokasi Simpanan Lalai',
    errSaveDirUnusable:
      'Folder yang dipilih tidak boleh ditulis dan tidak dapat digunakan sebagai lokasi simpanan lalai',
    tabCtxClose: 'Tutup',
    tabCtxCloseOthers: 'Tutup yang lain',
    tabCtxCloseLeft: 'Tutup di kiri',
    tabCtxCloseRight: 'Tutup di kanan',
    tabCtxCloseAll: 'Tutup semua',
  },
  he: {
    dlgAddFolderRoot: 'הוספת תיקייה לדף הבית',
    errFolderRootUnusable: 'לא ניתן לקרוא את התיקייה שנבחרה',
    menuFile: 'קובץ',
    menuSectionNew: 'חדש',
    menuOpenInNewWindow: 'פתח בחלון חדש',
    menuNewDoc: 'מסמך',
    menuNewSheet: 'גיליון',
    untitledSheet: 'גיליון אלקטרוני ללא שם',
    untitledDoc: 'מסמך ללא שם',
    untitledDeck: 'מצגת ללא שם',
    untitledMarkdown: 'Markdown ללא שם',
    untitledHtml: 'HTML ללא שם',
    untitledPdf: 'PDF ללא שם',
    menuNewSlide: 'שקופיות',
    menuNewMarkdown: 'מסמך MD',
    menuNewPdf: 'מסמך PDF',
    menuNewHtml: 'AI HTML',
    menuExportPdf: 'ייצוא כ-PDF…',
    menuExportImages: 'ייצוא כתמונות…',
    menuExportHtml: 'ייצוא כ-HTML בקובץ יחיד…',
    menuOpenInDocs: 'המרה ופתיחה ב-Docs',
    menuPrint: 'הדפסה…',
    menuOpen: 'פתיחה…',
    menuSave: 'שמירה',
    menuSaveAs: 'שמירה בשם…',
    menuClose: 'סגירה',
    menuEdit: 'עריכה',
    menuWindow: 'חלון',
    menuHome: 'דף הבית',
    backToHome: 'חזרה לדף הבית',
    dlgOpenTitle: 'פתיחת קובץ',
    filterSupported: 'קבצים נתמכים',
    filterWord: 'מסמכי Word',
    filterExcel: 'חוברות עבודה של Excel',
    filterPpt: 'מצגות PowerPoint',
    filterMarkdown: 'מסמכי Markdown',
    filterHtml: 'מסמכי HTML',
    filterPdf: 'מסמכי PDF',
    errBadArgs: 'ארגומנטים לא חוקיים',
    errBadName: 'שם קובץ לא חוקי',
    errMissing: 'הקובץ לא נמצא',
    errExists: 'כבר קיים קובץ באותו שם',
    errRenameFailed: 'שינוי השם נכשל',
    errNewTabFailed: 'יצירת המסמך החדש נכשלה',
    errUnsupportedExt: 'קובצי .{ext} אינם נתמכים',
    copySuffix: 'עותק',
    menuHelp: 'עזרה',
    menuActivate: 'License',
    menuActivateLoading: 'Loading license status…',
    menuActivateEntitled: 'Activated · valid until {date}',
    menuActivateFree: 'Free trial · {n} days left',
    menuActivateExpired: 'Trial ended · buy to stop reminders',
    menuPurchaseActivate: 'Purchase / Activate…',
    thirdPartyNotices: 'הודעות על תוכנות צד שלישי',
    menuExportDocx: 'ייצוא כ-Word…',
    menuExportDocxLocal: 'ייצוא כ-Word（本地）…',
    pdfDocxLoginMsg: 'ייצוא כ-Word דורש התחברות ל-ChaAI Office.',
    pdfDocxLoginDetail: 'לחיצה על ”התחברות” תפתח את הדפדפן לאישור; בסיום, לחצו שוב על ייצוא.',
    pdfDocxBtnLogin: 'התחברות',
    pdfDocxConfirmMsg: 'להעלות את ה-PDF לענן של ChaAI Office ולהמיר אותו ל-Word?',
    pdfDocxConfirmDetail: 'ההמרה עולה 5 קרדיטים. הקובץ יועלה לעיבוד בענן.',
    pdfDocxConfirmBalance: 'יתרה נוכחית: {balance} קרדיטים.',
    pdfDocxBtnConvert: 'המשך',
    btnCancel: 'ביטול',
    pdfDocxFailedMsg: 'הייצוא כ-Word נכשל',
    pdfDocxNoCliMsg:
      'לא ניתן להתחבר ל-ChaAI Office: רכיב נדרש (chatoffice) חסר. נא להתקין מחדש את האפליקציה.',
    pdfDocxBusyMsg: 'ייצוא ל-Word כבר מתבצע. נא להמתין לסיומו.',
    menuExportPptx: 'ייצוא כ-PowerPoint…',
    pdfPptxFailedMsg: 'הייצוא כ-PowerPoint נכשל',
    pdfPptxBusyMsg: 'ייצוא כבר מתבצע. יש להמתין לסיומו.',
    pdfPptxLocalScannedDetail: 'כל עמוד יוצא כתמונה; הטקסט בשקופיות אינו ניתן לעריכה.',
    menuExportXlsx: 'ייצוא כ-Excel…',
    pdfXlsxFailedMsg: 'הייצוא כ-Excel נכשל',
    pdfXlsxBusyMsg: 'ייצוא כבר מתבצע. יש להמתין לסיומו.',
    pdfXlsxLocalScannedDetail:
      'עמודים סרוקים אינם ניתנים להמרה לתאים; בגיליון של כל עמוד נוספה שורת הודעה.',
    pdfXlsxLocalSkippedMsg: 'חלק מהעמודים לא הומרו לתאים',
    pdfXlsxLocalSkippedDetail:
      'לא ניתן היה להמיר את העמודים {pages} לתאים; בגיליונות שלהם נוספה שורת הודעה.',
    pdfDocxLocalScannedMsg: 'זוהה מסמך סרוק',
    pdfDocxLocalScannedDetail:
      'העמודים יוצאו כתמונות כדי לשמר את המראה. לא ניתן היה לזהות טקסט הניתן לעריכה.',
    pdfDocxLocalDegradedMsg: 'חלק מהעמודים יוצאו כתמונות',
    pdfDocxLocalDegradedDetail:
      'לא ניתן היה לשחזר באופן אמין את עמודים {pages}, והם יוצאו כתמונות של עמוד מלא.',
    pdfDocxLocalOcrMsg: 'עמודים סרוקים הומרו לטקסט הניתן לעריכה',
    pdfDocxLocalOcrDetail:
      'עמודים {pages} היו סריקות; הטקסט שוחזר באמצעות OCR מקומי. מומלץ להגיה את התוצאה.',
    pdfDocxLocalEncryptedDetail: 'קובץ PDF זה מוצפן ולא ניתן היה לפתוח אותו ללא הסיסמה הנכונה.',
    pdfDocxLocalUnsupportedEncDetail:
      'קובץ PDF זה משתמש בהצפנה מבוססת אישורים או בהצפנה שאינה נתמכת ולא ניתן להמירו.',
    pdfPwdTitle: 'הזנת סיסמה',
    pdfPwdPrompt: 'קובץ PDF זה מוצפן. הזינו את הסיסמה כדי לפתוח אותו:',
    pdfPwdRetryPrompt: 'סיסמה שגויה. נסו שוב.',
    pdfPwdOk: 'אישור',
    pdfPwdVerifying: 'מאמת את הסיסמה…',
    pdfPwdLabel: 'סיסמה',
    pdfPwdPlaceholder: 'הזינו את סיסמת הפתיחה',
    pdfPwdShow: 'הצג סיסמה',
    pdfPwdHide: 'הסתר סיסמה',
    pdfDocxLocalCorruptDetail: 'הקובץ פגום או שאינו PDF תקין ולא ניתן להמירו.',
    dlgPickSaveDir: 'בחירת מיקום שמירה כברירת מחדל',
    errSaveDirUnusable:
      'התיקייה שנבחרה אינה ניתנת לכתיבה ולא ניתן להשתמש בה כמיקום שמירה כברירת מחדל',
    tabCtxClose: 'סגור',
    tabCtxCloseOthers: 'סגור אחרים',
    tabCtxCloseLeft: 'סגור משמאל',
    tabCtxCloseRight: 'סגור מימין',
    tabCtxCloseAll: 'סגור הכל',
  },
  hi: {
    dlgAddFolderRoot: 'होम में फ़ोल्डर जोड़ें',
    errFolderRootUnusable: 'चयनित फ़ोल्डर पढ़ा नहीं जा सका',
    menuFile: 'फ़ाइल',
    menuSectionNew: 'नया',
    menuOpenInNewWindow: 'नई विंडो में खोलें',
    menuNewDoc: 'दस्तावेज़',
    menuNewSheet: 'शीट',
    untitledSheet: 'शीर्षकहीन स्प्रेडशीट',
    untitledDoc: 'बिना शीर्षक दस्तावेज़',
    untitledDeck: 'बिना शीर्षक प्रस्तुति',
    untitledMarkdown: 'अनाम Markdown',
    untitledHtml: 'अनाम HTML',
    untitledPdf: 'अनाम PDF',
    menuNewSlide: 'स्लाइड',
    menuNewMarkdown: 'MD दस्तावेज़',
    menuNewPdf: 'PDF दस्तावेज़',
    menuNewHtml: 'AI HTML',
    menuExportPdf: 'PDF के रूप में निर्यात…',
    menuExportImages: 'छवियों के रूप में निर्यात…',
    menuExportHtml: 'एकल-फ़ाइल HTML के रूप में निर्यात…',
    menuOpenInDocs: 'Docs में बदलें और खोलें',
    menuPrint: 'प्रिंट करें…',
    menuOpen: 'खोलें…',
    menuSave: 'सहेजें',
    menuSaveAs: 'इस रूप में सहेजें…',
    menuClose: 'बंद करें',
    menuEdit: 'संपादन',
    menuWindow: 'विंडो',
    menuHome: 'होम',
    backToHome: 'होम पर वापस जाएँ',
    dlgOpenTitle: 'फ़ाइल खोलें',
    filterSupported: 'समर्थित फ़ाइलें',
    filterWord: 'Word दस्तावेज़',
    filterExcel: 'Excel वर्कबुक',
    filterPpt: 'PowerPoint प्रस्तुतियाँ',
    filterMarkdown: 'Markdown दस्तावेज़',
    filterHtml: 'HTML दस्तावेज़',
    filterPdf: 'PDF दस्तावेज़',
    errBadArgs: 'अमान्य आर्ग्युमेंट',
    errBadName: 'अमान्य फ़ाइल नाम',
    errMissing: 'फ़ाइल नहीं मिली',
    errExists: 'इस नाम की फ़ाइल पहले से मौजूद है',
    errRenameFailed: 'नाम बदलने में विफल',
    errNewTabFailed: 'नया दस्तावेज़ बनाने में विफल',
    errUnsupportedExt: '.{ext} फ़ाइलें समर्थित नहीं हैं',
    copySuffix: 'प्रतिलिपि',
    menuHelp: 'सहायता',
    menuActivate: 'License',
    menuActivateLoading: 'Loading license status…',
    menuActivateEntitled: 'Activated · valid until {date}',
    menuActivateFree: 'Free trial · {n} days left',
    menuActivateExpired: 'Trial ended · buy to stop reminders',
    menuPurchaseActivate: 'Purchase / Activate…',
    thirdPartyNotices: 'तृतीय-पक्ष सॉफ़्टवेयर सूचनाएँ',
    menuExportDocx: 'Word के रूप में निर्यात करें…',
    menuExportDocxLocal: 'Word के रूप में निर्यात करें（本地）…',
    pdfDocxLoginMsg: 'Word के रूप में निर्यात करने के लिए ChaAI Office में लॉगिन आवश्यक है।',
    pdfDocxLoginDetail:
      '“लॉगिन” पर क्लिक करने से ब्राउज़र में प्राधिकरण खुलेगा; पूरा होने पर फिर से निर्यात पर क्लिक करें।',
    pdfDocxBtnLogin: 'लॉगिन',
    pdfDocxConfirmMsg: 'इस PDF को ChaAI Office क्लाउड पर अपलोड करके Word में बदलें?',
    pdfDocxConfirmDetail:
      'रूपांतरण में 5 क्रेडिट लगते हैं। फ़ाइल क्लाउड में प्रोसेसिंग के लिए अपलोड की जाएगी।',
    pdfDocxConfirmBalance: 'वर्तमान शेष: {balance} क्रेडिट।',
    pdfDocxBtnConvert: 'जारी रखें',
    btnCancel: 'रद्द करें',
    pdfDocxFailedMsg: 'Word के रूप में निर्यात विफल रहा',
    pdfDocxNoCliMsg:
      'ChaAI Office में साइन इन नहीं किया जा सकता: आवश्यक घटक (chatoffice) मौजूद नहीं है। कृपया ऐप को फिर से इंस्टॉल करें।',
    pdfDocxBusyMsg: 'Word के रूप में निर्यात पहले से चल रहा है। कृपया पूरा होने तक प्रतीक्षा करें।',
    menuExportPptx: 'PowerPoint के रूप में निर्यात करें…',
    pdfPptxFailedMsg: 'PowerPoint के रूप में निर्यात विफल रहा',
    pdfPptxBusyMsg: 'एक निर्यात पहले से चल रहा है। कृपया उसके पूरा होने की प्रतीक्षा करें।',
    pdfPptxLocalScannedDetail:
      'प्रत्येक पृष्ठ छवि के रूप में निर्यात किया गया; स्लाइड का टेक्स्ट संपादन योग्य नहीं है।',
    menuExportXlsx: 'Excel के रूप में निर्यात करें…',
    pdfXlsxFailedMsg: 'Excel के रूप में निर्यात विफल रहा',
    pdfXlsxBusyMsg: 'एक निर्यात पहले से चल रहा है। कृपया उसके पूरा होने की प्रतीक्षा करें।',
    pdfXlsxLocalScannedDetail:
      'स्कैन किए गए पेज सेल में परिवर्तित नहीं किए जा सकते; प्रत्येक पेज की वर्कशीट में एक सूचना पंक्ति जोड़ी गई है।',
    pdfXlsxLocalSkippedMsg: 'कुछ पेज सेल में परिवर्तित नहीं हुए',
    pdfXlsxLocalSkippedDetail:
      'पेज {pages} सेल में परिवर्तित नहीं किए जा सके; उनकी वर्कशीट में एक सूचना पंक्ति जोड़ी गई है।',
    pdfDocxLocalScannedMsg: 'स्कैन किया गया दस्तावेज़ मिला',
    pdfDocxLocalScannedDetail:
      'पृष्ठों का स्वरूप बनाए रखने के लिए उन्हें छवियों के रूप में निर्यात किया गया। संपादन योग्य टेक्स्ट को पहचाना नहीं जा सका।',
    pdfDocxLocalDegradedMsg: 'कुछ पृष्ठ छवियों के रूप में निर्यात किए गए',
    pdfDocxLocalDegradedDetail:
      'पृष्ठ {pages} का लेआउट विश्वसनीय रूप से पुनर्निर्मित नहीं हो सका, इसलिए उन्हें पूर्ण-पृष्ठ छवियों के रूप में निर्यात किया गया।',
    pdfDocxLocalOcrMsg: 'स्कैन किए गए पृष्ठ संपादन योग्य टेक्स्ट में बदले गए',
    pdfDocxLocalOcrDetail:
      'पृष्ठ {pages} स्कैन थे; स्थानीय OCR से टेक्स्ट पुनर्प्राप्त किया गया। कृपया परिणाम जाँचें।',
    pdfDocxLocalEncryptedDetail:
      'यह PDF एन्क्रिप्टेड है और सही पासवर्ड के बिना इसे खोला नहीं जा सका।',
    pdfDocxLocalUnsupportedEncDetail:
      'यह PDF प्रमाणपत्र-आधारित या असमर्थित एन्क्रिप्शन का उपयोग करता है और इसे परिवर्तित नहीं किया जा सकता।',
    pdfPwdTitle: 'पासवर्ड दर्ज करें',
    pdfPwdPrompt: 'यह PDF एन्क्रिप्टेड है। खोलने के लिए पासवर्ड दर्ज करें:',
    pdfPwdRetryPrompt: 'पासवर्ड गलत है। कृपया फिर से प्रयास करें।',
    pdfPwdOk: 'ठीक है',
    pdfPwdVerifying: 'पासवर्ड सत्यापित किया जा रहा है…',
    pdfPwdLabel: 'पासवर्ड',
    pdfPwdPlaceholder: 'खोलने का पासवर्ड दर्ज करें',
    pdfPwdShow: 'पासवर्ड दिखाएँ',
    pdfPwdHide: 'पासवर्ड छिपाएँ',
    pdfDocxLocalCorruptDetail:
      'फ़ाइल क्षतिग्रस्त है या मान्य PDF नहीं है, इसलिए रूपांतरण नहीं हो सकता।',
    dlgPickSaveDir: 'डिफ़ॉल्ट सहेजने का स्थान चुनें',
    errSaveDirUnusable:
      'चयनित फ़ोल्डर में लिखा नहीं जा सकता, इसलिए इसे डिफ़ॉल्ट सहेजने के स्थान के रूप में उपयोग नहीं किया जा सकता',
    tabCtxClose: 'बंद करें',
    tabCtxCloseOthers: 'अन्य बंद करें',
    tabCtxCloseLeft: 'बाएं बंद करें',
    tabCtxCloseRight: 'दाएं बंद करें',
    tabCtxCloseAll: 'सभी बंद करें',
  },
  'zh-TW': {
    dlgAddFolderRoot: '將資料夾加入首頁',
    errFolderRootUnusable: '無法讀取所選資料夾',
    menuFile: '檔案',
    menuSectionNew: '新增',
    menuOpenInNewWindow: '在新視窗中開啟',
    menuNewDoc: '文件',
    menuNewSheet: '表格',
    untitledSheet: '未命名試算表',
    untitledDoc: '未命名文件',
    untitledDeck: '未命名簡報',
    untitledMarkdown: '未命名 Markdown',
    untitledHtml: '未命名 HTML',
    untitledPdf: '未命名 PDF',
    menuNewSlide: '簡報',
    menuNewMarkdown: 'MD文件',
    menuNewPdf: 'PDF文件',
    menuNewHtml: 'AI HTML',
    menuExportPdf: '匯出為 PDF…',
    menuExportImages: '匯出為圖片…',
    menuExportHtml: '匯出為單檔 HTML…',
    menuOpenInDocs: '轉換為 Docs 文件並開啟',
    menuPrint: '列印…',
    menuOpen: '開啟…',
    menuSave: '儲存',
    menuSaveAs: '另存新檔…',
    menuClose: '關閉',
    menuEdit: '編輯',
    menuWindow: '視窗',
    menuHome: '首頁',
    backToHome: '返回首頁',
    dlgOpenTitle: '開啟檔案',
    filterSupported: '支援的檔案',
    filterWord: 'Word 文件',
    filterExcel: 'Excel 活頁簿',
    filterPpt: 'PowerPoint 簡報',
    filterMarkdown: 'Markdown 文件',
    filterHtml: 'HTML 文件',
    filterPdf: 'PDF 文件',
    errBadArgs: '參數無效',
    errBadName: '檔案名稱不合法',
    errMissing: '檔案不存在',
    errExists: '同名檔案已存在',
    errRenameFailed: '重新命名失敗',
    errNewTabFailed: '新建文件失敗',
    errUnsupportedExt: '暫不支援 .{ext} 類型',
    copySuffix: '副本',
    menuHelp: '說明',
    menuActivate: '啟用',
    menuActivateLoading: '正在讀取授權狀態…',
    menuActivateEntitled: '已啟用 · 有效期至 {date}',
    menuActivateFree: '免費體驗中 · 剩 {n} 天',
    menuActivateExpired: '體驗期已結束 · 購買後提醒消失',
    menuPurchaseActivate: '購買 / 啟用…',
    thirdPartyNotices: '第三方軟體聲明',
    menuExportDocx: '匯出為 Word…',
    menuExportDocxLocal: '匯出為 Word（本地）…',
    pdfDocxLoginMsg: '匯出為 Word 需要登入 察元AIOffice 帳號。',
    pdfDocxLoginDetail: '點擊「登入」將開啟瀏覽器完成授權，完成後請重新點擊匯出。',
    pdfDocxBtnLogin: '登入',
    pdfDocxConfirmMsg: '將此 PDF 上傳到 察元AIOffice 雲端轉換為 Word？',
    pdfDocxConfirmDetail: '本次轉換將消耗 5 credits，檔案將上傳至雲端處理。',
    pdfDocxConfirmBalance: '目前餘額 {balance} credits。',
    pdfDocxBtnConvert: '繼續',
    btnCancel: '取消',
    pdfDocxFailedMsg: '匯出為 Word 失敗',
    pdfDocxNoCliMsg: '無法登入 察元AIOffice：缺少必要元件（chatoffice），請重新安裝應用程式。',
    pdfDocxBusyMsg: '正在轉換中，請等待目前的匯出完成。',
    menuExportPptx: '匯出為 PPT…',
    pdfPptxFailedMsg: '匯出為 PPT 失敗',
    pdfPptxBusyMsg: '正在轉換中，請等待目前匯出完成。',
    pdfPptxLocalScannedDetail: '本機轉換已將各頁以圖片保真匯出，簡報中的文字無法編輯。',
    menuExportXlsx: '匯出為 Excel…',
    pdfXlsxFailedMsg: '匯出為 Excel 失敗',
    pdfXlsxBusyMsg: '正在轉換中，請等待目前匯出完成。',
    pdfXlsxLocalScannedDetail: '掃描頁無法轉換為儲存格，對應工作表中已寫入提示列。',
    pdfXlsxLocalSkippedMsg: '部分頁面未轉換為儲存格',
    pdfXlsxLocalSkippedDetail: '第 {pages} 頁無法轉換為儲存格，對應工作表中已寫入提示列。',
    pdfDocxLocalScannedMsg: '偵測到掃描文件',
    pdfDocxLocalScannedDetail: '本機轉換已將各頁以圖片方式保真匯出，未能辨識出可編輯的文字。',
    pdfDocxLocalDegradedMsg: '部分頁面已以圖片匯出',
    pdfDocxLocalDegradedDetail: '第 {pages} 頁的版面無法可靠重建，已以整頁圖片保真匯出。',
    pdfDocxLocalOcrMsg: '掃描頁已轉換為可編輯文字',
    pdfDocxLocalOcrDetail:
      '第 {pages} 頁為掃描件，已透過本機 OCR 辨識為可編輯文字，建議校對辨識結果。',
    pdfDocxLocalEncryptedDetail: '此 PDF 已加密，未提供正確的密碼，無法轉換。',
    pdfDocxLocalUnsupportedEncDetail: '該檔案使用憑證加密或不支援的加密方式，無法轉換。',
    pdfPwdTitle: '輸入密碼',
    pdfPwdPrompt: '此 PDF 已加密，請輸入開啟密碼：',
    pdfPwdRetryPrompt: '密碼不正確，請重試。',
    pdfPwdOk: '確定',
    pdfPwdVerifying: '正在驗證密碼…',
    pdfPwdLabel: '密碼',
    pdfPwdPlaceholder: '輸入開啟密碼',
    pdfPwdShow: '顯示密碼',
    pdfPwdHide: '隱藏密碼',
    pdfDocxLocalCorruptDetail: '檔案已損壞或不是有效的 PDF，無法轉換。',
    dlgPickSaveDir: '選擇預設儲存位置',
    errSaveDirUnusable: '所選資料夾無法寫入，無法作為預設儲存位置',
    tabCtxClose: '關閉',
    tabCtxCloseOthers: '關閉其他',
    tabCtxCloseLeft: '關閉左側',
    tabCtxCloseRight: '關閉右側',
    tabCtxCloseAll: '關閉全部',
  },
})

const tm = (key: Parameters<typeof tMain>[1], params?: Parameters<typeof tMain>[2]) =>
  tMain(currentLang(), key, params)

// ---- the shell window + its tab manager (recreated if the user closes it on macOS) ----

let shellWindow: BrowserWindow | null = null
let tabManager: TabManager | null = null

/**
 * New file from a folder view: the click remembers the folder per kind, the
 * new-tab code consumes it right away. Sheets / PDF write their blank file
 * straight into that folder; the editors that save untitled files themselves
 * (docs, slides, markdown, html) get the folder bound to the tab that was just
 * created, and the tab's first save moves the fresh file there.
 * key: 'doc' | 'sheet' | 'slide' | 'markdown' | 'html' | 'pdf'
 */
/** folders the user added to the home tree beside the default save folder */
function extraFolderRoots(): string[] {
  return readExtraRoots(readAppSettings(APP_SETTINGS_PATH()), defaultSaveDir())
}

function folderRootPaths(): string[] {
  return [defaultSaveDir(), ...extraFolderRoots()]
}

function insideAnyRoot(path: string): boolean {
  return folderRootPaths().some((root) => isInsideRoot(root, path))
}

function isAnyRoot(path: string): boolean {
  const key = resolve(path)
  return folderRootPaths().some((root) => resolve(root) === key)
}

const pendingNewFileDir = new Map<string, { dir: string; setAt: number }>()
/** folder bound to a freshly created editor tab, keyed by its webContents id; consumed by the first save */
const pendingDirByWc = new Map<number, { dir: string; setAt: number }>()
/** a pending folder only applies to a file created within this window after the click */
const PENDING_DIR_TTL_MS = 30 * 60 * 1000

function rememberPendingDir(kind: string, opts?: NewFileOpts): void {
  const dir = opts?.dir
  if (!dir || resolve(dir) === resolve(defaultSaveDir()) || !insideAnyRoot(dir)) {
    pendingNewFileDir.delete(kind)
    return
  }
  pendingNewFileDir.set(kind, { dir, setAt: Date.now() })
}

/** the folder remembered for this kind, consumed; null when none, expired or gone */
function takePendingDir(kind: string): { dir: string; setAt: number } | null {
  const pending = pendingNewFileDir.get(kind)
  pendingNewFileDir.delete(kind)
  if (!pending) return null
  if (Date.now() - pending.setAt > PENDING_DIR_TTL_MS) return null
  return existsSync(pending.dir) ? pending : null
}

/** where a shell-created blank file (sheet, pdf) lands: the remembered folder, else the root */
function newFileDir(kind: string): string {
  return takePendingDir(kind)?.dir ?? defaultSaveDir()
}

/** hand the remembered folder to the tab that was just opened for it */
function bindPendingDir(kind: string, tabId: string | undefined): void {
  const pending = takePendingDir(kind)
  const wc = tabId ? tabManager?.webContentsForTab(tabId) : undefined
  if (pending && wc) pendingDirByWc.set(wc.id, pending)
}

/**
 * A tab's file first hit disk (silent first save, Save As, or an open): if a
 * folder is bound to that tab and the file is a fresh one in the root, move
 * it there. A pre-existing file opened in the tab never qualifies: its birth
 * time (or, where the filesystem reports none, its mtime) predates the click.
 */
/** 会话停靠文档的所属项目(按 webContents 记):文件首存时经
 *  applyPendingProject 落进项目 files[]——非文件夹项目(惰性建出的会话
 *  项目)没有目录可扫,必须显式登记 */
const pendingDockProjectByWc = new Map<number, string>()
const pendingNewFileProject = new Map<string, string>()

function applyPendingProject(filePath: string, wcId?: number): void {
  const ext = extname(filePath).slice(1).toLowerCase()
  let key: string | undefined
  if (ext === 'docx') key = 'doc'
  else if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xls' || ext === 'csv') key = 'sheet'
  else if (ext === 'pptx') key = 'slide'
  else if (ext === 'md' || ext === 'markdown') key = 'markdown'
  else if (ext === 'html' || ext === 'htm') key = 'html'
  else if (ext === 'pdf') key = 'pdf'
  // a conversation-docked editor's pending project wins over the tree flow's
  let projectId = wcId !== undefined ? pendingDockProjectByWc.get(wcId) : undefined
  if (wcId !== undefined && projectId) pendingDockProjectByWc.delete(wcId)
  if (!projectId) {
    if (!key) return
    projectId = pendingNewFileProject.get(key)
    if (!projectId) return
    pendingNewFileProject.delete(key)
  }
  try {
    const store = new ProjectStore(app.getPath('userData'))
    store.ensureDefaultProject()
    store.resolveProjectForFile(filePath) // assign to default first (idempotent)
    store.moveFileToProject(filePath, projectId)
  } catch (err) {
    console.warn('[shell] applyPendingProject failed:', err)
  }
}

function applyPendingDir(wcId: number, filePath: string): string {
  const pending = pendingDirByWc.get(wcId)
  if (!pending) return filePath
  if (Date.now() - pending.setAt > PENDING_DIR_TTL_MS) {
    pendingDirByWc.delete(wcId)
    return filePath
  }
  if (resolve(dirname(filePath)) !== resolve(defaultSaveDir())) return filePath
  try {
    const stat = statSync(filePath)
    const born = stat.birthtimeMs || stat.mtimeMs
    if (born < pending.setAt - 2000) return filePath
  } catch {
    return filePath
  }
  pendingDirByWc.delete(wcId)
  if (!existsSync(pending.dir)) return filePath
  // a clash with an existing name takes the "(2)" suffix rather than staying in the root
  const target = join(pending.dir, uniqueNameIn(pending.dir, basename(filePath)))
  try {
    renameSync(filePath, target)
  } catch (err) {
    console.warn('[shell] move new file into folder failed:', err)
    return filePath
  }
  afterFileMoved(filePath, target)
  return target
}

/**
 * Everything that keys on a file path follows a rename/move: recents, stars,
 * the AI chat history (project-store), the slides start-screen list and any
 * open tab (which re-grants the new path and refreshes its title).
 */
function afterFileMoved(oldPath: string, newPath: string): void {
  replaceRecentFile(oldPath, newPath)
  projectFileRenamed(oldPath, newPath)
  if (/\.pptx$/i.test(newPath)) void replaceSlidesRecentFile(oldPath, newPath)
  const affected = tabManager?.renameTabFile(oldPath, newPath) ?? []
  const detachedAffected = detachedRenameFile(oldPath, newPath)
  if (detachedAffected) affected.push(detachedAffected)
  for (const t of affected) {
    if (t.kind === 'slides') slidesFileRenamed(t.webContents, oldPath, newPath)
    else if (t.kind === 'docs') docsFileRenamed(t.webContents, oldPath, newPath)
    else if (t.kind === 'sheets') sheetsFileRenamed(t.webContents, oldPath, newPath)
    else if (t.kind === 'markdown') markdownFileRenamed(t.webContents, oldPath, newPath)
    else if (t.kind === 'html') htmlFileRenamed(t.webContents, oldPath, newPath)
    else if (t.kind === 'pdf') pdfFileRenamed(t.webContents, oldPath, newPath)
  }
}

function trackedFilesUnder(dir: string): string[] {
  return pathsUnder(dir, [
    ...readRecentFiles(),
    ...readStarredFiles(),
    ...projectFilePaths(),
    ...readSlidesRecentFiles(),
    ...(tabManager?.openFilePaths() ?? []),
    ...detachedFilePaths(),
  ])
}

/** a folder moved/renamed: re-key every tracked file that lived under it */
function afterFolderMoved(oldDir: string, newDir: string, filesBefore: readonly string[]): void {
  for (const file of filesBefore) afterFileMoved(file, rebasePath(file, oldDir, newDir))
}

const folderWatchers = new Map<string, FolderWatcher>()

let fileIndexStore: FileIndexStore | null = null
let fileIndexer: FileIndexer | null = null
let searchReranker: SearchReranker | null = null

function readFileSearchSettings(): FileSearchSettings {
  return normalizeFileSearchSettings(readAppSettings(APP_SETTINGS_PATH()).fileSearch)
}

/** the search index lives in userData and follows the save folder plus recents/starred */
function ensureFileIndexer(): FileIndexer | null {
  if (fileIndexer) return fileIndexer
  try {
    fileIndexStore = new FileIndexStore(join(app.getPath('userData'), 'file-index.db'))
  } catch (e) {
    console.warn('[file-index] unavailable:', e instanceof Error ? e.message : e)
    return null
  }
  fileIndexer = new FileIndexer(fileIndexStore, extractWorkerPath, {
    roots: () => folderRootPaths().filter((root) => existsSync(root)),
    extraPaths: () => [...readRecentFiles(), ...readStarredFiles()],
  })
  return fileIndexer
}

const SEARCH_EXT_FAMILY: Record<string, readonly string[]> = {
  docx: ['docx', 'doc'],
  xlsx: ['xlsx', 'xlsm', 'xls', 'csv'],
  pptx: ['pptx', 'ppt'],
  md: ['md', 'markdown'],
  html: ['html', 'htm'],
}

/** one recursive watcher per tree root; follows the save-folder setting and the added folders */
function ensureFolderWatchers(): void {
  const wanted = new Set(folderRootPaths().filter((root) => existsSync(root)))
  for (const [root, watcher] of folderWatchers) {
    if (wanted.has(root) && watcher.active) continue
    watcher.close()
    folderWatchers.delete(root)
  }
  for (const root of wanted) {
    if (folderWatchers.has(root)) continue
    const watcher = new FolderWatcher(root, (dirs) => {
      fileIndexer?.refresh()
      for (const wc of webContents.getAllWebContents()) {
        if (!wc.isDestroyed()) wc.send(HOME_CHANNELS.folderChanged, dirs)
      }
    })
    folderWatchers.set(root, watcher)
  }
}

/**
 * P4: when the pending "create from project" target is a FOLDER project, its
 * root wins over the global default save dir for kinds that materialize on
 * disk immediately (sheets/pdf). Document kinds still save through their own
 * editor flow and join the project logically via applyPendingProject.
 */
function pendingProjectSaveDir(kind: 'doc' | 'sheet' | 'slide' | 'markdown' | 'pdf'): string {
  const projectId = pendingNewFileProject.get(kind)
  if (projectId) {
    try {
      const store = new ProjectStore(app.getPath('userData'))
      const root = store.projectRootPath(projectId)
      if (root && existsSync(root)) return root
    } catch {
      // unreadable store: fall back to the global default
    }
  }
  return defaultSaveDir()
}

function applyMenuFor(kind: TabKind): void {
  lastAppliedMenuKind = kind
  switch (kind) {
    case 'docs':
      buildDocsMenu()
      break
    case 'sheets':
      installSheetsMenu()
      break
    case 'slides':
      installSlidesMenu()
      break
    case 'pdf':
      buildPdfMenu()
      break
    case 'markdown':
      buildMarkdownMenu()
      break
    case 'html':
      buildHtmlMenu()
      break
    default:
      buildHomeMenu()
  }
}

function refreshTitleBarOverlay(): void {
  // adapted（上游 e42da7c7）:本地窗口方案=全平台 titleBarStyle hidden+TabBar 自绘三键
  // （WINDOW_CHANNELS），不启用 titleBarOverlay;在未启用 overlay 的窗口上调用
  // setTitleBarOverlay 会抛错,所以这里保持 no-op
  if (!shellWindow || shellWindow.isDestroyed()) return
  try {
    shellWindow.setTitleBarOverlay(tabStripOverlay(nativeTheme.shouldUseDarkColors))
  } catch {
    /* no overlay on this window — the local tab strip draws its own controls */
  }
}

function createShellWindow(): void {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 600,
    title: '察元AIOffice',
    icon: APP_ICON,
    // 全平台隐藏系统标题栏（自绘最小化/最大化/关闭：mac 左侧、win 右侧，位于 tab 条内）
    titleBarStyle: 'hidden' as const,
    autoHideMenuBar: true,
    // vibrancy: editor modules punch translucent regions (e.g. the slides
    // thumbnail pane) through to the desktop
    ...(process.platform === 'darwin' ? { vibrancy: 'sidebar' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  shellWindow = win
  nativeTheme.on('updated', refreshTitleBarOverlay)
  win.once('closed', () => nativeTheme.off('updated', refreshTitleBarOverlay))
  // dragging the window by the tab strip's blank (draggable) area produces no
  // DOM event anywhere — will-move is the only signal to dismiss popovers
  win.on('will-move', () => broadcastChromePressed())
  // A detached editor window claims the process-global menu/active-editor targets
  // while focused; take them back when the shell window regains focus. Keyboard
  // focus must land back on the active tab's view too — regaining window focus
  // gives it to the chrome webContents, leaving typing dead in the document.
  win.on('focus', () => {
    tabManager?.refreshActiveTargets()
    tabManager?.focusActiveView()
  })

  const manager = new TabManager(
    win,
    () => {
      if (win.webContents.isDestroyed()) return
      win.webContents.send(TABS_CHANNELS.changed, manager.list())
      win.webContents.send(DOCK_CHANNELS.changed, manager.dockedTabs())
      publishOpenDocumentsIfOwner([...manager.openFilePaths(), ...detachedFilePaths()])
    },
    applyMenuFor,
    // no extension: these tabs have no file on disk yet; the title becomes the
    // real filename (the localized untitled default + .docx etc.) once the first save lands
    (kind) =>
      kind === 'docs'
        ? tm('untitledDoc')
        : kind === 'slides'
          ? tm('untitledDeck')
          : kind === 'markdown'
            ? tm('untitledMarkdown')
            : kind === 'html'
              ? tm('untitledHtml')
              : tm('untitledSheet'),
  )
  tabManager = manager

  // pushRecent-triggered docs menu rebuilds must not clobber the active tab's
  // menu; a focused detached docs window owns the menu just like an active tab
  setDocsMenuGate(
    () =>
      focusedDetachedKind() === 'docs' || manager.list().some((t) => t.active && t.kind === 'docs'),
  )

  setDocsShellWindow(win)
  setSheetsShellWindow(win)
  setDocsHostWindowHook((wc) => detachedWindowForWebContents(wc.id))
  setSheetsHostWindowHook((wc) => detachedWindowForWebContents(wc.id))
  setSlidesShellWindow(win)
  setSlidesShowBleed((wc, on) => manager.setContentBleed(wc, on))
  setHtmlPresentHooks({
    setBleed: (wc, on) => manager.setContentBleed(wc, on),
    hostWindow: () => win,
    openTab: (owner, title) => {
      manager.openHtmlPresentTab(owner, title)
      return true
    },
    closeTab: (wc) => {
      const id = manager.tabIdForWebContents(wc.id)
      if (id) void manager.closeTab(id)
      return !!id
    },
  })
  // A detached docs/sheets window can outlive the shell window; its hooks must
  // then reach the live tab manager (recreating the shell), never this closure's.
  setDocsShellHooks({
    openTab: (openPath, options) => ensureTabManager().openDocsTab(openPath, options),
    openAiDocTab: (content) =>
      ensureTabManager().openDocsTab(undefined, { newBlank: true, aiContent: content }),
    // P1 停靠契约: home-chat create_document lands in the Home right pane —
    // untitled blank docs tab seeded with the AI content, panel hidden
    openAiDockTab: (content, saveDir, projectId) => {
      try {
        const id = manager.dockEditorTab('docs', {
          newBlank: true,
          aiContent: content,
          hidePanel: true,
        })
        if (id) {
          const wcId = manager.webContentsIdOf(id)
          if (wcId && saveDir) queueDocsSaveDir(wcId, saveDir)
          // 会话产物:文件首存时登记进会话项目(非文件夹项目无目录可扫)
          if (wcId && projectId) pendingDockProjectByWc.set(wcId, projectId)
        }
        return id !== null
      } catch (err) {
        console.error('[shell] ai dock tab failed:', err)
        return false
      }
    },
    openMarkdownDockTab: (content, suggestedName, saveDir, projectId) => {
      try {
        const id = manager.dockMarkdownWithContent(content, suggestedName)
        if (id) {
          const wcId = manager.webContentsIdOf(id)
          if (wcId && saveDir) queueDocsSaveDir(wcId, saveDir)
          if (wcId && projectId) pendingDockProjectByWc.set(wcId, projectId)
        }
        return true
      } catch (err) {
        console.error('[shell] markdown dock tab failed:', err)
        return false
      }
    },
    // P2-7② 停靠者建的新文档落同一右栏(docs-main createDocument 据此补 dock)
    isDockedWebContents: (wcId) => {
      const tabId = manager.tabIdForWebContents(wcId)
      return !!tabId && !!manager.list().find((t) => t.id === tabId)?.docked
    },
    listTabs: () =>
      (tabManager?.list() ?? [])
        .filter((t) => t.kind === 'docs')
        .map((t) => ({ id: t.id, title: t.title, focused: t.active })),
    focusTab: (id) => tabManager?.activateTab(id),
    // ⌘W in a detached docs window closes that window (its own close guard runs)
    closeActiveTab: () => {
      const focused = BrowserWindow.getFocusedWindow()
      if (focused && focused !== win) focused.close()
      else tabManager?.closeActiveTab()
    },
    openGeneratedPath: (path) => openGeneratedDocument(path),
    openUntitledPdf: (bytes, suggestedName, saveDir) => {
      // AI-created PDF as a hidden temp-backed untitled document: the AI title
      // only prefills the first save — nothing lands on disk until then.
      try {
        mkdirSync(blankDraftsDir(), { recursive: true })
        const tempPath = uniquePathIn(blankDraftsDir(), `ai-${randomUUID()}.pdf`)
        writeFileSync(tempPath, bytes)
        const pdfDir = saveDir ?? defaultSaveDir()
        markPdfUntitledPath(tempPath, { defaultDir: pdfDir, suggestedName })
        registerPendingUntitled({
          kind: 'pdf',
          tempPath,
          suggestedName,
          defaultDir: pdfDir,
        })
        manager.openPdfTab(tempPath, { untitledTitle: suggestedName })
        return true
      } catch (err) {
        console.warn('[shell] untitled pdf tab open failed:', err)
        return false
      }
    },
    openUntitledMarkdown: (content, suggestedName) => {
      // AI-created Markdown as an untitled tab carrying the content in memory.
      try {
        manager.openMarkdownTabWithContent(content, suggestedName)
        return true
      } catch (err) {
        console.warn('[shell] untitled markdown tab open failed:', err)
        return false
      }
    },
    openUntitledHtml: (content, suggestedName) => {
      // AI-created HTML as an untitled tab carrying the content in memory.
      try {
        manager.openHtmlTabWithContent(content, suggestedName)
        return true
      } catch (err) {
        console.warn('[shell] untitled html tab open failed:', err)
        return false
      }
    },
  })
  setSheetsCloseTabHook(() => {
    const focused = BrowserWindow.getFocusedWindow()
    if (focused && focused !== win) focused.close()
    else tabManager?.closeActiveTab()
  })
  // ⌘W targets the focused window: in a detached slides editor window it closes
  // that window (running its own close guard), not the shell's active tab
  setSlidesCloseTabHook(() => {
    const focused = BrowserWindow.getFocusedWindow()
    if (focused && focused !== win) focused.close()
    else manager.closeActiveTab()
  })
  // When ⌘O opens a file inside a tab, sync the tab title/path (used for de-dup by path) and record it as recent.
  // The first save / save-as fires this too, so applyPendingProject also runs here.
  setSheetsWorkbookOpenedHook((wc, path, fromBlankDraft) => {
    // A blank draft's first save just made it a real file: drop its registry entry.
    if (fromBlankDraft) removePendingUntitled(fromBlankDraft)
    manager.setTabFileFor(wc.id, path)
    detachedSetFileFor(wc.id, path)
    recordRecentFile(path)
  })
  // Hidden temp-backed blank workbook materialized: track it so a crash before
  // the first save can offer the content back on the next launch.
  setSheetsBlankDraftHook((_wc, tempPath, saveDir) => {
    registerPendingUntitled({ kind: 'sheet', tempPath, defaultDir: saveDir })
  })
  setSlidesOpenedHook((wc, path) => {
    manager.setTabFileFor(wc.id, path)
    recordRecentFile(path)
    applyPendingDir(wc.id, path)
  })
  // docs' save-as / silent first save lands on a new path → sync the tab title too
  setDocsFileSavedHook((wc, path) => {
    manager.setTabFileFor(wc.id, path)
    detachedSetFileFor(wc.id, path)
    recordRecentFile(path)
    applyPendingProject(path, wc.id)
    applyPendingDir(wc.id, path)
  })
  // ⌘O / open-path inside a docs tab: sync the tab title immediately, same
  // contract as the sheets/slides opened hooks (a plain save to the original
  // path never renames the tab, so the open must — r115)
  setDocsFileOpenedHook((wcId, path) => {
    manager.setTabFileFor(wcId, path)
    detachedSetFileFor(wcId, path)
    recordRecentFile(path)
    applyPendingDir(wcId, path)
  })
  // markdown untitled first save / Save As lands on a new path
  setMarkdownFileSavedHook((wc, path) => {
    manager.setTabFileFor(wc.id, path)
    recordRecentFile(path)
    applyPendingProject(path, wc.id)
    applyPendingDir(wc.id, path)
  })
  setHtmlFileSavedHook((wc, path) => {
    manager.setTabFileFor(wc.id, path)
    recordRecentFile(path)
    applyPendingProject(path, wc.id)
    applyPendingDir(wc.id, path)
  })
  setHtmlProvisionalTitleHook((wc, title) => manager.setTabTitleFor(wc.id, title))
  // pdf content-derived auto-rename: the file moved on disk, follow it everywhere
  setPdfRenamedHook((wc, oldPath, newPath) => {
    // An untitled document's first save landed: drop its registry entry.
    removePendingUntitled(oldPath)
    manager.setTabFileFor(wc.id, newPath)
    replaceRecentFile(oldPath, newPath)
    projectFileRenamed(oldPath, newPath)
  })
  // markdown "convert & open in Docs" → route the fresh .docx to a docs tab
  setMarkdownDocxExportedHook((path) => {
    openDocumentPath(path)
  })
  // Word export to a path already open in a docs tab: close that tab before the file is
  // written (its unsaved-changes prompt applies, and a later save of the stale document
  // could otherwise overwrite the export); a cancelled close aborts the export.
  setHtmlDocxExportPrepareHook(async (path) => {
    const stale = manager.findDocsTabByPath(path)
    if (!stale) return true
    const active = manager.list().find((t) => t.active)?.id
    await manager.closeTab(stale)
    if (active && active !== stale) manager.activateTab(active)
    return !manager.findDocsTabByPath(path)
  })
  setHtmlDocxExportedHook((path) => {
    openDocumentPath(path)
  })

  // Closing the whole window walks every dirty sheets/pdf/slides/docs tab through
  // the same save/don't-save/cancel prompt; any cancel aborts the close.
  // docs dirtiness lives renderer-side, so any live docs tab forces the async path
  // and gets queried there (clean tabs pass through without activation).
  let closeConfirmed = false
  win.on('close', (event) => {
    if (closeConfirmed) return
    const dirtySheets = manager.dirtySheetsTabs()
    const dirtyPdf = manager.dirtyPdfTabs()
    const dirtyMarkdown = manager.dirtyMarkdownTabs()
    const dirtyHtml = manager.dirtyHtmlTabs()
    const dirtySlides = manager.dirtySlidesTabs()
    const docsTabs = manager.docsTabs()
    if (
      dirtySheets.length === 0 &&
      dirtyPdf.length === 0 &&
      dirtyMarkdown.length === 0 &&
      dirtyHtml.length === 0 &&
      dirtySlides.length === 0 &&
      docsTabs.length === 0
    )
      return
    event.preventDefault()
    void (async () => {
      for (const tab of dirtySheets) {
        manager.activateTab(tab.id)
        if (!(await requestSheetsClose(tab.webContents, win))) return
      }
      for (const tab of dirtyPdf) {
        manager.activateTab(tab.id)
        if (!(await requestPdfClose(tab.webContents, win))) return
      }
      for (const tab of dirtyMarkdown) {
        manager.activateTab(tab.id)
        if (!(await requestMarkdownClose(tab.webContents, win))) return
      }
      for (const tab of dirtyHtml) {
        manager.activateTab(tab.id)
        if (!(await requestHtmlClose(tab.webContents, win))) return
      }
      for (const tab of dirtySlides) {
        manager.activateTab(tab.id)
        if (!(await requestSlidesClose(tab.webContents, win))) return
      }
      for (const tab of docsTabs) {
        if (!(await docsQueryDirty(tab.webContents))) continue
        manager.activateTab(tab.id)
        if (!(await requestDocsClose(tab.webContents, win))) return
      }
      closeConfirmed = true
      if (!win.isDestroyed()) win.close()
    })()
  })

  win.on('closed', () => {
    if (shellWindow === win) shellWindow = null
    if (tabManager === manager) {
      tabManager = null
      publishAllOpenDocuments()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---- routing: one dispatch function for every open path ----

const DOCX_RE = /\.docx$/i
const XLSX_RE = /\.(xlsx|xlsm|xls|csv)$/i
const PPTX_RE = /\.pptx$/i
const PDF_RE = /\.pdf$/i
const MD_RE = /\.(md|markdown)$/i
const HTML_RE = /\.html?$/i

/** document formats we recognize but don't open — surfaced as a dialog, not silently dropped */
const UNSUPPORTED_DOC_RE = /\.(doc|rtf|odt|ppt|pps|odp|ods|xlsb|pages|key|numbers)$/i

/**
 * Single source of truth for the open-dialog filter. Includes the
 * legacy .doc/.ppt binaries so they are selectable and surface the explicit
 * "not supported" dialog via openDocumentPath instead of being grayed out.
 */
const OPEN_DIALOG_EXTENSIONS = [
  'docx',
  'doc',
  'xlsx',
  'xlsm',
  'xls',
  'csv',
  'pptx',
  'ppt',
  'pdf',
  'md',
  'markdown',
  'html',
  'htm',
]

function supportedFileIn(argv: string[]): string | null {
  return (
    argv.find(
      (arg) =>
        (DOCX_RE.test(arg) ||
          XLSX_RE.test(arg) ||
          PPTX_RE.test(arg) ||
          PDF_RE.test(arg) ||
          MD_RE.test(arg) ||
          HTML_RE.test(arg)) &&
        existsSync(arg),
    ) ?? null
  )
}

function unsupportedFileIn(argv: string[]): string | null {
  return argv.find((arg) => UNSUPPORTED_DOC_RE.test(arg) && existsSync(arg)) ?? null
}

function notifyUnsupportedFile(filePath: string): void {
  const ext = extname(filePath).slice(1).toLowerCase() || basename(filePath)
  showAppWarning(tm('errUnsupportedExt', { ext }))
}

/** shell-hosted warning box; focused when a shell window exists, standalone otherwise */
function showAppWarning(message: string): void {
  const options = { type: 'warning' as const, message }
  if (shellWindow) {
    shellWindow.show()
    shellWindow.focus()
    void dialog.showMessageBox(shellWindow, options)
  } else {
    void dialog.showMessageBox(options)
  }
}

/**
 * Files dropped from the OS into any renderer arrive via installDropOpenBridge
 * and route through the normal File > Open pipeline; detached editor windows
 * can host the drop target, so the shell must reveal itself after opening.
 */
const droppedFilesDeps = () => ({
  openDocumentPath,
  revealShellWindow,
  showWarning: showAppWarning,
  unsupportedMessage: (exts: string[]) => tm('errUnsupportedExt', { ext: exts.join(', ') }),
})

function registerDroppedFilesIpc(): void {
  ipcMain.on(DROP_OPEN_CHANNEL, (_event, raw: unknown) =>
    handleDroppedFiles(raw, droppedFilesDeps()),
  )
}

/** the single router: extension decides which module owns the file; false = nothing opened */
function openDocumentPath(filePath: string): boolean {
  const opened = routeDocumentPath(filePath)
  if (opened) {
    recordStarPromptDocOpen()
    // extension only — never the file name or path
    analytics.track('file_open', { ext: extname(filePath).slice(1).toLowerCase() })
  }
  return opened
}

/**
 * Open a just-written export. Unlike File > Open, an already-open PDF tab is
 * reloaded from disk so a re-export to the same path shows the new bytes
 * instead of the previous in-memory document (which may also hold unsaved
 * annotations). In-memory edits on that tab are discarded — Save would
 * overwrite the file we just exported.
 */
function openGeneratedDocument(filePath: string): boolean {
  if (tabManager && PDF_RE.test(filePath)) {
    const existing = tabManager.findPdfTabByPath(filePath)
    if (existing) {
      tabManager.reloadTab(existing)
      tabManager.activateTab(existing)
      return true
    }
  }
  return openDocumentPath(filePath)
}

function routeDocumentPath(filePath: string, dock = false): boolean {
  if (!existsSync(filePath)) return false
  // a detached editor window already shows this file — focus it, never a second copy
  if (focusDetachedByPath(filePath)) return true
  if (!tabManager) return false
  // P1 停靠契约 (dock=true, home-chat open_document): the file docks into the
  // Home right pane. An already-open tab of any placement wins (its editor
  // holds the live document); otherwise a docked tab is created per kind.
  if (dock) {
    if (DOCX_RE.test(filePath)) {
      recordRecentFile(filePath)
      const existing = tabManager.findDocsTabByPath(filePath)
      if (existing) {
        tabManager.activateDocumentTab(existing)
      } else {
        tabManager.dockEditorTab('docs', { file: filePath, hidePanel: true })
      }
      return true
    }
    if (XLSX_RE.test(filePath)) {
      recordRecentFile(filePath)
      const existing = tabManager.findSheetsTabByPath(filePath)
      if (existing) {
        tabManager.activateDocumentTab(existing)
      } else {
        tabManager.dockEditorTab('sheets', { file: filePath })
      }
      return true
    }
    if (PPTX_RE.test(filePath)) {
      recordRecentFile(filePath)
      const existing = tabManager.findSlidesTabByPath(filePath)
      if (existing) {
        tabManager.activateDocumentTab(existing)
      } else {
        tabManager.dockEditorTab('slides', { file: filePath })
      }
      return true
    }
    if (PDF_RE.test(filePath)) {
      recordRecentFile(filePath)
      const existing = tabManager.findPdfTabByPath(filePath)
      if (existing) {
        tabManager.activateDocumentTab(existing)
      } else {
        tabManager.dockEditorTab('pdf', { file: filePath })
      }
      return true
    }
    if (MD_RE.test(filePath)) {
      recordRecentFile(filePath)
      const existing = tabManager.findMarkdownTabByPath(filePath)
      if (existing) {
        tabManager.activateDocumentTab(existing)
      } else {
        tabManager.dockEditorTab('markdown', { file: filePath })
      }
      return true
    }
    if (HTML_RE.test(filePath)) {
      recordRecentFile(filePath)
      const existing = tabManager.findHtmlTabByPath(filePath)
      if (existing) {
        tabManager.activateDocumentTab(existing)
      } else {
        tabManager.dockEditorTab('html', { file: filePath })
      }
      return true
    }
    notifyUnsupportedFile(filePath)
    return false
  }
  if (DOCX_RE.test(filePath)) {
    recordRecentFile(filePath)
    const existing = tabManager.findDocsTabByPath(filePath)
    if (existing) tabManager.activateTab(existing)
    else tabManager.openDocsTab(filePath)
    return true
  }
  if (XLSX_RE.test(filePath)) {
    recordRecentFile(filePath)
    const existing = tabManager.findSheetsTabByPath(filePath)
    if (existing) {
      tabManager.activateTab(existing)
    } else {
      tabManager.openSheetsTab(filePath)
      startQueuedWorkbookNudge()
    }
    return true
  }
  if (PPTX_RE.test(filePath)) {
    recordRecentFile(filePath)
    const existing = tabManager.findSlidesTabByPath(filePath)
    if (existing) {
      tabManager.activateTab(existing)
    } else {
      // For a new tab the path goes through the pending queue; the renderer consumes it after mounting
      tabManager.openSlidesTab(filePath)
    }
    return true
  }
  if (PDF_RE.test(filePath)) {
    recordRecentFile(filePath)
    const existing = tabManager.findPdfTabByPath(filePath)
    if (existing) tabManager.activateTab(existing)
    else tabManager.openPdfTab(filePath)
    return true
  }
  if (MD_RE.test(filePath)) {
    recordRecentFile(filePath)
    const existing = tabManager.findMarkdownTabByPath(filePath)
    if (existing) tabManager.activateTab(existing)
    else tabManager.openMarkdownTab(filePath)
    return true
  }
  if (HTML_RE.test(filePath)) {
    recordRecentFile(filePath)
    const existing = tabManager.findHtmlTabByPath(filePath)
    if (existing) tabManager.activateTab(existing)
    else tabManager.openHtmlTab(filePath)
    return true
  }
  notifyUnsupportedFile(filePath)
  return false
}

// ── Pending-unsaved registry (Home startup restore banner) ──
// Untitled temp-backed documents (new sheet/pdf, AI-generated pdf) are tracked
// here so a crash before the first save can offer the content back. The
// recovery copies themselves live in each module's hidden recovery area; an
// entry is restorable only while both its temp backing file and the module's
// recovery copy still exist (a closed-unsaved tab leaves the temp deleted, and
// the entry is dropped lazily on the next list).
interface PendingUntitledDoc {
  kind: 'sheet' | 'pdf'
  tempPath: string
  suggestedName?: string
  defaultDir: string
  savedAt: number
}

const pendingUntitledPath = () => join(app.getPath('userData'), 'pending-untitled.json')

function loadPendingUntitled(): Map<string, PendingUntitledDoc> {
  try {
    const raw = JSON.parse(readFileSync(pendingUntitledPath(), 'utf-8')) as PendingUntitledDoc[]
    return new Map(raw.map((doc) => [doc.tempPath, doc]))
  } catch {
    return new Map()
  }
}

const pendingUntitledDocs = loadPendingUntitled()

function persistPendingUntitled(): void {
  try {
    writeFileSync(pendingUntitledPath(), JSON.stringify([...pendingUntitledDocs.values()]))
  } catch (err) {
    console.warn('[shell] pending-untitled persist failed:', err)
  }
}

function registerPendingUntitled(doc: Omit<PendingUntitledDoc, 'savedAt'>): void {
  pendingUntitledDocs.set(doc.tempPath, { ...doc, savedAt: Date.now() })
  persistPendingUntitled()
}

function removePendingUntitled(tempPath: string): void {
  if (pendingUntitledDocs.delete(tempPath)) persistPendingUntitled()
}

/**
 * "New spreadsheet" opens a hidden temp-backed blank workbook session — nothing
 * lands in the user's project folder at creation. The user-visible file is only
 * written when they first save, which routes through Save As prefilled with the
 * pending project folder and the untitled name (sheets-main's blank-draft flow).
 */
async function newSheetTab(): Promise<void> {
  try {
    tabManager?.openSheetsTab(undefined, {
      newBlank: true,
      newBlankSaveDir: pendingProjectSaveDir('sheet'),
      newBlankName: tm('untitledSheet'),
    })
    recordStarPromptDocOpen()
    analytics.track('file_new', { kind: 'xlsx' })
  } catch (err) {
    surfaceNewTabError(err)
  }
}

/**
 * A throw anywhere in the create-tab path (view creation, sidecar resolution,
 * renderer load) used to be swallowed by `void`-ed promises and ipc-invoke
 * rejections, so the click looked like a pure no-op — the exact "AI Sheets /
 * AI Slides do nothing" alpha report. Surface the failure instead.
 */
function surfaceNewTabError(err: unknown): void {
  console.error('[shell] new tab failed:', err)
  showErrorDialog(shellWindow, tm('errNewTabFailed'), err)
}

function newDocTab(): void {
  try {
    bindPendingDir('doc', tabManager?.openDocsTab(undefined, { newBlank: true }))
    // creating a document is as much a value moment as opening one
    recordStarPromptDocOpen()
    analytics.track('file_new', { kind: 'docx' })
  } catch (err) {
    surfaceNewTabError(err)
  }
}

/** MCP: open a blank docs tab and return its webContents id, for the visible-editor bridge */
function openBlankDocsTabForMcp(): number {
  if (!tabManager) throw new Error('察元AIOffice is not ready')
  const tabId = tabManager.openDocsTab(undefined, { newBlank: true })
  const view = tabManager.docsTabs().find((t) => t.id === tabId)
  if (!view) throw new Error('the new document tab could not be opened')
  recordStarPromptDocOpen()
  analytics.track('file_new', { kind: 'docx' })
  return view.webContents.id
}

/**
 * MCP: open a blank sheets tab and return its webContents id, for the
 * visible-grid bridge. Like the app's own "new spreadsheet", a real blank
 * .xlsx is created up front (the save pipeline needs an on-disk workbook;
 * the fallback in-memory demo grid cannot save) — but the AI auto-rename
 * marking is skipped, the file name is the agent's business.
 */
async function openBlankSheetsTabForMcp(): Promise<number> {
  if (!tabManager) throw new Error('ChaAI Office is not ready')
  const filePath = uniquePathIn(defaultSaveDir(), `${tm('untitledSheet')}.xlsx`)
  writeFileSync(filePath, await blankXlsxBuffer())
  const tabId = tabManager.openSheetsTab(filePath)
  const view = tabManager.sheetsTabs().find((t) => t.id === tabId)
  if (!view) {
    // the tab never appeared, so nothing will ever consume this file
    try {
      rmSync(filePath)
    } catch (error) {
      console.warn('[mcp] could not remove the unused blank workbook:', error)
    }
    throw new Error('the new spreadsheet tab could not be opened')
  }
  const wcId = view.webContents.id
  mcpBlankSheetPaths.set(wcId, filePath)
  view.webContents.once('destroyed', () => mcpBlankSheetPaths.delete(wcId))
  // Same nudge the interactive path uses: the renderer subscribes to the open
  // action only after Univer mounts, so a single push can land in the void on a
  // cold start and leave the tab sitting on a blank in-memory workbook.
  startQueuedWorkbookNudge()
  recordStarPromptDocOpen()
  analytics.track('file_new', { kind: 'xlsx' })
  return view.webContents.id
}

/** backing files of blank sheets tabs created by the MCP session tools */
const mcpBlankSheetPaths = new Map<number, string>()

/**
 * MCP: drop a blank sheets tab whose session never became ready, and delete the
 * empty workbook created for it. Without this a failed `create_session` leaves
 * an orphan tab plus an .xlsx in the default save folder that the user never
 * asked for — and nothing in the MCP surface can clean either one up.
 */
function abandonBlankSheetsTabForMcp(wcId: number): void {
  const manager = tabManager
  const filePath = mcpBlankSheetPaths.get(wcId)
  mcpBlankSheetPaths.delete(wcId)
  if (!manager) return
  // the grid may already be usable while the MCP bridge is not: keep anything the user typed
  if (manager.dirtySheetsTabs().some((t) => t.webContents.id === wcId)) return
  if (!abandonBlankTabForMcp(manager.sheetsTabs(), wcId)) return
  if (!filePath) return
  try {
    if (existsSync(filePath)) rmSync(filePath)
  } catch (error) {
    console.warn('[mcp] could not remove the unused blank workbook:', error)
  }
}

/**
 * MCP: close a tab whose session never became ready. Returns false when the
 * tab could not be closed (it is already gone, or the close failed).
 */
function abandonBlankTabForMcp(
  tabs: Array<{ id: string; webContents: WebContents }>,
  wcId: number,
): boolean {
  const tab = tabs.find((t) => t.webContents.id === wcId)
  if (!tab || !tabManager) return false
  try {
    return tabManager.closeTabWithoutPrompt(tab.id)
  } catch (error) {
    console.warn('[mcp] could not close the unused tab:', error)
    return false
  }
}

/** MCP: open a blank slides tab and return its webContents id, for the visible-deck bridge */
function openBlankSlidesTabForMcp(): number {
  if (!tabManager) throw new Error('ChaAI Office is not ready')
  const tabId = tabManager.openSlidesTab()
  const view = tabManager.slidesTabs().find((t) => t.id === tabId)
  if (!view) throw new Error('the new presentation tab could not be opened')
  recordStarPromptDocOpen()
  analytics.track('file_new', { kind: 'pptx' })
  return view.webContents.id
}

function newSlideTab(): void {
  try {
    bindPendingDir('slide', tabManager?.openSlidesTab())
    recordStarPromptDocOpen()
    analytics.track('file_new', { kind: 'pptx' })
  } catch (err) {
    surfaceNewTabError(err)
  }
}

function newMarkdownTab(): void {
  try {
    bindPendingDir('markdown', tabManager?.openMarkdownTab())
    recordStarPromptDocOpen()
    analytics.track('file_new', { kind: 'md' })
  } catch (err) {
    surfaceNewTabError(err)
  }
}

function newHtmlTab(): void {
  try {
    bindPendingDir('html', tabManager?.openHtmlTab())
    recordStarPromptDocOpen()
    analytics.track('file_new', { kind: 'html' })
  } catch (err) {
    surfaceNewTabError(err)
  }
}

/**
 * "New PDF" opens a hidden temp-backed untitled document — nothing lands in the
 * user's project folder at creation. The user-visible PDF is only written when
 * they first save, which routes through Save As (pdf-main's untitled flow).
 */
async function newPdfTab(): Promise<void> {
  try {
    mkdirSync(blankDraftsDir(), { recursive: true })
    const tempPath = uniquePathIn(blankDraftsDir(), `blank-${randomUUID()}.pdf`)
    writeFileSync(tempPath, await blankPdfBuffer())
    markPdfUntitledPath(tempPath, { defaultDir: pendingProjectSaveDir('pdf') })
    registerPendingUntitled({ kind: 'pdf', tempPath, defaultDir: pendingProjectSaveDir('pdf') })
    // Direct tab open (not routeDocumentPath): a temp-backed untitled document
    // must not hit the recents list or claim a project — that happens at first save.
    tabManager?.openPdfTab(tempPath, { untitledTitle: tm('untitledPdf') })
    recordStarPromptDocOpen()
    analytics.track('file_new', { kind: 'pdf' })
  } catch (err) {
    surfaceNewTabError(err)
  }
}

/** Hidden working dir for untitled blank documents (never user-visible) */
function blankDraftsDir(): string {
  return join(app.getPath('temp'), 'chatoffice-blank-documents')
}

/**
 * The sheets renderer subscribes to menu actions only after Univer finishes
 * mounting (seconds on cold start), so a single 'open' can fire into the
 * void. Re-send until the queued workbook is consumed; consumption clears the
 * queue entry main-side (sheets-main), which stops the loop. The nudge only
 * reaches the active tab, so it gates on that tab's own queue entry —
 * background tabs from a multi-select Open pull their path themselves via the
 * renderer's has-queued-workbook poll.
 */
let workbookNudgeTimer: ReturnType<typeof setInterval> | null = null

function startQueuedWorkbookNudge(): void {
  if (workbookNudgeTimer) clearInterval(workbookNudgeTimer)
  const startedAt = Date.now()
  sendSheetsMenuAction('open')
  workbookNudgeTimer = setInterval(() => {
    if (
      !hasActiveQueuedWorkbook() ||
      Date.now() - startedAt > 30_000 ||
      !tabManager?.findSheetsTab()
    ) {
      if (workbookNudgeTimer) clearInterval(workbookNudgeTimer)
      workbookNudgeTimer = null
      return
    }
    sendSheetsMenuAction('open')
  }, 700)
}

// ---- home IPC ----

function statEntries(paths: string[]): RecentEntry[] {
  return statPathEntries(paths, new Set(readStarredFiles()))
}

// Remote storage (MinIO / OSS): the host lives in the embedded docs module so
// shell and docs share one instance, one settings file, one pending queue.
function registerRemoteFilesIpc(): void {
  const host = remoteFiles()
  bindRemoteFilesIpc(
    (channel, handler) => {
      ipcMain.handle(channel, (_event, payload: unknown) => handler(payload))
    },
    () => host,
  )
  // startup recovery: retry whatever auto-saves were stranded offline last run
  void host.queue.flush().catch((err: unknown) => {
    console.warn('[shell] remote save queue flush failed:', err)
  })
}

function registerHomeIpc(): void {
  // knowledge-base discovery + read surface: registered by docs-main's
  // registerAiIpc() (called above) exactly once for all window types —
  // a second registration here crashed the packaged app ("second handler
  // for 'kb:discover'"); the home composer and embedded editors share it.
  // signed-in means ChatOffice's own device-code login; the shared chatoffice CLI key
  // is only a silent fallback, deliberately not shown here to nudge users onto our key
  ipcMain.handle(HOME_CHANNELS.accountStatus, async () => {
    if (!loadChatofficeAuth()) return { loggedIn: false }
    await proxyBootstrap
    const info = await chatofficeLoginInfo()
    return info
      ? { loggedIn: true, email: info.email, creditBalance: info.creditBalance }
      : { loggedIn: true }
  })

  // login progress is streamed to the requesting renderer; the auth URL is
  // kept main-side so the "open manually" rescue never opens a renderer-supplied URL
  let pendingLoginUrl = ''
  ipcMain.handle(HOME_CHANNELS.accountLogin, async (event) => {
    analytics.track('login_click')
    const sender = event.sender
    pendingLoginUrl = ''
    await proxyBootstrap
    const send = (payload: AccountLoginEvent) => {
      if (!sender.isDestroyed()) sender.send(HOME_CHANNELS.accountLoginEvent, payload)
    }
    // open the browser on the first url event only; later events refresh the rescue URL
    let opened = false
    const launched = startChatofficeLogin((progress) => {
      if (progress.url) {
        pendingLoginUrl = progress.url
        if (!opened) {
          opened = true
          void shell.openExternal(progress.url)
        }
      }
      if (progress.phase === 'success') analytics.track('login_success')
      send(progress)
    })
    if (launched) send({ phase: 'launched' })
    return launched
  })

  ipcMain.handle(HOME_CHANNELS.accountLoginOpenUrl, () => {
    if (pendingLoginUrl) void shell.openExternal(pendingLoginUrl)
  })

  ipcMain.handle(HOME_CHANNELS.accountLogout, async () => {
    await chatofficeLogout()
    // the cloud projects cache belongs to the account that just signed out
    clearCloudProjectsStore(cloudProjectsStorePath())
  })

  // 版本号规范：设置页关于展示六段「自有版本.上游版本」（display-version 拼接）
  ipcMain.handle(HOME_CHANNELS.getAppVersion, (): string => displayVersion())

  // ── Feedback channel (aidooo.com): renderer CSP blocks cross-origin fetch,
  //    so probe/upload/submit are proxied here. Signing secret + app identity
  //    stay in main (src/main/feedback.ts, same endpoint as chayuan-wps).
  const feedbackClient = createFeedbackClient()
  ipcMain.handle(HOME_CHANNELS.feedbackProbe, (): Promise<boolean> => feedbackClient.probe())
  // 在线客服（察元机器人聊天页）：独立聊天窗加载 aidooo.com/bot/chat（同一聊天界面）。
  // 离线时主进程 loadURL 失败仅白窗——渲染层 handleFeedbackClick 已先 probe，离线走二维码卡片。
  ipcMain.handle(HOME_CHANNELS.openChat, () => {
    const chatWin = new BrowserWindow({
      width: 420,
      height: 660,
      minWidth: 320,
      minHeight: 480,
      title: '察元AI在线客服',
      autoHideMenuBar: true,
      backgroundColor: '#f7f8fa',
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    })
    void chatWin.loadURL('https://aidooo.com/bot/chat?embed=1&channel=office')
    return true
  })
  ipcMain.handle(
    HOME_CHANNELS.feedbackUpload,
    (_event, name: unknown, mime: unknown, data: unknown) => {
      if (typeof name !== 'string' || typeof mime !== 'string' || !(data instanceof Uint8Array)) {
        return Promise.resolve({ ok: false, error: 'bad_args' })
      }
      return feedbackClient.upload(name, mime, data)
    },
  )
  ipcMain.handle(HOME_CHANNELS.feedbackSubmit, (_event, payload: unknown) => {
    if (typeof payload !== 'object' || payload === null) {
      return Promise.resolve({ ok: false, error: 'bad_args' })
    }
    const p = payload as {
      mid?: unknown
      type?: unknown
      content?: unknown
      attachments?: unknown
      logJson?: unknown
      appVersion?: unknown
      os?: unknown
      osVer?: unknown
      arch?: unknown
    }
    if (typeof p.mid !== 'string' || typeof p.content !== 'string' || !p.content.trim()) {
      return Promise.resolve({ ok: false, error: 'bad_args' })
    }
    return feedbackClient.submit({
      mid: p.mid,
      type: typeof p.type === 'string' ? p.type : 'suggestion',
      content: p.content,
      attachments: Array.isArray(p.attachments)
        ? p.attachments.filter(
            (a): a is FeedbackAttachmentMeta =>
              typeof a === 'object' &&
              a !== null &&
              typeof a.name === 'string' &&
              typeof a.url === 'string',
          )
        : [],
      logJson: typeof p.logJson === 'string' ? p.logJson : '',
      appVersion: typeof p.appVersion === 'string' ? p.appVersion : undefined,
      os: typeof p.os === 'string' ? p.os : undefined,
      osVer: typeof p.osVer === 'string' ? p.osVer : undefined,
      arch: typeof p.arch === 'string' ? p.arch : undefined,
    })
  })

  ipcMain.handle(HOME_CHANNELS.recents, (_event, query: unknown): RecentPage =>
    pageRecentPaths(readRecentFiles(), query, new Set(readStarredFiles())),
  )

  ipcMain.handle(HOME_CHANNELS.searchFiles, (_event, raw: unknown): FileSearchPage => {
    const query = (raw && typeof raw === 'object' ? raw : {}) as Partial<FileSearchQuery>
    const indexer = ensureFileIndexer()
    if (!indexer || !fileIndexStore) {
      return { hits: [], total: 0, index: { indexed: 0, pending: 0, scanning: false } }
    }
    // an open search box is the moment a stale index shows; rescan at most once a minute
    indexer.refreshIfStale(60_000)
    const q = typeof query.q === 'string' ? query.q.trim().slice(0, 200) : ''
    const filter = typeof query.ext === 'string' ? query.ext : ''
    const exts = filter && filter !== 'all' ? (SEARCH_EXT_FAMILY[filter] ?? [filter]) : undefined
    const offset = Number.isFinite(query.offset) ? Math.max(0, Math.floor(query.offset!)) : 0
    const limit = Number.isFinite(query.limit) ? Math.max(0, Math.floor(query.limit!)) : 50
    const starred = new Set(readStarredFiles())
    const result = q ? fileIndexStore.search(q, { exts, offset, limit }) : { hits: [], total: 0 }
    return {
      hits: result.hits.map((h) => ({ ...h, starred: starred.has(h.path) })),
      total: result.total,
      index: indexer.progress(),
    }
  })

  ipcMain.handle(
    HOME_CHANNELS.rerankSearch,
    async (_event, raw: unknown): Promise<FileSearchRerank | null> => {
      const settings = readFileSearchSettings()
      if (!settings.rerank) return null
      const query = (raw && typeof raw === 'object' ? raw : {}) as { q?: unknown; paths?: unknown }
      const q = typeof query.q === 'string' ? query.q.trim().slice(0, 200) : ''
      const paths = Array.isArray(query.paths)
        ? query.paths.filter((p): p is string => typeof p === 'string').slice(0, 20)
        : []
      if (!q || paths.length < 2 || !ensureFileIndexer() || !fileIndexStore) return null
      searchReranker ??= new SearchReranker(fileIndexStore)
      return searchReranker.rerank(q, paths, settings)
    },
  )

  ipcMain.handle(HOME_CHANNELS.getFileSearchSettings, (): FileSearchSettings =>
    readFileSearchSettings(),
  )

  ipcMain.handle(
    HOME_CHANNELS.setFileSearchSettings,
    (_event, patch: unknown): FileSearchSettings => {
      const current = readFileSearchSettings()
      const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<FileSearchSettings>
      const next = normalizeFileSearchSettings({
        ...current,
        ...p,
        jevKeys: { ...current.jevKeys, ...(p.jevKeys ?? {}) },
      })
      writeAppSetting(APP_SETTINGS_PATH(), 'fileSearch', next)
      return next
    },
  )

  ipcMain.handle(HOME_CHANNELS.testFileSearchRerank, (_event, input: unknown) => {
    const { endpoint, apiKey } = (input && typeof input === 'object' ? input : {}) as {
      endpoint?: unknown
      apiKey?: unknown
    }
    return probeJev(jevEndpointOf(endpoint), typeof apiKey === 'string' ? apiKey : '')
  })

  // Starred files sort by mtime, which requires stat-ing them all first; they are hand-picked and few, so this is fine
  ipcMain.handle(HOME_CHANNELS.starred, (_event, query: unknown): RecentPage => {
    const { offset, limit, ext } = normalizeRecentQuery(query)
    const all = statEntries(readStarredFiles()).sort((a, b) => b.mtimeMs - a.mtimeMs)
    const filtered = ext ? all.filter((entry) => matchesExtFamily(entry.ext, ext)) : all
    return {
      entries: limit === 0 ? [] : filtered.slice(offset, offset + limit),
      total: filtered.length,
      totalAll: all.length,
    }
  })

  ipcMain.handle(HOME_CHANNELS.statPaths, (_event, paths: unknown): RecentEntry[] =>
    statEntries(stringPaths(paths)),
  )

  ipcMain.handle(HOME_CHANNELS.toggleStar, (_event, path: unknown) => {
    if (typeof path === 'string') toggleStarredFile(path)
  })

  // LOCAL(2026-09-22, f5247d3..476e5023): 上游 #560 openPath 长度/空串守卫并入本地
  // remote 物化+dock 结构(本地 routeDocumentPath 语义保留)
  ipcMain.handle(HOME_CHANNELS.openPath, (_event, path: unknown, options?: { dock?: boolean }) => {
    if (typeof path !== 'string' || !path || path.length > 4096) return
    const dock = options?.dock === true
    if (isRemoteUri(path)) {
      // materialize the object into the local cache, then open that copy; its
      // file-backed identity routes saves back to the bucket (consensus Q4)
      void openRemoteDocument(path)
        .then((cachePath) => routeDocumentPath(cachePath, dock))
        .catch((err: unknown) => {
          console.warn('[shell] remote open failed:', err)
          void dialog.showMessageBox({
            type: 'warning' as const,
            message: String(err instanceof Error ? err.message : err),
            detail: path,
          })
        })
      return
    }
    routeDocumentPath(path, dock)
    // 上游 #757: 文档开关后刷新全文索引
    fileIndexer?.refresh()
  })

  ipcMain.handle(HOME_CHANNELS.browse, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? shellWindow
    if (!win) return
    const result = await showOpenDialogWithMemory(dialog, win, {
      title: tm('dlgOpenTitle'),
      filters: [
        { name: tm('filterSupported'), extensions: OPEN_DIALOG_EXTENSIONS },
        { name: tm('filterWord'), extensions: ['docx', 'doc'] },
        { name: tm('filterExcel'), extensions: ['xlsx', 'xlsm', 'xls', 'csv'] },
        { name: tm('filterPpt'), extensions: ['pptx', 'ppt'] },
        { name: tm('filterPdf'), extensions: ['pdf'] },
        { name: tm('filterMarkdown'), extensions: ['md', 'markdown'] },
        { name: tm('filterHtml'), extensions: ['html', 'htm'] },
      ],
      properties: ['openFile', 'multiSelections'],
    })
    if (!result.canceled) for (const path of result.filePaths) routeDocumentPath(path)
  })

  ipcMain.handle(HOME_CHANNELS.newDoc, (_event, opts?: NewFileOpts) => {
    rememberPendingDir('doc', opts)
    newDocTab()
  })

  ipcMain.handle(HOME_CHANNELS.newSheet, (_event, opts?: NewFileOpts) => {
    rememberPendingDir('sheet', opts)
    void newSheetTab()
  })

  // ── Pending-unsaved restore (Home startup banner) ──
  // Only entries whose module recovery copy still exists are offered: the temp
  // backing file alone holds no edits, so there would be nothing to restore.
  ipcMain.handle(HOME_CHANNELS.listPendingUntitled, () => {
    const restorable: Array<{
      kind: 'sheet' | 'pdf'
      tempPath: string
      suggestedName?: string
      savedAt: number
    }> = []
    for (const doc of pendingUntitledDocs.values()) {
      const hasRecovery =
        doc.kind === 'sheet'
          ? sheetsBlankRecoveryCopy(doc.tempPath) !== null
          : pdfUntitledRecoveryCopy(doc.tempPath) !== null
      // A closed-unsaved tab deletes its temp backing file: drop the dead entry.
      if (!hasRecovery || !existsSync(doc.tempPath)) {
        removePendingUntitled(doc.tempPath)
        continue
      }
      restorable.push({
        kind: doc.kind,
        tempPath: doc.tempPath,
        suggestedName: doc.suggestedName,
        savedAt: doc.savedAt,
      })
    }
    return restorable
  })

  ipcMain.handle(HOME_CHANNELS.restorePendingUntitled, (_event, tempPath: unknown) => {
    const doc = typeof tempPath === 'string' ? pendingUntitledDocs.get(tempPath) : undefined
    if (!doc) return false
    try {
      if (doc.kind === 'sheet') {
        const recovery = sheetsBlankRecoveryCopy(doc.tempPath)
        if (!recovery) return false
        tabManager?.openSheetsTab(undefined, {
          newBlank: true,
          newBlankSaveDir: doc.defaultDir,
          newBlankName: tm('untitledSheet'),
          restoreFrom: recovery,
        })
      } else {
        const recovery = pdfUntitledRecoveryCopy(doc.tempPath)
        if (!recovery) return false
        // Fresh temp backing from the recovery copy: the old temp stays the
        // recovery key of the crashed session and is retired below.
        mkdirSync(blankDraftsDir(), { recursive: true })
        const newTemp = uniquePathIn(blankDraftsDir(), `blank-${randomUUID()}.pdf`)
        copyFileSync(recovery, newTemp)
        const meta = { defaultDir: doc.defaultDir, suggestedName: doc.suggestedName }
        markPdfUntitledPath(newTemp, meta)
        registerPendingUntitled({ kind: 'pdf', tempPath: newTemp, ...meta })
        tabManager?.openPdfTab(newTemp, {
          untitledTitle: doc.suggestedName ?? tm('untitledPdf'),
        })
        removePendingUntitled(doc.tempPath)
        rmSync(doc.tempPath, { force: true })
      }
      removePendingUntitled(doc.tempPath)
      return true
    } catch (err) {
      console.warn('[shell] pending-untitled restore failed:', err)
      return false
    }
  })

  ipcMain.handle(HOME_CHANNELS.discardPendingUntitled, (_event, tempPath: unknown) => {
    if (typeof tempPath !== 'string') return false
    removePendingUntitled(tempPath)
    // Forget the plumbing too: the tab is gone, so nothing else cleans these up.
    if (existsSync(tempPath)) rmSync(tempPath, { force: true })
    return true
  })

  ipcMain.handle(HOME_CHANNELS.newSlide, (_event, opts?: { projectId?: string } & NewFileOpts) => {
    if (opts?.projectId && opts.projectId !== 'default') {
      pendingNewFileProject.set('slide', opts.projectId)
    }
    rememberPendingDir('slide', opts)
    newSlideTab()
  })

  ipcMain.handle(HOME_CHANNELS.newMarkdown, (_event, opts?: NewFileOpts) => {
    rememberPendingDir('markdown', opts)
    newMarkdownTab()
  })

  ipcMain.handle(HOME_CHANNELS.newHtml, (_event, opts?: NewFileOpts) => {
    rememberPendingDir('html', opts)
    newHtmlTab()
  })

  ipcMain.handle(HOME_CHANNELS.newPdf, (_event, opts?: NewFileOpts) => {
    rememberPendingDir('pdf', opts)
    void newPdfTab()
  })

  ipcMain.handle(HOME_CHANNELS.removeRecent, (_event, paths: unknown) => {
    const list = stringPaths(paths)
    removeRecentFiles(list)
    // an unavailable entry's star must go with it, or the Starred view keeps
    // a dead dimmed row the recents list no longer shows
    removeStarredFiles(list.filter((p) => !existsSync(p)))
  })

  ipcMain.handle(HOME_CHANNELS.revealPath, (_event, path: unknown) => {
    if (typeof path === 'string' && existsSync(path)) shell.showItemInFolder(path)
  })

  ipcMain.handle(
    HOME_CHANNELS.renameFile,
    async (_event, path: unknown, newName: unknown): Promise<RenameResult> => {
      if (typeof path !== 'string' || typeof newName !== 'string')
        return { ok: false, error: tm('errBadArgs') }
      // Validate the raw name before trimming: trimming first would
      // silently turn "report " into "report" and make the
      // trailing-space gate in isValidRenameName unreachable. Reject
      // with the localized gate instead of renaming to a different
      // name than requested.
      if (!isValidRawRenameName(newName)) return { ok: false, error: tm('errBadName') }
      const name = newName.trim()
      if (typeof path === 'string' && isRemoteUri(path)) {
        // server-side rename within the same bucket prefix
        const parsed = parseRemoteUri(path)
        if (!parsed) return { ok: false, error: tm('errBadArgs') }
        try {
          const newUri = await renameRemoteDocument(path, name)
          replaceRecentFile(path, newUri)
          projectFileRenamed(path, newUri)
          return { ok: true, path: newUri }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : tm('errRenameFailed') }
        }
      }

      if (!existsSync(path)) return { ok: false, error: tm('errMissing') }
      const target = join(dirname(path), name)
      if (target === path) return { ok: true, path }
      // A case-only rename (Report.pdf -> report.pdf) hits the source itself on
      // case-insensitive filesystems; only a genuinely different file blocks.
      if (existsSync(target) && !isSameFile(path, target)) {
        return { ok: false, error: tm('errExists') }
      }
      try {
        renameSync(path, target)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : tm('errRenameFailed') }
      }
      afterFileMoved(path, target)
      return { ok: true, path: target }
    },
  )

  ipcMain.handle(HOME_CHANNELS.duplicateFile, (_event, path: unknown) => {
    if (typeof path !== 'string' || !existsSync(path)) return
    const ext = extname(path)
    const base = basename(path, ext)
    const dir = dirname(path)
    for (let i = 1; ; i++) {
      const target = join(dir, `${base} ${tm('copySuffix')}${i === 1 ? '' : ` ${i}`}${ext}`)
      if (existsSync(target)) continue
      copyFileSync(path, target)
      recordRecentFile(target)
      return
    }
  })

  ipcMain.handle(HOME_CHANNELS.deleteFiles, async (_event, paths: unknown) => {
    const list = stringPaths(paths)
    const failed = new Set<string>()
    for (const p of list) {
      if (isRemoteUri(p)) {
        // object storage has no trash: the renderer's confirm modal is the
        // guard, and a failed delete keeps the entry listed
        try {
          await deleteRemoteDocument(p)
        } catch {
          console.warn('[shell] remote delete failed:', p)
          failed.add(p)
        }
        continue
      }
      try {
        await shell.trashItem(p)
      } catch {
        // file already gone or trash unavailable; still drop it from the list
      }
    }
    const removed = list.filter((p) => !failed.has(p))
    removeRecentFiles(removed)
    // the files were deliberately destroyed — stars must not survive as ghosts
    removeStarredFiles(removed)
  })

  ipcMain.handle(HOME_CHANNELS.openTrash, () => {
    if (process.platform === 'darwin') {
      void shell.openPath(join(app.getPath('home'), '.Trash'))
    } else if (process.platform === 'win32') {
      spawn('explorer.exe', ['shell:RecycleBin'], { detached: true }).unref()
    } else {
      void shell.openPath(join(app.getPath('home'), '.local', 'share', 'Trash', 'files'))
    }
  })

  ipcMain.handle(HOME_CHANNELS.getLanguage, (): Lang => currentLang())

  ipcMain.handle(HOME_CHANNELS.setLanguage, (_event, lang: unknown) => {
    if (!isLang(lang) || lang === currentLang()) return
    persistLang(lang)
    // the switcher lives on the home page, so the home menu is the active one
    buildHomeMenu()
    installDockMenu()
    installBackToHomeItems()
    for (const wc of webContents.getAllWebContents()) wc.send('app:language-changed', lang)
  })

  ipcMain.handle(HOME_CHANNELS.getUpdateChannel, (): UpdateChannel => currentUpdateChannel())

  ipcMain.handle(HOME_CHANNELS.setUpdateChannel, (_event, channel: unknown) => {
    if (!isUpdateChannel(channel) || channel === currentUpdateChannel()) return
    cachedUpdateChannel = channel
    writeAppSetting(APP_SETTINGS_PATH(), 'updateChannel', channel)
    applyUpdateChannel(channel)
  })

  ipcMain.handle(
    HOME_CHANNELS.onboardingSeen,
    (): boolean => readAppSettings(APP_SETTINGS_PATH()).onboardingSeen === true,
  )

  ipcMain.handle(HOME_CHANNELS.setOnboardingSeen, (): boolean => {
    try {
      writeAppSetting(APP_SETTINGS_PATH(), 'onboardingSeen', true)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(HOME_CHANNELS.getTheme, (): UiTheme => currentTheme())
  // editor tabs ask via the app-wide channel (symmetric with app:get-language)
  ipcMain.handle('app:get-theme', (): UiTheme => currentTheme())

  ipcMain.handle(HOME_CHANNELS.setTheme, (_event, theme: unknown) => {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system') return
    if (theme === currentTheme()) return
    cachedTheme = theme
    writeAppSetting(APP_SETTINGS_PATH(), 'theme', theme)
    nativeTheme.themeSource = theme
    refreshTitleBarOverlay()
    for (const wc of webContents.getAllWebContents()) wc.send('app:theme-changed', theme)
  })

  ipcMain.handle(HOME_CHANNELS.getAutoSaveDefault, (): AutoSaveDefault => currentAutoSaveDefault())
  ipcMain.handle('app:get-auto-save-default', (): AutoSaveDefault => currentAutoSaveDefault())

  ipcMain.handle(HOME_CHANNELS.setAutoSaveDefault, (_event, on: unknown) => {
    if (typeof on !== 'boolean') return
    if (on === currentAutoSaveDefault().on) return
    const next: AutoSaveDefault = { on, updatedAt: Date.now() }
    cachedAutoSaveDefault = next
    writeAppSettings(APP_SETTINGS_PATH(), {
      autoSaveDefault: next.on,
      autoSaveDefaultUpdatedAt: next.updatedAt,
    })
    for (const wc of webContents.getAllWebContents()) wc.send('app:auto-save-default-changed', next)
  })

  ipcMain.handle(HOME_CHANNELS.getMcpStatus, () => mcpStatus())

  ipcMain.handle(HOME_CHANNELS.setMcpSettings, async (_event, patch: unknown) => {
    if (!patch || typeof patch !== 'object') return mcpStatus()
    const request = patch as {
      enabled?: unknown
      port?: unknown
      background?: unknown
      logging?: unknown
    }
    const current = currentMcpSettings()
    const enabled = typeof request.enabled === 'boolean' ? request.enabled : current.enabled
    const port =
      typeof request.port === 'number' &&
      Number.isInteger(request.port) &&
      request.port > 0 &&
      request.port < 65536
        ? request.port
        : current.port
    const background =
      typeof request.background === 'boolean' ? request.background : current.background
    const logging = typeof request.logging === 'boolean' ? request.logging : current.logging
    writeAppSettings(APP_SETTINGS_PATH(), {
      mcpEnabled: enabled,
      mcpPort: port,
      mcpBackground: background,
      mcpLogging: logging,
    })
    try {
      return await applyMcpSettings({ enabled, port, background, logging })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ...mcpStatus(), error: message }
    }
  })

  ipcMain.handle(HOME_CHANNELS.getMcpLogs, () => getMcpRecentLogs())

  ipcMain.handle(HOME_CHANNELS.clearMcpLogs, () => {
    clearMcpLogs()
  })

  ipcMain.handle(HOME_CHANNELS.openMcpLogFile, () => {
    revealMcpLogFile()
    const logPath = mcpLogFilePath()
    if (logPath) shell.showItemInFolder(logPath)
  })

  ipcMain.handle(HOME_CHANNELS.getAnalyticsEnabled, (): boolean => analyticsEnabled())

  ipcMain.handle(HOME_CHANNELS.setAnalyticsEnabled, (_event, enabled: unknown): boolean => {
    if (typeof enabled !== 'boolean') return false
    return persistAnalyticsPreference(enabled)
  })

  ipcMain.handle(HOME_CHANNELS.getAiPanelPrefs, (): AiPanelPrefs => currentAiPanelPrefs())
  ipcMain.handle('app:get-ai-panel-prefs', (): AiPanelPrefs => currentAiPanelPrefs())

  const setAiPanelPrefs = (patch: unknown): AiPanelPrefs => {
    const prev = currentAiPanelPrefs()
    const raw =
      patch !== null && typeof patch === 'object' ? (patch as Record<string, unknown>) : {}
    // unknown/malformed fields fall back to the previous value, not the default
    const next = normalizeAiPanelPrefs({
      side: raw.side === 'left' || raw.side === 'right' ? raw.side : prev.side,
      fontSize: 'fontSize' in raw ? raw.fontSize : prev.fontSize,
      customFontSize: 'customFontSize' in raw ? raw.customFontSize : prev.customFontSize,
      spellcheck: 'spellcheck' in raw ? raw.spellcheck : prev.spellcheck,
    })
    if (sameAiPanelPrefs(next, prev)) return prev
    cachedAiPanelPrefs = next
    writeAppSettings(APP_SETTINGS_PATH(), {
      aiPanelSide: next.side,
      aiPanelFontSize: next.fontSize,
      aiPanelCustomFontSize: next.customFontSize,
      aiPanelSpellcheck: next.spellcheck,
    })
    for (const wc of webContents.getAllWebContents()) wc.send('app:ai-panel-prefs-changed', next)
    return next
  }
  ipcMain.handle(HOME_CHANNELS.setAiPanelPrefs, (_event, patch) => setAiPanelPrefs(patch))
  ipcMain.handle('app:set-ai-panel-prefs', (_event, patch) => setAiPanelPrefs(patch))

  // effective folder where new/untitled files land; the editor mains resolve
  // the same setting themselves (configuredDefaultSaveDir via docs' defaultSaveDir)
  // ── folder tree over the default save folder ──
  const folderErrors = (): FolderErrors => ({
    badArgs: tm('errBadArgs'),
    badName: tm('errBadName'),
    missing: tm('errMissing'),
    exists: tm('errExists'),
    failed: tm('errRenameFailed'),
  })
  const insideRoot = (path: unknown): path is string =>
    typeof path === 'string' && insideAnyRoot(path)
  const isRoot = (path: string) => isAnyRoot(path)

  ipcMain.handle(HOME_CHANNELS.folderRoots, (): FolderRoot[] => {
    // describeRoot creates a missing save folder, so its watcher has something to attach to
    const roots = [describeRoot(defaultSaveDir()), ...extraFolderRoots().map(describeExtraRoot)]
    ensureFolderWatchers()
    return roots
  })

  // LOCAL 兼容：编辑器 Files pane 桥的旧单根通道（上游 #757 已改多根 folderRoots，
  // 但 files-pane-bridge 仍按旧名 invoke，语义保持 main 时代：返回默认保存目录根）
  ipcMain.handle(HOME_CHANNELS.folderRoot, (): FolderRoot => {
    // describeRoot creates a missing root, so the watcher has something to attach to
    const root = describeRoot(defaultSaveDir())
    if (root.usable) ensureFolderWatchers()
    return root
  })

  // an added folder joins the tree where it is: nothing on disk is created, copied or moved
  const addFolderRoot = (path: string): FolderRoot | null => {
    const extras = withExtraRoot(extraFolderRoots(), defaultSaveDir(), path)
    if (!extras) return null
    writeAppSetting(APP_SETTINGS_PATH(), FOLDER_ROOTS_KEY, extras)
    ensureFolderWatchers()
    fileIndexer?.refresh()
    return describeExtraRoot(path)
  }

  ipcMain.handle(HOME_CHANNELS.addFolderRoot, async (): Promise<FolderRoot | null> => {
    const result = await showOpenDialogWithMemory(dialog, shellWindow, {
      title: tm('dlgAddFolderRoot'),
      properties: ['openDirectory'],
    })
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return null
    if (!describeExtraRoot(picked).readable) {
      showErrorDialog(shellWindow, tm('errFolderRootUnusable'), picked)
      return null
    }
    return addFolderRoot(picked)
  })

  ipcMain.handle(HOME_CHANNELS.dropFolderRoots, (_event, paths: unknown): FolderRoot[] => {
    const added: FolderRoot[] = []
    const files: string[] = []
    for (const path of stringPaths(paths)) {
      if (!describeExtraRoot(path).readable) {
        files.push(path)
        continue
      }
      const root = addFolderRoot(path)
      if (root) added.push(root)
    }
    if (files.length > 0) handleDroppedFiles(files, droppedFilesDeps())
    return added
  })

  ipcMain.handle(HOME_CHANNELS.removeFolderRoot, (_event, path: unknown) => {
    if (typeof path !== 'string') return
    const extras = withoutExtraRoot(extraFolderRoots(), path)
    writeAppSetting(APP_SETTINGS_PATH(), FOLDER_ROOTS_KEY, extras)
    ensureFolderWatchers()
    fileIndexer?.refresh()
  })

  ipcMain.handle(HOME_CHANNELS.listFolder, (_event, dir: unknown): FolderListing => {
    if (!insideRoot(dir)) return { dir: String(dir), folders: [], files: [] }
    return listFolder(dir, new Set(readStarredFiles()))
  })

  ipcMain.handle(
    HOME_CHANNELS.createFolder,
    (_event, parent: unknown, name: unknown): RenameResult => {
      if (!insideRoot(parent) || typeof name !== 'string')
        return { ok: false, error: tm('errBadArgs') }
      return createFolder(parent, name, folderErrors())
    },
  )

  ipcMain.handle(
    HOME_CHANNELS.renameFolder,
    (_event, dir: unknown, newName: unknown): RenameResult => {
      if (!insideRoot(dir) || isRoot(dir) || typeof newName !== 'string')
        return { ok: false, error: tm('errBadArgs') }
      const filesBefore = trackedFilesUnder(dir)
      const result = renameFolder(dir, newName, folderErrors())
      if (result.ok && result.path && result.path !== dir) {
        afterFolderMoved(dir, result.path, filesBefore)
      }
      return result
    },
  )

  ipcMain.handle(
    HOME_CHANNELS.movePaths,
    async (_event, paths: unknown, targetDir: unknown, policy: unknown): Promise<MoveResult> => {
      const list = stringPaths(paths)
      if (!insideRoot(targetDir)) {
        const error = tm('errBadArgs')
        return { moved: [], conflicts: [], failed: list.map((path) => ({ path, error })) }
      }
      const conflictPolicy: MoveConflictPolicy =
        policy === 'replace' || policy === 'keepBoth' || policy === 'skip' ? policy : 'ask'
      const isDir = (p: string) => {
        try {
          return statSync(p).isDirectory()
        } catch {
          return false
        }
      }
      // files may come from anywhere (the Recent list); folders only from inside the tree, never a root itself
      const sources = list.filter((p) => !isDir(p) || (insideAnyRoot(p) && !isAnyRoot(p)))
      const dirFiles = new Map(sources.filter(isDir).map((p) => [p, trackedFilesUnder(p)]))
      // 'replace' must not destroy data: the displaced target goes to the trash,
      // and everything keyed on its path (recents, stars, chat history) leaves
      // with it so the incoming file does not inherit another document's record
      const displaced: string[] = []
      const result = movePathsInto(sources, targetDir, conflictPolicy, folderErrors(), {
        replaceExisting: (path) => {
          const parked = join(dirname(path), `.chatoffice-replaced-${Date.now()}-${basename(path)}`)
          const files = isDir(path) ? trackedFilesUnder(path) : [path]
          renameSync(path, parked)
          return {
            commit: () => {
              displaced.push(parked)
              removeRecentFiles(files)
              removeStarredFiles(files)
              for (const file of files) projectFileRenamed(file, rebasePath(file, path, parked))
            },
            rollback: () => renameSync(parked, path),
          }
        },
      })
      for (const parked of displaced) {
        try {
          await shell.trashItem(parked)
        } catch {
          rmSync(parked, { recursive: true, force: true })
        }
      }
      for (const { from, to } of result.moved) {
        const files = dirFiles.get(from)
        if (files) afterFolderMoved(from, to, files)
        else afterFileMoved(from, to)
      }
      return result
    },
  )

  ipcMain.handle(HOME_CHANNELS.deleteFolder, async (_event, dir: unknown) => {
    if (!insideRoot(dir) || isRoot(dir)) return
    const files = trackedFilesUnder(dir)
    try {
      await shell.trashItem(dir)
    } catch {
      return
    }
    removeRecentFiles(files)
    removeStarredFiles(files)
  })

  ipcMain.handle(HOME_CHANNELS.getDefaultSaveDir, (): string => defaultSaveDir())

  ipcMain.handle(HOME_CHANNELS.pickDefaultSaveDir, async (): Promise<string | null> => {
    const result = await showOpenDialogWithMemory(dialog, shellWindow, {
      title: tm('dlgPickSaveDir'),
      defaultPath: defaultSaveDir(),
      properties: ['openDirectory', 'createDirectory'],
    })
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return null
    if (!isUsableSaveDir(picked)) {
      showErrorDialog(shellWindow, tm('errSaveDirUnusable'), picked)
      return null
    }
    writeAppSetting(APP_SETTINGS_PATH(), DEFAULT_SAVE_DIR_KEY, picked)
    ensureFolderWatchers()
    return picked
  })

  ipcMain.handle(HOME_CHANNELS.openGenTeam, () => {
    shell.openExternal(GENTEAM_URL).catch(() => {
      // no browser handler available; nothing actionable for the user here
    })
  })

  ipcMain.handle(HOME_CHANNELS.openCreditUsage, () => {
    shell.openExternal(CREDIT_USAGE_URL).catch(() => {
      // no browser handler available; nothing actionable for the user here
    })
  })

  ipcMain.handle(HOME_CHANNELS.openGitHubRepo, () => {
    shell.openExternal(GITHUB_REPO_URL).catch(() => {
      // no browser handler available; nothing actionable for the user here
    })
  })

  ipcMain.handle(HOME_CHANNELS.githubStars, () => fetchGithubStars())

  // returning true also counts as "shown": the renderer displays it
  // unconditionally, so no separate mark-shown round-trip is needed
  ipcMain.handle(HOME_CHANNELS.starPromptShouldShow, (): StarPromptShow => {
    if (starPromptSessionGrant) return starPromptSessionGrant
    const now = Date.now()
    const state = readStarPrompt()
    const docOpens = state.docOpens ?? 0
    // dev preview of the card without waiting out the value thresholds
    // (same pattern as CHATOFFICE_FAKE_UPDATE); nothing is recorded
    if (!app.isPackaged && process.env.CHATOFFICE_FORCE_STAR_PROMPT) return { show: true, docOpens }
    const grant = (): StarPromptShow => {
      writeStarPrompt(withShown(state, now))
      starPromptSessionGrant = { show: true, docOpens }
      return starPromptSessionGrant
    }
    // first launch after an upgrade: skip the value gates once for a
    // never-prompted user (they are a proven repeat user already)
    if (upgradeStarPromptPending) {
      upgradeStarPromptPending = false
      if (shouldShowUpgradeStarPrompt(state)) return grant()
    }
    if (!shouldShowStarPrompt(state, now)) return { show: false, docOpens }
    return grant()
  })

  ipcMain.handle(HOME_CHANNELS.starPromptAction, (_event, action: unknown) => {
    if (action !== 'starred' && action !== 'later') return
    // the card was reacted to — drop the session grant so a later query (new
    // shell window on macOS) re-evaluates the real rules (snooze / resolved)
    starPromptSessionGrant = null
    // 'later' needs no write: the display was already counted by the query
    if (action === 'starred') writeStarPrompt(withResolved(readStarPrompt()))
  })

  const cloudProjectsStorePath = () => join(app.getPath('userData'), 'cloud-projects.json')

  ipcMain.handle(HOME_CHANNELS.cloudProjectsCached, () =>
    readCloudProjectsStore(cloudProjectsStorePath()),
  )

  ipcMain.handle(HOME_CHANNELS.cloudProjects, () => syncCloudProjects(cloudProjectsStorePath()))

  ipcMain.handle(HOME_CHANNELS.openCloudProject, (_event, projectUrl: unknown) => {
    const url = cloudProjectExternalUrl(projectUrl)
    if (url) void shell.openExternal(url)
  })

  // generic external-link opener (homepage footer etc.): renderer-supplied URL,
  // https-only — anything else (file:, javascript:, malformed) is dropped
  ipcMain.handle(HOME_CHANNELS.openExternal, (_event, raw: unknown) => {
    if (typeof raw !== 'string') return
    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      return
    }
    if (parsed.protocol !== 'https:') return
    void shell.openExternal(parsed.toString())
  })

  // home chat sessions: renderer owns the shape; main persists it atomically
  const chatSessionsPath = () => join(app.getPath('userData'), 'home-chat-sessions.json')

  ipcMain.handle(HOME_CHANNELS.chatSessionsLoad, (): unknown => {
    try {
      const raw = readFileSync(chatSessionsPath(), 'utf8')
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })

  ipcMain.handle(HOME_CHANNELS.chatSessionsSave, (_event, sessions: unknown) => {
    if (!Array.isArray(sessions)) return
    const target = chatSessionsPath()
    const tmp = `${target}.tmp`
    writeFileSync(tmp, JSON.stringify(sessions))
    renameSync(tmp, target)
  })

  ipcMain.handle(
    HOME_CHANNELS.systemFileSearch,
    (_event, query: unknown, ext: unknown): SystemSearchResult => {
      const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
      const extFilter = typeof ext === 'string' ? ext.toLowerCase().replace(/^\./, '') : ''
      const allowedExts = new Set(['docx', 'xlsx', 'pptx', 'md', 'html', 'pdf'])
      if (extFilter && !allowedExts.has(extFilter)) return { entries: [], truncated: false }

      const home = os.homedir()
      const searchDirs = ['Documents', 'Desktop', 'Downloads']
        .map((d) => join(home, d))
        .filter((d) => existsSync(d))

      const results: SystemSearchEntry[] = []
      const limit = 50

      for (const dir of searchDirs) {
        if (results.length >= limit) break
        walkDir(dir, q, extFilter, allowedExts, results, limit)
      }

      results.sort((a, b) => b.mtimeMs - a.mtimeMs)
      return { entries: results.slice(0, 20), truncated: results.length > 20 }
    },
  )
}

function walkDir(
  dir: string,
  query: string,
  extFilter: string,
  allowedExts: Set<string>,
  results: SystemSearchEntry[],
  limit: number,
): void {
  if (results.length >= limit) return
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as import('node:fs').Dirent[]
  } catch {
    return
  }
  for (const entry of entries) {
    if (results.length >= limit) return
    const name = entry.name
    if (name.startsWith('.')) continue
    const fullPath = join(dir, name)
    if (entry.isDirectory()) {
      walkDir(fullPath, query, extFilter, allowedExts, results, limit)
    } else if (entry.isFile()) {
      const ext = extname(name).slice(1).toLowerCase()
      if (!allowedExts.has(ext)) continue
      if (extFilter && ext !== extFilter) continue
      if (query && !name.toLowerCase().includes(query)) continue
      try {
        const stat = statSync(fullPath)
        results.push({
          name,
          path: fullPath,
          ext,
          mtimeMs: stat.mtimeMs,
          sizeBytes: stat.size,
        })
      } catch {
        // skip inaccessible files
      }
    }
  }
}

function stringPaths(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : []
}

// electron-vite emits ?asset files under hashed names, which breaks nativeImage's
// automatic `@2x` sibling lookup — attach the retina representation by hand
function loadMenuIcon(path1x: string, path2x: string): NativeImage {
  const icon = nativeImage.createFromPath(path1x)
  icon.addRepresentation({ scaleFactor: 2, buffer: readFileSync(path2x) })
  return icon
}

// loaded once, not on every menu open
interface MenuIconSet {
  docx: NativeImage
  xlsx: NativeImage
  pptx: NativeImage
  pdf: NativeImage
  md: NativeImage
  html: NativeImage
  home: NativeImage
}
let menuIconCache: MenuIconSet | null = null
function menuIcons(): MenuIconSet {
  menuIconCache ??= {
    docx: loadMenuIcon(menuDocxIcon1x, menuDocxIcon2x),
    xlsx: loadMenuIcon(menuXlsxIcon1x, menuXlsxIcon2x),
    pptx: loadMenuIcon(menuPptxIcon1x, menuPptxIcon2x),
    pdf: loadMenuIcon(menuPdfIcon1x, menuPdfIcon2x),
    md: loadMenuIcon(menuMdIcon1x, menuMdIcon2x),
    html: loadMenuIcon(menuHtmlIcon1x, menuHtmlIcon2x),
    home: loadMenuIcon(menuHomeIcon1x, menuHomeIcon2x),
  }
  return menuIconCache
}

const TAB_MENU_ICON: Record<TabKind, keyof MenuIconSet> = {
  home: 'home',
  docs: 'docx',
  sheets: 'xlsx',
  slides: 'pptx',
  pdf: 'pdf',
  markdown: 'md',
  html: 'html',
}

// tab views see neither DOM events nor a focus change when the user clicks the
// shell chrome — relay the press so open popovers in documents can dismiss.
// The pressed document must be excluded: it already dismissed (or is opening)
// its own popovers via its local pointerdown listeners, and the async IPC
// round-trip would otherwise close a popover that very press just opened
// (home row menus died this way: pointerdown → broadcast → menu unmounts
// before the click event ever reached the menu item).
function broadcastChromePressed(exclude?: WebContents): void {
  for (const wc of webContents.getAllWebContents()) {
    if (wc !== exclude) wc.send('app:chrome-pressed')
  }
}

/**
 * 原生菜单隐藏（快捷键全保留）：各 tab 的菜单 builder 照常构建并经统一的
 * setApplicationMenu 收口——
 *   macOS 菜单栏只留 应用名 + 编辑（剪贴板 role）；其余顶层 visible:false。
 *   Electron 隐藏菜单项不注册加速器，因此隐藏前把子树里 accelerator→click
 *   收进派发表，由 before-input-event 统一派发（含 role:close 的兜底）。
 *   Windows/Linux 不做 visible:false（原生加速器正常），窗口 autoHideMenuBar。
 * popup 类临时菜单（tab 列表/新建）走 menu.popup，不经 setApplicationMenu。
 */
type AcceleratorEntry = {
  accelerator: string
  click: (menuItem: Electron.MenuItem, window?: Electron.BaseWindow) => void
}
const menuAccelerators = new Map<string, AcceleratorEntry>()

const ROLE_FALLBACK_ACCELERATOR: Record<string, string> = {
  close: 'CmdOrCtrl+W',
}

function normalizedAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => (part === 'CmdOrCtrl' ? 'CmdOrCtrl' : part.toUpperCase()))
    .sort((a, b) => (a === 'CmdOrCtrl' ? -1 : b === 'CmdOrCtrl' ? 1 : a.localeCompare(b)))
    .join('+')
}

function collectHiddenAccelerators(menu: Electron.Menu, item: Electron.MenuItem): void {
  const submenu = item.submenu as Electron.Menu | undefined
  if (!submenu) return
  if (process.env.CHATOFFICE_MENU_DEBUG) {
    console.log(
      '[menu-debug] collect from',
      item.label,
      submenu.items.map((x) => `${x.label ?? x.role}:${x.accelerator ?? ''}`).slice(0, 10),
    )
  }
  for (const sub of submenu.items) {
    const fallback =
      sub.role && ROLE_FALLBACK_ACCELERATOR[sub.role]
        ? ROLE_FALLBACK_ACCELERATOR[sub.role]
        : undefined
    const accelerator = sub.accelerator ?? fallback
    if (!accelerator) continue
    if (typeof sub.click === 'function') {
      menuAccelerators.set(normalizedAccelerator(accelerator), {
        accelerator,
        click: sub.click as unknown as AcceleratorEntry['click'],
      })
    } else if (sub.role === 'close') {
      // role 项没有实例 click：close 兜底为关窗
      menuAccelerators.set(normalizedAccelerator(accelerator), {
        accelerator,
        click: () => shellWindow?.close(),
      })
    }
  }
}

const rawSetApplicationMenu = Menu.setApplicationMenu.bind(Menu)
Menu.setApplicationMenu = ((menu: Electron.Menu | null) => {
  const isMac = process.platform === 'darwin'
  if (!menu || menu.items.length === 0) {
    menuAccelerators.clear()
    rawSetApplicationMenu(menu)
    return
  }
  // LOCAL(purchase): 统一注入独立「激活」菜单（帮助上方）。所有菜单——
  // 包括 docs/sheets/slides 各包自建的——都经此收口，包内无需重复实现；
  // 已含激活段（防重）或缺帮助菜单时退化为 append。
  if (!menu.items.some((it) => it.label === tm('menuActivate'))) {
    const activate = new MenuItem(activateMenuSection())
    const helpIdx = menu.items.findIndex((it) => it.role === 'help')
    if (helpIdx >= 0) menu.insert(helpIdx, activate)
    else menu.append(activate)
  }
  if (!isMac) {
    menuAccelerators.clear()
    rawSetApplicationMenu(menu)
    return
  }
  menuAccelerators.clear()
  menu.items.forEach((item, index) => {
    if (index === 0) return // appMenu：系统菜单栏必需
    const isEditMenu =
      !!item.submenu && (item.submenu as Electron.Menu).items.some((sub) => sub.role === 'copy')
    if (isEditMenu) return // 编辑：剪贴板 role 的可见入口（⌘C/⌘V 在 AppKit 层）
    // LOCAL(purchase): 激活菜单独立于帮助菜单，始终可见——授权状态是账户级
    // 信息，随时要能点开购买页（帮助等其余菜单仍按原约定隐藏，仅留加速键）
    if (item.label === tm('menuActivate')) return
    collectHiddenAccelerators(menu, item)
    item.visible = false
  })
  rawSetApplicationMenu(menu)
}) as typeof Menu.setApplicationMenu

// 隐藏菜单的加速键派发：shell 与所有编辑器视图的 webContents 统一拦截
app.on('web-contents-created', (_event, contents) => {
  if (process.env.CHATOFFICE_MENU_DEBUG) {
    console.log('[menu-debug] wc-created', contents.getType(), contents.getURL().slice(-30))
  }
  contents.on('before-input-event', (event, input) => {
    if (process.env.CHATOFFICE_MENU_DEBUG && input.type === 'keyDown') {
      console.log(
        '[menu-debug] BIE',
        input.code,
        input.key,
        'ctrl',
        input.control,
        'meta',
        input.meta,
        'size',
        menuAccelerators.size,
      )
    }
    if (input.type !== 'keyDown' || menuAccelerators.size === 0) return
    if (!input.control && !input.meta && !input.alt && !input.shift) return
    const code = input.code ?? ''
    const keyPart = code.startsWith('Key')
      ? code.slice(3)
      : code.startsWith('Digit')
        ? code.slice(5)
        : input.key.toUpperCase()
    if (!keyPart || keyPart.length !== 1) return
    const parts: string[] = []
    if (input.control || input.meta) parts.push('CmdOrCtrl')
    if (input.alt) parts.push('Alt')
    if (input.shift) parts.push('Shift')
    parts.push(keyPart.toUpperCase())
    const hit = menuAccelerators.get(
      parts
        .slice()
        .sort((a, b) => (a === 'CmdOrCtrl' ? -1 : b === 'CmdOrCtrl' ? 1 : a.localeCompare(b)))
        .join('+'),
    )
    if (hit?.click) {
      event.preventDefault()
      hit.click({} as Electron.MenuItem, shellWindow ?? undefined)
    }
  })
})

function registerWindowControlsIpc(): void {
  ipcMain.on(WINDOW_CHANNELS.minimize, () => shellWindow?.minimize())
  ipcMain.on(WINDOW_CHANNELS.toggleMaximize, () => {
    if (!shellWindow || shellWindow.isDestroyed()) return
    if (shellWindow.isMaximized()) shellWindow.unmaximize()
    else shellWindow.maximize()
  })
  ipcMain.on(WINDOW_CHANNELS.close, () => shellWindow?.close())
  ipcMain.handle(WINDOW_CHANNELS.isMaximized, () =>
    Boolean(shellWindow && !shellWindow.isDestroyed() && shellWindow.isMaximized()),
  )
  // maximize 状态变化 → tab 条按钮图标切换（还原/最大化 glyph）
  const broadcastMaximized = (maximized: boolean): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(WINDOW_CHANNELS.maximizeChanged, maximized)
    }
  }
  app.on('browser-window-created', (_event, win) => {
    win.on('maximize', () => broadcastMaximized(true))
    win.on('unmaximize', () => broadcastMaximized(false))
  })
  if (process.env.CHATOFFICE_MENU_DEBUG) {
    console.log('[wc-debug] ipc registered')
    // 无屏/自动化环境下的窗口真值端点（仅调试用）。POST /bounds 支持
    // 自动化驱动真实窗口缩放（ribbon 自适应阶梯的 M4 验收钩子）
    void import('node:http').then(({ default: http }) => {
      http
        .createServer((req, res) => {
          if (req.method === 'POST' && req.url === '/bounds') {
            let body = ''
            req.on('data', (chunk) => (body += chunk))
            req.on('end', () => {
              try {
                const { width, height } = JSON.parse(body) as { width?: number; height?: number }
                if (
                  shellWindow &&
                  !shellWindow.isDestroyed() &&
                  typeof width === 'number' &&
                  Number.isFinite(width) &&
                  typeof height === 'number' &&
                  Number.isFinite(height)
                ) {
                  shellWindow.setBounds({
                    ...shellWindow.getBounds(),
                    width: Math.round(width),
                    height: Math.round(height),
                  })
                  res.setHeader('content-type', 'application/json')
                  res.end(JSON.stringify({ ok: true, bounds: shellWindow.getBounds() }))
                  return
                }
              } catch {
                // fallthrough to 400
              }
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false }))
            })
            return
          }
          res.setHeader('content-type', 'application/json')
          res.end(
            JSON.stringify({
              has: !!shellWindow && !shellWindow.isDestroyed(),
              minimized: shellWindow?.isMinimized() ?? null,
              maximized: shellWindow?.isMaximized() ?? null,
              bounds: shellWindow?.getBounds() ?? null,
            }),
          )
        })
        .listen(5278)
    })
  }
}

/** the shell's tab manager, recreating the shell window when a detached editor outlived it */
function ensureTabManager(): TabManager {
  if (!tabManager) createShellWindow()
  if (!tabManager) throw new Error('the shell window could not be created')
  return tabManager
}

/** "Open in New Window": reparent the tab's live view into a detached editor
 *  window — the document moves as-is, unsaved edits included. */
function detachTabToWindow(id: string): void {
  if (!tabManager) return
  const record = tabManager.detachTab(id)
  if (!record) return
  const win = createDetachedEditorWindow({ ...record, applyMenuFor })
  win.focus()
}

function registerTabsIpc(): void {
  ipcMain.on(TABS_CHANNELS.chromePressed, (event) => broadcastChromePressed(event.sender))
  ipcMain.on(TABS_CHANNELS.treeInset, (_event, visible: unknown) => {
    tabManager?.setTreeInset(visible === true)
  })
  ipcMain.on(TABS_CHANNELS.treeWidth, (_event, px: unknown) => {
    if (typeof px === 'number' && Number.isFinite(px)) tabManager?.setTreeWidth(px)
  })
  ipcMain.on(TABS_CHANNELS.shellModal, (_event, open: unknown) => {
    tabManager?.setShellModalOpen(open === true)
  })
  ipcMain.handle(TABS_CHANNELS.list, () => tabManager?.list() ?? [])
  ipcMain.handle(TABS_CHANNELS.activate, (_event, id: unknown) => {
    if (typeof id !== 'string' || !id) return
    tabManager?.activateTab(id)
  })
  ipcMain.handle(TABS_CHANNELS.close, (_event, id: unknown) => {
    if (typeof id !== 'string' || !id) return
    return tabManager?.closeTab(id)
  })
  ipcMain.handle(TABS_CHANNELS.reorder, (_event, id: string, toIndex: number) => {
    if (typeof id === 'string' && Number.isInteger(toIndex)) tabManager?.reorderTab(id, toIndex)
  })
  // right-click context menu on a tab — native popup for the same reason as the
  // overflow menu above (WebContentsView covers DOM dropdowns)
  ipcMain.handle(
    TABS_CHANNELS.showTabContextMenu,
    (_event, x: unknown, y: unknown, tabId: unknown) => {
      if (!tabManager || !shellWindow || typeof tabId !== 'string') return
      const tabs = tabManager.list()
      const idx = tabs.findIndex((t) => t.id === tabId)
      if (idx < 0) return
      const isHome = tabs[idx]!.kind === 'home'
      const hasClosableLeft = tabs.some((t, i) => i < idx && t.id !== 'home')
      const hasClosableRight = tabs.some((t, i) => i > idx && t.id !== 'home')
      const hasOtherClosable = tabs.some((t) => t.id !== 'home' && t.id !== tabId)
      const hasAnyClosable = tabs.some((t) => t.id !== 'home')
      const items: MenuItemConstructorOptions[] = isHome
        ? [
            {
              label: tm('tabCtxCloseAll'),
              enabled: hasAnyClosable,
              click: () => void tabManager?.closeAllTabs(),
            },
          ]
        : [
            {
              label: tm('tabCtxClose'),
              click: () => void tabManager?.closeTab(tabId),
            },
            {
              label: tm('tabCtxCloseOthers'),
              enabled: hasOtherClosable,
              click: () => void tabManager?.closeOtherTabs(tabId),
            },
            { type: 'separator' },
            {
              label: tm('tabCtxCloseLeft'),
              enabled: hasClosableLeft,
              click: () => void tabManager?.closeLeftTabs(tabId),
            },
            {
              label: tm('tabCtxCloseRight'),
              enabled: hasClosableRight,
              click: () => void tabManager?.closeRightTabs(tabId),
            },
            { type: 'separator' },
            {
              label: tm('tabCtxCloseAll'),
              enabled: hasAnyClosable,
              click: () => void tabManager?.closeAllTabs(),
            },
          ]
      const menu = Menu.buildFromTemplate(items)
      menu.popup({
        window: shellWindow,
        ...(typeof x === 'number' && typeof y === 'number'
          ? { x: Math.round(x), y: Math.round(y) }
          : {}),
      })
    },
  )
  // "all tabs" overflow menu — native popup because the editors' WebContentsView
  // would cover any DOM dropdown the shell renderer draws below the tab strip
  ipcMain.handle(TABS_CHANNELS.showAppMenu, (_event, x: unknown, y: unknown) => {
    if (!shellWindow) return
    Menu.getApplicationMenu()?.popup({
      window: shellWindow,
      ...(typeof x === 'number' && typeof y === 'number'
        ? { x: Math.round(x), y: Math.round(y) }
        : {}),
    })
  })
  ipcMain.handle(TABS_CHANNELS.showMenu, (_event, x: unknown, y: unknown) => {
    if (!tabManager || !shellWindow) return
    const menu = Menu.buildFromTemplate(
      tabManager.list().map((tab) => ({
        label: tab.title,
        type: 'checkbox' as const,
        checked: tab.active,
        icon: menuIcons()[TAB_MENU_ICON[tab.kind]],
        click: () => tabManager?.activateTab(tab.id),
      })),
    )
    menu.popup({
      window: shellWindow,
      ...(typeof x === 'number' && typeof y === 'number'
        ? { x: Math.round(x), y: Math.round(y) }
        : {}),
    })
  })
  ipcMain.handle(TABS_CHANNELS.detach, (_event, id: unknown) => {
    if (typeof id !== 'string') return
    const tab = tabManager?.list().find((t) => t.id === id)
    if (tab && (tab.kind === 'docs' || tab.kind === 'sheets')) detachTabToWindow(id)
  })
  // per-tab context menu — native for the same reason as the tab list above
  ipcMain.handle(TABS_CHANNELS.showTabMenu, (_event, id: unknown, x: unknown, y: unknown) => {
    if (!tabManager || !shellWindow || typeof id !== 'string') return
    const tab = tabManager.list().find((t) => t.id === id)
    if (!tab || tab.kind === 'home') return
    const template: MenuItemConstructorOptions[] = []
    // MVP: docs + sheets; the other editors follow once their
    // detached-window quirks (slides fullscreen bleed, pdf) are covered
    if (tab.kind === 'docs' || tab.kind === 'sheets') {
      template.push({
        label: tm('menuOpenInNewWindow'),
        click: () => detachTabToWindow(id),
      })
      template.push({ type: 'separator' })
    }
    template.push({
      label: tm('menuClose'),
      enabled: tab.closable,
      click: () => void tabManager?.closeTab(id),
    })
    Menu.buildFromTemplate(template).popup({
      window: shellWindow,
      ...(typeof x === 'number' && typeof y === 'number'
        ? { x: Math.round(x), y: Math.round(y) }
        : {}),
    })
  })
  // "+" new-file menu — native for the same reason as the tab list above
  ipcMain.handle(TABS_CHANNELS.showNewMenu, (_event, x: unknown, y: unknown) => {
    if (!tabManager || !shellWindow) return
    const menu = Menu.buildFromTemplate([
      // enabled:false so pre-Sonoma macOS / Windows (no 'header' support) degrade
      // to an inert label instead of a clickable no-op item
      { label: tm('menuSectionNew'), type: 'header', enabled: false },
      {
        label: tm('menuNewDoc'),
        icon: menuIcons().docx,
        click: () => newDocTab(),
      },
      {
        label: tm('menuNewSheet'),
        icon: menuIcons().xlsx,
        click: () => void newSheetTab(),
      },
      {
        label: tm('menuNewSlide'),
        icon: menuIcons().pptx,
        click: () => newSlideTab(),
      },
      {
        label: tm('menuNewMarkdown'),
        icon: menuIcons().md,
        click: () => newMarkdownTab(),
      },
      {
        label: tm('menuNewHtml'),
        icon: menuIcons().html,
        click: () => newHtmlTab(),
      },
      {
        label: tm('menuNewPdf'),
        icon: menuIcons().pdf,
        click: () => void newPdfTab(),
      },
      { type: 'separator' },
      { label: tm('menuOpen'), click: () => void openFileViaDialog() },
    ])
    menu.popup({
      window: shellWindow,
      ...(typeof x === 'number' && typeof y === 'number'
        ? { x: Math.round(x), y: Math.round(y) }
        : {}),
    })
  })
}

/** Home 右栏停靠契约的 IPC 面（P1, apps/shell/src/shared/dock-api.ts） */
function registerDockIpc(): void {
  ipcMain.on(DOCK_CHANNELS.setRect, (_event, rect: unknown) => {
    if (!tabManager) return
    const r = rect as DockRect | null
    if (
      !r ||
      typeof r.x !== 'number' ||
      typeof r.y !== 'number' ||
      typeof r.width !== 'number' ||
      typeof r.height !== 'number' ||
      !Number.isFinite(r.x) ||
      !Number.isFinite(r.y) ||
      !Number.isFinite(r.width) ||
      !Number.isFinite(r.height)
    )
      return
    tabManager.setDockRect({ x: r.x, y: r.y, width: r.width, height: r.height })
  })
  ipcMain.handle(DOCK_CHANNELS.list, () => tabManager?.dockedTabs() ?? [])
  ipcMain.handle(DOCK_CHANNELS.open, (_event, kind: unknown, options: unknown) => {
    if (!tabManager || typeof kind !== 'string') return null
    const opts = (options ?? {}) as DockEditorOptions
    // an existing file rides the extension router (dock placement, panel
    // hidden for docs); kind is only the fallback for blank/seeded docks
    if (opts.file && existsSync(opts.file)) {
      const routed = routeDocumentPath(opts.file, true)
      if (!routed) return null
      return tabManager.dockedTabs().find((t) => t.filePath === opts.file) ?? null
    }
    const id = tabManager.dockEditorTab(kind as DockKind, opts)
    if (!id) return null
    return tabManager.dockedTabs().find((t) => t.id === id) ?? null
  })
  ipcMain.handle(DOCK_CHANNELS.activate, (_event, id: unknown) => {
    if (typeof id === 'string') tabManager?.activateDockedTab(id)
  })
  ipcMain.handle(DOCK_CHANNELS.close, (_event, id: unknown) => {
    if (typeof id === 'string') return tabManager?.closeTab(id)
  })
  ipcMain.handle(DOCK_CHANNELS.undock, (_event, id: unknown) => {
    if (typeof id === 'string') tabManager?.undockTab(id)
  })
  // P2 中继: shell renderer ⇄ docked editor loop (RelayCommand in, RelayEvent out)
  ipcMain.on(DOCK_CHANNELS.relayCommand, (_event, dockTabId: unknown, command: unknown) => {
    if (typeof dockTabId !== 'string' || !tabManager) return
    const wcId = tabManager.webContentsIdOf(dockTabId)
    if (wcId) forwardRelayCommand(wcId, command)
  })
}

/** dock 渲染器的 RelayEvent → 壳渲染器(补 tab id);web 形态走 postMessage 不经此 */
function installRelayEventForwarder(): void {
  setRelayEventForwarder((wcId, event) => {
    if (!shellWindow || shellWindow.isDestroyed() || !tabManager) return
    const tabId = tabManager.tabIdForWebContents(wcId)
    if (tabId && tabManager.list().find((t) => t.id === tabId)?.docked) {
      shellWindow.webContents.send(DOCK_CHANNELS.relayEvent, tabId, event)
    }
  })
  // P2-5 回流薄钩: full-tab panel turns mirror into the Home mainline
  setPanelTurnForwarder((turn) => {
    if (shellWindow && !shellWindow.isDestroyed()) {
      shellWindow.webContents.send(DOCK_CHANNELS.panelTurn, turn)
    }
  })
}

// ---- home menu ----

async function openFileViaDialog(): Promise<void> {
  const win = shellWindow ?? BrowserWindow.getFocusedWindow()
  if (!win) return
  const result = await showOpenDialogWithMemory(dialog, win, {
    filters: [{ name: tm('filterSupported'), extensions: OPEN_DIALOG_EXTENSIONS }],
    properties: ['openFile', 'multiSelections'],
  })
  if (!result.canceled) for (const path of result.filePaths) openDocumentPath(path)
}

// ---- LOCAL(purchase): 激活 menu section (above 帮助) ----

/** Cached entitlement snapshot for the menu status line; null until the
 * first async load lands (the menu itself builds synchronously). */
let purchaseMenuSnapshot: PurchaseSnapshot | null = null
let lastAppliedMenuKind: TabKind | null = null

function purchaseStatusLabel(): string {
  const s = purchaseMenuSnapshot
  if (s === null) return tm('menuActivateLoading')
  if (s.entitled) return tm('menuActivateEntitled').replaceAll('{date}', (s.expireAt ?? '').slice(0, 10))
  return s.freeDaysLeft > 0
    ? tm('menuActivateFree').replaceAll('{n}', String(s.freeDaysLeft))
    : tm('menuActivateExpired')
}

/** The standalone top-level 激活 menu: live status line + entry that opens
 * the renderer purchase dialog (QR + activation form) via the same
 * open-page event the scheduler uses. */
function activateMenuSection(): MenuItemConstructorOptions {
  return {
    label: tm('menuActivate'),
    submenu: [
      { label: purchaseStatusLabel(), enabled: false },
      { type: 'separator' },
      { label: tm('menuPurchaseActivate'), click: () => openPurchasePage(shellWindow) },
    ],
  }
}

/** Pull a fresh snapshot and rebuild the current menu so the status line
 * flips (e.g. 已激活 · 至日期) the moment an activation lands. */
async function refreshPurchaseMenu(): Promise<void> {
  try {
    purchaseMenuSnapshot = await purchaseSnapshot()
  } catch {
    return // keep the previous label on failure
  }
  if (lastAppliedMenuKind !== null) applyMenuFor(lastAppliedMenuKind)
}

function buildHomeMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: tm('menuFile'),
      submenu: [
        { label: tm('menuSectionNew'), type: 'header', enabled: false },
        {
          label: tm('menuNewDoc'),
          accelerator: 'CmdOrCtrl+N',
          click: () => newDocTab(),
        },
        {
          label: tm('menuNewSheet'),
          click: () => void newSheetTab(),
        },
        { label: tm('menuNewSlide'), click: () => newSlideTab() },
        { label: tm('menuNewMarkdown'), click: () => newMarkdownTab() },
        { label: tm('menuNewHtml'), click: () => newHtmlTab() },
        { label: tm('menuNewPdf'), click: () => void newPdfTab() },
        { type: 'separator' },
        {
          label: tm('menuOpen'),
          accelerator: 'CmdOrCtrl+O',
          click: () => void openFileViaDialog(),
        },
        { type: 'separator' },
        { role: 'close', label: tm('menuClose') },
      ],
    },
    editMenuTemplate(process.platform, appMenuLabels(currentLang())),
    windowMenuTemplate(process.platform, appMenuLabels(currentLang())),
    {
      role: 'help',
      label: tm('menuHelp'),
      submenu: [
        { label: tm('thirdPartyNotices'), click: () => void openThirdPartyNotices() },
        { type: 'separator' },
        checkUpdatesMenuItem(appMenuLabels(currentLang())),
        aboutMenuItem(appMenuLabels(currentLang())),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---- pdf menu (pdf-main has no menu of its own; the shell owns pdf tabs, so it builds one) ----

function buildPdfMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: tm('menuFile'),
      submenu: [
        {
          label: tm('menuOpen'),
          accelerator: 'CmdOrCtrl+O',
          click: () => void openFileViaDialog(),
        },
        { type: 'separator' },
        {
          label: tm('backToHome'),
          accelerator: 'Shift+CmdOrCtrl+H',
          click: () => tabManager?.openHomeTab(),
        },
        { type: 'separator' },
        {
          label: tm('menuSave'),
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            const tab = tabManager?.activePdfTab()
            if (tab) void flushPdfSave(tab.webContents)
          },
        },
        {
          label: tm('menuSaveAs'),
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => void savePdfAs(),
        },
        { type: 'separator' },
        // local pdf2docx (P4): in-process PDFium wasm, no cloud counterpart
        {
          label: tm('menuExportDocx'),
          click: () => void exportPdfAsDocx(),
        },
        {
          label: tm('menuExportDocxLocal'),
          click: () => void exportPdfAsDocxLocal(),
        },
        // local pdf2pptx (P25): one slide per page, no cloud counterpart
        {
          label: tm('menuExportPptx'),
          click: () => void exportPdfAsPptxLocal(),
        },
        // local pdf2xlsx (P26): one worksheet per page, no cloud counterpart
        {
          label: tm('menuExportXlsx'),
          click: () => void exportPdfAsXlsxLocal(),
        },
        { type: 'separator' },
        {
          label: tm('menuPrint'),
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            const tab = tabManager?.activePdfTab()
            if (tab) sendPdfPrintRequest(tab.webContents)
          },
        },
        { type: 'separator' },
        {
          label: tm('menuClose'),
          accelerator: 'CmdOrCtrl+W',
          click: () => tabManager?.closeActiveTab(),
        },
      ],
    },
    editMenuTemplate(process.platform, appMenuLabels(currentLang())),
    windowMenuTemplate(process.platform, appMenuLabels(currentLang())),
    {
      role: 'help',
      label: tm('menuHelp'),
      submenu: [
        { label: tm('thirdPartyNotices'), click: () => void openThirdPartyNotices() },
        { type: 'separator' },
        checkUpdatesMenuItem(appMenuLabels(currentLang())),
        aboutMenuItem(appMenuLabels(currentLang())),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---- markdown menu (markdown-main has no menu of its own; the shell owns markdown tabs) ----

function buildMarkdownMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: tm('menuFile'),
      submenu: [
        {
          label: tm('menuOpen'),
          accelerator: 'CmdOrCtrl+O',
          click: () => void openFileViaDialog(),
        },
        { type: 'separator' },
        {
          label: tm('backToHome'),
          accelerator: 'Shift+CmdOrCtrl+H',
          click: () => tabManager?.openHomeTab(),
        },
        { type: 'separator' },
        {
          label: tm('menuSave'),
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            const tab = tabManager?.activeMarkdownTab()
            if (tab) void requestMarkdownSave(tab.webContents, 'save')
          },
        },
        {
          label: tm('menuSaveAs'),
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            const tab = tabManager?.activeMarkdownTab()
            if (tab) void requestMarkdownSave(tab.webContents, 'saveAs')
          },
        },
        { type: 'separator' },
        {
          label: tm('menuExportDocx'),
          click: () => {
            const tab = tabManager?.activeMarkdownTab()
            if (tab) sendMarkdownExportRequest(tab.webContents, 'docx')
          },
        },
        {
          label: tm('menuExportPdf'),
          click: () => {
            const tab = tabManager?.activeMarkdownTab()
            if (tab) sendMarkdownExportRequest(tab.webContents, 'pdf')
          },
        },
        {
          label: tm('menuExportImages'),
          click: () => {
            const tab = tabManager?.activeMarkdownTab()
            if (tab) sendMarkdownExportRequest(tab.webContents, 'png')
          },
        },
        {
          label: tm('menuOpenInDocs'),
          click: () => {
            const tab = tabManager?.activeMarkdownTab()
            if (tab) sendMarkdownExportRequest(tab.webContents, 'docs')
          },
        },
        { type: 'separator' },
        {
          label: tm('menuPrint'),
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            const tab = tabManager?.activeMarkdownTab()
            if (tab) sendMarkdownPrintRequest(tab.webContents)
          },
        },
        { type: 'separator' },
        {
          label: tm('menuClose'),
          accelerator: 'CmdOrCtrl+W',
          click: () => tabManager?.closeActiveTab(),
        },
      ],
    },
    editMenuTemplate(process.platform, appMenuLabels(currentLang())),
    windowMenuTemplate(process.platform, appMenuLabels(currentLang())),
    {
      role: 'help',
      label: tm('menuHelp'),
      submenu: [
        { label: tm('thirdPartyNotices'), click: () => void openThirdPartyNotices() },
        { type: 'separator' },
        checkUpdatesMenuItem(appMenuLabels(currentLang())),
        aboutMenuItem(appMenuLabels(currentLang())),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---- html menu (html-main has no menu of its own; the shell owns html tabs) ----

function buildHtmlMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: tm('menuFile'),
      submenu: [
        {
          label: tm('menuOpen'),
          accelerator: 'CmdOrCtrl+O',
          click: () => void openFileViaDialog(),
        },
        { type: 'separator' },
        {
          label: tm('backToHome'),
          accelerator: 'Shift+CmdOrCtrl+H',
          click: () => tabManager?.openHomeTab(),
        },
        { type: 'separator' },
        {
          label: tm('menuSave'),
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            const tab = tabManager?.activeHtmlTab()
            if (tab) void requestHtmlSave(tab.webContents, 'save')
          },
        },
        {
          label: tm('menuSaveAs'),
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            const tab = tabManager?.activeHtmlTab()
            if (tab) void requestHtmlSave(tab.webContents, 'saveAs')
          },
        },
        { type: 'separator' },
        {
          label: tm('menuExportDocx'),
          click: () => {
            const tab = tabManager?.activeHtmlTab()
            if (tab) sendHtmlExportRequest(tab.webContents, 'docx')
          },
        },
        {
          label: tm('menuExportPdf'),
          click: () => {
            const tab = tabManager?.activeHtmlTab()
            if (tab) sendHtmlExportRequest(tab.webContents, 'pdf')
          },
        },
        {
          label: tm('menuExportHtml'),
          click: () => {
            const tab = tabManager?.activeHtmlTab()
            if (tab) sendHtmlExportRequest(tab.webContents, 'html')
          },
        },
        { type: 'separator' },
        {
          label: tm('menuPrint'),
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            const tab = tabManager?.activeHtmlTab()
            if (tab) sendHtmlPrintRequest(tab.webContents)
          },
        },
        { type: 'separator' },
        {
          label: tm('menuClose'),
          accelerator: 'CmdOrCtrl+W',
          click: () => tabManager?.closeActiveTab(),
        },
      ],
    },
    editMenuTemplate(process.platform, appMenuLabels(currentLang())),
    windowMenuTemplate(process.platform, appMenuLabels(currentLang())),
    {
      role: 'help',
      label: tm('menuHelp'),
      submenu: [
        { label: tm('thirdPartyNotices'), click: () => void openThirdPartyNotices() },
        { type: 'separator' },
        checkUpdatesMenuItem(appMenuLabels(currentLang())),
        aboutMenuItem(appMenuLabels(currentLang())),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * Save As for pdf tabs: write pending edits to the picked path only, then open the copy.
 * Non-destructive: the original file is never written, and a cancelled dialog changes
 * nothing on disk (dialog first, no flush into the source).
 */
/** In-flight guard (same pattern as exportPdfAsDocxLocal): a re-trigger while the dialog
    or write is active must not start a second flow that overwrites the first one's
    waiter/target grant or clears its autosave pause early */
let savingPdfAs = false

async function savePdfAs(): Promise<void> {
  const tab = tabManager?.activePdfTab()
  if (!tab?.filePath || !shellWindow || savingPdfAs) return
  // An untitled (temp-backed) tab's Save As prefills the pending project folder
  // and untitled/AI name instead of the hidden temp path.
  const untitledDefault = pdfUntitledDialogDefault(tab.webContents.id)
  savingPdfAs = true
  // Pause renderer autosave for the whole flow: the dialog blurs the window, and a
  // blur-triggered autosave would write the pending edits into the original file
  setPdfSaveAsInFlight(tab.webContents, true)
  try {
    const picked = await showSaveDialogWithMemory(dialog, shellWindow, {
      defaultPath: untitledDefault ?? tab.filePath,
      filters: [{ name: tm('filterPdf'), extensions: ['pdf'] }],
    })
    if (picked.canceled || !picked.filePath || picked.filePath === tab.filePath) return
    if (pdfIsDirty(tab.webContents.id)) {
      // Renderer applies its pending edits onto the source bytes; the pdf main
      // process writes the result to the picked path only. An untitled tab is
      // retargeted by the save handler itself (temp backing file retired).
      if (!(await requestPdfSaveAs(tab.webContents, picked.filePath))) return
    } else {
      // No pending edits → a byte-identical copy
      copyFileSync(tab.filePath, picked.filePath)
      if (untitledDefault) finalizePdfUntitled(tab.webContents, tab.filePath, picked.filePath)
    }
    openDocumentPath(picked.filePath)
  } finally {
    savingPdfAs = false
    setPdfSaveAsInFlight(tab.webContents, false)
  }
}

/**
 * In-flight guard: covers the whole flow (dialogs included) so re-triggering
 * from the menu can never start a second conversion
 */
let exportingPdfDocx = false

/**
 * Export as Word for pdf tabs: flush pending edits, confirm the 5-credit cost,
 * pick the destination, then upload + cloud-convert via chatoffice file_convert. Not
 * logged in → offer browser login and let the user re-trigger the export
 * afterwards. The destination is picked before converting so cancelling the
 * save dialog never wastes a paid conversion.
 */

/**
 * Export as Word for pdf tabs, fully local (pdf2docx P4): flush pending
 * edits, pick the destination, convert in-process via PDFium wasm, write the
 * file and open it in a Docs tab. No login, no credits.
 */

async function exportPdfAsDocx(): Promise<void> {
  const tab = tabManager?.activePdfTab()
  if (!tab?.filePath || !shellWindow) return
  if (exportingPdfDocx) {
    // Re-triggered while a previous export (dialogs or cloud conversion) is
    // still in flight: tell the user instead of silently ignoring the click.
    void dialog.showMessageBox(shellWindow, {
      type: 'info',
      message: tm('pdfDocxBusyMsg'),
    })
    return
  }
  exportingPdfDocx = true
  try {
    if (!(await flushPdfSave(tab.webContents))) return
    if (!hasChatOfficeAuth()) {
      // hasChatOfficeAuth() is also false when the chatoffice CLI itself cannot be resolved
      // (broken install); Sign In could not launch in that case, so surface
      // the real problem instead of a login dialog that cannot succeed.
      if (!resolveChatOfficeEntry()) {
        void dialog.showMessageBox(shellWindow, {
          type: 'error',
          message: tm('pdfDocxNoCliMsg'),
        })
        return
      }
      const { response } = await dialog.showMessageBox(shellWindow, {
        type: 'info',
        message: tm('pdfDocxLoginMsg'),
        detail: tm('pdfDocxLoginDetail'),
        buttons: [tm('pdfDocxBtnLogin'), tm('btnCancel')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      if (response === 0) ensureChatofficeLogin((url) => void shell.openExternal(url))
      return
    }
    const balance = (await chatofficeLoginInfo())?.creditBalance
    const balanceLine =
      balance === undefined
        ? ''
        : ` ${tm('pdfDocxConfirmBalance', { balance: Math.floor(balance).toLocaleString('en-US') })}`
    const confirm = await dialog.showMessageBox(shellWindow, {
      type: 'question',
      message: tm('pdfDocxConfirmMsg'),
      detail: `${tm('pdfDocxConfirmDetail')}${balanceLine}`,
      buttons: [tm('pdfDocxBtnConvert'), tm('btnCancel')],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (confirm.response !== 0) return
    const picked = await showSaveDialogWithMemory(dialog, shellWindow, {
      defaultPath: tab.filePath.replace(/\.pdf$/i, '.docx'),
      filters: [{ name: tm('filterWord'), extensions: ['docx'] }],
    })
    if (picked.canceled || !picked.filePath) return
    // If the destination is already open in a docs tab, close it first (its
    // normal unsaved-changes guard applies) so the converted file opens fresh
    // instead of leaving a stale tab whose next save would clobber the result.
    // Cancelling the close aborts the export before any credits are spent.
    const staleTabId = tabManager?.findDocsTabByPath(picked.filePath)
    if (staleTabId) {
      await tabManager?.closeTab(staleTabId)
      // closeTab activates the docs tab for its unsaved-changes prompt (and a
      // fallback tab after a successful close), so bring the pdf tab back
      // either way — especially when the user cancels and the export aborts.
      tabManager?.activateTab(tab.id)
      if (tabManager?.findDocsTabByPath(picked.filePath)) return
    }
    shellWindow.setProgressBar(2)
    const bytes = await chatofficeConvertPdfToDocx(tab.filePath)
    writeFileSync(picked.filePath, bytes)
    openDocumentPath(picked.filePath)
  } catch (err) {
    if (shellWindow && !shellWindow.isDestroyed()) {
      void dialog.showMessageBox(shellWindow, {
        type: 'error',
        message: tm('pdfDocxFailedMsg'),
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  } finally {
    exportingPdfDocx = false
    if (shellWindow && !shellWindow.isDestroyed()) shellWindow.setProgressBar(-1)
  }
}

async function exportPdfAsDocxLocal(): Promise<void> {
  const tab = tabManager?.activePdfTab()
  if (!tab?.filePath || !shellWindow) return
  if (exportingPdfDocx) {
    void dialog.showMessageBox(shellWindow, {
      type: 'info',
      message: tm('pdfDocxBusyMsg'),
    })
    return
  }
  exportingPdfDocx = true
  try {
    if (!(await flushPdfSave(tab.webContents))) return
    const picked = await showSaveDialogWithMemory(dialog, shellWindow, {
      defaultPath: tab.filePath.replace(/\.pdf$/i, '.docx'),
      filters: [{ name: tm('filterWord'), extensions: ['docx'] }],
    })
    if (picked.canceled || !picked.filePath) return
    // If the destination is already open in a docs tab, close it first (its
    // normal unsaved-changes guard applies) so the converted file opens fresh
    // instead of leaving a stale tab whose next save would clobber the result.
    const staleTabId = tabManager?.findDocsTabByPath(picked.filePath)
    if (staleTabId) {
      await tabManager?.closeTab(staleTabId)
      tabManager?.activateTab(tab.id)
      if (tabManager?.findDocsTabByPath(picked.filePath)) return
    }
    shellWindow.setProgressBar(2)
    // encrypted PDFs prompt for the password (P23), looping on wrong entries;
    // null result = user cancelled the prompt → abort silently
    const pdfPath = tab.filePath
    const result = await convertPdfFileToDocxLocalWithPrompt(
      pdfPath,
      (retry) =>
        promptPdfPassword(shellWindow, {
          fileName: basename(pdfPath),
          retry,
          busy: false,
          lang: currentLang(),
          strings: {
            title: tm('pdfPwdTitle'),
            prompt: tm('pdfPwdPrompt'),
            retryPrompt: tm('pdfPwdRetryPrompt'),
            ok: tm('pdfPwdOk'),
            cancel: tm('btnCancel'),
            verifying: tm('pdfPwdVerifying'),
            label: tm('pdfPwdLabel'),
            placeholder: tm('pdfPwdPlaceholder'),
            show: tm('pdfPwdShow'),
            hide: tm('pdfPwdHide'),
          },
        }),
      (page, total) => {
        if (shellWindow && !shellWindow.isDestroyed() && total > 0) {
          shellWindow.setProgressBar(page / total)
        }
      },
    )
    if (result === null) return
    writeFileSync(picked.filePath, result.docx)

    // degrade transparency (plan §7.6 dual-track split): whole scan → say so
    // once; individual image-fallback pages → name them;
    // OCR-recovered scans ('ocr') are SUCCESSES — announce the recovery (the
    // user should proofread machine-read text), never the image-export notice
    const ocrPages = result.pageResults.filter((r) => r.status === 'ocr').map((r) => r.page)
    const imagePages = result.pageResults
      .filter((r) => r.status !== 'ok' && r.status !== 'ocr')
      .map((r) => r.page)
    if (result.scannedDocument) {
      await dialog.showMessageBox(shellWindow, {
        type: 'info',
        message: tm('pdfDocxLocalScannedMsg'),
        detail: tm('pdfDocxLocalScannedDetail'),
      })
    } else if (imagePages.length > 0 && ocrPages.length > 0) {
      // mixed documents surface BOTH facts in one dialog: which pages shipped
      // as images and which carry machine-read text the user should proofread
      await dialog.showMessageBox(shellWindow, {
        type: 'info',
        message: tm('pdfDocxLocalDegradedMsg'),
        detail:
          tm('pdfDocxLocalDegradedDetail', { pages: imagePages.join(', ') }) +
          '\n\n' +
          tm('pdfDocxLocalOcrDetail', { pages: ocrPages.join(', ') }),
      })
    } else if (imagePages.length > 0) {
      await dialog.showMessageBox(shellWindow, {
        type: 'info',
        message: tm('pdfDocxLocalDegradedMsg'),
        detail: tm('pdfDocxLocalDegradedDetail', { pages: imagePages.join(', ') }),
      })
    } else if (ocrPages.length > 0) {
      await dialog.showMessageBox(shellWindow, {
        type: 'info',
        message: tm('pdfDocxLocalOcrMsg'),
        detail: tm('pdfDocxLocalOcrDetail', { pages: ocrPages.join(', ') }),
      })
    }
    openDocumentPath(picked.filePath)
  } catch (err) {
    if (shellWindow && !shellWindow.isDestroyed()) {
      // structured load failures (P22): password-protected / damaged PDFs get
      // a human-readable explanation instead of the raw PDFium error string
      const detail =
        err instanceof PdfLoadError
          ? err.code === 'password-required'
            ? tm('pdfDocxLocalEncryptedDetail')
            : err.code === 'unsupported'
              ? // certificate-based or otherwise unsupported security (FPDF
                // error 5): a hard PDFium boundary — no password can open it
                // locally, so the message must NOT suggest one (P24 C)
                tm('pdfDocxLocalUnsupportedEncDetail')
              : tm('pdfDocxLocalCorruptDetail')
          : err instanceof Error
            ? err.message
            : String(err)
      void dialog.showMessageBox(shellWindow, {
        type: 'error',
        message: tm('pdfDocxFailedMsg'),
        detail,
      })
    }
  } finally {
    // the prompt window may still be open when the loop exits through cancel
    // or a non-password error thrown mid-retry
    closePdfPasswordDialog()
    exportingPdfDocx = false
    if (shellWindow && !shellWindow.isDestroyed()) shellWindow.setProgressBar(-1)
  }
}

/**
 * Export as PowerPoint for pdf tabs, fully local (pdf2pptx P25): flush
 * pending edits, pick the destination, convert in-process via PDFium wasm,
 * write the file and open it in a Slides tab. No login, no credits. Shares
 * the in-flight guard with the Word exports so pdfium never runs two
 * conversions at once.
 */
async function exportPdfAsPptxLocal(): Promise<void> {
  const tab = tabManager?.activePdfTab()
  if (!tab?.filePath || !shellWindow) return
  if (exportingPdfDocx) {
    void dialog.showMessageBox(shellWindow, {
      type: 'info',
      message: tm('pdfPptxBusyMsg'),
    })
    return
  }
  exportingPdfDocx = true
  try {
    if (!(await flushPdfSave(tab.webContents))) return
    const picked = await showSaveDialogWithMemory(dialog, shellWindow, {
      defaultPath: tab.filePath.replace(/\.pdf$/i, '.pptx'),
      filters: [{ name: tm('filterPpt'), extensions: ['pptx'] }],
    })
    if (picked.canceled || !picked.filePath) return
    // same stale-tab handling as the Word export (see exportPdfAsDocxLocal),
    // against the slides tab that may already show the destination file
    const staleTabId = tabManager?.findSlidesTabByPath(picked.filePath)
    if (staleTabId) {
      await tabManager?.closeTab(staleTabId)
      tabManager?.activateTab(tab.id)
      if (tabManager?.findSlidesTabByPath(picked.filePath)) return
    }
    shellWindow.setProgressBar(2)
    // encrypted PDFs prompt for the password (P23), looping on wrong entries;
    // null result = user cancelled the prompt → abort silently
    const pdfPath = tab.filePath
    const result = await convertPdfFileToPptxLocalWithPrompt(
      pdfPath,
      (retry) =>
        promptPdfPassword(shellWindow, {
          fileName: basename(pdfPath),
          retry,
          busy: false,
          lang: currentLang(),
          strings: {
            title: tm('pdfPwdTitle'),
            prompt: tm('pdfPwdPrompt'),
            retryPrompt: tm('pdfPwdRetryPrompt'),
            ok: tm('pdfPwdOk'),
            cancel: tm('btnCancel'),
            verifying: tm('pdfPwdVerifying'),
            label: tm('pdfPwdLabel'),
            placeholder: tm('pdfPwdPlaceholder'),
            show: tm('pdfPwdShow'),
            hide: tm('pdfPwdHide'),
          },
        }),
      (page, total) => {
        if (shellWindow && !shellWindow.isDestroyed() && total > 0) {
          shellWindow.setProgressBar(page / total)
        }
      },
    )
    if (result === null) return
    writeFileSync(picked.filePath, result.pptx)

    // degrade transparency (same split as the Word export): whole scan vs
    // individual image-fallback pages
    const imagePages = result.pageResults.filter((r) => r.status !== 'ok').map((r) => r.page)
    if (result.scannedDocument) {
      await dialog.showMessageBox(shellWindow, {
        type: 'info',
        message: tm('pdfDocxLocalScannedMsg'),
        detail: tm('pdfPptxLocalScannedDetail'),
      })
    } else if (imagePages.length > 0) {
      await dialog.showMessageBox(shellWindow, {
        type: 'info',
        message: tm('pdfDocxLocalDegradedMsg'),
        detail: tm('pdfDocxLocalDegradedDetail', { pages: imagePages.join(', ') }),
      })
    }
    openDocumentPath(picked.filePath)
  } catch (err) {
    if (shellWindow && !shellWindow.isDestroyed()) {
      // structured load failures (P22): same explanations as the Word export
      const detail =
        err instanceof PdfLoadError
          ? err.code === 'password-required'
            ? tm('pdfDocxLocalEncryptedDetail')
            : err.code === 'unsupported'
              ? tm('pdfDocxLocalUnsupportedEncDetail')
              : tm('pdfDocxLocalCorruptDetail')
          : err instanceof Error
            ? err.message
            : String(err)
      void dialog.showMessageBox(shellWindow, {
        type: 'error',
        message: tm('pdfPptxFailedMsg'),
        detail,
      })
    }
  } finally {
    closePdfPasswordDialog()
    exportingPdfDocx = false
    if (shellWindow && !shellWindow.isDestroyed()) shellWindow.setProgressBar(-1)
  }
}

/**
 * Export as Excel for pdf tabs, fully local (pdf2xlsx P26): flush pending
 * edits, pick the destination, convert in-process via PDFium wasm, write the
 * file and open it in a Sheets tab. No login, no credits. Shares the
 * in-flight guard with the Word/PowerPoint exports so pdfium never runs two
 * conversions at once.
 */
async function exportPdfAsXlsxLocal(): Promise<void> {
  const tab = tabManager?.activePdfTab()
  if (!tab?.filePath || !shellWindow) return
  if (exportingPdfDocx) {
    void dialog.showMessageBox(shellWindow, {
      type: 'info',
      message: tm('pdfXlsxBusyMsg'),
    })
    return
  }
  exportingPdfDocx = true
  try {
    if (!(await flushPdfSave(tab.webContents))) return
    const picked = await showSaveDialogWithMemory(dialog, shellWindow, {
      defaultPath: tab.filePath.replace(/\.pdf$/i, '.xlsx'),
      filters: [{ name: tm('filterExcel'), extensions: ['xlsx'] }],
    })
    if (picked.canceled || !picked.filePath) return
    // same stale-tab handling as the Word export (see exportPdfAsDocxLocal),
    // against the sheets tab that may already show the destination file
    const staleTabId = tabManager?.findSheetsTabByPath(picked.filePath)
    if (staleTabId) {
      await tabManager?.closeTab(staleTabId)
      tabManager?.activateTab(tab.id)
      if (tabManager?.findSheetsTabByPath(picked.filePath)) return
    }
    shellWindow.setProgressBar(2)
    // encrypted PDFs prompt for the password (P23), looping on wrong entries;
    // null result = user cancelled the prompt → abort silently
    const pdfPath = tab.filePath
    const result = await convertPdfFileToXlsxLocalWithPrompt(
      pdfPath,
      (retry) =>
        promptPdfPassword(shellWindow, {
          fileName: basename(pdfPath),
          retry,
          busy: false,
          lang: currentLang(),
          strings: {
            title: tm('pdfPwdTitle'),
            prompt: tm('pdfPwdPrompt'),
            retryPrompt: tm('pdfPwdRetryPrompt'),
            ok: tm('pdfPwdOk'),
            cancel: tm('btnCancel'),
            verifying: tm('pdfPwdVerifying'),
            label: tm('pdfPwdLabel'),
            placeholder: tm('pdfPwdPlaceholder'),
            show: tm('pdfPwdShow'),
            hide: tm('pdfPwdHide'),
          },
        }),
      (page, total) => {
        if (shellWindow && !shellWindow.isDestroyed() && total > 0) {
          shellWindow.setProgressBar(page / total)
        }
      },
    )
    if (result === null) return
    writeFileSync(picked.filePath, result.xlsx)

    // degrade transparency: pages that could not become cells got a notice
    // row on their worksheet instead of an image (a spreadsheet has none)
    const noticePages = result.pageResults.filter((r) => r.status !== 'ok').map((r) => r.page)
    if (result.scannedDocument) {
      await dialog.showMessageBox(shellWindow, {
        type: 'info',
        message: tm('pdfDocxLocalScannedMsg'),
        detail: tm('pdfXlsxLocalScannedDetail'),
      })
    } else if (noticePages.length > 0) {
      await dialog.showMessageBox(shellWindow, {
        type: 'info',
        message: tm('pdfXlsxLocalSkippedMsg'),
        detail: tm('pdfXlsxLocalSkippedDetail', { pages: noticePages.join(', ') }),
      })
    }
    openDocumentPath(picked.filePath)
  } catch (err) {
    if (shellWindow && !shellWindow.isDestroyed()) {
      // structured load failures (P22): same explanations as the Word export
      const detail =
        err instanceof PdfLoadError
          ? err.code === 'password-required'
            ? tm('pdfDocxLocalEncryptedDetail')
            : err.code === 'unsupported'
              ? tm('pdfDocxLocalUnsupportedEncDetail')
              : tm('pdfDocxLocalCorruptDetail')
          : err instanceof Error
            ? err.message
            : String(err)
      void dialog.showMessageBox(shellWindow, {
        type: 'error',
        message: tm('pdfXlsxFailedMsg'),
        detail,
      })
    }
  } finally {
    closePdfPasswordDialog()
    exportingPdfDocx = false
    if (shellWindow && !shellWindow.isDestroyed()) shellWindow.setProgressBar(-1)
  }
}

// The pdf renderer's converter dropdown funnels into the same local conversion
// flows as the File menu items (dialogs, password prompt, in-flight guard included)
ipcMain.handle(PDF_CHANNELS.convertOffice, async (e, format: unknown) => {
  // only the active pdf tab may trigger a conversion (its file is the source)
  if (tabManager?.activePdfTab()?.webContents.id !== e.sender.id) return
  if (format === 'docx') await exportPdfAsDocxLocal()
  else if (format === 'xlsx') await exportPdfAsXlsxLocal()
  else if (format === 'pptx') await exportPdfAsPptxLocal()
})

function openThirdPartyNotices(): Promise<string> {
  const path = app.isPackaged
    ? join(process.resourcesPath, 'THIRD-PARTY-NOTICES.txt')
    : join(app.getAppPath(), 'build', 'THIRD-PARTY-NOTICES.txt')
  return shell.openPath(path)
}

/** every module's File menu gets a way back to the launcher */
function installBackToHomeItems(): void {
  const backToHomeItem: MenuItemConstructorOptions = {
    label: tm('backToHome'),
    accelerator: 'Shift+CmdOrCtrl+H',
    click: () => tabManager?.openHomeTab(),
  }
  setDocsExtraFileMenuItems([backToHomeItem])
  setSheetsExtraFileMenuItems([backToHomeItem])
  setSlidesExtraFileMenuItems([backToHomeItem])
}

function installDockMenu(): void {
  if (process.platform !== 'darwin') return
  // Dev runs from the stock Electron.app, whose dock icon is Electron's own;
  // packaged builds take the brand icon from icon.icns at full quality.
  if (!app.isPackaged) app.dock?.setIcon(APP_ICON)
  app.dock?.setMenu(
    Menu.buildFromTemplate([
      { label: tm('menuHome'), click: () => tabManager?.openHomeTab() },
      {
        label: tm('menuNewDoc'),
        click: () => newDocTab(),
      },
      {
        label: tm('menuNewSheet'),
        click: () => void newSheetTab(),
      },
      { label: tm('menuNewSlide'), click: () => newSlideTab() },
      { label: tm('menuNewMarkdown'), click: () => newMarkdownTab() },
      { label: tm('menuNewPdf'), click: () => void newPdfTab() },
    ]),
  )
}

// On mainland-China networks the main process's Node fetch (undici) bypasses the system proxy,
// so direct calls to overseas LLM/image-search APIs time out or get region-blocked (403).
// Prefer proxy env vars (terminal launch); a packaged app launched from Finder inherits no shell
// env vars, so fall back to the system HTTP proxy. The renderer uses Chromium's system proxy and
// is unaffected. Same bootstrap as slides-main startSlidesStandalone.
// awaited by login IPC so the first status probe / login click cannot race the proxy resolution
let proxyBootstrap: Promise<void> = Promise.resolve()

async function installMainProcessProxy(): Promise<void> {
  let proxyUrl = [
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
    process.env.ALL_PROXY,
    process.env.all_proxy,
  ].find((v) => v && /^https?:\/\//.test(v))
  if (!proxyUrl) {
    try {
      // PAC/rule proxies answer per-host: probe the host the login flow, the
      // ChatOffice LLM proxy and the chatoffice CLI actually target
      const resolved = await session.defaultSession.resolveProxy('https://www.genspark.ai/')
      const m = /PROXY\s+([^;\s]+)/.exec(resolved)
      if (m) proxyUrl = `http://${m[1]}`
    } catch {
      /* no system proxy */
    }
  }
  if (!proxyUrl) return
  // spawned chatoffice CLI children (login/search/…) do their own fetch and never see
  // the dispatcher below — forward the proxy to them via env
  setChatOfficeProxyUrl(proxyUrl)
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici')
    setGlobalDispatcher(new ProxyAgent(proxyUrl))
    // strip user:pass credentials before logging
    console.log('[proxy] main-process fetch via', proxyUrl.replace(/\/\/[^@/]*@/, '//***@'))
  } catch (e) {
    console.warn('[proxy] failed to set ProxyAgent:', e)
  }
}

// ---- lifecycle (the shell is the only owner) ----

let pendingLaunchPath = supportedFileIn(process.argv) ?? unsupportedFileIn(process.argv)
let controlServer: ControlServer | null = null

// show() does not un-minimize, and on macOS ⌘W destroys the shell window while the
// app keeps running — either way a file opened from Finder would land out of sight.
function revealShellWindow(): void {
  if (!shellWindow) createShellWindow()
  if (shellWindow?.isMinimized()) shellWindow.restore()
  shellWindow?.show()
  shellWindow?.focus()
}

// On macOS a file opened from Finder is not in argv; it arrives via the open-file event (before ready).
// If another instance already holds the lock, this process exits, and the path must ride along in
// the lock request's additionalData to the surviving instance — so the lock request is deferred
// until ready, after the path is known.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (!app.isReady()) {
    pendingLaunchPath = filePath
    return
  }
  revealShellWindow()
  if (!openDocumentPath(filePath)) tabManager?.openHomeTab()
})

app.on('second-instance', (_event, argv, _cwd, additionalData) => {
  const file =
    supportedFileIn(argv) ??
    unsupportedFileIn(argv) ??
    (additionalData as { launchPath?: string } | null)?.launchPath
  revealShellWindow()
  if (!file || !openDocumentPath(file)) tabManager?.openHomeTab()
})

installNavigationGuard(app)
installContextMenu(app, () => contextMenuLabels(currentLang()))
registerAiIpc()
registerProjectIpc()
registerDocsIpc()
// External MCP client (Settings → MCP 管理): the app dials OUT to user-registered
// servers; live connections are cached per id and dropped when the config changes.
const externalMcp = createExternalMcpManager({
  settingsPath: APP_SETTINGS_PATH,
  log: (message) => console.log(`[mcp-client] ${message}`),
})
registerMcpClientIpc(externalMcp)
// Override the net.fetch rescue path with a hidden BrowserWindow proxy.
// Cloudflare blocks both Node fetch and net.fetch (different TLS fingerprints);
// only a genuine Chromium renderer fetch passes. The proxy creates the window lazily.
const aiProxyFetch = initAiFetchProxy()
setRescueFetch(aiProxyFetch)
registerHomeIpc()
registerIntegrationsIpc({
  settingsPath: APP_SETTINGS_PATH,
  window: () => shellWindow,
  cliDir: app.isPackaged
    ? join(process.resourcesPath, 'cli')
    : join(APPS_ROOT, '..', 'packages', 'cli', 'bin'),
  skillPath: app.isPackaged
    ? join(process.resourcesPath, 'cli', 'skills', 'chaoffice', 'SKILL.md')
    : join(APPS_ROOT, '..', 'skills', 'chaoffice', 'SKILL.md'),
  cliPackageJson: app.isPackaged
    ? join(process.resourcesPath, 'cli', 'package.json')
    : join(APPS_ROOT, '..', 'packages', 'cli', 'package.json'),
})
registerTabsIpc()
registerDockIpc()
installRelayEventForwarder()
registerWindowControlsIpc()
registerDroppedFilesIpc()
registerRemoteFilesIpc()

// sheets' project:resolveChat goes through the handler registered by docs-main; the sessionId reverse lookup hooks in here
setSessionPathResolver(resolveSheetsSessionPath)

/** Dev-only pid marker for the takeover below; scoped to userData like the lock itself. */
const devPidFile = () => join(app.getPath('userData'), 'dev-instance.pid')

/** Hidden-window exporters, one per editor module (HEADLESS_TARGETS says which formats each takes). */
const headlessExporters: HeadlessExporters = {
  docs: exportDocsHeadless,
  sheets: (input, outPath) => exportSheetsPdfHeadless(input, outPath),
  slides: (input, outPath) => exportSlidesPdfHeadless(input, outPath),
  markdown: (input, outPath) => exportMarkdownPdfHeadless(input, outPath),
  html: exportHtmlHeadless,
}

/**
 * The whole `--headless-export` run: no shell window, no menus, no updater,
 * no single-instance lock (a GUI instance may well be running). Prints
 * exactly one line and exits with the chatoffice convention (0/1/2/3).
 */
async function runHeadlessExportEntry(
  parsed: Exclude<HeadlessArgvParse, { kind: 'none' }>,
): Promise<void> {
  const outcome =
    parsed.kind === 'error'
      ? ({ ok: false, code: HEADLESS_EXIT.badArgs, message: parsed.message } as const)
      : await runHeadlessExport(parsed.request, headlessExporters)
  const json = parsed.kind === 'error' ? parsed.json : parsed.request.json
  stopSheetsSidecar()
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.destroy()
  // Writing to a pipe can finish asynchronously, and app.exit() would cut the
  // envelope off mid-line; wait for the flush (but never longer than 2s).
  const line = formatHeadlessEnvelope(outcome, json) + '\n'
  await new Promise<void>((resolve) => {
    const bail = setTimeout(resolve, 2000)
    process.stdout.write(line, () => {
      clearTimeout(bail)
      resolve()
    })
  })
  // app.quit() always exits 0; the chatoffice envelope needs the real code, and
  // every teardown this run owns has already happened.
  app.exit(headlessExitCode(outcome))
}

// LOCAL(2026-09-21, d8201ad0): 真机测试辅助——REMOTE_DEBUG_PORT 环境变量存在时开启 CDP
// 调试端口(仅显式设置时生效,正常运行零影响;收敛条件:无需收敛,env 门控)
if (process.env.REMOTE_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.REMOTE_DEBUG_PORT)
}

app.whenReady().then(async () => {
  startSiteSync('office') // 官网心跳+检查更新（静默）
  // first scan waits for the windows to come up; later ones follow folder changes
  setTimeout(() => ensureFileIndexer()?.refresh(), 4000)
  installRendererProtocol({
    docs: join(DOCS_OUT, 'renderer'),
    sheets: join(SHEETS_OUT, 'renderer'),
    slides: join(SLIDES_OUT, 'renderer'),
    pdf: join(PDF_OUT, 'renderer'),
    markdown: join(MARKDOWN_OUT, 'renderer'),
    html: join(HTML_OUT, 'renderer'),
  })
  if (headlessArgv.kind !== 'none') {
    await runHeadlessExportEntry(headlessArgv)
    return
  }
  const lockData = () => (pendingLaunchPath ? { launchPath: pendingLaunchPath } : {})
  let hasLock = app.requestSingleInstanceLock(lockData())
  if (!hasLock && !app.isPackaged) {
    // Dev watch restart: electron-vite SIGTERMs the previous instance and spawns this
    // one immediately. Chromium turns that SIGTERM into a graceful quit (Node's
    // process.on('SIGTERM') never fires in the main process), and the quit can wedge
    // in the close-confirmation flow — the zombie then keeps the single-instance lock,
    // this instance quits, and electron-vite's on-close handler exits with it, killing
    // the renderer dev server (blank shell window until a manual dev restart).
    // The previous instance is doomed either way: kill it and take over the lock.
    try {
      const oldPid = Number(readFileSync(devPidFile(), 'utf-8').trim())
      if (Number.isFinite(oldPid) && oldPid > 0 && oldPid !== process.pid) {
        // pid-recycling guard: only kill if that pid is still our dev electron.
        // Match the dist directory, not the executable name — dev-identity
        // (patch-dev-electron-name.mjs) hard-links the binary as 察元AIOffice,
        // so the command line no longer contains "Electron" and a name check
        // would leave the zombie holding the single-instance lock forever.
        const cmd = execSync(`ps -o command= -p ${oldPid}`).toString()
        if (cmd.includes('node_modules/electron/dist')) process.kill(oldPid, 'SIGKILL')
      }
    } catch {
      // no previous instance recorded / already gone (ps exits non-zero)
    }
    for (let i = 0; i < 20 && !hasLock; i++) {
      await new Promise((r) => setTimeout(r, 150))
      hasLock = app.requestSingleInstanceLock(lockData())
    }
  }
  if (!hasLock) {
    app.quit()
    return
  }
  // another ChatOffice-family app re-logging in rotates the shared key; the
  // home page re-reads its account status. A logout that leaves only the
  // chatoffice CLI fallback key is not a login
  stopAuthWatch = watchChatofficeApiKey(() => {
    if (!loadChatofficeAuth()) return
    for (const w of BrowserWindow.getAllWindows())
      w.webContents.send(HOME_CHANNELS.accountLoginEvent, { phase: 'success' })
  })
  // a registry left by a crashed instance must not block chatoffice writes
  ownsOpenDocumentsRegistry = true
  publishOpenDocuments(OPEN_DOCUMENTS_PATH(), [])
  if (!app.isPackaged) {
    try {
      writeFileSync(devPidFile(), String(process.pid))
    } catch {
      // best-effort: without the marker the next restart just retries the lock
    }
  }

  proxyBootstrap = installMainProcessProxy()
  app.setAccessibilitySupportEnabled(true)
  // Settle the shared uiLang from saved settings BEFORE any tab renderer can
  // ask 'app:get-language': the editor handlers return the i18n module's
  // mutable lang, whose 'zh' default otherwise wins the race for whichever
  // tab loads first (e.g. sheets booting in Chinese while docs shows English).
  currentLang()
  // native menus/dialogs/scrollbars follow the persisted theme from first paint
  nativeTheme.themeSource = currentTheme()
  // stamp the star-prompt install-age clock on the first launch carrying the feature,
  // and detect upgrade launches (version changed since the previous run)
  try {
    const settings = readAppSettings(APP_SETTINGS_PATH())
    const starState = readStarPrompt()
    const stamped = withFirstRun(starState, Date.now())
    if (stamped !== starState) writeStarPrompt(stamped)

    const prevVersion =
      typeof settings[LAST_RUN_VERSION_KEY] === 'string'
        ? (settings[LAST_RUN_VERSION_KEY] as string)
        : null
    const currentVersion = app.getVersion()
    upgradeStarPromptPending = isUpgradeLaunch(
      prevVersion,
      currentVersion,
      settings.onboardingSeen === true,
    )
    if (prevVersion !== currentVersion)
      writeAppSetting(APP_SETTINGS_PATH(), LAST_RUN_VERSION_KEY, currentVersion)
  } catch {
    // settings write failures must never block startup
  }
  // off the startup path: a symlink / registry write nobody is waiting for
  setTimeout(() => installCliLinkBestEffort(APP_SETTINGS_PATH()), 3000)
  initAnalytics()
  analytics.track('app_launch')
  // LOCAL(purchase): stamp firstRunAt, register activation IPC, and run the
  // free-period scheduler (once-per-day page + 30-min gentle toast). Events
  // only fire while the shell window is visible; the page popup catches up
  // later the same day after lock screens or hidden windows.
  registerPurchaseIpc(() => void refreshPurchaseMenu())
  void refreshPurchaseMenu()
  startPurchaseScheduler(() =>
    shellWindow !== null && !shellWindow.isDestroyed() && shellWindow.isVisible() ? shellWindow : null,
  )
  startSheetsCaptureServer()
  // Register the docs renderer bridge listeners before the MCP server can take
  // a visible-editing request.
  installDocsBridge()
  installSheetsBridge()
  // MCP server: localhost-only, docx generation for external agents. Deps are
  // injected so the mcp module never imports this file back.
  // family controls are referenced twice (their own tools + the open-documents
  // tool), so create them once here
  const mcpDocsControl = createDocsControl({
    openBlankTab: () => openBlankDocsTabForMcp(),
    authorizeSave: authorizeMcpDocWrite,
    abandonBlankTab: (wcId) => {
      if (tabManager) abandonBlankTabForMcp(tabManager.docsTabs(), wcId)
    },
  })
  const mcpSlidesControl = createSlidesControl({
    openBlankTab: () => openBlankSlidesTabForMcp(),
    abandonBlankTab: (wcId) => {
      if (tabManager) abandonBlankTabForMcp(tabManager.slidesTabs(), wcId)
    },
  })
  const mcpSheetsControl = createSheetsControl({
    openBlankTab: () => openBlankSheetsTabForMcp(),
    authorizeSave: authorizeMcpSheetWrite,
    abandonBlankTab: (wcId) => abandonBlankSheetsTabForMcp(wcId),
  })
  configureMcpRuntime({
    version: app.getVersion(),
    defaultSaveDir: () => defaultSaveDir(),
    openPath: (filePath) => routeDocumentPath(filePath),
    docsControl: mcpDocsControl,
    slidesControl: mcpSlidesControl,
    sheetsControl: mcpSheetsControl,
    // documents the user has open: the tab list plus each family's own bridge,
    // so an agent reaches a tab nobody but the user opened
    openDocumentsControl: createOpenDocumentsControl({
      list: async () => {
        const tabs = tabManager ? await tabManager.openDocuments() : []
        return [...tabs, ...(await detachedOpenDocuments())]
      },
      webContentsFor: (tabId) =>
        tabManager?.webContentsForTab(tabId) ?? detachedWebContentsFor(tabId),
      closeTab: (tabId) =>
        closeDetachedWithoutPrompt(tabId) || (tabManager?.closeTabWithoutPrompt(tabId) ?? false),
      defaultSaveDir: () => defaultSaveDir(),
      docs: mcpDocsControl,
      sheets: mcpSheetsControl,
      slides: mcpSlidesControl,
      slidesDiscard: discardSlidesRecovery,
      markdown: {
        read: markdownReadText,
        save: markdownSaveToPath,
        discard: markdownDiscardPendingAssets,
      },
      html: {
        read: htmlReadText,
        save: htmlSaveToPath,
        discard: htmlDiscardPendingAssets,
      },
    }),
    // the headless create_*/read_* tools delegate to the bundled chatoffice CLI
    // (the same engines, no second implementation); it runs on the app's own
    // Node runtime via ELECTRON_RUN_AS_NODE
    cliRunner: createCliRunner({
      executable: process.execPath,
      entry: app.isPackaged
        ? join(process.resourcesPath, 'cli', 'chaoffice.cjs')
        : join(APPS_ROOT, '..', 'packages', 'cli', 'dist', 'chaoffice.cjs'),
    }),
    // lets the content tools take a `document` argument (tab id or path) and edit
    // a tab the *user* has open, with no create_session involved
    resolveTarget: createOpenTargetResolver({
      list: async () => {
        const tabs = tabManager ? await tabManager.openDocuments() : []
        return [...tabs, ...(await detachedOpenDocuments())]
      },
      webContentsFor: (tabId) =>
        tabManager?.webContentsForTab(tabId) ?? detachedWebContentsFor(tabId),
      // an agent editing a background tab would otherwise work where nobody can
      // see it: switch to that tab and bring its window forward first
      activate: (tabId) => {
        if (!activateDetached(tabId)) tabManager?.activateTab(tabId)
      },
      revealWindow: (tabId) => {
        if (!isDetachedTabId(tabId)) revealShellWindow()
      },
    }),
    logFilePath: join(app.getPath('userData'), 'mcp-log.txt'),
  })
  void startMcpFromSettings(currentMcpSettings()).catch((error) => {
    console.error('[mcp] failed to start on boot:', error)
  })
  createShellWindow()
  // deferred to ready: labels need currentLang(), which reads app.getLocale()
  installBackToHomeItems()
  installDockMenu()
  setUpdateCheckInvoker(() => void checkForUpdatesNow())
  initAutoUpdater(() => shellWindow, currentUpdateChannel())

  if (!pendingLaunchPath || !openDocumentPath(pendingLaunchPath)) tabManager?.openHomeTab()
  pendingLaunchPath = null

  startControlServer(
    app.getPath('userData'),
    controlHandler({
      reveal: revealShellWindow,
      openDocument: openDocumentPath,
      activateTab: (id) => {
        if (!activateDetached(id)) tabManager?.activateTab(id)
      },
      findTab: (path) => tabManager?.findTabByPath(path) ?? findDetachedTabByPath(path),
    }),
  ).then(
    (server) => {
      controlServer = server
    },
    (err: unknown) => console.warn('[control] not listening:', err),
  )

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createShellWindow()
  })
})

app.on('window-all-closed', () => {
  // A headless export destroys its hidden window between documents; only
  // runHeadlessExportEntry decides when that run is over.
  if (headlessArgv.kind !== 'none') return
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // No close prompt may fall through to "Save" during shutdown
  markSheetsShuttingDown()
  stopSheetsSidecar()
  // release the MCP port synchronously (macOS keeps the process alive after
  // the last window closes, so window-all-closed is not enough)
  stopMcpSync()
  // best-effort: close outbound MCP client connections (kills spawned stdio servers)
  void externalMcp.shutdown()
  cleanupAiFetchProxy()
})

// after every window has closed, so the shell window's own 'closed' republish cannot revive the file
app.on('will-quit', () => {
  fileIndexer?.stop()
  fileIndexStore?.close()
  stopAuthWatch?.()
  for (const watcher of folderWatchers.values()) watcher.close()
  controlServer?.close()
  // a second instance that lost the lock quits too; it must not delete the running editor's list
  if (ownsOpenDocumentsRegistry) clearOpenDocuments(OPEN_DOCUMENTS_PATH())
})
