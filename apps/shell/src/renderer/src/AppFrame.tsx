import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react'
import { Home } from './Home'
import { Onboarding } from './Onboarding'
import { StarPromptCard } from './StarPromptCard'
import { TabBar } from './TabBar'
import { EditorPane } from './EditorPane'
import type { PaneMode } from './EditorPane'
import { useI18n } from './locale'

interface AppFrameProps {
  /** resolved before first paint (main.tsx) so home never flashes under the overlay */
  initialOnboardingSeen: boolean
}

/** the embedded editor pane needs the shell's pane-bounds bridge; the web shim gains it in the web sync phase */
function paneCapable(): boolean {
  return typeof window.chatOfficeTabs.setPaneBounds === 'function'
}

const CHAT_RATIO_MIN = 0.15
const CHAT_RATIO_MAX = 0.75
const clampRatio = (ratio: number): number =>
  Math.min(CHAT_RATIO_MAX, Math.max(CHAT_RATIO_MIN, ratio))

/** three-pane frame: home (sidebar + chat) | draggable divider | editor pane */
function PaneFrame({ children }: { children: ReactNode }): ReactElement {
  const { t } = useI18n()
  const [mode, setMode] = useState<PaneMode>('split')
  const [chatRatio, setChatRatio] = useState(0.36)
  const [dragging, setDragging] = useState(false)
  const workRef = useRef<HTMLDivElement>(null)
  const ratioRef = useRef(chatRatio)
  ratioRef.current = chatRatio

  // restore the persisted layout once
  useEffect(() => {
    void window.chatOfficeTabs.getPaneLayout().then((layout) => {
      setMode(layout.mode)
      setChatRatio(clampRatio(layout.chatRatio))
    })
  }, [])

  // 回主页 menu items collapse the pane from the main side
  useEffect(() => window.chatOfficeTabs.onHomeActivated(() => setMode('collapsed')), [])

  const applyMode = useCallback((next: PaneMode) => {
    setMode(next)
    window.chatOfficeTabs.setPaneLayout({ mode: next, chatRatio: ratioRef.current })
  }, [])

  const persistRatio = useCallback((ratio: number) => {
    window.chatOfficeTabs.setPaneLayout({ mode: 'split', chatRatio: ratio })
  }, [])

  const onDividerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const work = workRef.current
    if (!work) return
    setDragging(true)
    work.setPointerCapture(event.pointerId)
  }

  const onDividerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging || !workRef.current) return
    const rect = workRef.current.getBoundingClientRect()
    setChatRatio(clampRatio((event.clientX - rect.left) / rect.width))
  }

  const onDividerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    workRef.current?.releasePointerCapture(event.pointerId)
    setDragging(false)
    persistRatio(ratioRef.current)
  }

  return (
    <div className={`app-frame pane-frame${dragging ? ' divider-drag' : ''}`}>
      <div className="pane-workarea" ref={workRef}>
        {mode !== 'maximized' && (
          <div
            className="pane-home"
            style={mode === 'split' ? { flex: `0 0 ${chatRatio * 100}%` } : undefined}
          >
            {children}
          </div>
        )}
        {mode === 'split' && (
          <div
            className="pane-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('paneResizeAria')}
            onPointerDown={onDividerDown}
            onPointerMove={onDividerMove}
            onPointerUp={onDividerUp}
            onPointerCancel={onDividerUp}
            onDoubleClick={() => {
              setChatRatio(0.36)
              persistRatio(0.36)
            }}
          />
        )}
        {mode !== 'collapsed' && <EditorPane mode={mode} onModeChange={applyMode} />}
        {mode === 'collapsed' && (
          <button
            className="pane-reveal"
            title={t('paneExpand')}
            aria-label={t('paneExpand')}
            onClick={() => applyMode('split')}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M4.5 2.5L8 6l-3.5 3.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

/** legacy strip frame — the web shim keeps it until the web sync phase */
function TabStripFrame({
  children,
  initialOnboardingSeen,
}: AppFrameProps & { children: ReactNode }): ReactElement {
  const [homeActive, setHomeActive] = useState(true)
  const [showOnboarding, setShowOnboarding] = useState(!initialOnboardingSeen)
  const [starPromptDocOpens, setStarPromptDocOpens] = useState<number | null>(null)

  useEffect(() => {
    const applyTabs = (tabs: Awaited<ReturnType<typeof window.chatOfficeTabs.list>>) => {
      const active = tabs.find((tab) => tab.active)
      setHomeActive(!active || active.kind === 'home')
    }
    void window.chatOfficeTabs.list().then(applyTabs)
    return window.chatOfficeTabs.onChanged(applyTabs)
  }, [])

  // The "star us" invitation is decided (and counted as shown) by the main
  // process; ask once per session, and never while onboarding is up — a
  // first-run user can't have met the value threshold anyway.
  useEffect(() => {
    if (showOnboarding) return
    let alive = true
    void window.chatOffice.starPromptShouldShow?.().then((result) => {
      if (alive && result.show) setStarPromptDocOpens(result.docOpens)
    })
    return () => {
      alive = false
    }
  }, [showOnboarding])

  const finishOnboarding = async (): Promise<boolean> => {
    try {
      const persisted = await window.chatOffice.setOnboardingSeen()
      if (!persisted) return false
      setShowOnboarding(false)
      return true
    } catch {
      return false
    }
  }

  return (
    <div className="app-frame">
      <TabBar />
      {/* docs/sheets tabs render as WebContentsView children of this window, positioned
       * by the main process to cover this area — only Home paints its own content here. */}
      <div className="app-frame-content" style={{ visibility: homeActive ? 'visible' : 'hidden' }}>
        {children}
      </div>
      {/* editor WebContentsViews paint above ALL shell DOM, so the overlay only
       * renders while the home tab is active — it comes back when home does */}
      {showOnboarding && homeActive && <Onboarding onDone={finishOnboarding} />}
      {starPromptDocOpens !== null && !showOnboarding && homeActive && (
        <StarPromptCard docOpens={starPromptDocOpens} onClose={() => setStarPromptDocOpens(null)} />
      )}
    </div>
  )
}

export function AppFrame({ initialOnboardingSeen }: AppFrameProps) {
  const [embedded] = useState(paneCapable)

  // shared onboarding/star-prompt state for the pane frame
  const [showOnboarding, setShowOnboarding] = useState(!initialOnboardingSeen)
  const [starPromptDocOpens, setStarPromptDocOpens] = useState<number | null>(null)

  useEffect(() => {
    if (!embedded) return
    if (showOnboarding) return
    let alive = true
    void window.chatOffice.starPromptShouldShow?.().then((result) => {
      if (alive && result.show) setStarPromptDocOpens(result.docOpens)
    })
    return () => {
      alive = false
    }
  }, [showOnboarding, embedded])

  const finishOnboarding = async (): Promise<boolean> => {
    try {
      const persisted = await window.chatOffice.setOnboardingSeen()
      if (!persisted) return false
      setShowOnboarding(false)
      return true
    } catch {
      return false
    }
  }

  if (!embedded) {
    return (
      <TabStripFrame initialOnboardingSeen={initialOnboardingSeen}>
        <Home />
      </TabStripFrame>
    )
  }

  return (
    <PaneFrame>
      <Home />
      {showOnboarding && <Onboarding onDone={finishOnboarding} />}
      {starPromptDocOpens !== null && !showOnboarding && (
        <StarPromptCard docOpens={starPromptDocOpens} onClose={() => setStarPromptDocOpens(null)} />
      )}
    </PaneFrame>
  )
}
