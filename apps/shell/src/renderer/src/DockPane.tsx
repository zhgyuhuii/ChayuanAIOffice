import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { DockTabSummary } from '../../shared/dock-api'
import { getHomeLayout, onHomeLayoutChange, setHomeLayout } from './home-layout'
import { useI18n } from './locale'
import tabIconDocx from './assets/file-docx.png'
import tabIconXlsx from './assets/file-xlsx.png'
import tabIconPptx from './assets/file-pptx.png'
import tabIconMd from './assets/file-md.png'
import tabIconPdf from './assets/file-pdf.png'
import tabIconHtml from './assets/file-html.png'

const KIND_ICONS: Record<DockTabSummary['kind'], string> = {
  docs: tabIconDocx,
  sheets: tabIconXlsx,
  slides: tabIconPptx,
  pdf: tabIconPdf,
  markdown: tabIconMd,
  html: tabIconHtml,
}

/**
 * Home 右栏停靠容器（P1 契约的消费端）。编辑器本体是主进程的
 * WebContentsView,盖在本组件 .dock-area 的矩形之上——渲染器只负责
 * 量矩形并经 IPC 镜像(setRect),不渲染编辑器内容。tab 条负责切换
 * 「哪份停靠文档填充面板」（所见即所驱:中栏对话中继给激活 tab）。
 *
 * 矩形镜像的触发面:ResizeObserver(尺寸)+onHomeLayoutChange(左树拖拽
 * /折叠引起的位置平移)+window resize,rAF 合帧。
 */
export function DockPane({
  onTabs,
}: {
  /** live dock list (session memory wiring in Home) */
  onTabs?: (tabs: DockTabSummary[]) => void
}): ReactElement {
  const { t } = useI18n()
  const [tabs, setTabs] = useState<DockTabSummary[]>([])
  const areaRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef(0)
  const hasTabs = tabs.length > 0

  // live dock list (absent on web/dsh until the shim lands → stays empty)
  useEffect(() => {
    const dock = window.chatOfficeDock
    if (!dock) return
    let alive = true
    void dock.list().then((list) => {
      if (alive) setTabs(list)
    })
    const off = dock.onChanged((list) => setTabs(list))
    return () => {
      alive = false
      off()
    }
  }, [])

  const onTabsRef = useRef(onTabs)
  onTabsRef.current = onTabs
  useEffect(() => {
    onTabsRef.current?.(tabs)
  }, [tabs])

  // a docked editor appearing auto-expands the pane (never auto-collapses:
  // closing the last tab leaves the arrangement to the user)
  useEffect(() => {
    if (hasTabs && getHomeLayout().rightCollapsed) setHomeLayout({ rightCollapsed: false })
  }, [hasTabs])

  const mirror = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const el = areaRef.current
      const dock = window.chatOfficeDock
      if (!el || !dock) return
      const rect = el.getBoundingClientRect()
      dock.setRect({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    })
  }, [])

  useEffect(() => {
    if (!hasTabs) return
    mirror()
    const observer = new ResizeObserver(mirror)
    if (areaRef.current) observer.observe(areaRef.current)
    window.addEventListener('resize', mirror)
    const offLayout = onHomeLayoutChange(mirror)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', mirror)
      offLayout()
      cancelAnimationFrame(rafRef.current)
    }
  }, [hasTabs, mirror])

  const activate = (id: string) => {
    void window.chatOfficeDock?.activate(id)
  }
  const undock = (id: string) => {
    void window.chatOfficeDock?.undock(id)
  }
  const close = (id: string) => {
    void window.chatOfficeDock?.close(id)
  }

  return (
    <>
      {hasTabs && (
        <div className="dock-strip" role="tablist" aria-label={t('dockTabList')}>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.active}
              className={`dock-tab${tab.active ? ' active' : ''}`}
              title={tab.title}
              onClick={() => activate(tab.id)}
            >
              <img className="dock-tab-icon" src={KIND_ICONS[tab.kind]} alt="" aria-hidden />
              <span className="dock-tab-label">{tab.title}</span>
              <button
                className="dock-tab-pop"
                aria-label={t('dockPopOut')}
                title={t('dockPopOut')}
                onClick={(event) => {
                  event.stopPropagation()
                  undock(tab.id)
                }}
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M6.5 3.5H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 13.5h7A1.5 1.5 0 0 0 12.5 12V9.5M9.5 2.5h4v4M13 3l-5.5 5.5"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                className="dock-tab-close"
                aria-label={t('dockCloseTab')}
                title={t('dockCloseTab')}
                onClick={(event) => {
                  event.stopPropagation()
                  close(tab.id)
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path
                    d="M2 2l6 6M8 2l-6 6"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      {hasTabs ? (
        <div className="dock-area" ref={areaRef} />
      ) : (
        <div className="content-pane-empty">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 3.5h8.2L19 8.3V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5A1.5 1.5 0 0 1 6.5 3.5Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path
              d="M13.8 3.8V8.5H18.6M8.5 12.5h7M8.5 15.5h5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <p>{t('contentPaneEmpty')}</p>
        </div>
      )}
    </>
  )
}
