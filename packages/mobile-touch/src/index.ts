/**
 * @chatoffice/mobile-touch — shared mobile interaction kit (consensus #7):
 * gestures, selection handles, editor overlay, keyboard avoidance.
 *
 * P1 implements keyboard avoidance (visualViewport inset), long-press and
 * double-tap. Pinch-zoom, pan, selection handles and the editor overlay stay
 * loud-failing stubs until P2 — wiring them before implementation must crash
 * at the call site, not silently no-op.
 */
export { useDoubleTap, DOUBLE_TAP_SLOP_PX, DOUBLE_TAP_WINDOW_MS } from './gestures/double-tap'
export { useLongPress, LONG_PRESS_DELAY_MS, LONG_PRESS_SLOP_PX } from './gestures/long-press'
export { usePan, usePinchZoom } from './gestures/stubs'
export type {
  GestureRef,
  LongPressOptions,
  PanHandlers,
  PinchZoomHandlers,
  TouchPoint,
} from './gestures/types'
export { SelectionHandles, type SelectionHandlesProps } from './handles/types'
export { KeyboardSpacer, computeKeyboardInset, useKeyboardInset } from './keyboard/inset'
export type { KeyboardInset } from './keyboard/types'
export {
  EditorOverlay,
  FloatingToolbar,
  type EditorOverlayProps,
  type FloatingToolbarProps,
} from './overlay/types'
