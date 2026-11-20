/**
 * chaOffice / chaOfficeProject / chaOfficeTabs — WEB implementation of the shell
 * preload bridges (plan v2.2 decision #2/#4). The shell renderer source is
 * untouched; these globals are installed before it boots and route to the
 * in-page tab manager, the localStorage recents store, and the FS Access
 * handle store. Channels outside batch 1 reject via the degrade registry so
 * the UI can grey them with an explanation instead of breaking.
 */

import { degradeInfo } from '@chaoffice/web-bridge'
import { installKbFetchBridge } from '@chaoffice/web-bridge'
import { GITHUB_REPO_URL } from '@chaoffice/electron-utils/github-menu'
import { openExternalUrl } from './open-external.js'
import { tabManager, type TabKind } from './tab-manager.js'
import { dockHost } from './dock.js'
import {
  entryFor,
  pageRecents,
  recordRecent,
  removeRecents,
  renameRecent,
  toggleStar,
  type RecentEntry,
} from './recents.js'
import { fileStore, extToKind, openEditorFor, openPickedFile } from './file-open.js'

/** 一页空白 PDF 的最小合法文档（PDF 1.4，无字体无对象流——查看器直接可开）。 */
function blankPdfBytes(): Uint8Array {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n',
  ]
  const header = '%PDF-1.4\n'
  let body = header
  const offsets: number[] = []
  for (const o of objects) {
    offsets.push(body.length)
    body += o
  }
  const xrefAt = body.length
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  body += xref
  return new TextEncoder().encode(body)
}

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
  const err = new Error(info?.reason ?? '该能力尚未在网页版开放') as Error & {
    code: string
    batch?: string
  }
  err.code = info ? 'degraded' : 'unsupported'
  if (info?.batch) err.batch = info.batch
  throw err
}

function toShellEntry(e: RecentEntry): RecentEntryShell {
  const ext =
    e.kind === 'docs'
      ? 'docx'
      : e.kind === 'sheets'
        ? 'xlsx'
        : e.kind === 'slides'
          ? 'pptx'
          : e.kind === 'pdf'
            ? 'pdf'
            : 'md'
  return {
    path: e.fileId,
    name: e.name,
    ext,
    mtimeMs: e.lastOpened,
    sizeBytes: 0,
    starred: e.starred,
  }
}

function page(
  query: { starred?: boolean; offset?: number; limit?: number; ext?: string } | undefined,
  starredOnly: boolean,
) {
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

// ── user-skills helpers (chaOfficeIntegrations + home composer picker) ──────

/** JSON fetch over the BFF's /ai/skills* routes; non-2xx bodies carry {error} */
async function skillsJson<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(aiUrl(path), init)
  const body = (await r.json().catch(() => null)) as (T & { error?: string }) | null
  if (!r.ok) throw new Error((body as { error?: string } | null)?.error ?? `HTTP ${r.status}`)
  return body as T
}

async function skillsText(path: string): Promise<string> {
  const r = await fetch(aiUrl(path))
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `HTTP ${r.status}`)
  }
  return r.text()
}

/** the pane's UI language, same localStorage key the shell settings write */
function uiLang(): string {
  return localStorage.getItem(LS.lang) ?? 'zh'
}

function getAppVersionStr(): string {
  return (window as unknown as { CHAOFFICE_VERSION?: string }).CHAOFFICE_VERSION ?? '1'
}

/**
 * The web listing's path shape is `<name>/SKILL.md` (the sidecar root-relativizes
 * before answering); the pane feeds that path back to skillBody, which only
 * needs the name — the exact segment the store uses as the skills folder key.
 */
function skillNameFromPath(path: string): string {
  const m = /(?:^|\/)([^/]+)\/SKILL\.md$/.exec(String(path ?? ''))
  if (!m) throw new Error('unknown skill')
  return m[1]!
}

/** one-shot <input> picker; resolves [] when the user cancels */
function pickFiles(opts: {
  accept?: string
  multiple?: boolean
  directory?: boolean
}): Promise<File[]> {
  return new Promise((resolvePromise) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (opts.accept) input.accept = opts.accept
    if (opts.multiple) input.multiple = true
    if (opts.directory) {
      input.setAttribute('webkitdirectory', '')
      input.setAttribute('directory', '')
    }
    input.style.display = 'none'
    let settled = false
    const done = (files: File[]) => {
      if (settled) return
      settled = true
      input.remove()
      resolvePromise(files)
    }
    input.addEventListener('change', () => done(Array.from(input.files ?? [])))
    // focus returns to the page when the picker closes without a choice
    window.addEventListener('focus', () => setTimeout(() => done(Array.from(input.files ?? [])), 300), {
      once: true,
    })
    document.body.appendChild(input)
    input.click()
  })
}

