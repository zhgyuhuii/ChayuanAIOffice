/**
 * FloatingToolbar (P2): the selection-following contextual toolbar. Positions
 * a fixed panel at the anchor (above by default), measured and clamped after
 * layout so the toolbar never spills past the viewport edges — including on
 * the first render, where its own size is still unknown.
 */
import { useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import type { FloatingToolbarProps } from './types'

const VIEWPORT_MARGIN_PX = 8

export function FloatingToolbar({
  anchor,
  placement = 'above',
  children,
}: FloatingToolbarProps): ReactElement | null {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [adjusted, setAdjusted] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!anchor) {
      setAdjusted(null)
      return
    }
    const element = panelRef.current
    const width = element?.offsetWidth ?? 0
    const height = element?.offsetHeight ?? 0
    const margin = VIEWPORT_MARGIN_PX
    const viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth
    const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight
    // center on the anchor, then clamp the box (not its center) into the viewport
    const left = Math.min(
      Math.max(anchor.x - width / 2, margin),
      Math.max(viewportWidth - width - margin, margin),
    )
    const rawTop = placement === 'above' ? anchor.y - height : anchor.y
    const top = Math.min(
      Math.max(rawTop, margin),
      Math.max(viewportHeight - height - margin, margin),
    )
    setAdjusted({ left, top })
  }, [anchor, placement])

  if (!anchor) return null
  return (
    <div
      ref={panelRef}
      className={`mth-toolbar mth-toolbar-${placement}`}
      style={{
        position: 'fixed',
        left: adjusted?.left ?? anchor.x,
        top: adjusted?.top ?? anchor.y,
      }}
    >
      {children}
    </div>
  )
}
