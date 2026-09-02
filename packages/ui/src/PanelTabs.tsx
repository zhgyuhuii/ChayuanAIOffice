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
 */
import React, { useState } from 'react'

export interface PanelTabItem {
  id: string
  label: string
}

export interface PanelTabsProps {
  tabs: PanelTabItem[]
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
            className={`ai-tab${tab.id === activeId ? ' active' : ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
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
  tabs: PanelTabItem[],
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
