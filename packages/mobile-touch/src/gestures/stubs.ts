/**
 * P0 stubs kept until P2: pinch-zoom and pan need pointer-chord tracking with
 * per-editor damping tuning, so they stay loud failures until implemented —
 * consumers must not wire them accidentally.
 */
import type { GestureRef, PanHandlers, PinchZoomHandlers } from './types'

/** Attach to a scrollable/zoomable host element (canvas wrapper etc.). */
export function usePinchZoom(_ref: GestureRef, _handlers: PinchZoomHandlers): void {
  throw new Error('@chatoffice/mobile-touch: usePinchZoom is not implemented (planned P2)')
}

export function usePan(_ref: GestureRef, _handlers: PanHandlers): void {
  throw new Error('@chatoffice/mobile-touch: usePan is not implemented (planned P2)')
}
