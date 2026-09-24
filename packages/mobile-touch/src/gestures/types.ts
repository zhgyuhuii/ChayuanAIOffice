/**
 * Gesture primitive types (consensus #7). Unified pointer-event recognition
 * shared by docs / sheets / slides so pinch damping and long-press thresholds
 * never drift between editors. Implementations: long-press and double-tap in
 * P1; pinch-zoom and pan remain P0 stubs (stubs.ts) until P2.
 */

export interface TouchPoint {
  readonly x: number
  readonly y: number
}

export interface PinchZoomHandlers {
  readonly onPinchStart?: () => void
  readonly onPinchZoom: (scale: number, center: TouchPoint) => void
  readonly onPinchEnd?: () => void
}

export interface PanHandlers {
  readonly onPanStart?: (point: TouchPoint) => void
  readonly onPanMove: (delta: TouchPoint, point: TouchPoint) => void
  readonly onPanEnd?: (velocity: TouchPoint) => void
}

export interface LongPressOptions {
  readonly delayMs?: number
  readonly onLongPress: (point: TouchPoint) => void
}

/** Ref-shaped target so hooks attach to plain DOM nodes without forwardRef. */
export type GestureRef = { current: HTMLElement | null }
