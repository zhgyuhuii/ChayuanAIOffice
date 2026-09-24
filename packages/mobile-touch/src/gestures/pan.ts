/**
 * Pan (P2): single-pointer drag tracking with pointer capture. Reports the
 * per-move delta plus the absolute point while dragging, and a px/ms velocity
 * on release so callers can implement fling/momentum without re-deriving it.
 * Multi-touch stays out of the way: a second pointer during a pan is ignored
 * (attach usePinchZoom separately for chord gestures).
 *
 * Like usePinchZoom, sets `touch-action: none` while attached.
 */
import { useEffect, useRef } from 'react'
import type { GestureRef, PanHandlers } from './types'

export function usePan(ref: GestureRef, handlers: PanHandlers): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    const element = ref.current
    if (!element) return

    let dragging = false
    let lastX = 0
    let lastY = 0
    let lastTime = 0
    let velocityX = 0
    let velocityY = 0

    const down = (event: PointerEvent) => {
      if (event.button !== 0 || dragging) return
      dragging = true
      element.setPointerCapture?.(event.pointerId)
      lastX = event.clientX
      lastY = event.clientY
      lastTime = event.timeStamp
      velocityX = 0
      velocityY = 0
      handlersRef.current.onPanStart?.({ x: event.clientX, y: event.clientY })
    }
    const move = (event: PointerEvent) => {
      if (!dragging) return
      const deltaTime = event.timeStamp - lastTime
      const deltaX = event.clientX - lastX
      const deltaY = event.clientY - lastY
      if (deltaTime > 0) {
        velocityX = deltaX / deltaTime
        velocityY = deltaY / deltaTime
      }
      lastX = event.clientX
      lastY = event.clientY
      lastTime = event.timeStamp
      handlersRef.current.onPanMove(
        { x: deltaX, y: deltaY },
        { x: event.clientX, y: event.clientY },
      )
    }
    const up = () => {
      if (!dragging) return
      dragging = false
      handlersRef.current.onPanEnd?.({ x: velocityX, y: velocityY })
    }
    const cancel = () => {
      if (!dragging) return
      dragging = false
      handlersRef.current.onPanEnd?.({ x: 0, y: 0 })
    }

    const previousTouchAction = element.style.touchAction
    element.style.touchAction = 'none'
    element.addEventListener('pointerdown', down)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', cancel)
    return () => {
      element.style.touchAction = previousTouchAction
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', cancel)
    }
  }, [ref])
}
