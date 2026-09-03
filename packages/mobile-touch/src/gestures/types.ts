/**
 * Gesture primitives (P0: type-level stubs, implemented in P1/P2). Unified
 * pointer+touch recognition shared by docs / sheets / slides so pinch damping
 * and long-press thresholds never drift between editors.
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

/** Attach to a scrollable/zoomable host element (canvas wrapper etc.). */
export function usePinchZoom(
  _ref: { current: HTMLElement | null },
  _handlers: PinchZoomHandlers,
): void {
  throw new Error('@chatoffice/mobile-touch: usePinchZoom is not implemented in P0')
}

export function usePan(_ref: { current: HTMLElement | null }, _handlers: PanHandlers): void {
  throw new Error('@chatoffice/mobile-touch: usePan is not implemented in P0')
}

export function useDoubleTap(
  _ref: { current: HTMLElement | null },
  _onDoubleTap: (point: TouchPoint) => void,
): void {
  throw new Error('@chatoffice/mobile-touch: useDoubleTap is not implemented in P0')
}

export function useLongPress(
  _ref: { current: HTMLElement | null },
  _options: LongPressOptions,
): void {
  throw new Error('@chatoffice/mobile-touch: useLongPress is not implemented in P0')
}
