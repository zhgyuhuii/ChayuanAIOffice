import type { AiDocContent } from '../../../docs/src/shared/ipc'
import type { TabKind } from './tabs-api'
import type { RelayCommand, RelayEvent } from './relay-protocol'

/**
 * 右栏停靠契约（组件化 P1）：Home 右侧 content-pane 里停靠编辑器视图的
 * 渲染器↔主进程接口。与 tabs-api 同构（同通道风格、同双宿主策略——
 * web 形态由 apps/web 的 shim 提供同名 window.chatOfficeDock）。
 *
 * 停靠态语义（已签共识）：
 * - 停靠 tab 是 TabManager 里的真 tab（顶部 tab 条带「已停靠」标记），
 *   点顶部 tab = 弹出全幅（undock，面板回归）；
 * - 停靠视图只在 Home 激活时可见，定位到渲染器镜像过来的 dock 矩形；
 * - 一个会话右栏可开多份、多种格式、tab 条切换、可关闭（LRU 有上限）。
 */

/** editor kinds that can dock into the Home right pane */
export type DockKind = Exclude<TabKind, 'home'>

/** boot options when docking an editor view into the Home right pane */
export interface DockEditorOptions {
  /** absolute file path to open in the editor */
  file?: string
  /** start as an untitled blank editor */
  newBlank?: boolean
  /** docs only: seed AI-generated content into a new blank document */
  aiContent?: AiDocContent
  /**
   * boot the editor with its own AI side panel hidden (?panel=0) — the
   * Home conversation is the chat surface for docked editors. Defaults to
   * true (docked = no panel, signed consensus): pass an explicit false only
   * for a "docked with panel" variant. The editor's persisted panel
   * preference is never touched either way.
   */
  hidePanel?: boolean
}

/** one docked tab in the Home right pane (id matches the top tab strip) */
export interface DockTabSummary {
  id: string
  kind: DockKind
  title: string
  filePath?: string
  /** the docked tab whose view fills the pane right now */
  active: boolean
}

/**
 * CSS-pixel rect of the dock area inside the shell window, from the
 * renderer's getBoundingClientRect(). Electron view bounds are DIPs and the
 * existing tree-width mirror already assumes CSS px ≡ DIP, so the main
 * process consumes the rect verbatim.
 */
export interface DockRect {
  x: number
  y: number
  width: number
  height: number
}

export interface DockApi {
  /**
   * dock an editor into the Home right pane. Reuses an already-docked tab
   * holding the same file (or the single blank tab per kind); resolves to
   * null when the kind cannot dock.
   */
  open(kind: DockKind, options?: DockEditorOptions): Promise<DockTabSummary | null>
  /** tabs currently docked in the Home pane, strip order */
  list(): Promise<DockTabSummary[]>
  /** switch which docked tab fills the pane */
  activate(id: string): Promise<void>
  /** close one docked tab (same unsaved-changes guards as the top strip) */
  close(id: string): Promise<void>
  /** pop a docked tab out to a full-window tab (its AI panel returns) */
  undock(id: string): Promise<void>
  /** fire-and-forget: the pane's rect changed (splitter drag / window resize) */
  setRect(rect: DockRect): void
  /** dock tab list changes (open/close/activate/title); returns unsubscribe */
  onChanged(handler: (tabs: DockTabSummary[]) => void): () => void
  /** P2 中继: send a RelayCommand to one docked editor's loop */
  relayCommand(dockTabId: string, command: RelayCommand): void
  /** P2 中继: subscribe to RelayEvents from all docked editors; returns unsubscribe */
  onRelayEvent(handler: (dockTabId: string, event: RelayEvent) => void): () => void
  /** P2-5: subscribe to completed panel turns (full-tab mirrors into mainline) */
  onPanelTurn(handler: (turn: PanelTurnReport) => void): () => void
}

export const DOCK_CHANNELS = {
  open: 'dock:open',
  list: 'dock:list',
  activate: 'dock:activate',
  close: 'dock:close',
  undock: 'dock:undock',
  setRect: 'dock:set-rect',
  changed: 'dock:changed',
  relayCommand: 'dock:relay-command',
  relayEvent: 'dock:relay-event',
  panelTurn: 'dock:panel-turn',
} as const

/** P2-5 回流薄钩载荷: a completed editor-panel turn (full-tab mode) */
export interface PanelTurnReport {
  filePath: string | null
  userText: string
  assistantText: string
  cancelled: boolean
}

declare global {
  interface Window {
    /** right-pane dock contract (P1). Optional until the web/dsh shim lands,
     *  so renderer code guards for its absence in non-electron forms. */
    chatOfficeDock?: DockApi
  }
}
