export type TabKind = 'home' | 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown' | 'html'

/** a tab that holds a document — every kind except the Home screen */
export type DocumentTabKind = Exclude<TabKind, 'home'>

/** one open tab in the top tab strip; Home is always id 'home' and not closable */
export interface TabSummary {
  id: string
  kind: TabKind
  title: string
  closable: boolean
  active: boolean
  /** docked into the Home right pane (「已停靠」): paints at the mirrored
   *  pane rect while Home is active; clicking it in the strip pops it full */
  docked?: boolean
  /** absolute path behind the tab; absent while the document is untitled */
  filePath?: string
}

/**
 * One document open in an editor tab, as reported to the MCP `open_documents`
 * tool. Unlike `TabSummary` this excludes Home and chrome-free Present tabs (no
 * file, nothing an agent could read or close) and carries the unsaved-changes
 * state, which the shell resolves per family.
 */
export interface OpenDocumentTab {
  id: string
  kind: DocumentTabKind
  title: string
  filePath?: string
  active: boolean
  dirty: boolean

}

export interface TabsApi {
  list(): Promise<TabSummary[]>
  activate(id: string): Promise<void>
  close(id: string): Promise<void>
  /**
   * pop up the native tab context menu (close / close others / close left /
   * close right / close all) at (x, y) in window CSS coordinates for the
   * given tab. Native because the content area below the strip is a
   * WebContentsView that would cover any DOM dropdown.
   */
  showTabContextMenu(x: number, y: number, tabId: string): Promise<void>
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
  /**
   * pop up the native per-tab context menu (Open in New Window / Close) at
   * (x, y) in window CSS coordinates. Native for the same reason as showMenu.
   */
  showTabMenu(id: string, x: number, y: number): Promise<void>
  /** detach a docs/sheets tab into its own window ("Open in New Window") */
  detach(id: string): Promise<void>
  /**
   * pop up the application menu (File / Edit / View …) at (x, y). Windows and
   * Linux hide the native menu bar under the tab strip; macOS keeps the
   * system menu bar and never shows the button.
   */
  showAppMenu(x: number, y: number): Promise<void>
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
   * fire-and-forget: show/hide the home tree beside document tabs. When on,
   * the main process insets every document WebContentsView by the home
   * sidebar's width so the shell's own tree strip stays visible to its left.
   */
  setTreeInset(visible: boolean): void
  /**
   * fire-and-forget: the user dragged the home tree splitter — the editor
   * views' left inset follows this width live.
   */
  setTreeWidth(px: number): void
  /**
   * fire-and-forget: a shell modal (settings) needs the whole window. Shell
   * DOM always paints beneath the editor WebContentsViews, so the main
   * process hides the active editor view for the modal's lifetime.
   */
  setShellModalOpen(open: boolean): void
}

export const TABS_CHANNELS = {
  list: 'tabs:list',
  activate: 'tabs:activate',
  close: 'tabs:close',
  showTabContextMenu: 'tabs:show-tab-context-menu',
  showMenu: 'tabs:show-menu',
  showNewMenu: 'tabs:show-new-menu',
  showTabMenu: 'tabs:show-tab-menu',
  detach: 'tabs:detach',
  showAppMenu: 'tabs:show-app-menu',
  reorder: 'tabs:reorder',
  changed: 'tabs:changed',
  chromePressed: 'tabs:chrome-pressed',
  treeInset: 'tabs:tree-inset',
  treeWidth: 'tabs:tree-width',
  shellModal: 'tabs:shell-modal',
} as const

/// 自绘窗口控制（Windows/Linux 用；macOS 用原生红绿灯，web/dsh 无窗口概念）
export const WINDOW_CHANNELS = {
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
  isMaximized: 'window:is-maximized',
  maximizeChanged: 'window:maximize-changed',
} as const

export interface WindowControlsApi {
  /** 仅 Windows/Linux electron 为 true；macOS 走原生红绿灯，web/dsh 无此 API */
  readonly controls: boolean
  readonly platform: string
  minimize(): void
  toggleMaximize(): void
  close(): void
  isMaximized(): Promise<boolean>
  onMaximizeChange(callback: (maximized: boolean) => void): () => void
}
