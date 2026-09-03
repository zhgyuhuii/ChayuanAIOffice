import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { Home, CloudProjectsView } from './Home'
import { Onboarding } from './Onboarding'
import { StarPromptCard } from './StarPromptCard'
import { TabBar } from './TabBar'
import { EditorPane } from './EditorPane'
import type { PaneMode } from './EditorPane'
import { TopStrip } from './TopStrip'
import { ChatPanel } from './home-chat/ChatPanel'
import { HomeChatProvider } from './home-chat/context'
import { useI18n } from './locale'
import { refreshHomeModelCache } from './home-chat/bridge'

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

/** lifted state shared by both frames (the sidebar and the pane body) */
interface FrameProps {
  initialOnboardingSeen: boolean
  selectedProjectId: string | null
  onSelectProject: (id: string | null) => void
  settingsOpen: boolean
  onSettingsOpenChange: (open: boolean) => void
  cloudMode: boolean
  onCloudModeChange: (on: boolean) => void
}

/**
 * Three-pane frame (ZCode-style): narrow sidebar | wide area with a top strip
 * (conversation title/actions) above a body that splits into the chat (left)
 * and the tabbed file panel (right).
 */
function PaneFrame({
  selectedProjectId,
  onSelectProject,
  settingsOpen,
  onSettingsOpenChange,
  cloudMode,
  onCloudModeChange,
}: Omit<FrameProps, 'initialOnboardingSeen'>): ReactElement {
  const { t } = useI18n()
  const [mode, setMode] = useState<PaneMode>('split')
  const [chatRatio, setChatRatio] = useState(0.36)
  const [dragging, setDragging] = useState(false)
  const workRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
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

  // an editor tab activated while the file panel is collapsed (AI opened a
  // document) → expand it again
  useEffect(() => {
    const expand = () => setMode((m) => (m === 'collapsed' ? 'split' : m))
    window.addEventListener('chatoffice:expand-pane', expand)
    return () => window.removeEventListener('chatoffice:expand-pane', expand)
  }, [])

  const applyMode = useCallback((next: PaneMode) => {
    setMode(next)
    window.chatOfficeTabs.setPaneLayout({ mode: next, chatRatio: ratioRef.current })
  }, [])

  const persistRatio = useCallback((ratio: number) => {
    window.chatOfficeTabs.setPaneLayout({ mode: 'split', chatRatio: ratio })
  }, [])

  const onDividerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const work = bodyRef.current
    if (!work) return
    setDragging(true)
    work.setPointerCapture(event.pointerId)
  }

  const onDividerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging || !bodyRef.current) return
    const rect = bodyRef.current.getBoundingClientRect()
    setChatRatio(clampRatio((event.clientX - rect.left) / rect.width))
  }

  const onDividerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    bodyRef.current?.releasePointerCapture(event.pointerId)
    setDragging(false)
    persistRatio(ratioRef.current)
  }

  return (
    <div className={`app-frame pane-frame${dragging ? ' divider-drag' : ''}`}>
      <div className="pane-workarea" ref={workRef}>
        {mode !== 'maximized' && (
          <div className="pane-home">
            <Home
              selectedProjectId={selectedProjectId}
              onSelectProject={(id) => {
                onSelectProject(id)
                onCloudModeChange(false)
              }}
              settingsOpen={settingsOpen}
              onSettingsOpenChange={onSettingsOpenChange}
              cloudMode={cloudMode}
              onCloudModeChange={onCloudModeChange}
            />
          </div>
        )}
        <div className="pane-main">
          <TopStrip mode={mode} onModeChange={applyMode} />
          <div className="pane-body" ref={bodyRef}>
            {mode !== 'maximized' && (
              <>
                <div
                  className="pane-chat-host"
                  style={mode === 'split' ? { flex: `0 0 ${chatRatio * 100}%` } : undefined}
                >
                  {cloudMode ? <CloudProjectsView /> : <ChatPanel />}
                </div>
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
              </>
            )}
            {mode !== 'collapsed' && <EditorPane mode={mode} />}
          </div>
        </div>
      </div>
    </div>
  )
}

/** legacy strip frame — the web shim keeps it until the web sync phase */
function TabStripFrame({
  selectedProjectId,
  onSelectProject,
  settingsOpen,
  onSettingsOpenChange,
  cloudMode,
  onCloudModeChange,
}: Omit<FrameProps, 'initialOnboardingSeen'>): ReactElement {
  const [homeActive, setHomeActive] = useState(true)

  useEffect(() => {
    const applyTabs = (tabs: Awaited<ReturnType<typeof window.chatOfficeTabs.list>>) => {
      const active = tabs.find((tab) => tab.active)
      setHomeActive(!active || active.kind === 'home')
    }
    void window.chatOfficeTabs.list().then(applyTabs)
    return window.chatOfficeTabs.onChanged(applyTabs)
  }, [])

  return (
    <div className="app-frame">
      <TabBar />
      {/* docs/sheets tabs render as WebContentsView children of this window, positioned
       * by the main process to cover this area — only Home paints its own content here. */}
      <div className="app-frame-content" style={{ visibility: homeActive ? 'visible' : 'hidden' }}>
        <div className="legacy-home-row">
          <Home
            selectedProjectId={selectedProjectId}
            onSelectProject={onSelectProject}
            settingsOpen={settingsOpen}
            onSettingsOpenChange={onSettingsOpenChange}
            cloudMode={cloudMode}
            onCloudModeChange={onCloudModeChange}
          />
          {cloudMode ? <CloudProjectsView /> : <ChatPanel />}
        </div>
      </div>
    </div>
  )
}

export function AppFrame({ initialOnboardingSeen }: AppFrameProps) {
  const [embedded] = useState(paneCapable)

  // lifted shared state: the sidebar (Home) and the pane body both need it
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cloudMode, setCloudMode] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(!initialOnboardingSeen)
  const [starPromptDocOpens, setStarPromptDocOpens] = useState<number | null>(null)

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

  // The "star us" invitation is decided (and counted as shown) by the main
  // process; ask once per session, and never while onboarding is up.
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

  const frameProps: FrameProps = {
    initialOnboardingSeen,
    selectedProjectId,
    onSelectProject: setSelectedProjectId,
    settingsOpen,
    onSettingsOpenChange: handleSettingsOpenChange,
    cloudMode,
    onCloudModeChange: setCloudMode,
  }

  return (
    <HomeChatProvider
      projectId={selectedProjectId}
      onOpenSettings={() => handleSettingsOpenChange(true)}
    >
      {embedded ? (
        <PaneFrame
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
          settingsOpen={settingsOpen}
          onSettingsOpenChange={handleSettingsOpenChange}
          cloudMode={cloudMode}
          onCloudModeChange={setCloudMode}
        />
      ) : (
        <TabStripFrame {...frameProps} />
      )}
      {showOnboarding && <Onboarding onDone={finishOnboarding} />}
      {starPromptDocOpens !== null && !showOnboarding && (
        <StarPromptCard docOpens={starPromptDocOpens} onClose={() => setStarPromptDocOpens(null)} />
      )}
    </HomeChatProvider>
  )
}
