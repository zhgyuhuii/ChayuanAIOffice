import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { TabsApi, TabSummary, WindowControlsApi } from '../../shared/tabs-api'
import { useI18n } from './locale'
import { getHomeLayout, onHomeLayoutChange, setHomeLayout } from './home-layout'
import tabIconDocx from './assets/file-docx.png'
import tabIconXlsx from './assets/file-xlsx.png'
import tabIconPptx from './assets/file-pptx.png'
import tabIconMd from './assets/file-md.png'

declare global {
  interface Window {
    chatOfficeTabs: TabsApi
    chatOfficeWindow?: WindowControlsApi
  }
}

/** 自绘窗口控制：Windows/Linux 标题栏隐藏后的 最小化/最大化/关闭，与 tab 条同行。
 *  macOS 用原生红绿灯、web/dsh 无窗口概念——preload 的 controls=false 时不出现在 DOM。 */
function WindowControls({ side }: { side: 'left' | 'right' }): ReactElement | null {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    const controls = window.chatOfficeWindow
    if (!controls?.controls) return
    void controls.isMaximized().then(setMaximized)
    return controls.onMaximizeChange(setMaximized)
  }, [])
  if (!window.chatOfficeWindow?.controls) return null
  return (
    <div className={`win-controls side-${side}`}>
      <button
        className="win-control-btn"
        title="最小化"
        aria-label="最小化"
        onClick={() => window.chatOfficeWindow?.minimize()}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
          <path d="M1.5 5.5h8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className="win-control-btn"
        title={maximized ? '还原' : '最大化'}
        aria-label={maximized ? '还原' : '最大化'}
        onClick={() => window.chatOfficeWindow?.toggleMaximize()}
      >
        {maximized ? (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <path d="M3 3V1.5h6.5V8H8" stroke="currentColor" strokeWidth="1.1" />
            <rect x="1.5" y="3" width="6.5" height="6.5" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <rect x="1.5" y="1.5" width="8" height="8" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        )}
      </button>
      <button
        className="win-control-btn win-control-close"
        title="关闭"
        aria-label="关闭"
        onClick={() => window.chatOfficeWindow?.close()}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
          <path
            d="M1.5 1.5l8 8m0-8l-8 8"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  )
}

/** Panel glyph: outlined window with one side column filled to signal the target pane */
function PaneToggleIcon({ side }: { side: 'left' | 'right' }): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="15" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d={side === 'left' ? 'M9.25 4.5v15' : 'M14.75 4.5v15'}
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d={side === 'left' ? 'M4.5 9.25h3.25M4.5 12h3.25' : 'M16.25 9.25h3.25M16.25 12h3.25'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function DocIcon() {
  // brand document icon (162×211 portrait sheet), height-driven
  return <img src={tabIconDocx} style={{ height: 16, width: 'auto' }} alt="" aria-hidden="true" />
}

function SheetIcon() {
  // brand document icon (162×211 portrait sheet), height-driven
  return <img src={tabIconXlsx} style={{ height: 16, width: 'auto' }} alt="" aria-hidden="true" />
}

function PdfIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 240 240" fill="none" aria-hidden="true">
      <rect width="240" height="240" rx="48" fill="#EF4444" />
      <path
        d="M102.719 63.0153C105.738 52.1477 126.265 50.9398 128.68 66.6374C131.699 75.6938 127.472 90.7878 125.661 100.448C130.491 113.127 137.133 122.183 147.397 128.22C158.264 127.013 179.395 125.202 186.641 132.447C192.678 138.485 191.471 155.389 175.774 155.389C166.717 155.389 153.434 151.767 141.963 145.126C129.284 147.541 114.19 152.974 100.907 157.804C70.7196 209.727 53.2104 186.181 55.0216 176.521C57.4366 164.446 73.7385 154.786 85.8136 148.749C91.8511 137.277 100.907 117.957 106.944 103.466C102.718 86.5617 100.304 72.6754 102.719 63.0153ZM85.2149 158.437C81.5921 161.456 70.1214 171.117 67.1026 179.569C67.1026 179.569 73.7436 176.55 85.2149 158.437ZM116.605 113.718C112.378 124.586 107.548 136.662 101.511 146.925C111.171 142.699 122.039 137.869 134.718 134.85C127.473 130.02 121.435 122.775 116.605 113.718ZM180.613 143.932C183.028 142.121 179.406 137.291 158.275 139.102C177.595 147.555 180.613 143.932 180.613 143.932ZM116.013 64.2419C114.805 64.2436 114.806 80.5436 117.221 88.9958C120.239 83.5616 120.843 64.2421 116.013 64.2419Z"
        fill="#fff"
      />
    </svg>
  )
}

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9.06163 4.82633L3.23911 9.92134C2.7398 10.3583 3.07458 11.1343 3.76238 11.1343C4.18259 11.1343 4.52324 11.4489 4.52324 11.8371V15.0806C4.52324 17.871 4.52324 19.2662 5.46176 20.1331C6.40029 21 7.91082 21 10.9319 21H13.0681C16.0892 21 17.5997 21 18.5382 20.1331C19.4768 19.2662 19.4768 17.871 19.4768 15.0806V11.8371C19.4768 11.4489 19.8174 11.1343 20.2376 11.1343C20.9254 11.1343 21.2602 10.3583 20.7609 9.92134L14.9383 4.82633C13.5469 3.60878 12.8512 3 12 3C11.1488 3 10.4531 3.60878 9.06163 4.82633Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 16.0011H12.0105"
        stroke="currentColor"
        strokeWidth="2.57143"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SlideIcon() {
  // brand document icon (162×211 portrait sheet), height-driven
  return <img src={tabIconPptx} style={{ height: 16, width: 'auto' }} alt="" aria-hidden="true" />
}

