/**
 * @chatoffice/mobile-touch — shared mobile interaction kit (consensus #7):
 * gestures, selection handles, editor overlay, keyboard avoidance.
 *
 * P1 shipped keyboard avoidance, long-press and double-tap; P2 completes the
 * kit with pinch-zoom, pan, selection handles, the floating toolbar and the
 * editor overlay — every piece implemented, no stubs left. Recognition is
 * pointer-event based and shared by docs / sheets / slides so thresholds and
 * damping never drift between editors.
 */
export { useDoubleTap, DOUBLE_TAP_SLOP_PX, DOUBLE_TAP_WINDOW_MS } from './gestures/double-tap'
export { useLongPress, LONG_PRESS_DELAY_MS, LONG_PRESS_SLOP_PX } from './gestures/long-press'
export { usePan } from './gestures/pan'
export { usePinchZoom } from './gestures/pinch'
export type {
  GestureRef,
  LongPressOptions,
  PanHandlers,
  PinchZoomHandlers,
  TouchPoint,
} from './gestures/types'
export { SelectionHandles } from './handles/selection-handles'
export type { SelectionHandlesProps } from './handles/types'
export { KeyboardSpacer, computeKeyboardInset, useKeyboardInset } from './keyboard/inset'
export type { KeyboardInset } from './keyboard/types'
export { EditorOverlay } from './overlay/editor-overlay'
export { FloatingToolbar } from './overlay/floating-toolbar'
export type { EditorOverlayProps, FloatingToolbarProps } from './overlay/types'
