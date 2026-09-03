import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Home, CloudProjectsView } from './Home'
import { Onboarding } from './Onboarding'
import { StarPromptCard } from './StarPromptCard'
import { TabBar } from './TabBar'
import { TopStrip } from './TopStrip'
import { ChatPanel } from './home-chat/ChatPanel'
import { HomeChatProvider } from './home-chat/context'
import { refreshHomeModelCache } from './home-chat/bridge'

interface AppFrameProps {
  /** resolved before first paint (main.tsx) so home never flashes under the overlay */
  initialOnboardingSeen: boolean
}

/**
 * The shell keeps the ORIGINAL tab mechanism — TabBar at the very top, one
 * tab per open editor, editors cover the content area — with ONE change: the
 * sidebar is persistent. Layout:
 *
 *   ┌──────────────────────────────────────────┐
 *   │ TabBar (doc tabs … +)          ← top     │
 *   ├──────────┬───────────────────────────────┤
 *   │ sidebar  │ content area                  │
 *   │ (Home)   │  home tab: strip + chat       │
 *   │          │  doc tab: editor view covers  │
 *   └──────────┴───────────────────────────────┘
 *
 * On desktop the editor is a WebContentsView fitted to the content area's
 * reported rect (tabs:pane-bounds); on web it is the iframe layer anchored to
 * the same .app-frame-content element. Both hide the home DOM while a
 * document tab is active, exactly like the pre-sidebar shell.
 */
export function AppFrame({ initialOnboardingSeen }: AppFrameProps): ReactElement {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cloudMode, setCloudMode] = useState(false)
  const [homeActive, setHomeActive] = useState(true)
  const [showOnboarding, setShowOnboarding] = useState(!initialOnboardingSeen)
  const [starPromptDocOpens, setStarPromptDocOpens] = useState<number | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // the embedded editor views need the pane-bounds bridge (desktop preload);
  // the web shim's iframe layer anchors to .app-frame-content instead
  const paneCapable = typeof window.chatOfficeTabs.setPaneBounds === 'function'

  // home is active when no editor tab is active (TabBar shows no home tab —
  // the sidebar is always there, so "home" is just the content state)
  useEffect(() => {
    const apply = (tabs: Awaited<ReturnType<typeof window.chatOfficeTabs.list>>) => {
      setHomeActive(!tabs.some((tab) => tab.active && tab.kind !== 'home'))
    }
    void window.chatOfficeTabs.list().then(apply)
    return window.chatOfficeTabs.onChanged(apply)
  }, [])

  // report the content-area rect so main fits the active editor view into it
  // (views are hidden while home is active, so reporting is unconditional)
  useEffect(() => {
    if (!paneCapable) return
    const el = contentRef.current
    if (!el) return
    const report = () => {
      const r = el.getBoundingClientRect()
      window.chatOfficeTabs.setPaneBounds(
        r.width < 1 || r.height < 1
          ? null
          : {
              x: Math.round(r.left),
              y: Math.round(r.top),
              width: Math.round(r.width),
              height: Math.round(r.height),
            },
      )
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
  }, [paneCapable])

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

  const handleSettingsOpenChange = useCallback((open: boolean) => {
    setSettingsOpen(open)
    if (!open) void refreshHomeModelCache()
  }, [])

  const finishOnboarding = useCallback(async (): Promise<boolean> => {
    try {
      const persisted = await window.chatOffice.setOnboardingSeen()
      if (!persisted) return false
      setShowOnboarding(false)
      return true
    } catch {
      return false
    }
  }, [])

  return (
    <HomeChatProvider onOpenSettings={() => handleSettingsOpenChange(true)}>
      <div className="app-frame shell-frame">
        <TabBar />
        <div className="frame-body">
          <Home
            settingsOpen={settingsOpen}
            onSettingsOpenChange={handleSettingsOpenChange}
            cloudMode={cloudMode}
            onCloudModeChange={setCloudMode}
          />
          <div
            className="app-frame-content"
            ref={contentRef}
            style={{ visibility: homeActive ? 'visible' : 'hidden' }}
          >
            {cloudMode ? (
              <CloudProjectsView />
            ) : (
              <div className="frame-home">
                <TopStrip />
                <ChatPanel />
              </div>
            )}
          </div>
        </div>
      </div>
      {/* editor views paint above ALL shell DOM, so the overlays only render
       * while the home state is active — they come back when home does */}
      {showOnboarding && homeActive && <Onboarding onDone={finishOnboarding} />}
      {starPromptDocOpens !== null && !showOnboarding && homeActive && (
        <StarPromptCard docOpens={starPromptDocOpens} onClose={() => setStarPromptDocOpens(null)} />
      )}
    </HomeChatProvider>
  )
}
