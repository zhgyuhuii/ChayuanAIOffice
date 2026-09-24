/**
 * DockShell — shared dockable panel container for the office apps' AI panes.
 *
 * One component owns the panel chrome across docs / sheets / slides / markdown:
 *
 *  - four layouts: docked left / right / bottom (bottom spans the full shell
 *    width, VS Code panel style) or floating (absolute, clamped inside the shell)
 *  - switching: a layout menu in the panel header, or drag the panel header —
 *    the panel tears off and follows the pointer, edge hot zones (48px) show a
 *    snap preview, dropping center leaves it floating
 *  - divider drag between panel and content (double-click collapses), float
 *    resize from every edge/corner; panel keeps ≥ its min, content keeps 320px
 *  - collapse hides the panel entirely (the top-row bubble icon reopens)
 *    and maximize covers the content (Esc restores); a maximized panel
 *    stays draggable — carrying it away un-maximizes into a float/snap
 *  - full persistence (position / sizes / float rect / maximized) per app key
 *
 * The panel stays a single stable DOM subtree for every layout — switching
 * position only flips CSS classes on the shell, so panel state, scroll and
 * in-flight runs survive layout changes.
 *
 * Apps keep their panel component (header included) and render the chrome this
 * shell hands out: `chrome.buttons` goes into the panel header's action row,
 * `chrome.dragProps` spreads onto the header element to enable tear-off.
 * Styling lives in dock.css (dockshell* classes, theme-token fallbacks).
 */
import React, { useEffect, useRef, useState } from 'react'
import { useDismissablePopover } from './popover-dismiss'

export type DockPosition = 'left' | 'right' | 'bottom' | 'float'

export interface DockRect {
  x: number
  y: number
  width: number
  height: number
}

export interface DockLayoutState {
  position: DockPosition
  /** width when docked left/right */
  sideWidth: number
  /**
   * no width was ever user-chosen: the docked side defaults to half the
   * shell (equal chat/editor columns) on first measurement instead of a
   * fixed px value. Cleared once the default is applied or the user drags.
   */
  sideWidthAuto?: boolean
  /** height when docked bottom */
  bottomHeight: number
  /** floating geometry; null until first floated (then defaults right-center) */
  floatRect: DockRect | null
  /** panel covers the whole content area; the content stays mounted beneath */
  maximized: boolean
}

export interface DockLabels {
  /** panel name — resizer aria-label */
  panelTitle: string
  layoutMenu: string
  dockLeft: string
  dockRight: string
  dockBottom: string
  float: string
  maximize: string
  restore: string
  collapse: string
}

export interface DockChrome {
  /** layout menu + maximize + collapse buttons for the panel header's action row */
  buttons: React.ReactNode
  /** spread onto the panel header element to enable drag-to-move/dock */
  dragProps: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
  }
}

export interface DockShellProps {
  /** extra class merged onto the shell root (apps keep their layout hooks) */
  className?: string
  /** extra inline style merged onto the shell root (after the dock vars) */
  style?: React.CSSProperties
  /** localStorage key for the layout state (per app) */
  storageKey: string
  /** pre-DockShell width preference key, migrated on first load */
  legacyWidthKey?: string
  /** panel visibility; owned by the app (it already persists + reports this) */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** the panel body; receives the chrome to place in its header */
  renderPanel: (chrome: DockChrome) => React.ReactNode
  labels: DockLabels
  /** false hides every trace of the panel (no document open) */
  panelAvailable?: boolean
  /** committed layout changes (slides needs the dock width for stage math) */
  onStateChange?: (state: DockLayoutState) => void
  children: React.ReactNode
}

const SIDE_DEFAULT = 360
const SIDE_MIN = 280
/** generous static ceiling (half-split defaults reach 960+ on maximized
 * windows); the live clampSide still caps at shellW - CONTENT_MIN */
const SIDE_MAX = 1200
const BOTTOM_DEFAULT = 320
const BOTTOM_MIN = 200
const BOTTOM_MAX = 800
const FLOAT_DEFAULT_WIDTH = 480
const FLOAT_DEFAULT_HEIGHT = 560
const FLOAT_MIN_W = 320
const FLOAT_MIN_H = 240
/** the content area never shrinks below this in the docked dimension */
const CONTENT_MIN = 320
/** pointer distance from a shell edge that arms the snap preview (negative
 * distances — the pointer pushed past the edge — count as armed: pressing
 * harder toward an edge must not disarm it) */
