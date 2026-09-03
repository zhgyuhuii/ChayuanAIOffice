/**
 * Selection handles (P0 stub until P2). One visual language (≥44px touch
 * targets) for docs text selections, sheets cell-range selections, and slides
 * object frames.
 */
import type { TouchPoint } from '../gestures/types'

export interface SelectionHandlesProps {
  /** Viewport-relative anchor points of the two teardrop handles. */
  readonly start: TouchPoint
  readonly end: TouchPoint
  readonly visible: boolean
  readonly onDragHandle: (which: 'start' | 'end', position: TouchPoint) => void
  readonly onDragEnd?: () => void
}

export function SelectionHandles(_props: SelectionHandlesProps): null {
  throw new Error('@chatoffice/mobile-touch: SelectionHandles is not implemented (planned P2)')
}
