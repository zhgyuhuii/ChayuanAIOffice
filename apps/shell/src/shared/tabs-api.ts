export type TabKind = 'home' | 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown'

/** one open tab in the top tab strip; Home is always id 'home' and not closable */
export interface TabSummary {
  id: string
  kind: TabKind
  title: string
  closable: boolean
  active: boolean
}

/** persisted editor-pane layout (three-pane home: chat | editor pane) */
export interface PaneLayout {
  /** split = chat + editor side by side; collapsed = editor hidden; maximized = editor fills the window */
  mode: 'split' | 'collapsed' | 'maximized'
  /** chat column width as a fraction of the work area (split mode) */
  chatRatio: number
}

export interface PaneRect {
  x: number
  y: number
  width: number
  height: number
}

export interface TabsApi {
  list(): Promise<TabSummary[]>
  activate(id: string): Promise<void>
  close(id: string): Promise<void>
  /**
   * pop up the native "all tabs" list menu at (x, y) in window CSS coordinates.
   * Native because the content area below the strip is a WebContentsView that
   * would cover any DOM dropdown rendered by the shell.
   */
  showMenu(x: number, y: number): Promise<void>
  /**
   * pop up the native "+" new-file menu (new doc/sheet/slides, open local
   * file) at (x, y) in window CSS coordinates. Native for the same reason
   * as showMenu.
   */
  showNewMenu(x: number, y: number): Promise<void>
  /** move a tab to a new index in the strip; Home stays pinned at index 0 */
  reorder(id: string, toIndex: number): Promise<void>
  /** subscribe to tab list changes (open/close/activate/title updates); returns unsubscribe */
  onChanged(handler: (tabs: TabSummary[]) => void): () => void
  /**
   * fire-and-forget: a pointerdown landed on the shell chrome (tab strip).
   * Document tabs are sibling WebContentsViews that see neither the event nor
   * a focus change, so the shell relays it for them to dismiss popovers.
   */
  notifyChromePressed(): void
  /** the main-process broadcast that notifyChromePressed (and a window drag)
   * triggers; the shell's own popovers subscribe so a title-bar drag — which
   * produces no DOM event — still dismisses them */
  onChromePressed(handler: () => void): () => void
  /**
   * report the editor pane's view-host rect in window content coordinates
   * (CSS px, viewport origin); the active editor view is fitted to it. null
   * hides every editor view (pane collapsed / pane absent).
   */
  setPaneBounds(rect: PaneRect | null): void
  /** 主页 was activated from the main side (回主页 menu items) — the pane should collapse */
  onHomeActivated(handler: () => void): () => void
  /** persisted pane layout (mode + chat width); defaults when unset */
  getPaneLayout(): Promise<PaneLayout>
  /** persist the pane layout (fire-and-forget) */
  setPaneLayout(layout: PaneLayout): void
}

export const TABS_CHANNELS = {
  list: 'tabs:list',
  activate: 'tabs:activate',
  close: 'tabs:close',
  showMenu: 'tabs:show-menu',
  showNewMenu: 'tabs:show-new-menu',
  reorder: 'tabs:reorder',
  changed: 'tabs:changed',
  chromePressed: 'tabs:chrome-pressed',
  paneBounds: 'tabs:pane-bounds',
  homeActivated: 'tabs:home-activated',
  getPaneLayout: 'tabs:get-pane-layout',
  setPaneLayout: 'tabs:set-pane-layout',
} as const
