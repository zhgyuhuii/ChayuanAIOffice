import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useI18n } from './locale'
import type { TabSummary } from '../../shared/tabs-api'

export type PaneMode = 'split' | 'collapsed' | 'maximized'

/**
 * The three-pane home's right column: a DOM tab strip on top and the
 * view-host rectangle the main process fits the active editor
 * WebContentsView into. The strip stays interactive DOM — the editor view
 * only ever covers the host area below it.
 */
export function EditorPane({ mode }: { mode: PaneMode }): ReactElement {
  const { t } = useI18n()
  const [tabs, setTabs] = useState<TabSummary[]>([])
  const hostRef = useRef<HTMLDivElement>(null)
  const modeRef = useRef(mode)
  modeRef.current = mode

  // tab list (Home's pseudo-tab is not a pane tab)
  useEffect(() => {
    let live = true
    const apply = (all: TabSummary[]) => setTabs(all.filter((tab) => tab.kind !== 'home'))
    void window.chatOfficeTabs.list().then((all) => {
      if (live) apply(all)
    })
    const off = window.chatOfficeTabs.onChanged(apply)
    return () => {
      live = false
      off()
    }
  }, [])

  // an editor tab activated while the pane is collapsed (menu, AI created a
  // document, opened from the sidebar) → expand so the user sees it
  useEffect(() => {
    return window.chatOfficeTabs.onChanged((all) => {
      if (modeRef.current !== 'collapsed') return
      if (all.some((tab) => tab.kind !== 'home' && tab.active)) {
        window.dispatchEvent(new Event('chatoffice:expand-pane'))
      }
    })
  }, [])

  // report the view-host rect so main can fit the active editor view into it
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const report = () => {
      if (modeRef.current === 'collapsed') {
        window.chatOfficeTabs.setPaneBounds(null)
        return
      }
      const rect = el.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) {
        window.chatOfficeTabs.setPaneBounds(null)
        return
      }
      window.chatOfficeTabs.setPaneBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
      window.chatOfficeTabs.setPaneBounds(null)
    }
  }, [])

  return (
    <section className={`editor-pane${mode === 'maximized' ? ' maximized' : ''}`}>
      <div className="pane-strip">
        <div className="pane-tabs">
          {tabs.length === 0 && <span className="pane-tabs-empty">{t('paneEmptyStrip')}</span>}
          {tabs.map((tab) => (
            <div key={tab.id} className={`pane-tab${tab.active ? ' active' : ''}`}>
              <button
                className="pane-tab-btn"
                title={tab.title}
                onClick={() => void window.chatOfficeTabs.activate(tab.id)}
              >
                {tab.title}
              </button>
              <button
                className="pane-tab-close"
                title={t('closeTab')}
                aria-label={t('closeTab')}
                onClick={() => void window.chatOfficeTabs.close(tab.id)}
              >
                <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
                  <path
                    d="M2.5 2.5l7 7m0-7l-7 7"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <button
          className="pane-add-btn"
          aria-label={t('projNewMenu')}
          title={t('projNewMenu')}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            void window.chatOfficeTabs.showNewMenu(Math.round(rect.left), Math.round(rect.bottom))
          }}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M7 1v12M1 7h12"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <div className="pane-view-host" ref={hostRef}>
        {tabs.length === 0 && (
          <div className="pane-host-empty">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6.3 3.75h7.88c.32 0 .63.13.85.37l3.54 3.84c.19.21.3.49.3.77v9.37c0 .63-.51 1.15-1.15 1.15H6.3a1.15 1.15 0 0 1-1.15-1.15V4.9c0-.64.52-1.15 1.15-1.15z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M13.9 4v3.11c0 1.04.85 1.89 1.89 1.89h3.11"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
            <p>{t('paneEmptyHost')}</p>
          </div>
        )}
      </div>
    </section>
  )
}