const SNAP_ZONE = 56
/** header press must travel this far before the panel tears off */
const DRAG_THRESHOLD = 4

const POSITIONS: DockPosition[] = ['left', 'right', 'bottom', 'float']

function clampStaticSide(w: number): number {
  return Math.round(Math.min(Math.max(w, SIDE_MIN), SIDE_MAX))
}

function clampStaticBottom(h: number): number {
  return Math.round(Math.min(Math.max(h, BOTTOM_MIN), BOTTOM_MAX))
}

/** shellW <= 0 means unmeasured (a WebContentsView starts 0×0) — static bounds only */
export function clampSide(w: number, shellW: number): number {
  if (shellW <= 0) return clampStaticSide(w)
  const max = Math.max(120, Math.min(SIDE_MAX, shellW - CONTENT_MIN))
  return Math.round(Math.min(Math.max(w, Math.min(SIDE_MIN, max)), max))
}

export function clampBottom(h: number, shellH: number): number {
  if (shellH <= 0) return clampStaticBottom(h)
  const max = Math.max(120, Math.min(BOTTOM_MAX, shellH - CONTENT_MIN))
  return Math.round(Math.min(Math.max(h, Math.min(BOTTOM_MIN, max)), max))
}

export function clampFloatRect(r: DockRect, shellW: number, shellH: number): DockRect {
  const width = Math.round(
    Math.min(Math.max(r.width, FLOAT_MIN_W), Math.max(FLOAT_MIN_W, shellW || r.width)),
  )
  const height = Math.round(
    Math.min(Math.max(r.height, FLOAT_MIN_H), Math.max(FLOAT_MIN_H, shellH || r.height)),
  )
  const x = Math.round(Math.min(Math.max(r.x, 0), Math.max(0, shellW - width)))
  const y = Math.round(Math.min(Math.max(r.y, 0), Math.max(0, shellH - height)))
  return { x, y, width, height }
}

/** first float: dock-default size hugging the shell's right edge, vertically centered */
export function defaultFloatRect(shellW: number, shellH: number): DockRect {
  const width = Math.min(FLOAT_DEFAULT_WIDTH, Math.max(FLOAT_MIN_W, shellW - 32))
  const height = Math.min(FLOAT_DEFAULT_HEIGHT, Math.max(FLOAT_MIN_H, shellH - 32))
  const x = Math.max(16, shellW - width - Math.round(shellW * 0.06))
  const y = Math.max(16, Math.round((shellH - height) / 2))
  return { x, y, width, height }
}

function sameRect(a: DockRect, b: DockRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

export function loadState(storageKey: string, legacyWidthKey?: string): DockLayoutState {
  let raw: Partial<DockLayoutState>
  try {
    raw = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Partial<DockLayoutState>
  } catch {
    raw = {}
  }
  const legacyWidth = legacyWidthKey ? Number(localStorage.getItem(legacyWidthKey)) : NaN
  const floatRect =
    raw.floatRect &&
    Number.isFinite(raw.floatRect.x) &&
    Number.isFinite(raw.floatRect.y) &&
    Number.isFinite(raw.floatRect.width) &&
    Number.isFinite(raw.floatRect.height)
      ? {
          x: Math.max(0, raw.floatRect.x),
          y: Math.max(0, raw.floatRect.y),
          width: Math.max(FLOAT_MIN_W, raw.floatRect.width),
          height: Math.max(FLOAT_MIN_H, raw.floatRect.height),
        }
      : null
  const storedSide = Number.isFinite(raw.sideWidth) ? clampStaticSide(raw.sideWidth as number) : NaN
  const legacySide =
    Number.isFinite(legacyWidth) && (legacyWidth as number) > 0
      ? clampStaticSide(legacyWidth as number)
      : NaN
  // A width equal to the old fixed default was almost certainly never
  // user-chosen (the default was persisted on every load), so it migrates to
  // the auto half-split instead of pinning existing installs to 360px.
  const sideWidthAuto =
    !(storedSide > 0 && storedSide !== SIDE_DEFAULT) &&
    !(legacySide > 0 && legacySide !== SIDE_DEFAULT)
  return {
    position: POSITIONS.includes(raw.position as DockPosition)
      ? (raw.position as DockPosition)
      : 'left',
    sideWidth: storedSide > 0 ? storedSide : legacySide > 0 ? legacySide : SIDE_DEFAULT,
    sideWidthAuto,
    bottomHeight: Number.isFinite(raw.bottomHeight)
      ? clampStaticBottom(raw.bottomHeight as number)
      : BOTTOM_DEFAULT,
    floatRect,
    maximized: raw.maximized === true,
  }
}

function IconDockLayout(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  )
}

