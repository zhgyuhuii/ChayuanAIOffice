/**
 * Home three-pane layout state (left tree pane / right content pane), shared
 * by the TabBar toggle buttons and the Home surface. Collapsed flags persist
 * in localStorage so the arrangement survives restarts; the middle chat pane
 * is always on and never persisted.
 *
 * Section collapse (收藏 / 最近使用 group headers) lives here too — one
 * storage slot for every home-tree arrangement the user fiddles with.
 */

export interface HomeLayoutState {
  leftCollapsed: boolean
  rightCollapsed: boolean
  starredCollapsed: boolean
  recentCollapsed: boolean
  /** sidebar width in px (tree strip); the main process insets document views
   *  by the same amount, mirrored over setTreeWidth IPC */
  sidebarWidth: number
}

const STORAGE_KEY = 'chatoffice.home-layout'

/** hard floor keeps the tree's labels readable; cap leaves the chat pane usable */
export const SIDEBAR_MIN = 180
export const SIDEBAR_MAX = 420
const SIDEBAR_DEFAULT = 232

export function clampSidebarWidth(w: number): number {
  return Math.round(Math.min(Math.max(w, SIDEBAR_MIN), SIDEBAR_MAX))
}

const DEFAULT_STATE: HomeLayoutState = {
  leftCollapsed: false,
  rightCollapsed: true,
  starredCollapsed: false,
  recentCollapsed: false,
  sidebarWidth: SIDEBAR_DEFAULT,
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
        starredCollapsed: obj.starredCollapsed === true,
        recentCollapsed: obj.recentCollapsed === true,
        sidebarWidth:
          typeof obj.sidebarWidth === 'number' && Number.isFinite(obj.sidebarWidth)
            ? clampSidebarWidth(obj.sidebarWidth)
            : SIDEBAR_DEFAULT,
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
    next.starredCollapsed === state.starredCollapsed &&
    next.recentCollapsed === state.recentCollapsed &&
    next.sidebarWidth === state.sidebarWidth
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
