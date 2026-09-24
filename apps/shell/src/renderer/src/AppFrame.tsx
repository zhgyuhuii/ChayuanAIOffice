import { useEffect, useState } from 'react'
import { Home } from './Home'
import { Onboarding } from './Onboarding'
import { StarPromptCard } from './StarPromptCard'
import { TabBar } from './TabBar'
// LOCAL(purchase): offline purchase toast + dialog; Electron-bridge only.
import { PurchaseModal } from './PurchaseModal'
import { PurchaseToast } from './PurchaseToast'

interface AppFrameProps {
  /** resolved before first paint (main.tsx) so home never flashes under the overlay */
  initialOnboardingSeen: boolean
}

export function AppFrame({ initialOnboardingSeen }: AppFrameProps) {
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
       * by the main process to cover this area — only Home paints its own content here.
       * While a document tab is active the home tree stays painted in the strip the
       * view leaves open: .doc-active (tabbar.css) clips painting to that left column
       * so home can't ghost through the editor views' translucent (vibrancy) regions
       * and the covered layout never reflows. A shell modal (chatoffice-shell-modal
       * class, set by Home's settings funnel) drops the clip — the main process hides
       * the covering editor view for the dialog's lifetime. */}
      <div className={`app-frame-content${homeActive ? '' : ' doc-active'}`}>
        <Home />
      </div>
      {/* editor WebContentsViews paint above ALL shell DOM, so the overlay only
       * renders while the home tab is active — it comes back when home does */}
      {showOnboarding && homeActive && <Onboarding onDone={finishOnboarding} />}
      {starPromptDocOpens !== null && !showOnboarding && homeActive && (
        <StarPromptCard docOpens={starPromptDocOpens} onClose={() => setStarPromptDocOpens(null)} />
      )}
      {/* LOCAL(purchase): scheduler-driven toast + dialog. The bridge only
       * exists in the Electron shell, so the web/dsh-iframe forms never mount
       * these — they structurally cannot self-remind inside the harness host. */}
      {typeof window !== 'undefined' && 'chatOfficePurchase' in window && (
        <>
          <PurchaseToast />
          <PurchaseModal />
        </>
      )}
    </div>
  )
}