async function fileToB64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

// ── language / theme / onboarding (localStorage) ────────────────────────────

const LS = {
  lang: 'chaoffice.lang',
  theme: 'chaoffice.theme',
  onboard: 'chaoffice.onboarding-seen',
}
const themeListeners = new Set<(t: string) => void>()
const langListeners = new Set<(l: string) => void>()

// home chat stream fan-out (see aiStream in installShellShims)
const CHAT_SESSIONS_KEY = 'chaoffice.home-chat-sessions'

/** 附件扩展名单与上限对齐桌面 files:pick/files:read 契约（docs-main） */
const WEB_TEXT_EXTS = ['txt','md','markdown','csv','tsv','json','yaml','yml','xml','html','htm','log']
const WEB_IMAGE_EXTS = ['png','jpg','jpeg','gif','webp']
const WEB_IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
}
const WEB_ATTACHMENT_EXTS = [...WEB_TEXT_EXTS, 'doc','docx','pdf','pptx','ppt','xlsx','xlsm','xls', ...WEB_IMAGE_EXTS]
const WEB_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024
const WEB_ATTACHMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
const webfsId = (path: string): string | null => /^webfs:([^:]+):/.exec(path)?.[1] ?? null
// AI endpoints are root-relative in the plain web form, but the dsh plugin
// form serves this host under /chaoffice-app/ — derive the prefix from the
// document URL so both forms hit the BFF through the same origin.
const aiUrl = (path: string): string => `${new URL('./', document.baseURI).pathname}${path}`

const aiListeners = new Set<(chunk: unknown) => void>()
const aiControllers = new Map<string, AbortController>()

function dispatchAi(chunk: unknown): void {
  for (const listener of [...aiListeners]) listener(chunk)
}

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
    'position:fixed',
    `left:${Math.round(x)}px`,
    `top:${Math.round(y)}px`,
    'z-index:2147483647',
    'background:#2b2d30',
    'color:#e6e6e6',
    'border:1px solid #4a4c4f',
    'border-radius:8px',
    'padding:4px',
    'min-width:180px',
    'font:13px/1.2 system-ui,sans-serif',
    'box-shadow:0 8px 24px rgba(0,0,0,.4)',
  ].join(';')
  for (const item of items) {
    const el = document.createElement('div')
    el.textContent = item.label
    el.style.cssText = 'padding:7px 12px;border-radius:5px;cursor:pointer;white-space:nowrap'
    el.addEventListener('mouseenter', () => (el.style.background = 'rgba(255,255,255,.08)'))
    el.addEventListener('mouseleave', () => (el.style.background = 'transparent'))
    // pointerup 触发（比 click 早且不受 down/up 间元素移除影响）：真实点击 down→up
    // 都落在项上（down 已被外部关闭逻辑排除），up 立即执行动作并收起。
    el.addEventListener('pointerup', () => {
      closeDomMenu()
      item.onClick()
    })
    menu.appendChild(el)
  }
  document.body.appendChild(menu)

  // 关闭：非捕获 pointerdown 且目标在菜单外（菜单内的 down 不关，让 up 完成选择）；
  // Escape / 滚轮 / 窗口失焦同样收起。监听挂在 menu 的存活期，菜单移除即失效。
  const onDown = (e: PointerEvent) => {
    if (e.target instanceof Node && menu.contains(e.target)) return
    closeDomMenu()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeDomMenu()
  }
  const dismiss = () => closeDomMenu()
  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('wheel', dismiss, { passive: true, capture: true })
  window.addEventListener('blur', dismiss)
  const cleanup = () => {
    document.removeEventListener('pointerdown', onDown, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('wheel', dismiss, { capture: true } as EventListenerOptions)
    window.removeEventListener('blur', dismiss)
  }
  ;(menu as unknown as { __goCleanup?: () => void }).__goCleanup = cleanup
  // closeDomMenu 移除菜单时清理监听：借助 MutationObserver 兜底
  const mo = new MutationObserver(() => {
    if (!document.contains(menu)) {
      cleanup()
      mo.disconnect()
    }
  })
  mo.observe(document.body, { childList: true, subtree: true })
}

function closeDomMenu(): void {
  for (const m of [...document.querySelectorAll('[data-go-menu]')]) {
    ;(m as unknown as { __goCleanup?: () => void }).__goCleanup?.()
    m.remove()
  }
}

