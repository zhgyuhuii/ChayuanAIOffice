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
}

const STORAGE_KEY = 'chatoffice.home-layout'

const DEFAULT_STATE: HomeLayoutState = {
  leftCollapsed: false,
  rightCollapsed: true,
  starredCollapsed: false,
  recentCollapsed: false,
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
    next.recentCollapsed === state.recentCollapsed
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
