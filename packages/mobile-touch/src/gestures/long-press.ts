/**
 * Long-press (P1): press-and-hold fires after delayMs unless the pointer
 * moves beyond the slop radius (scroll intent) or lifts/cancels first. The
 * callback lives in a ref so callers can pass fresh closures without
 * re-subscribing listeners every render.
 */
import { useEffect, useRef } from 'react'
import type { GestureRef, LongPressOptions } from './types'

export const LONG_PRESS_DELAY_MS = 500
/** Movement beyond this radius means a scroll/swipe, not a hold. */
export const LONG_PRESS_SLOP_PX = 10

export function useLongPress(ref: GestureRef, options: LongPressOptions): void {
  const { delayMs = LONG_PRESS_DELAY_MS } = options
  const onLongPressRef = useRef(options.onLongPress)
  onLongPressRef.current = options.onLongPress

  useEffect(() => {
    const element = ref.current
    if (!element) return

    let timer: number | undefined
    let startX = 0
    let startY = 0

    const clear = () => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    }
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      startX = event.clientX
      startY = event.clientY
      clear()
      timer = window.setTimeout(() => {
        timer = undefined
        onLongPressRef.current({ x: event.clientX, y: event.clientY })
      }, delayMs)
    }
    const move = (event: PointerEvent) => {
      if (timer === undefined) return
      const dx = event.clientX - startX
      const dy = event.clientY - startY
      if (Math.hypot(dx, dy) > LONG_PRESS_SLOP_PX) clear()
    }
    const cancel = () => clear()

    element.addEventListener('pointerdown', down)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', cancel)
    element.addEventListener('pointercancel', cancel)
    element.addEventListener('pointerleave', cancel)
    return () => {
      clear()
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', cancel)
      element.removeEventListener('pointercancel', cancel)
      element.removeEventListener('pointerleave', cancel)
    }
  }, [ref, delayMs])
}
