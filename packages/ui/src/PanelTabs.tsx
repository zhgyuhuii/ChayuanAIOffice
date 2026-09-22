/**
 * PanelTabs — the AI panel's header, doubled as its tab bar.
 *
 * Replaces the branded title row: the app's tabs (对话 / 助手) sit on the
 * left, app actions (new chat etc.) and the DockShell chrome buttons
 * (layout / maximize / collapse) on the right. The whole strip carries the
 * chrome's dragProps, so it stays the tear-off handle.
 *
 * Tab state is owned by the app via usePanelTab (persisted per app key) —
 * switching tabs only swaps the panel body below this strip, so an in-flight
 * chat run keeps running underneath.
 *
 * LOCAL(2026-09-21, d8201ad0): 多会话扩展——PanelTabItem 增加可选 onClose(渲染 ✕,
 * stopPropagation:点 ✕ 不触发切换)与 running(渲染运行中小圆点)。上游无此改动;
 * 收敛条件:上游若原生实现可关闭 tab,评估取上游。
 */
import React, { useState } from 'react'

export interface PanelTabItem {
  id: string
  label: string
  /** renders the ✕ affordance; clicking it must not activate the tab */
  onClose?: () => void
  /** renders the running dot (a background stream keeps flowing) */
  running?: boolean
}

export interface PanelTabsProps {
  tabs: readonly PanelTabItem[]
  activeId: string
  onTabChange: (id: string) => void
  /** app actions before the dock chrome (new chat etc.); tab-scoped visibility is the app's call */
  actions?: React.ReactNode
  /** chrome.buttons handed out by DockShell — layout / maximize / collapse */
  chromeActions?: React.ReactNode
  /** spread of the chrome's dragProps — the strip is the panel's drag handle */
  dragProps?: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
  } | undefined
}

export function PanelTabs({
  tabs,
  activeId,
  onTabChange,
  actions,
  chromeActions,
  dragProps,
}: PanelTabsProps): React.JSX.Element {
  return (
    <div className="ai-tab-header" {...dragProps}>
      <div className="ai-tab-strip" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeId}
            className={`ai-tab${tab.id === activeId ? ' active' : ''}${tab.running ? ' ai-tab-running' : ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.running && <span className="ai-tab-dot" aria-hidden />}
            <span className="ai-tab-label">{tab.label}</span>
            {tab.onClose && (
              <span
                role="button"
                aria-label="close"
                className="ai-tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  tab.onClose?.()
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <svg width="10" height="10" viewBox="0 0 32 32" aria-hidden>
                  <path
                    d="M24 9.4L22.6 8L16 14.6L9.4 8L8 9.4l6.6 6.6L8 22.6L9.4 24l6.6-6.6l6.6 6.6l1.4-1.4l-6.6-6.6L24 9.4z"
                    fill="currentColor"
                  />
                </svg>
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="ai-tab-header-actions">
        {actions}
        {chromeActions}
      </div>
    </div>
  )
}

/** persisted active-tab memory; a stored id outside the list falls back to the first tab */
export function usePanelTab(
  persistKey: string,
  tabs: readonly PanelTabItem[],
): [string, (id: string) => void] {
  const [tab, setTab] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(persistKey)
      if (saved && tabs.some((t) => t.id === saved)) return saved
    } catch {
      /* storage blocked: fall back to the first tab */
    }
    return tabs[0]?.id ?? ''
  })
  const select = (id: string) => {
    setTab(id)
    try {
      localStorage.setItem(persistKey, id)
    } catch {
      /* storage blocked: the pick lasts for the session */
    }
  }
  return [tab, select]
}
