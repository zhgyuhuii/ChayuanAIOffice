/**
 * Tab-strip overflow for the hand-written ribbon tab rows. When the strip runs
 * out of width, tabs clip instead of wrapping; the wheel scrolls the row
 * horizontally and floating edge arrows page through the hidden tabs.
 *
 * DOM contract (hosts keep their pinned file/quick actions and trailing
 * actions outside; only the tab row scrolls):
 *
 *   <nav className="ribbon-tabs">            pinned row (existing chrome)
 *     …pinned leading content…
 *     <div className="ribbon-tabs-scroll" ref={overflow.viewportRef}>
 *       <div className="ribbon-tabs-track" ref={overflow.trackRef}>
 *         …tab buttons (white-space: nowrap, no shrink)…
 *       </div>
 *       <TabStripArrows overflow={overflow} … />
 *     </div>
 *     …pinned trailing content…
 *   </nav>
 *
 * Callback refs (not ref objects) so re-mounting the strip — docs' collapse
 * toggle unmounts the whole row — re-wires observation automatically.
 */
import { useCallback, useEffect, useState, type Ref } from 'react'

export interface TabStripOverflowState {
  /** Tabs are clipped at the strip's physical left edge. */
  readonly hiddenStart: boolean
  /** Tabs are clipped at the strip's physical right edge. */
  readonly hiddenEnd: boolean
}

export interface TabStripOverflow extends TabStripOverflowState {
  /** Attach to the `.ribbon-tabs-scroll` element. */
  readonly viewportRef: Ref<HTMLDivElement>
  /** Attach to the `.ribbon-tabs-track` element inside it. */
  readonly trackRef: Ref<HTMLDivElement>
  /** Page one viewport toward the physical left (-1) / right (1). */
  readonly scrollByPage: (dir: -1 | 1) => void
}

/** Below this many clipped px the strip counts as fitting. */
const EDGE_EPSILON = 1

export function useTabStripOverflow(): TabStripOverflow {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [track, setTrack] = useState<HTMLElement | null>(null)
  const [state, setState] = useState<TabStripOverflowState>({
    hiddenStart: false,
    hiddenEnd: false,
  })

  const measure = useCallback(() => {
    if (!viewport) return
    const max = viewport.scrollWidth - viewport.clientWidth
    let next: TabStripOverflowState
    if (max <= EDGE_EPSILON) {
      next = { hiddenStart: false, hiddenEnd: false }
    } else {
      // RTL scrollLeft runs 0 → -max (Chrome); normalize to "px hidden past
      // the physical left edge" so both directions share one comparison.
      const rtl = getComputedStyle(viewport).direction === 'rtl'
      const fromLeft = rtl ? viewport.scrollLeft + max : viewport.scrollLeft
      next = {
        hiddenStart: fromLeft > EDGE_EPSILON,
        hiddenEnd: fromLeft < max - EDGE_EPSILON,
      }
    }
    setState((prev) =>
      prev.hiddenStart === next.hiddenStart && prev.hiddenEnd === next.hiddenEnd ? prev : next,
    )
  }, [viewport])

  useEffect(() => {
    if (!viewport || !track) return
    viewport.addEventListener('scroll', measure, { passive: true })
    // jsdom and very old webviews ship no ResizeObserver: window resize still
    // re-measures (tab appearance/disappearance won't, but those coincide with
    // renders that scroll/re-measure in practice).
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      measure()
      return () => {
        window.removeEventListener('resize', measure)
        viewport.removeEventListener('scroll', measure)
      }
    }
    // ResizeObserver on both ends: viewport resizes with the window, track
    // resizes when tabs appear/disappear (contextual tabs, language switch).
    const ro = new ResizeObserver(measure)
    ro.observe(viewport)
    ro.observe(track)
    measure()
    return () => {
      ro.disconnect()
      viewport.removeEventListener('scroll', measure)
    }
  }, [viewport, track, measure])

  useEffect(() => {
    if (!viewport) return
    // React's onWheel is passive; horizontal wheel-over-strip needs a real
    // preventDefault, so attach manually. Wheel is physical: += works in RTL
    // too (RTL scrollLeft decreases toward the physical-left overflow).
    const onWheel = (event: WheelEvent) => {
      const max = viewport.scrollWidth - viewport.clientWidth
      if (max <= EDGE_EPSILON) return
      const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (delta === 0) return
      event.preventDefault()
      viewport.scrollLeft += delta
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [viewport])

  const scrollByPage = useCallback(
    (dir: -1 | 1) => {
      if (!viewport) return
      viewport.scrollBy({ left: dir * viewport.clientWidth * 0.8, behavior: 'smooth' })
    },
    [viewport],
  )

  return { viewportRef: setViewport, trackRef: setTrack, scrollByPage, ...state }
}
