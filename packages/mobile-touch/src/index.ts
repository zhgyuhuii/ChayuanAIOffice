/**
 * @chatoffice/mobile-touch — shared mobile interaction kit (consensus #7):
 * gestures, selection handles, editor overlay, keyboard avoidance. P0 ships
 * the type-level API surface only; implementations land in P1/P2.
 */
export {
  useDoubleTap,
  useLongPress,
  usePan,
  usePinchZoom,
  type LongPressOptions,
  type PanHandlers,
  type PinchZoomHandlers,
  type TouchPoint,
} from './gestures/types'
export { SelectionHandles, type SelectionHandlesProps } from './handles/types'
export {
  EditorOverlay,
  FloatingToolbar,
  type EditorOverlayProps,
  type FloatingToolbarProps,
} from './overlay/types'
export { KeyboardSpacer, useKeyboardInset, type KeyboardInset } from './keyboard/types'
