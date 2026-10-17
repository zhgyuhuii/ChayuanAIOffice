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
    newPdf: async () => tabManager.openEditor('pdf', { newBlank: true }),
    // html has no dedicated web editor bundle — author it as text in the
    // markdown editor (same surface OPEN of an .html file lands on below)
    newHtml: async () => tabManager.openEditor('markdown', { newBlank: true, title: '未命名.html' }),

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
    getDefaultSaveDir: async () => null,
    pickDefaultSaveDir: async () => degraded('chaOffice.pickDefaultSaveDir'),
    getAnalyticsEnabled: async () => false,
    setAnalyticsEnabled: async () => undefined,
    githubStars: async () => null,
    openGitHubRepo: () => undefined,
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
    openExternal: async () => degraded('chaOffice.openExternal'),
    openGenTeam: () => undefined,
    // attachment pickers/readers need real file access (FS-Access landing TBD);
    // null = user cancelled, ok:false = unreadable, matching the desktop shapes
    pickAttachments: async () => null,
    readAttachment: async () => ({ ok: false, error: '网页版暂不支持读取附件' }),
    readAttachmentImage: async () => ({ ok: false, error: '网页版暂不支持读取图片附件' }),
  }

  w.chaOfficeProject = {
    listProjects: async () => [],
    createProject: async () => degraded('chaOfficeProject.createProject'),
    renameProject: async () => degraded('chaOfficeProject.renameProject'),
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
