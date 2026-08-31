/**
 * aiOffice / aiOfficeProject / aiOfficeTabs — WEB implementation of the shell
 * preload bridges (plan v2.2 decision #2/#4). The shell renderer source is
 * untouched; these globals are installed before it boots and route to the
 * in-page tab manager, the localStorage recents store, and the FS Access
 * handle store. Channels outside batch 1 reject via the degrade registry so
 * the UI can grey them with an explanation instead of breaking.
 */

import { degradeInfo } from '@genoffice/web-bridge'
import { tabManager, type TabKind } from './tab-manager.js'
import {
  entryFor,
  pageRecents,
  recordRecent,
  removeRecents,
  renameRecent,
  toggleStar,
  type RecentEntry,
} from './recents.js'
import { openEditorFor, openPickedFile } from './file-open.js'

type RecentEntryShell = {
  path: string
  name: string
  ext: string
  mtimeMs: number
  sizeBytes: number
  starred: boolean
}

function degraded(channel: string): never {
  const info = degradeInfo(channel)
  const err = new Error(info?.reason ?? '该能力尚未在网页版开放') as Error & { code: string; batch?: string }
  err.code = info ? 'degraded' : 'unsupported'
  if (info?.batch) err.batch = info.batch
  throw err
}

function toShellEntry(e: RecentEntry): RecentEntryShell {
  const ext =
    e.kind === 'docs' ? 'docx' : e.kind === 'sheets' ? 'xlsx' : e.kind === 'slides' ? 'pptx' : e.kind === 'pdf' ? 'pdf' : 'md'
  return { path: e.fileId, name: e.name, ext, mtimeMs: e.lastOpened, sizeBytes: 0, starred: e.starred }
}

function page(query: { starred?: boolean; offset?: number; limit?: number; ext?: string } | undefined, starredOnly: boolean) {
  const all = pageRecents({ starred: starredOnly })
  let entries = all.entries
  if (query?.ext) entries = entries.filter((e) => toShellEntry(e).ext === query.ext)
  const offset = query?.offset ?? 0
  const limit = query?.limit ?? 50
  const slice = query?.limit === 0 ? [] : entries.slice(offset, offset + limit)
  return {
    entries: slice.map(toShellEntry),
    total: entries.length,
    totalAll: pageRecents().entries.length,
  }
}

// ── language / theme / onboarding (localStorage) ────────────────────────────

const LS = { lang: 'genoffice.lang', theme: 'genoffice.theme', onboard: 'genoffice.onboarding-seen' }
const themeListeners = new Set<(t: string) => void>()
const langListeners = new Set<(l: string) => void>()

function emitTheme(): void {
  const t = localStorage.getItem(LS.theme) ?? 'system'
  for (const l of [...themeListeners]) l(t)
}

// ── small DOM menus (web rendition of the native strip menus) ───────────────

function domMenu(x: number, y: number, items: Array<{ label: string; onClick(): void }>): void {
  closeDomMenu()
  const menu = document.createElement('div')
  menu.dataset.goMenu = '1'
  menu.style.cssText = [
    'position:fixed', `left:${Math.round(x)}px`, `top:${Math.round(y)}px`, 'z-index:2147483647',
    'background:#2b2d30', 'color:#e6e6e6', 'border:1px solid #4a4c4f', 'border-radius:8px',
    'padding:4px', 'min-width:180px', 'font:13px/1.2 system-ui,sans-serif',
    'box-shadow:0 8px 24px rgba(0,0,0,.4)',
  ].join(';')
  for (const item of items) {
    const el = document.createElement('div')
    el.textContent = item.label
    el.style.cssText = 'padding:7px 12px;border-radius:5px;cursor:pointer;white-space:nowrap'
    el.addEventListener('mouseenter', () => (el.style.background = 'rgba(255,255,255,.08)'))
    el.addEventListener('mouseleave', () => (el.style.background = 'transparent'))
    el.addEventListener('click', () => {
      closeDomMenu()
      item.onClick()
    })
    menu.appendChild(el)
  }
  document.body.appendChild(menu)
  setTimeout(() => document.addEventListener('pointerdown', closeDomMenu, { once: true }), 0)
}

function closeDomMenu(): void {
  for (const m of [...document.querySelectorAll('[data-go-menu]')]) m.remove()
}

const NEW_MENU: Array<{ label: string; kind: TabKind }> = [
  { label: '新建 Word 文档', kind: 'docs' },
  { label: '新建 Excel 表格', kind: 'sheets' },
  { label: '新建 PowerPoint 演示', kind: 'slides' },
  { label: '新建 PDF', kind: 'pdf' },
  { label: '新建 Markdown', kind: 'markdown' },
]

// ── install ─────────────────────────────────────────────────────────────────

