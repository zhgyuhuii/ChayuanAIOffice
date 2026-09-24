/**
 * Pinch-zoom (P2): two-pointer chord tracking with pointer capture, so the
 * scale/center stream stays alive when fingers drift off the element. Reports
 * the raw scale (current span / starting span) and the chord center — damping
 * and clamping stay caller-side until a second editor consumes them, so the
 * primitive cannot bake in one app's feel.
 *
 * The hook sets `touch-action: none` on the element while attached (browser
 * pinch-zoom/scroll would otherwise swallow the pointers) and restores the
 * previous value on cleanup.
 */
import { useEffect, useRef } from 'react'
import type { GestureRef, PinchZoomHandlers, TouchPoint } from './types'

export function usePinchZoom(ref: GestureRef, handlers: PinchZoomHandlers): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const pointers = new Map<number, TouchPoint>()
    let startDist = 0
    let pinching = false

    const span = (a: TouchPoint, b: TouchPoint) => Math.hypot(a.x - b.x, a.y - b.y)
    const midpoint = (a: TouchPoint, b: TouchPoint): TouchPoint => ({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    })

    const down = (event: PointerEvent) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      element.setPointerCapture?.(event.pointerId)
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        startDist = span(a, b)
        pinching = true
        handlersRef.current.onPinchStart?.()
      }
    }
    const move = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (!pinching || pointers.size < 2 || startDist <= 0) return
      const [a, b] = [...pointers.values()]
      handlersRef.current.onPinchZoom(span(a, b) / startDist, midpoint(a, b))
    }
    const lift = (event: PointerEvent) => {
      pointers.delete(event.pointerId)
      if (pinching && pointers.size < 2) {
        pinching = false
        handlersRef.current.onPinchEnd?.()
      }
    }

    const previousTouchAction = element.style.touchAction
    element.style.touchAction = 'none'
    element.addEventListener('pointerdown', down)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', lift)
    element.addEventListener('pointercancel', lift)
    return () => {
      element.style.touchAction = previousTouchAction
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', lift)
      element.removeEventListener('pointercancel', lift)
    }
  }, [ref])
}