function IconDockSide({ side }: { side: 'left' | 'right' }): React.JSX.Element {
  const bar = side === 'left' ? <path d="M9 4v16" /> : <path d="M15 4v16" />
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      {bar}
    </svg>
  )
}

function IconDockBottom(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 14h18" />
    </svg>
  )
}

function IconFloat(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="13" height="11" rx="2" />
      <rect x="9" y="9" width="12" height="11" rx="2" />
    </svg>
  )
}

function IconMaximize({ maximized }: { maximized: boolean }): React.JSX.Element {
  return maximized ? (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </svg>
  ) : (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  )
}

/** the unified close ✕ — same "collapse" semantics in every dock position */
function IconClose(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

type FloatHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const FLOAT_HANDLES: FloatHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

/// macOS 独立编辑器窗口（titleBarStyle hiddenInset）：原生红绿灯占据左上，
/// AI 面板头（对话/助手行）需要让位；tab 模式的灯归 shell tab 条、web/dsh
/// 无窗口——宿主据此给 DockShell 挂 .mac-standalone。
export function isMacStandaloneWindow(): boolean {
  const mac = navigator.platform.toLowerCase().includes('mac')
  const inTab = new URLSearchParams(window.location.search).get('mode') === 'tab'
  return mac && !inTab
}

export function DockShell({
  className,
  style,
  storageKey,
  legacyWidthKey,
  open,
  onOpenChange,
  renderPanel,
  labels,
  panelAvailable = true,
  onStateChange,
  children,
}: DockShellProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)

  const [state, setState] = useState<DockLayoutState>(() => {
    const initial = loadState(storageKey, legacyWidthKey)
    // apply the auto half-split synchronously, before first paint: the view is
    // already at its final size when scripts run, so the chat panel mounts at
    // its resting width instead of jumping wider right after the editor shows
    // (a mid-load resize that re-fits the document and reads as jank)
    if (initial.sideWidthAuto && typeof window !== 'undefined' && window.innerWidth > 0) {
      return {
        ...initial,
        sideWidth: clampSide(Math.round(window.innerWidth / 2), window.innerWidth),
        sideWidthAuto: false,
      }
    }
    return initial
  })
  const stateRef = useRef(state)
  stateRef.current = state
  const [shellSize, setShellSize] = useState({ w: 0, h: 0 })
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const [resizing, setResizing] = useState(false)
  /** live tear-off drag: the panel slot renders as a floating ghost at rect */
  const [tear, setTear] = useState<{ rect: DockRect; snap: DockPosition | null } | null>(null)
  // A drag whose pointerup was swallowed by native chrome (window resize
  // border, OS gestures) never reaches the drop handler. Recovery is handled
  // inside the drag itself (bare-move detection + blur commit — see
  // startHeaderDrag), not by clearing the tear here.

  /** mirror of `tear` for the drag cleanup — committing inside a state updater
      would fire twice under StrictMode, so the drop reads the ref instead */
  const tearRef = useRef<typeof tear>(null)
  tearRef.current = tear

  useDismissablePopover(menuOpen, () => setMenuOpen(false), {
    inside: () => [menuRef.current, menuBtnRef.current],
  })

  // shell measurement drives every clamp; ResizeObserver also re-clamps the
  // float rect when the window shrinks so the panel can never be lost offscreen
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => setShellSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      const width = entry?.contentRect?.width ?? el.clientWidth
      const height = entry?.contentRect?.height ?? el.clientHeight
      // display:none measures 0×0: re-clamping against it would drag the
      // float rect to the origin, so a hide/show cycle must be a no-op
      if (width === 0 && height === 0) return
      setShellSize({ w: width, h: height })
      setState((prev) => {
        if (!prev.floatRect) return prev
        const clamped = clampFloatRect(prev.floatRect, width, height)
        return sameRect(clamped, prev.floatRect) ? prev : { ...prev, floatRect: clamped }
      })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // No width was ever user-chosen (sideWidthAuto): split the shell in half on
  // first real measurement so the chat pane and the editor render as equal
  // columns. The value then persists like any hand-set width; side-dock only
  // (bottom/float keep the flag until they dock sideways).
  useEffect(() => {
    if (shellSize.w <= 0) return
    setState((prev) => {
      if (!prev.sideWidthAuto) return prev
      if (prev.position !== 'left' && prev.position !== 'right') return prev
      return {
        ...prev,
        sideWidth: clampSide(Math.round(shellSize.w / 2), shellSize.w),
        sideWidthAuto: false,
      }
    })
  }, [shellSize.w])

  // persist + notify on every committed change
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state))
    } catch {
      /* storage full/blocked: layout still works for the session */
    }
    onStateChange?.(state)
  }, [state, storageKey, onStateChange])

  // Esc restores a maximized panel; a dialog that already ate the key (defaultPrevented) wins
  useEffect(() => {
    if (!state.maximized) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        setState((prev) => (prev.maximized ? { ...prev, maximized: false } : prev))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.maximized])

  const setPosition = (position: DockPosition) => {
    setMenuOpen(false)
    setState((prev) => ({ ...prev, position, maximized: false }))
  }

  const toggleMenu = () => {
    if (!menuOpen && menuBtnRef.current) {
      const r = menuBtnRef.current.getBoundingClientRect()
      setMenuPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
    }
    setMenuOpen((v) => !v)
  }

  /** window-level drag helper: move/up listeners with guaranteed cleanup */
  const trackPointer = (
    e: React.PointerEvent,
    onMove: (ev: PointerEvent) => void,
    onDone?: () => void,
  ) => {
    e.preventDefault()
    const cursor = document.body.style.cursor
    const select = document.body.style.userSelect
    // implicit capture on the pressed element: without it, moving over an
    // iframe (sheets/slides editors) or past a native edge stops delivering
    // pointermove to this window — the gesture would freeze mid-drag
    const captureEl = e.currentTarget as EventTarget & {
      setPointerCapture?: (id: number) => void
      releasePointerCapture?: (id: number) => void
    }
    try {
      captureEl.setPointerCapture?.(e.pointerId)
    } catch {
      /* capture is best-effort */
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      try {
        captureEl.releasePointerCapture?.(e.pointerId)
      } catch {
        /* already released */
      }
      document.body.style.cursor = cursor
      document.body.style.userSelect = select
      onDone?.()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
  }

  /** docked divider drag: resize the panel in the docked dimension */
  const startDockResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || stateRef.current.maximized) return
    const shell = rootRef.current?.getBoundingClientRect()
    if (!shell) return
    const pos = stateRef.current.position
    setResizing(true)
    // body styles go on AFTER trackPointer: it snapshots the current values
    // for restore, and must not capture the drag's own cursor/userSelect
    trackPointer(
      e,
      (ev) => {
        setState((prev) =>
          pos === 'bottom'
            ? { ...prev, bottomHeight: clampBottom(shell.bottom - ev.clientY, shell.height) }
            : {
                ...prev,
                // a drag is a width choice — it retires the auto half-split
                sideWidthAuto: false,
                sideWidth: clampSide(
                  pos === 'right' ? shell.right - ev.clientX : ev.clientX - shell.left,
                  shell.width,
                ),
              },
        )
      },
      () => setResizing(false),
    )
    document.body.style.cursor = pos === 'bottom' ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
  }

  /** float window resize from an edge/corner handle */
  const startFloatResize = (e: React.PointerEvent<HTMLDivElement>, handle: FloatHandle) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const shell = rootRef.current?.getBoundingClientRect()
    if (!shell) return
    const start = { ...(stateRef.current.floatRect ?? defaultFloatRect(shell.width, shell.height)) }
    trackPointer(e, (ev) => {
      const px = ev.clientX - shell.left
      const py = ev.clientY - shell.top
      const next = { ...start }
      if (handle.includes('e')) next.width = px - start.x
      if (handle.includes('s')) next.height = py - start.y
      if (handle.includes('w')) {
        next.x = px
        next.width = start.x + start.width - px
      }
      if (handle.includes('n')) {
        next.y = py
        next.height = start.y + start.height - py
      }
      setState((prev) => ({ ...prev, floatRect: clampFloatRect(next, shell.width, shell.height) }))
    })
  }

  /** header drag: threshold-gated tear-off, then edge snap zones / center float.
   * Every resting layout can tear off — docked, floated, or maximized (a
   * maximized panel commits maximized:false on drop, so carrying it away is
   * itself the un-maximize gesture). */
  const startHeaderDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !open) return
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select, [data-no-drag]')) {
      return
    }
    const shellEl = rootRef.current
    const panelEl = panelRef.current
    if (!shellEl || !panelEl) return
    const shell = shellEl.getBoundingClientRect()
    const panel = panelEl.getBoundingClientRect()
    const grabDX = e.clientX - panel.left
    const grabDY = e.clientY - panel.top
    const startX = e.clientX
    const startY = e.clientY
    // ghost model: tearing adopts FLOAT geometry (last float size or the
    // default), with the hand position mapped proportionally onto it — never
    // the docked strip. The docked layout keeps a placeholder slot until drop,
    // so the editor never reflows mid-drag.
    const baseFloat = clampFloatRect(
      stateRef.current.floatRect ?? defaultFloatRect(shell.width, shell.height),
      shell.width,
      shell.height,
    )
    const relX = Math.min(Math.max(grabDX / Math.max(panel.width, 1), 0.1), 0.9)
    const relY = Math.min(Math.max(grabDY / Math.max(panel.height, 1), 0.06), 0.5)
    const anchorX = relX * baseFloat.width
    const anchorY = relY * baseFloat.height
    let active = false
    // Esc mid-drag aborts the gesture entirely — without this the next
    // pointermove would just tear the panel off again
    let aborted = false
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        aborted = true
        tearRef.current = null
        setTear(null)
      }
    }
    /** idempotent drop: commits the armed snap / carried rect exactly once.
     * Beyond pointerup, two swallowed-release paths funnel here too: a bare
     * pointermove (buttons=0 — the OS ate the release but still delivers the
     * next move) and window blur (release landed on native chrome like the
     * resize border or taskbar, or the window lost focus mid-drag). Committing
     * the last shown intent beats discarding the drag: teleporting the panel
     * back to its old dock reads to the user as "the panel vanished from where
     * I dropped it". visibilitychange is deliberately NOT a trigger — an
     * occluded WebContentsView flaps visibility while the button is still
     * held (macOS occlusion), which would commit mid-gesture. */
    let committed = false
    const commit = () => {
      if (committed) return
      committed = true
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', commit)
      const dropped = tearRef.current
      tearRef.current = null
      setTear(null)
      if (dropped) {
        setState((prev) =>
          dropped.snap
            ? { ...prev, position: dropped.snap as DockPosition, maximized: false }
            : { ...prev, position: 'float', floatRect: dropped.rect, maximized: false },
        )
      }
    }
    window.addEventListener('blur', commit)
    trackPointer(
      e,
      (ev) => {
        if (aborted || committed) return
        if (active && ev.buttons === 0) {
          // the button came up without a pointerup (native chrome swallowed
          // it) — treat this move as the drop
          commit()
          return
        }
        if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) {
          return
        }
        if (!active) {
          active = true
          window.addEventListener('keydown', onKey, true)
        }
        const rect = clampFloatRect(
          {
            x: ev.clientX - shell.left - anchorX,
            y: ev.clientY - shell.top - anchorY,
            width: baseFloat.width,
            height: baseFloat.height,
          },
          shell.width,
          shell.height,
        )
        // nearest armed edge wins (corner overlaps resolve by distance);
        // a negative distance = pointer pushed past the edge = armed
        const px = ev.clientX - shell.left
        const py = ev.clientY - shell.top
        const candidates: Array<[DockPosition, number]> = [
          ['left', px],
          ['right', shell.width - px],
          ['bottom', shell.height - py],
        ]
        const armed = candidates
          .filter((c): c is [DockPosition, number] => c[1] < SNAP_ZONE)
          .sort((a, b) => a[1] - b[1])
        const next = { rect, snap: armed[0]?.[0] ?? null }
        tearRef.current = next
        setTear(next)
      },
      () => commit(),
    )
  }

  const position = state.position
  const maximized = state.maximized
  const dockedSize =
    position === 'bottom'
      ? clampBottom(state.bottomHeight, shellSize.h)
      : clampSide(state.sideWidth, shellSize.w)
  const floatRect =
    state.floatRect ??
    defaultFloatRect(shellSize.w || FLOAT_DEFAULT_WIDTH, shellSize.h || FLOAT_DEFAULT_HEIGHT)
  const liveRect = tear?.rect ?? clampFloatRect(floatRect, shellSize.w, shellSize.h)

  const rootClass = [
    'dockshell',
    // during a tear drag the class stays at the resting position — the editor
    // layout must not reflow mid-gesture; only the drop commits the new one
    `pos-${position}`,
    open ? '' : 'is-closed',
    maximized && open ? 'is-max' : '',
    resizing ? 'is-resizing' : '',
    tear ? 'is-tearing' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const rootStyle = {
    '--dock-size': `${dockedSize}px`,
    // the snap preview shows the size the panel WILL take in the armed slot
    '--snap-size': `${tear?.snap === 'bottom' ? clampBottom(state.bottomHeight, shellSize.h) : clampSide(state.sideWidth, shellSize.w)}px`,
    '--dock-x': `${liveRect.x}px`,
    '--dock-y': `${liveRect.y}px`,
    '--dock-w': `${liveRect.width}px`,
    '--dock-h': `${liveRect.height}px`,
    ...style,
  } as React.CSSProperties

  const menuItems: Array<{ value: DockPosition; label: string; icon: React.ReactNode }> = [
    { value: 'left', label: labels.dockLeft, icon: <IconDockSide side="left" /> },
    { value: 'right', label: labels.dockRight, icon: <IconDockSide side="right" /> },
    { value: 'bottom', label: labels.dockBottom, icon: <IconDockBottom /> },
    { value: 'float', label: labels.float, icon: <IconFloat /> },
  ]

  const chrome: DockChrome = {
    buttons: (
      <>
        <button
          ref={menuBtnRef}
          type="button"
          className="dockshell-btn"
          data-tip={labels.layoutMenu}
          aria-label={labels.layoutMenu}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={toggleMenu}
        >
          <IconDockLayout />
        </button>
        <button
          type="button"
          className="dockshell-btn"
          data-tip={maximized ? labels.restore : labels.maximize}
          aria-label={maximized ? labels.restore : labels.maximize}
          onClick={() => setState((prev) => ({ ...prev, maximized: !prev.maximized }))}
        >
          <IconMaximize maximized={maximized} />
        </button>
        <button
          type="button"
          className="dockshell-btn"
          data-tip={labels.collapse}
          aria-label={labels.collapse}
          onClick={() => onOpenChange(false)}
        >
          <IconClose />
        </button>
        {menuOpen && (
          <div
            ref={menuRef}
            className="dockshell-menu"
            role="menu"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            {menuItems.map((item) => (
              <button
                key={item.value}
                type="button"
                role="menuitemradio"
                aria-checked={position === item.value}
                className={`dockshell-menu-item${position === item.value ? ' selected' : ''}`}
                onClick={() => setPosition(item.value)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        )}
      </>
    ),
    dragProps: { onPointerDown: startHeaderDrag },
  }

  const showPanel = panelAvailable

  return (
    <div ref={rootRef} className={rootClass} style={rootStyle}>
      {showPanel && tear && position !== 'float' && !maximized && (
        // reserves the docked strip while the panel is carried as a ghost, so
        // the editor below holds its layout until the drop commits — a
        // maximized panel was never in flow, so a slot there would only
        // shrink the editor mid-drag
        <div
          className="dockshell-slot"
          style={
            position === 'bottom' ? { height: `${dockedSize}px` } : { width: `${dockedSize}px` }
          }
          aria-hidden
        />
      )}
      {showPanel && (
        <div ref={panelRef} className="dockshell-panel">
          {renderPanel(chrome)}
          <div
            className="dockshell-resizer"
            role="separator"
            aria-orientation={position === 'bottom' ? 'horizontal' : 'vertical'}
            aria-label={labels.panelTitle}
            onPointerDown={startDockResize}
            onDoubleClick={() => onOpenChange(false)}
          />
        </div>
      )}
      {showPanel && position === 'float' && !maximized && open && !tear
        ? // siblings of the slot: the float slot is overflow:hidden (corner
          // radius), so handles inside it would lose half their hit area
          FLOAT_HANDLES.map((h) => (
            <div
              key={h}
              className={`dockshell-fh dockshell-fh-${h}`}
              onPointerDown={(e) => startFloatResize(e, h)}
            />
          ))
        : null}
      <div className="dockshell-body">{children}</div>
      {tear?.snap && <div className={`dockshell-snap dockshell-snap-${tear.snap}`} aria-hidden />}
      {showPanel && open && !tear && (maximized || position === 'float') && (
        // keep as the root's LAST child: Chromium composes -webkit-app-region
        // rects in document order, so this invisible no-drag rect is what
        // re-carves the body's ribbon drag row out of the window drag region
        // wherever the panel covers it — else header clicks in that band drag
        // the window and the maximize/restore, layout and close buttons go
        // dead (see .dockshell-carve in dock.css)
        <div className="dockshell-carve" aria-hidden />
      )}
    </div>
  )
}