export function installShellShims(): void {
  const w = window as unknown as Record<string, unknown>

  w.aiOfficeTabs = {
    list: async () => tabManager.list(),
    activate: async (id: string) => tabManager.activate(id),
    close: async (id: string) => tabManager.close(id),
    reorder: async (id: string, toIndex: number) => tabManager.reorder(id, toIndex),
    showMenu: async (x: number, y: number) => {
      domMenu(
        x,
        y,
        tabManager.list().map((t) => ({
          label: t.title,
          onClick: () => tabManager.activate(t.id),
        })),
      )
    },
    showNewMenu: async (x: number, y: number) => {
      domMenu(x, y, [
        ...NEW_MENU.map(({ label, kind }) => ({ label, onClick: () => tabManager.openEditor(kind, { newBlank: true }) })),
        { label: '打开文件…', onClick: () => void openPickedFile() },
      ])
    },
    onChanged: (handler: (tabs: unknown) => void) => tabManager.onChanged(handler as (t: ReturnType<typeof tabManager.list>) => void),
  }

  w.aiOffice = {
    // ── file lists (localStorage recents over FS-Access file ids) ──
    recents: async (query?: { offset?: number; limit?: number; ext?: string }) => page(query, false),
    starred: async (query?: { offset?: number; limit?: number; ext?: string }) => page(query, true),
    statPaths: async (paths: string[]) => paths.map((p) => entryFor(p)).filter((e) => e !== null).map((e) => toShellEntry(e as RecentEntry)),
    toggleStar: async (path: string) => toggleStar(path),
    removeRecent: async (paths: string[]) => removeRecents(paths),
    openPath: async (path: string) => {
      const entry = entryFor(path)
      if (!entry) throw new Error(`文件已不可用：${path}`)
      await openEditorFor(entry.kind, entry.fileId, entry.name)
    },
    browse: async () => {
      await openPickedFile()
    },
    newDoc: async () => tabManager.openEditor('docs', { newBlank: true }),
    newSheet: async () => tabManager.openEditor('sheets', { newBlank: true }),
    newSlide: async () => tabManager.openEditor('slides', { newBlank: true }),
    newMarkdown: async () => tabManager.openEditor('markdown', { newBlank: true }),
    newPdf: async () => tabManager.openEditor('pdf', { newBlank: true }),

    // ── app state ──
    getLanguage: async () => (localStorage.getItem(LS.lang) as string) ?? 'zh',
    setLanguage: async (lang: string) => {
      localStorage.setItem(LS.lang, lang)
      for (const l of [...langListeners]) l(lang)
    },
    onLanguageChanged: (handler: (l: string) => void) => {
      langListeners.add(handler)
      return () => langListeners.delete(handler)
    },
    getTheme: async () => (localStorage.getItem(LS.theme) as string) ?? 'system',
    setTheme: async (theme: string) => {
      localStorage.setItem(LS.theme, theme)
      if (theme === 'system') document.documentElement.removeAttribute('data-theme')
      else document.documentElement.setAttribute('data-theme', theme)
      emitTheme()
    },
    onThemeChanged: (handler: (t: string) => void) => {
      themeListeners.add(handler)
      return () => themeListeners.delete(handler)
    },
    onboardingSeen: async () => localStorage.getItem(LS.onboard) === '1',
    setOnboardingSeen: async () => {
      localStorage.setItem(LS.onboard, '1')
      return true // finishOnboarding only closes the dialog on a truthy return
    },
    getAppVersion: async () => (window as unknown as { GENOFFICE_VERSION?: string }).GENOFFICE_VERSION ?? '0.1.0',

    // ── file management: batch 2 ──
    renameFile: async () => degraded('aiOffice.renameFile'),
    duplicateFile: async () => degraded('aiOffice.duplicateFile'),
    deleteFiles: async () => degraded('aiOffice.deleteFiles'),
    revealPath: async () => degraded('aiOffice.revealPath'),
    openTrash: async () => degraded('aiOffice.openTrash'),

    // ── account / cloud / AI: awaiting the BFF channels ──
    accountStatus: async () => null,
    accountLogin: async () => degraded('aiOffice.accountLogin'),
    accountLogout: async () => undefined,
    openLoginUrl: () => undefined,
    onAccountLogin: () => () => undefined,
    cloudProjectsSync: async () => degraded('aiOffice.cloudProjectsSync'),
    cloudProjectsCached: async () => null,
    openCloudProject: async () => degraded('aiOffice.openCloudProject'),
    getAiSettings: async () => degraded('aiOffice.getAiSettings'),
    setAiSettings: async () => degraded('aiOffice.setAiSettings'),
    getAiProviders: async () => [],
    testAiSettings: async () => degraded('aiOffice.testAiSettings'),
    getDefaultSaveDir: async () => null,
    pickDefaultSaveDir: async () => degraded('aiOffice.pickDefaultSaveDir'),
    getAnalyticsEnabled: async () => false,
    setAnalyticsEnabled: async () => undefined,
    githubStars: async () => null,
    openGitHubRepo: () => undefined,
    starPromptShouldShow: async () => ({ show: false as const, docOpens: 0 }),
    starPromptAction: async () => undefined,
  }

  w.aiOfficeProject = {
    listProjects: async () => [],
    createProject: async () => degraded('aiOfficeProject.createProject'),
    renameProject: async () => degraded('aiOfficeProject.renameProject'),
    deleteProject: async () => degraded('aiOfficeProject.deleteProject'),
    moveFile: async () => degraded('aiOfficeProject.moveFile'),
    listProjectFiles: async () => [],
    getTimeline: async () => [],
  }
}

export { recordRecent, renameRecent }
