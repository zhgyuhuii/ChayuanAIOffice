/**
 * Virtual-keyboard avoidance (P1): visualViewport-driven inset so bottom
 * toolbars float above the keyboard and the canvas compresses instead of
 * being covered. Pure decision lives in computeKeyboardInset (node-testable);
 * the hook wires resize/scroll events; KeyboardSpacer renders the gap.
 *
 * visualViewport exists on iOS Safari ≥13 / Android Chrome / modern desktop;
 * where it's missing (old WebViews, jsdom) the inset reads zero and consumers
 * keep their static layout.
 */
import { useEffect, useState } from 'react'
import type { KeyboardInset } from './types'

/**
 * Below this threshold an inset is browser-chrome resizing (URL bar show/hide),
 * not the keyboard — reporting it would make toolbars hop on every scroll.
 */
const KEYBOARD_MIN_INSET_PX = 100

/** Pure inset decision: viewport minus visual viewport, floored at zero. */
export function computeKeyboardInset(
  innerHeight: number,
  visual: { height: number; offsetTop: number } | null | undefined,
): KeyboardInset {
  if (!visual) return { insetBottom: 0, visible: false }
  const raw = Math.round(innerHeight - visual.height - visual.offsetTop)
  if (raw < KEYBOARD_MIN_INSET_PX) return { insetBottom: 0, visible: false }
  return { insetBottom: raw, visible: true }
}

function readInset(): KeyboardInset {
  if (typeof window === 'undefined') return { insetBottom: 0, visible: false }
  const visual = window.visualViewport
  if (!visual) return { insetBottom: 0, visible: false }
  return computeKeyboardInset(window.innerHeight, visual)
}

export function useKeyboardInset(): KeyboardInset {
  const [inset, setInset] = useState<KeyboardInset>(readInset)
  useEffect(() => {
    const visual = window.visualViewport
    if (!visual) return
    const update = () => setInset(readInset())
    visual.addEventListener('resize', update)
    visual.addEventListener('scroll', update)
    return () => {
      visual.removeEventListener('resize', update)
      visual.removeEventListener('scroll', update)
    }
  }, [])
  return inset
}

/** Layout spacer that grows by the keyboard inset (toolbars, docks). */
export function KeyboardSpacer(): React.ReactElement {
  const { insetBottom } = useKeyboardInset()
  return <div className="kmt-keyboard-spacer" style={{ height: insetBottom }} aria-hidden="true" />
}