/* same artwork as the home screen's file-md.svg asset */
function MarkdownIcon() {
  // brand document icon (162×211 portrait sheet), height-driven — same artwork family as the home screen badge
  return <img src={tabIconMd} style={{ height: 16, width: 'auto' }} alt="" aria-hidden="true" />
}

const KIND_ICON: Record<TabSummary['kind'], ReactElement> = {
  home: <HomeIcon />,
  docs: <DocIcon />,
  sheets: <SheetIcon />,
  slides: <SlideIcon />,
  pdf: <PdfIcon />,
  markdown: <MarkdownIcon />,
}

export function TabBar() {
  const { t } = useI18n()
  const layout = useSyncExternalStore(onHomeLayoutChange, getHomeLayout)
  const [tabs, setTabs] = useState<TabSummary[]>([])
  const stripRef = useRef<HTMLDivElement>(null)

  // Chrome-style drag-to-reorder: the grabbed tab tracks the pointer 1:1 while
  // its neighbours slide aside live; the final order is committed on release.
  interface DragInfo {
    pointerId: number
    id: string
    from: number
    startX: number
    /** viewport-x left edge + width of every tab, sampled at drag start */
    lefts: number[]
    widths: number[]
    target: number
    started: boolean
  }
  const dragRef = useRef<DragInfo | null>(null)
  const [dragVisual, setDragVisual] = useState<{
    id: string
    dx: number
    from: number
    target: number
    width: number
  } | null>(null)

  const finishDrag = (pointerId: number, commit: boolean) => {
    const drag = dragRef.current
    if (!drag || pointerId !== drag.pointerId) return
    dragRef.current = null
    if (!drag.started) {
      // plain click: the in-view scroll was suppressed while the press was
      // held (dragRef was set), so honor it now that the press is over
      stripRef.current
        ?.querySelector('.tab-item.active')
        ?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
      return
    }
    setDragVisual(null)
    if (commit && drag.target !== drag.from) {
      // optimistic local reorder so clearing the transforms causes no flash;
      // the main-process broadcast arrives with the identical order
      setTabs((prev) => {
        // look the tab up by id — the list may have changed mid-drag (e.g.
        // Cmd+W), which would make the indices captured at pointer-down stale
        const fromIdx = prev.findIndex((tb) => tb.id === drag.id)
        if (fromIdx < 0) return prev
        const next = [...prev]
        const [moved] = next.splice(fromIdx, 1)
        next.splice(Math.min(Math.max(drag.target, 1), next.length), 0, moved)
        return next
      })
      void window.chatOfficeTabs.reorder(drag.id, drag.target)
    }
  }

  useEffect(() => {
    void window.chatOfficeTabs.list().then(setTabs)
    return window.chatOfficeTabs.onChanged(setTabs)
  }, [])

  // document tabs are sibling WebContentsViews: they see neither this press
  // nor a focus change, so relay it for them to dismiss open popovers
  useEffect(() => {
    const notify = (): void => window.chatOfficeTabs.notifyChromePressed?.()
    document.addEventListener('pointerdown', notify, true)
    return () => document.removeEventListener('pointerdown', notify, true)
  }, [])

  // mirror the home tree's visibility and width into the main process: document
  // views inset by the sidebar so the tree strip stays visible beside them
  // (the sidebar itself is the shell document, always rendered underneath)
  useEffect(() => {
    if (!('chatOfficeTabs' in window)) return
    const send = (): void => {
      const layout = getHomeLayout()
      window.chatOfficeTabs.setTreeInset(!layout.leftCollapsed)
      window.chatOfficeTabs.setTreeWidth(layout.sidebarWidth)
    }
    send()
    return onHomeLayoutChange(send)
  }, [])

  // if the dragged tab is closed mid-drag (e.g. Cmd+W) its element unmounts
  // and pointerup/pointercancel never fire — clear the drag state ourselves
  useEffect(() => {
    const drag = dragRef.current
    if (drag && !tabs.some((t) => t.id === drag.id)) {
      dragRef.current = null
      setDragVisual(null)
    }
  }, [tabs])

  // Trackpads scroll the strip natively; map a mouse's vertical wheel to
  // horizontal scrolling. Native listener because React registers wheel as
  // passive, which forbids preventDefault.
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const onWheel = (event: WheelEvent) => {
      if (strip.scrollWidth <= strip.clientWidth) return
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      event.preventDefault()
      strip.scrollLeft += event.deltaY
    }
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => strip.removeEventListener('wheel', onWheel)
  }, [])

  // keep the active tab in view — new tabs open at the far end of the strip
  const activeId = tabs.find((tab) => tab.active)?.id
  useEffect(() => {
    // pointer-down activation runs while the user is pressing that tab — it is
    // already visible, and scrolling the strip mid-press would invalidate the
    // drag geometry sampled at pointer-down
    if (dragRef.current) return
    stripRef.current
      ?.querySelector('.tab-item.active')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activeId])

  const platform = window.chatOfficeWindow?.platform ?? ''
  const controlSide = platform === 'darwin' ? 'left' : 'right'
  return (
    <div className="tab-bar">
      {controlSide === 'left' && <WindowControls side="left" />}
      <div className="tab-bar-drag-spacer" />
      {/* Home three-pane toggles: always visible, they only affect the home
          layout (the middle chat pane can never be collapsed) */}
      <button
        className={`tab-pane-toggle${layout.leftCollapsed ? ' collapsed' : ''}`}
        title={t('toggleSidebar')}
        aria-label={t('toggleSidebar')}
        aria-pressed={!layout.leftCollapsed}
        onClick={() => setHomeLayout({ leftCollapsed: !layout.leftCollapsed })}
      >
        <PaneToggleIcon side="left" />
      </button>
      <div className={dragVisual ? 'tab-strip dragging' : 'tab-strip'} ref={stripRef}>
        {tabs.map((tab, index) => {
          // live transforms: the grabbed tab tracks the pointer; tabs between
          // the origin and the current target slide aside by the grabbed width
          let dragStyle: CSSProperties | undefined
          if (dragVisual) {
            if (dragVisual.id === tab.id) {
              dragStyle = { transform: `translateX(${dragVisual.dx}px)` }
            } else if (dragVisual.target <= index && index < dragVisual.from) {
              dragStyle = { transform: `translateX(${dragVisual.width}px)` }
            } else if (dragVisual.from < index && index <= dragVisual.target) {
              dragStyle = { transform: `translateX(-${dragVisual.width}px)` }
            }
          }
          return (
            <div
              key={tab.id}
              className={`tab-item ${tab.kind === 'home' ? 'tab-home' : ''} ${tab.active ? 'active' : ''} ${dragVisual?.id === tab.id ? 'drag-source' : ''}`}
              style={dragStyle}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                if ((event.target as HTMLElement).closest('.tab-close')) return
                // Chrome-style: pressing a tab activates it immediately, so
                // activation never depends on the click that a drag would eat
                if (!tab.active) void window.chatOfficeTabs.activate(tab.id)
                if (tab.id === 'home') return
                const strip = stripRef.current
                if (!strip) return
                const rects = Array.from(strip.querySelectorAll<HTMLElement>('.tab-item'), (el) =>
                  el.getBoundingClientRect(),
                )
                dragRef.current = {
                  pointerId: event.pointerId,
                  id: tab.id,
                  from: index,
                  startX: event.clientX,
                  lefts: rects.map((r) => r.left),
                  widths: rects.map((r) => r.width),
                  target: index,
                  started: false,
                }
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current
                if (!drag || event.pointerId !== drag.pointerId) return
                let dx = event.clientX - drag.startX
                // 4px dead zone so plain clicks never wiggle the tab
                if (!drag.started) {
                  if (Math.abs(dx) < 4) return
                  // re-sample geometry the moment the drag really starts — the
                  // pointer-down activation re-renders and could have moved tabs
                  const strip = stripRef.current
                  if (strip) {
                    const rects = Array.from(
                      strip.querySelectorAll<HTMLElement>('.tab-item'),
                      (el) => el.getBoundingClientRect(),
                    )
                    drag.lefts = rects.map((r) => r.left)
                    drag.widths = rects.map((r) => r.width)
                  }
                  drag.started = true
                }
                // keep the tab inside the strip; slot 0 (Home) is off limits
                const last = drag.lefts.length - 1
                const minDx = drag.lefts[1] - drag.lefts[drag.from]
                const maxDx =
                  drag.lefts[last] +
                  drag.widths[last] -
                  drag.widths[drag.from] -
                  drag.lefts[drag.from]
                dx = Math.min(Math.max(dx, minDx), Math.max(minDx, maxDx))
                // Chrome's rule: swap once the grabbed tab's leading edge crosses
                // a neighbour's midpoint (the clamped center can only ever *touch*
                // the first slot's midpoint, so edge-based tests have no dead spot)
                const draggedLeft = drag.lefts[drag.from] + dx
                const draggedRight = draggedLeft + drag.widths[drag.from]
                let target = drag.from
                for (let i = 1; i < drag.from; i++) {
                  if (draggedLeft < drag.lefts[i] + drag.widths[i] / 2) {
                    target = i
                    break
                  }
                }
                for (let i = last; i > drag.from; i--) {
                  if (draggedRight > drag.lefts[i] + drag.widths[i] / 2) {
                    target = i
                    break
                  }
                }
                drag.target = target
                setDragVisual({
                  id: drag.id,
                  dx,
                  from: drag.from,
                  target,
                  width: drag.widths[drag.from],
                })
              }}
              onPointerUp={(event) => finishDrag(event.pointerId, true)}
              onPointerCancel={(event) => finishDrag(event.pointerId, false)}
              onLostPointerCapture={(event) => finishDrag(event.pointerId, false)}
            >
              {/* highlight plate behind the content — hover capsule / active white body */}
              <span className="tab-plate" aria-hidden="true" />
              <span className="tab-icon">{KIND_ICON[tab.kind]}</span>
              <span className="tab-title">{tab.title}</span>
              {tab.closable && (
                <button
                  className="tab-close"
                  title={t('closeTab')}
                  aria-label={t('closeTab')}
                  onClick={(event) => {
                    event.stopPropagation()
                    void window.chatOfficeTabs.close(tab.id)
                  }}
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
        <button
          className="tab-new-btn"
          title={t('newTab')}
          aria-label={t('newTab')}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            void window.chatOfficeTabs.showNewMenu(Math.round(rect.left), Math.round(rect.bottom))
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 4.286v15.429M4.286 12h15.429"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <button
        className="tab-overflow-btn"
        title={t('tabList')}
        aria-label={t('tabList')}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          void window.chatOfficeTabs.showMenu(Math.round(rect.left), Math.round(rect.bottom))
        }}
      >
        {/* window-with-tab-bar glyph: slanted tab cells above a full-width
            header divider (from design asset tab.svg) */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M21 4H3C2.44772 4 2 4.44772 2 5V19C2 19.5523 2.44772 20 3 20H21C21.5523 20 22 19.5523 22 19V5C22 4.44772 21.5523 4 21 4Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M11.5 9.5H22M11.5 9.5L9.5 4M17.5 9.5L15.5 4M2 19V8.5M22 19V8.5M4.5 20H19.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        className={`tab-pane-toggle pane-right${layout.rightCollapsed ? ' collapsed' : ''}`}
        title={t('toggleContentPane')}
        aria-label={t('toggleContentPane')}
        aria-pressed={!layout.rightCollapsed}
        onClick={() => setHomeLayout({ rightCollapsed: !layout.rightCollapsed })}
      >
        <PaneToggleIcon side="right" />
      </button>
      {controlSide === 'right' && <WindowControls side="right" />}
    </div>
  )
}
