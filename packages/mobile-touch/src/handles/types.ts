/**
 * Selection handles types (consensus #7). One visual language (≥44px touch
 * targets) for docs text selections, sheets cell-range selections, and slides
 * object frames. Implementation: selection-handles.tsx (P2); this module
 * stays type-only.
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
