/**
 * Double-tap (P1): two taps within the window and slop radius fire once, at
 * the second tap's position. Pointer events only — no click synthesization —
 * so editors attach this alongside native click handling without double fire.
 */
import { useEffect, useRef } from 'react'
import type { GestureRef, TouchPoint } from './types'

export const DOUBLE_TAP_WINDOW_MS = 300
export const DOUBLE_TAP_SLOP_PX = 30

export function useDoubleTap(ref: GestureRef, onDoubleTap: (point: TouchPoint) => void): void {
  const onDoubleTapRef = useRef(onDoubleTap)
  onDoubleTapRef.current = onDoubleTap

  useEffect(() => {
    const element = ref.current
    if (!element) return

    let lastTime = 0
    let lastX = 0
    let lastY = 0

    const up = (event: PointerEvent) => {
      if (event.button !== 0) return
      const now = event.timeStamp
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      if (now - lastTime <= DOUBLE_TAP_WINDOW_MS && Math.hypot(dx, dy) <= DOUBLE_TAP_SLOP_PX) {
        lastTime = 0
        onDoubleTapRef.current({ x: event.clientX, y: event.clientY })
        return
      }
      lastTime = now
      lastX = event.clientX
      lastY = event.clientY
    }

    element.addEventListener('pointerup', up)
    return () => element.removeEventListener('pointerup', up)
  }, [ref])
}
