/**
 * Selection handles (P2): the shared teardrop pair for text/cell/object
 * selections. The container ignores pointers; each handle is its own ≥44px
 * hit target (the visual teardrop is drawn per-app via the `mth-handle-*`
 * classes). Dragging captures the pointer so the stream survives fingers
 * sliding off; every move reports the absolute pointer position.
 */
import { useRef, type ReactElement } from 'react'
import type { TouchPoint } from '../gestures/types'
import type { SelectionHandlesProps } from './types'

function Handle({
  which,
  point,
  onDragHandle,
  onDragEnd,
}: {
  which: 'start' | 'end'
  point: TouchPoint
  onDragHandle: (which: 'start' | 'end', position: TouchPoint) => void
  onDragEnd?: () => void
}): ReactElement {
  const dragging = useRef(false)
  return (
    <div
      className={`mth-handle mth-handle-${which}`}
      style={{ left: point.x, top: point.y }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId)
        dragging.current = true
      }}
      onPointerMove={(event) => {
        if (dragging.current) onDragHandle(which, { x: event.clientX, y: event.clientY })
      }}
      onPointerUp={() => {
        dragging.current = false
        onDragEnd?.()
      }}
      onPointerCancel={() => {
        dragging.current = false
        onDragEnd?.()
      }}
    />
  )
}

export function SelectionHandles(props: SelectionHandlesProps): ReactElement | null {
  const { start, end, visible, onDragHandle, onDragEnd } = props
  if (!visible) return null
  return (
    <div className="mth-handles" aria-hidden="true">
      <Handle which="start" point={start} onDragHandle={onDragHandle} onDragEnd={onDragEnd} />
      <Handle which="end" point={end} onDragHandle={onDragHandle} onDragEnd={onDragEnd} />
    </div>
  )
}