const NEW_MENU: Array<{ label: string; kind: TabKind }> = [
  { label: '新建 Word 文档', kind: 'docs' },
  { label: '新建 Excel 表格', kind: 'sheets' },
  { label: '新建 PowerPoint 演示', kind: 'slides' },
  { label: '新建 PDF', kind: 'pdf' },
  { label: '新建 Markdown', kind: 'markdown' },
]

// ── 统一外链出口：实现在 ./open-external.ts，四个「打开浏览器」通道都汇过去 ──
// 与 shell main 的 GENTEAM_URL / CREDIT_USAGE_URL 同值（main 侧未导出共享常量）
const GENTEAM_URL = 'https://genspark.ai/join'
const CREDIT_USAGE_URL = 'https://www.genspark.ai/credit-usage'

// ── install ─────────────────────────────────────────────────────────────────

export function installShellShims(): void {
  // same chaOfficeKb contract as the desktop preloads (fetch-backed here)
  installKbFetchBridge()
  const w = window as unknown as Record<string, unknown>

  w.chaOfficeTabs = {
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
        ...NEW_MENU.map(({ label, kind }) => ({
          label,
          onClick: () => tabManager.openEditor(kind, { newBlank: true }),
        })),
        { label: '打开文件…', onClick: () => void openPickedFile() },
      ])
    },
    onChanged: (handler: (tabs: unknown) => void) =>
      tabManager.onChanged(handler as (t: ReturnType<typeof tabManager.list>) => void),
    // TabBar mirrors home-layout into these unconditionally; on the web the
    // geometry is handled natively (tab-manager subscribes to home-layout
    // itself), but the calls must not throw — and setShellModalOpen relays
    // the settings dialog's lifetime so the covering editor layer hides.
    setTreeInset: () => {},
    setTreeWidth: () => {},
    // right pane twin; the web tab-manager reads home-layout.rightCollapsed
    // directly (same as the left tree), so this only keeps the contract
    setFilesInset: () => {},
    setShellModalOpen: (open: boolean) => tabManager.setModalOpen(open),
  }

  // Home 右栏停靠(P1 契约 web 侧): dock iframes live in their own layer;
  // the layer element is attached by shell-boot alongside the editor layer.
  w.chaOfficeDock = {
    open: async (kind: string, options?: { file?: string; newBlank?: boolean }) =>
      dockHost.open(kind as never, {
        // web 的「文件」= FS-Access fileId(契约 options.file 在 web 语义下即 id)
        ...(options?.file ? { fileId: options.file } : {}),
        ...(options?.newBlank ? { newBlank: true } : {}),
      }),
    list: async () => dockHost.list(),
    activate: async (id: string) => dockHost.activate(id),
    close: async (id: string) => dockHost.close(id),
    undock: async (id: string) => dockHost.undock(id),
    setRect: (rect: { x: number; y: number; width: number; height: number }) =>
      dockHost.setRect(rect),
    onChanged: (handler: (tabs: unknown) => void) =>
      dockHost.onChanged(handler as (t: ReturnType<typeof dockHost.list>) => void),
    // P2 中继：web 侧没有停靠编辑器的 RelayEvent 源，恒空订阅即可——
    // Home 的 useEffect 顶层会无条件调用 onRelayEvent，缺方法会让整个
    // 主包挂载在首次渲染前崩掉（main-tSsXsMIL 顶层 useEffect）。
    onRelayEvent: (_handler: (dockTabId: string, event: unknown) => void) => () => {},
    onPanelTurn: (_handler: (turn: unknown) => void) => () => {},
  }

  w.chaOffice = {
    // ── file lists (localStorage recents over FS-Access file ids) ──
    recents: async (query?: { offset?: number; limit?: number; ext?: string }) =>
      page(query, false),
    starred: async (query?: { offset?: number; limit?: number; ext?: string }) => page(query, true),
    statPaths: async (paths: string[]) =>
      paths
        .map((p) => entryFor(p))
        .filter((e) => e !== null)
        .map((e) => toShellEntry(e as RecentEntry)),
    toggleStar: async (path: string) => toggleStar(path),
    // ── starred groups (upstream R23 收藏组): no per-entry group storage on
    // the web — the group strip renders empty and the mutating calls degrade
    starredGroups: async (): Promise<string[]> => [],
    unstarPaths: async (paths: string[]) => {
      for (const p of paths) {
        const e = entryFor(p)
        if (e?.starred) toggleStar(p)
      }
    },
    setStarredGroup: async (_paths: string[], _group: string) => {},
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
    // pdf 没有渲染器内「无文档」模式（Electron 形态由主进程先造草稿盘上文件），
    // web 形态在这里造一页空白 PDF 的内存句柄再打开——编辑器拿到真文档。
    newPdf: async () => {
      const bytes = blankPdfBytes()
      const saved = fileStore.registerFile(
        new File([bytes.slice().buffer as ArrayBuffer], '未命名.pdf'),
        '未命名.pdf',
      )
      await openEditorFor('pdf', saved, '未命名.pdf')
    },
    // html has no dedicated web editor bundle — author it as text in the
    // markdown editor (same surface OPEN of an .html file lands on below)
    newHtml: async () => tabManager.openEditor('html', { newBlank: true }),

    // ── home folder tree (upstream 7036122): no local filesystem here — the
    // tree renders empty and the mutating actions degrade. folderRoots MUST
    // exist: FileTreePane calls it unguarded during mount and a missing
    // method crashes the whole shell to a blank page. ──
    folderRoots: async () => [],
    addFolderRoot: async () => null,
    dropFolderRoots: async () => [],
    removeFolderRoot: async () => undefined,
    pathForFile: () => '',
    listFolder: async (dir: string) => ({ dir, folders: [], files: [], missing: true }),
    createFolder: async () => degraded('chaOffice.createFolder'),
    renameFolder: async () => degraded('chaOffice.renameFolder'),
    movePaths: async () => degraded('chaOffice.movePaths'),
    deleteFolder: async () => degraded('chaOffice.deleteFolder'),
    onFolderChanged: (_handler: (dirs: string[]) => void) => () => undefined,

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
    getAppVersion: async () =>
      (window as unknown as { CHAOFFICE_VERSION?: string }).CHAOFFICE_VERSION ?? '0.1.0',

    // ── file management: batch 2 ──
    renameFile: async () => degraded('chaOffice.renameFile'),
    duplicateFile: async () => degraded('chaOffice.duplicateFile'),
    deleteFiles: async () => degraded('chaOffice.deleteFiles'),
    revealPath: async () => degraded('chaOffice.revealPath'),
    openTrash: async () => degraded('chaOffice.openTrash'),

    // ── local MCP server: the web host has none — report the disabled state
    // (the settings panel reads these fields directly) and degrade mutations ──
    getMcpStatus: async () => ({
      running: false,
      enabled: false,
      port: 0,
      background: false,
      logging: false,
      url: null,
      capabilities: [],
    }),
    setMcpSettings: async () => ({
      running: false,
      enabled: false,
      port: 0,
      background: false,
      logging: false,
      url: null,
      capabilities: [],
    }),
    getMcpLogs: async () => [],
    clearMcpLogs: async () => undefined,
    openMcpLogFile: async () => degraded('chaOffice.openMcpLogFile'),
    searchCapabilities: async () =>
      (await fetch(aiUrl('ai/search-capabilities')).then((r) => r.json())) as unknown,

    // media + document channels over the BFF (parity with the desktop
    // ai:media-* IPC): generation and probing run server-side, keys never
    // reach the page; binaries land through the FS Access save picker, which
    // degrades to a browser download outside user-gesture windows
    mediaGenerate: async (req: {
      profileId?: string
      modelId?: string
      prompt: string
      params?: Record<string, unknown>
    }) =>
      (
        await fetch(aiUrl('ai/media/generate'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(req),
        })
      ).json() as unknown,
    mediaCapabilities: async () =>
      (await fetch(aiUrl('ai/media/capabilities'))).json() as unknown,
    // web search rides the BFF's /ai/web-search (free DuckDuckGo tier included)
    webSearch: async (query: string, maxResults?: number) =>
      (
        await fetch(aiUrl('ai/web-search'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query, maxResults }),
        })
      ).json() as unknown,
    mediaVideo: async (req: {
      prompt: string
      aspectRatio?: string
      durationSeconds?: number
    }) => {
      const r = (await fetch(aiUrl('ai/media/video'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      }).then((x) => x.json())) as {
        url?: string
        bytesB64?: string
        mime?: string
        model?: string
        error?: string
      }
      // inline-first (Doubao-style): hand the player a data URL; the chat
      // media card's ⤓ button is the save-as path — no picker at generation
      if (r.bytesB64) {
        return {
          url: `data:${r.mime ?? 'video/mp4'};base64,${r.bytesB64}`,
          model: r.model,
        }
      }
      return r
    },
    mediaUnderstand: async (req: {
      kind: 'image' | 'video' | 'auto'
      sources: string[]
      requirements: string
    }) =>
      (
        await fetch(aiUrl('ai/media/understand'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(req),
        })
      ).json() as unknown,
    mediaAsr: async (req: { source: string; language?: string }) =>
      (
        await fetch(aiUrl('ai/media/asr'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(req),
        })
      ).json() as unknown,
    mediaTts: async (req: { text: string; voice?: string }) => {
      const r = (await fetch(aiUrl('ai/media/tts'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      }).then((x) => x.json())) as {
        bytesB64?: string
        mime?: string
        remoteUrl?: string
        model?: string
        error?: string
      }
      // inline-first: the chat media card plays it and ⤓ saves it
      if (r.bytesB64) return { url: `data:${r.mime ?? 'audio/mpeg'};base64,${r.bytesB64}`, mime: r.mime, model: r.model }
      return r.remoteUrl ? { url: r.remoteUrl, mime: r.mime, model: r.model } : r
    },
    createDocument: async (req: {
      type: string
      title: string
      content: string
    }): Promise<{ ok: boolean; path?: string; error?: string }> => {
      const format = req.type === 'docx' ? 'docx' : 'md'
      const r = (await fetch(aiUrl('ai/create-document'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: req.title, format, content: req.content }),
      }).then((x) => x.json())) as { ok?: boolean; bytesB64?: string; filename?: string; error?: string }
      if (!r.ok || !r.bytesB64 || !r.filename) return { ok: false, error: r.error ?? 'build failed' }
      const bytes = Uint8Array.from(atob(r.bytesB64), (c) => c.charCodeAt(0))
      const saved = await fileStore.saveAsPicker(r.filename, bytes)
      if (!saved) return { ok: false, error: 'save canceled' }
      const kind = extToKind(saved.name)
      if (kind) await openEditorFor(kind, saved.id, saved.name)
      return { ok: true, path: saved.name }
    },

    // ── account / cloud / AI: awaiting the BFF channels ──
    accountStatus: async () => null,
    accountLogin: async () => degraded('chaOffice.accountLogin'),
    accountLogout: async () => undefined,
    openLoginUrl: () => undefined,
    onAccountLogin: () => () => undefined,
    cloudProjectsSync: async () => degraded('chaOffice.cloudProjectsSync'),
    cloudProjectsCached: async () => null,
    openCloudProject: async () => degraded('chaOffice.openCloudProject'),
    // AI settings run over the BFF's /ai/* endpoints (keys stay server-side)
    getAiSettings: async () => (await fetch(aiUrl('ai/settings'))).json() as unknown,
    setAiSettings: async (view: unknown) => {
      await fetch(aiUrl('ai/settings'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(view),
      })
    },
    setAiCurrentModel: async (selection: unknown) => {
      await fetch(aiUrl('ai/set-current-model'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(selection),
      })
    },
    aiDiscoverModels: async (target: unknown) =>
      (
        await fetch(aiUrl('ai/discover-models'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(target),
        })
      ).json() as unknown,
    // home chat streams over the BFF's /ai/stream SSE endpoint (same wire
    // shape the desktop main process consumes); chunks are fanned out to the
    // onAiStream listeners so the shared agent transport needs no changes
    aiStream: async (request: { requestId: string }) => {
      const controller = new AbortController()
      aiControllers.set(request.requestId, controller)
      try {
        const response = await fetch(aiUrl('ai/stream'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        })
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            const line = frame.split('\n').find((l) => l.startsWith('data: '))
            if (!line) continue
            try {
              dispatchAi(JSON.parse(line.slice(6)))
            } catch {
              /* skip malformed frames */
            }
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          dispatchAi({
            requestId: request.requestId,
            type: 'error',
            error: err instanceof Error ? err.message : String(err),
          })
        }
      } finally {
        aiControllers.delete(request.requestId)
      }
    },
    aiStreamCancel: async (requestId: string) => {
      aiControllers.get(requestId)?.abort()
      await fetch(aiUrl('ai/stream-cancel'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId }),
      }).catch(() => undefined)
    },
    onAiStream: (handler: (chunk: unknown) => void) => {
      aiListeners.add(handler)
      return () => aiListeners.delete(handler)
    },
    // home chat sessions persist server-side (disk under the BFF data dir,
    // like the desktop's userData/home-chat-sessions.json) — localStorage caps
    // at ~5-10MB per origin and one generated-video data URL killed the whole
    // save, losing history media. localStorage stays as fallback + migrates up.
    chatSessionsLoad: async () => {
      try {
        const fromServer = (await fetch(aiUrl('ai/chat-sessions')).then((r) => r.json())) as unknown
        if (Array.isArray(fromServer) && fromServer.length > 0) return fromServer
        const raw = localStorage.getItem(CHAT_SESSIONS_KEY)
        const parsed: unknown = raw ? JSON.parse(raw) : []
        if (Array.isArray(parsed) && parsed.length > 0) {
          // one-time migration: push legacy local sessions up, then drop the
          // key so stale local copies never shadow server state
          void fetch(aiUrl('ai/chat-sessions'), {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(parsed),
          })
            .then(() => localStorage.removeItem(CHAT_SESSIONS_KEY))
            .catch(() => undefined)
          return parsed
        }
        return []
      } catch {
        try {
          const raw = localStorage.getItem(CHAT_SESSIONS_KEY)
          const parsed: unknown = raw ? JSON.parse(raw) : []
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      }
    },
    chatSessionsSave: async (sessions: unknown) => {
      try {
        const resp = await fetch(aiUrl('ai/chat-sessions'), {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(sessions),
        })
        if (resp.ok) return
      } catch {
        /* server unreachable: legacy localStorage below (may quota-fail) */
      }
      try {
        localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(sessions))
      } catch {
        /* quota exceeded: the server retry on the next change recovers */
      }
    },
    chaofficeStatus: async () => ({ loggedIn: false }),
    chaofficeLogin: async () => undefined,

    // ── user skills (home chat composer picker; desktop ai:skills-list parity) ──
    skillsList: async () => {
      const skills = (await skillsJson<Array<Record<string, unknown>>>('ai/skills')) ?? []
      return skills.map((s) => ({
        name: String(s.name ?? ''),
        description: String(s.description ?? ''),
        relevant: s.relevant === true,
      }))
    },
    skillText: async (name: string) => {
      const r = await fetch(aiUrl(`ai/skills/text?name=${encodeURIComponent(String(name ?? ''))}`))
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.text()
    },
    // the desktop handler for this deep-link never existed either (the invoke
    // rejects and the panel swallows it) — keep the same no-op shape here
    openSkillsSettings: async () => undefined,
    getDefaultSaveDir: async () => null,
    pickDefaultSaveDir: async () => degraded('chaOffice.pickDefaultSaveDir'),
    getAnalyticsEnabled: async () => false,
    setAnalyticsEnabled: async () => undefined,
    githubStars: async () => null,
    openGitHubRepo: () => openExternalUrl(GITHUB_REPO_URL),
    starPromptShouldShow: async () => ({ show: false as const, docOpens: 0 }),
    starPromptAction: async () => undefined,
    // ── surfaces the web can't back yet. These MUST exist: the shell calls
    // several of them during mount (Home's untitled-restore banner) and a
    // missing method crashes the whole shell to a blank page, not just the
    // feature. Stubs degrade the way the desktop contract allows.
    // No temp-backed crashed documents exist in the web host.
    listPendingUntitled: async () => [],
    restorePendingUntitled: async () => false,
    discardPendingUntitled: async () => true,
    // updater UI reads the channel; web has no auto-update
    getUpdateChannel: async () => 'stable' as const,
    setUpdateChannel: async () => undefined,
    getAutoSaveDefault: async () => ({ on: true, updatedAt: 0 }),
    setAutoSaveDefault: async () => undefined,
    feedbackProbe: async () => false,
    feedbackUpload: async () => degraded('chaOffice.feedbackUpload'),
    feedbackSubmit: async () => degraded('chaOffice.feedbackSubmit'),
    openExternal: (url: string) => openExternalUrl(url),
    openGenTeam: () => openExternalUrl(GENTEAM_URL),
    openCreditUsage: () => openExternalUrl(CREDIT_USAGE_URL),
    // attachment pickers/readers need real file access (FS-Access landing TBD);
    // null = user cancelled, ok:false = unreadable, matching the desktop shapes
    // attachments over FS Access (multi-select picker with <input multiple>
    // fallback); the webfs:<id>:<name> path rides the message and resolves
    // back through the file store on read
    pickAttachments: async () => {
      try {
        const picked = await fileStore.openPickerMulti()
        if (!picked || !picked.length) return null
        const accepted: Array<{ path: string; name: string; ext: string; sizeBytes: number }> = []
        const rejected: string[] = []
        for (const f of picked) {
          const ext = (f.name.split('.').pop() ?? '').toLowerCase()
          if (!WEB_ATTACHMENT_EXTS.includes(ext)) {
            rejected.push(`${f.name}: 不支持的附件类型 .${ext}`)
            continue
          }
          if (f.size > WEB_ATTACHMENT_MAX_BYTES) {
            rejected.push(`${f.name}: 超过 50MB`)
            continue
          }
          if (WEB_IMAGE_EXTS.includes(ext) && f.size > WEB_ATTACHMENT_IMAGE_MAX_BYTES) {
            rejected.push(`${f.name}: 图片超过 5MB`)
            continue
          }
          accepted.push({ path: `webfs:${f.id}:${f.name}`, name: f.name, ext, sizeBytes: f.size })
        }
        return { accepted, rejected }
      } catch {
        return null
      }
    },
    validateAttachments: async (paths: string[]) => ({
      accepted: [],
      rejected: (paths ?? []).map((p) => `网页版暂不支持拖入本地文件路径：${p}`),
    }),
    readAttachment: async (
      path: string,
      offset = 0,
      maxChars = 12_000,
    ): Promise<{
      ok: boolean
      error?: string
      name?: string
      totalChars?: number
      text?: string
      offset?: number
    }> => {
      const id = webfsId(path)
      if (!id) return { ok: false, error: '附件已失效（网页版仅支持本次会话中添加的附件），请重新添加' }
      try {
        const r = await fileStore.read(id)
        const ext = (r.name.split('.').pop() ?? '').toLowerCase()
        if (WEB_IMAGE_EXTS.includes(ext)) {
          return { ok: false, error: '图片附件没有可提取的文本（模型可直接查看图片）' }
        }
        if (!WEB_TEXT_EXTS.includes(ext)) {
          // office/pdf formats ride the BFF's engines (same @chaoffice/file-parse
          // the desktop uses) — bytes go up, extracted text comes back
          const up = (await fetch(aiUrl('ai/attachment-text'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: r.name, bytesB64: r.base64 }),
          }).then((x) => x.json())) as { ok?: boolean; text?: string; error?: string }
          if (!up.ok || !up.text) return { ok: false, error: up.error ?? 'parse failed' }
          const start2 = Math.max(0, Math.floor(offset) || 0)
          const size2 = Math.min(Math.max(1, Math.floor(maxChars) || 1), 48_000)
          return { ok: true, name: r.name, totalChars: up.text.length, text: up.text.slice(start2, start2 + size2), offset: start2 }
        }
        const full =
          r.text ?? new TextDecoder().decode(Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0)))
        const start = Math.max(0, Math.floor(offset) || 0)
        const size = Math.min(Math.max(1, Math.floor(maxChars) || 1), 48_000)
        return { ok: true, name: r.name, totalChars: full.length, text: full.slice(start, start + size), offset: start }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
    readAttachmentImage: async (path: string): Promise<{ ok: boolean; base64?: string; mime?: string; error?: string }> => {
      const id = webfsId(path)
      if (!id) return { ok: false, error: '附件已失效，请重新添加' }
      try {
        const r = await fileStore.read(id)
        const ext = (r.name.split('.').pop() ?? '').toLowerCase()
        const mime = WEB_IMAGE_MIME[ext]
        if (!mime) return { ok: false, error: '不是图片附件' }
        return { ok: true, base64: r.base64, mime }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  }

  // ── settings › integrations + skills pane (window.chaOfficeIntegrations):
  // the HTTP port of the desktop preload's integrations API over the sidecar's
  // /ai/skills* routes. The catalog/import/remove/install flows are fully
  // wired; the CLI-link story (launcher, PATH, coding-agent dirs) is
  // desktop-only — status() says so and the pane skips that chrome. ──
  w.chaOfficeIntegrations = {
    status: async () => skillsJson('ai/skills/status'),
    listSkills: async () => skillsJson('ai/skills'),
    listRecommendedSkills: async () =>
      skillsJson(`ai/skills/recommended?lang=${encodeURIComponent(uiLang())}`),
    skillBody: async (path: string) =>
      skillsText(`ai/skills/body?name=${encodeURIComponent(skillNameFromPath(path))}`),
    installRecommendedSkill: async (name: string) =>
      skillsJson('ai/skills/recommended/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    removeSkill: async (name: string) => {
      await skillsJson('ai/skills/remove', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
    },
    // Import: the browser has no dialog API, so the pickers are <input> based
    // and the bytes go up base64 (the store's caps still bite server-side).
    importSkillZip: async () => {
      const files = await pickFiles({ accept: '.zip,.md', multiple: false })
      const file = files[0]
      if (!file) return null
      const bytesB64 = await fileToB64(file)
      const isMd = /\.md$/i.test(file.name)
      return skillsJson(
        isMd ? 'ai/skills/import/markdown' : 'ai/skills/import/zip',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ filename: file.name, bytesB64 }),
        },
      )
    },
    importSkillFolder: async () => {
      const files = await pickFiles({ directory: true, multiple: true })
      if (files.length === 0) return null
      const payloads: Array<{ path: string; bytesB64: string }> = []
      let total = 0
      for (const f of files) {
        // webkitRelativePath = "<pickedDir>/…"; the store's one-top-folder rule
        // names the skill after the picked directory, like the desktop import
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
        total += f.size
        if (total > 1024 * 1024 * 1024) throw new Error('the skill is larger than the 1 GB import cap')
        payloads.push({ path: rel, bytesB64: await fileToB64(f) })
      }
      return skillsJson('ai/skills/import/folder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ files: payloads }),
      })
    },
    saveSkillZip: async () => {
      const r = await fetch(aiUrl('ai/skills/agent-skill.zip'))
      if (!r.ok) return null
      const blob = await r.blob()
      const dispo = r.headers.get('content-disposition') ?? ''
      const name =
        /filename="([^"]+)"/.exec(dispo)?.[1] ?? `chaoffice-skill-${getAppVersionStr()}.zip`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      return name
    },
    // clipboard: never throws — the pane's copy button must stay quiet when
    // the iframe denies the permission (fallback is the execCommand dance)
    copyText: async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        try {
          const ta = document.createElement('textarea')
          ta.value = text
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          ta.remove()
        } catch {
          /* selection/permission denied: nothing more a page can do */
        }
      }
    },
    // the desktop-only writes: the pane never renders their entry points here
    // (status() reports agents: [] and pickSkillDir answers "cancelled"), and
    // an unexpected call degrades loudly instead of pretending
    pickSkillDir: async () => null,
    installSkill: async () => degraded('chaOfficeIntegrations.installSkill'),
    uninstallSkill: async () => degraded('chaOfficeIntegrations.uninstallSkill'),
    sweepLegacySkillCopies: async () => degraded('chaOfficeIntegrations.sweepLegacySkillCopies'),
  }

  w.chaOfficeProject = {
    listProjects: async () => [],
    createProject: async () => degraded('chaOfficeProject.createProject'),
    renameProject: async () => degraded('chaOfficeProject.renameProject'),
    setProjectRoot: async () => degraded('chaOfficeProject.setProjectRoot'),
    deleteProject: async () => degraded('chaOfficeProject.deleteProject'),
    moveFile: async () => degraded('chaOfficeProject.moveFile'),
    listProjectFiles: async () => [],
    getTimeline: async () => [],
  }

  // Remote storage (MinIO / OSS): settings and object transfer go through the
  // BFF's /rpc/remoteStorage/*; the pending save queue is desktop-only, so its
  // calls degrade to inert no-ops here.
  const storageRpc = async (method: string, args: unknown[]): Promise<unknown> => {
    const res = await fetch(`/rpc/remoteStorage/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args }),
    })
    const body = (await res.json()) as {
      ok: boolean
      result?: unknown
      error?: string
      code?: string
    }
    if (!body.ok) {
      const err = new Error(body.error ?? `rpc ${method} failed`) as Error & { code?: string }
      err.code = body.code
      throw err
    }
    return body.result
  }
  ;(w as unknown as Record<string, unknown>).chaOfficeRemoteFiles = {
    getSettings: () => storageRpc('getSettings', []),
    saveSettings: (settings: unknown) => storageRpc('saveSettings', [settings]),
    testConnection: (config: unknown) => storageRpc('testConnection', [config]),
    refreshIndex: (configId: string) => storageRpc('refreshIndex', [configId]),
    listFiles: (configId: string) => storageRpc('listFiles', [configId]),
    readObject: (configId: string, key: string) => storageRpc('readObject', [configId, key]),
    writeObject: (configId: string, key: string, base64: string, expectedEtag?: string) =>
      storageRpc('writeObject', [configId, key, base64, expectedEtag]),
    uploadObject: (configId: string, key: string, base64: string) =>
      storageRpc('uploadObject', [configId, key, base64]),
    deleteObject: (configId: string, key: string) => storageRpc('deleteObject', [configId, key]),
    renameObject: (configId: string, fromKey: string, toKey: string) =>
      storageRpc('renameObject', [configId, fromKey, toKey]),
    queueStatus: async () => [],
    queueEnqueue: async () => undefined,
    queueDiscard: async () => undefined,
    queueFlush: async () => [],
  }
}

export { recordRecent, renameRecent }
