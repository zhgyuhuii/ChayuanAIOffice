// @vitest-environment jsdom
// Gesture recognition: long-press fires after the delay unless the pointer
// moves beyond the slop radius or lifts first; double-tap fires on the second
// tap inside the time window and slop radius. Events are dispatched as plain
// `pointer*` Event objects (jsdom has no PointerEvent constructor; listeners
// key on the event name, which is all the hooks use).
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MutableRefObject } from 'react'
import { useDoubleTap } from '../src/gestures/double-tap'
import { useLongPress } from '../src/gestures/long-press'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn()
  vi.useRealTimers()
})

function pointerEvent(type: string, x: number, y: number, timeStamp = 0): Event {
  const event = new Event(type)
  Object.assign(event, { button: 0, clientX: x, clientY: y })
  Object.defineProperty(event, 'timeStamp', { value: timeStamp })
  return event
}

/**
 * Renders a probe <div> whose ref the hook consumes. The ref fills during
 * commit, so the hook's effect sees a live element on first mount.
 */
function mountProbe(
  probe: (props: { ref: MutableRefObject<HTMLElement | null> }) => ReturnType<typeof createElement>,
): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  cleanups.push(() => root.unmount())
  const ref = { current: null as HTMLElement | null }
  act(() => {
    root.render(probe({ ref }))
  })
  const target = host.querySelector('div')!
  return target
}

function LongPressProbe({
  ref,
  delayMs,
  onLongPress,
}: {
  ref: MutableRefObject<HTMLElement | null>
  delayMs?: number
  onLongPress: (point: { x: number; y: number }) => void
}) {
  useLongPress(ref, delayMs ? { delayMs, onLongPress } : { onLongPress })
  return createElement('div', { ref })
}

function DoubleTapProbe({
  ref,
  onDoubleTap,
}: {
  ref: MutableRefObject<HTMLElement | null>
  onDoubleTap: (point: { x: number; y: number }) => void
}) {
  useDoubleTap(ref, onDoubleTap)
  return createElement('div', { ref })
}

describe('useLongPress', () => {
  it('fires after the delay at the press point', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const target = mountProbe(({ ref }) => createElement(LongPressProbe, { ref, onLongPress }))
    act(() => {
      target.dispatchEvent(pointerEvent('pointerdown', 40, 60))
    })
    expect(onLongPress).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(onLongPress).toHaveBeenCalledWith({ x: 40, y: 60 })
  })

  it('cancels when the pointer lifts or moves beyond the slop radius', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const target = mountProbe(({ ref }) =>
      createElement(LongPressProbe, { ref, delayMs: 100, onLongPress }),
    )

    act(() => {
      target.dispatchEvent(pointerEvent('pointerdown', 0, 0))
      target.dispatchEvent(pointerEvent('pointerup', 0, 0))
      vi.advanceTimersByTime(200)
    })
    expect(onLongPress).not.toHaveBeenCalled()

    act(() => {
      target.dispatchEvent(pointerEvent('pointerdown', 0, 0))
      target.dispatchEvent(pointerEvent('pointermove', 40, 0)) // beyond slop → scroll intent
      vi.advanceTimersByTime(200)
    })
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('keeps the hold alive for small jitter within the slop radius', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const target = mountProbe(({ ref }) =>
      createElement(LongPressProbe, { ref, delayMs: 100, onLongPress }),
    )
    act(() => {
      target.dispatchEvent(pointerEvent('pointerdown', 0, 0))
      target.dispatchEvent(pointerEvent('pointermove', 5, 5))
      vi.advanceTimersByTime(150)
    })
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })
})

describe('useDoubleTap', () => {
  it('fires on the second tap inside the window and radius', () => {
    const onDoubleTap = vi.fn()
    const target = mountProbe(({ ref }) => createElement(DoubleTapProbe, { ref, onDoubleTap }))
    act(() => {
      target.dispatchEvent(pointerEvent('pointerup', 10, 10, 1000))
      target.dispatchEvent(pointerEvent('pointerup', 14, 12, 1150))
    })
    expect(onDoubleTap).toHaveBeenCalledTimes(1)
    expect(onDoubleTap).toHaveBeenCalledWith({ x: 14, y: 12 })
  })

  it('ignores slow or distant taps', () => {
    const onDoubleTap = vi.fn()
    const target = mountProbe(({ ref }) => createElement(DoubleTapProbe, { ref, onDoubleTap }))
    act(() => {
      // every pair inside the time window is >30px apart, every pair within
      // 30px is >300ms apart — no combination qualifies as a double-tap
      target.dispatchEvent(pointerEvent('pointerup', 10, 10, 1000))
      target.dispatchEvent(pointerEvent('pointerup', 200, 10, 1100)) // too far
      target.dispatchEvent(pointerEvent('pointerup', 10, 10, 1200)) // too far
      target.dispatchEvent(pointerEvent('pointerup', 10, 10, 2000)) // too slow
    })
    expect(onDoubleTap).not.toHaveBeenCalled()
  })
})
