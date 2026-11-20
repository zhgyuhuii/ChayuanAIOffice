/**
 * Home three-pane layout state (left tree pane / right content pane), shared
 * by the TabBar toggle buttons and the Home surface. Collapsed flags persist
 * in localStorage so the arrangement survives restarts; the middle chat pane
 * is always on and never persisted.
 *
 * Section collapse (最近使用 group header) and the tree's dual-tab pick
 * (对话 | 项目) live here too — one storage slot for every home-tree
 * arrangement the user fiddles with.
 */

/** which of the two left-tree tabs (对话 / 项目) is shown */
export type HomeTreeTab = 'recent' | 'chats' | 'projects'

export interface HomeLayoutState {
  leftCollapsed: boolean
  rightCollapsed: boolean
  /** ZCode 式左树三 Tab（对话 | 项目 | 最近）：当前显示的面（默认项目） */
  activeTab: HomeTreeTab
  recentCollapsed: boolean
  /** 侧栏「新建」分组（6 新建 + 打开本地）的折叠态 */
  newCollapsed: boolean
  /** sidebar width in px (tree strip); the main process insets document views
   *  by the same amount, mirrored over setTreeWidth IPC */
  sidebarWidth: number
  /** dock pane width in px; null = equal flex split (never dragged yet) */
  dockWidth: number | null
  /** one-time migration marker: the first run after the 2026-11-19 default-tab
   *  switch (recent→projects) resets a pre-switch stored tab to projects once;
   *  written true with the next layout change so later choices stick */
  homeLayoutV2: boolean
}

const STORAGE_KEY = 'chaoffice.home-layout'

/** hard floor keeps the tree's labels readable; cap leaves the chat pane usable */
export const SIDEBAR_MIN = 180
export const SIDEBAR_MAX = 420
// LOCAL(2026-11-19, main@b4f4499d3): 264px matches the ZCode workspace sidebar
// default (visual-consistency project); the main process mirrors this via the
// setTreeWidth IPC so document views keep their inset
const SIDEBAR_DEFAULT = 264

// fixed width of the home files pane (right drawer); must equal the CSS width
// in packages/ui zcode-theme.css (.home-files-pane) and the main process's
// FILES_PANE_WIDTH — all three feed the document views' right inset, so a
// drift would leave the pane partly covered (or a gap) beside an editor
export const FILES_PANE_WIDTH = 280

export function clampSidebarWidth(w: number): number {
  return Math.round(Math.min(Math.max(w, SIDEBAR_MIN), SIDEBAR_MAX))
}

/** dock pane width bounds: floor keeps an editor usable, cap keeps the
 *  conversation readable on wide windows */
export const DOCK_MIN = 320
export const DOCK_MAX = 1100

export function clampDockWidth(w: number): number {
  return Math.round(Math.min(Math.max(w, DOCK_MIN), DOCK_MAX))
}

const DEFAULT_STATE: HomeLayoutState = {
  leftCollapsed: false,
  rightCollapsed: true,
  activeTab: 'projects',
  recentCollapsed: false,
  newCollapsed: false,
  sidebarWidth: SIDEBAR_DEFAULT,
  dockWidth: null,
  homeLayoutV2: true,
}

/**
 * Read the tree tab from a stored payload, migrating the pre-tab collapse
 * flags: with both groups expanded the chats tab wins (default); a folded
 * 对话 group with the projects group open means the user last looked at
 * projects.
 *
 * 2026-11-19 产品裁定：默认面从「最近」改为「项目」（左树退役文件列表面板后，
 * 项目成为侧栏主入口）；存量的 homeLayoutV2 标记缺位视为旧默认，一次性切到
 * projects，之后用户的手动选择照常持久化。
 */
export function treeTabFromStored(obj: Record<string, unknown>): HomeTreeTab {
  if (obj.activeTab === 'recent' || obj.activeTab === 'projects' || obj.activeTab === 'chats') {
    if (obj.activeTab !== 'projects' && obj.homeLayoutV2 !== true) return 'projects'
    return obj.activeTab
  }
  return 'projects'
}

function load(): HomeLayoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>
      return {
        leftCollapsed: obj.leftCollapsed === true,
        rightCollapsed: obj.rightCollapsed === true,
        activeTab: treeTabFromStored(obj),
        recentCollapsed: obj.recentCollapsed === true,
        newCollapsed: obj.newCollapsed === true,
        sidebarWidth:
          typeof obj.sidebarWidth === 'number' && Number.isFinite(obj.sidebarWidth)
            ? clampSidebarWidth(obj.sidebarWidth)
            : SIDEBAR_DEFAULT,
        dockWidth:
          typeof obj.dockWidth === 'number' && Number.isFinite(obj.dockWidth)
            ? clampDockWidth(obj.dockWidth)
            : null,
        homeLayoutV2: true,
      }
    }
  } catch {
    // corrupt or unavailable storage: fall back to the defaults
  }
  return DEFAULT_STATE
}

let state: HomeLayoutState = load()
const listeners = new Set<() => void>()

export function getHomeLayout(): HomeLayoutState {
  return state
}

export function setHomeLayout(patch: Partial<HomeLayoutState>): void {
  const next = { ...state, ...patch }
  if (
    next.leftCollapsed === state.leftCollapsed &&
    next.rightCollapsed === state.rightCollapsed &&
    next.activeTab === state.activeTab &&
    next.recentCollapsed === state.recentCollapsed &&
    next.newCollapsed === state.newCollapsed &&
    next.sidebarWidth === state.sidebarWidth &&
    next.dockWidth === state.dockWidth
  ) {
    return
  }
  state = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // persistence is best-effort; the in-memory state still applies
  }
  for (const listener of [...listeners]) listener()
}

export function onHomeLayoutChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
