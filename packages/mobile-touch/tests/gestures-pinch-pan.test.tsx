// @vitest-environment jsdom
// Pinch-zoom and pan: two-pointer chord scaling with the raw span ratio and
// chord center; single-pointer drag deltas with px/ms release velocity. Point
// capture and touch-action setup are asserted too (jsdom has no pointer
// capture, so the hooks' optional calls must tolerate that).
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MutableRefObject } from 'react'
import { usePan } from '../src/gestures/pan'
import { usePinchZoom } from '../src/gestures/pinch'
import type { PinchZoomHandlers } from '../src/gestures/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn()
})

function pointerEvent(type: string, pointerId: number, x: number, y: number, timeStamp = 0): Event {
  const event = new Event(type)
  Object.assign(event, { button: 0, pointerId, clientX: x, clientY: y })
  Object.defineProperty(event, 'timeStamp', { value: timeStamp })
  return event
}

function mountProbe(
  probe: (props: { ref: MutableRefObject<HTMLElement | null> }) => ReturnType<typeof createElement>,
): { target: HTMLElement; host: HTMLElement; unmount: () => void } {
  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  const ref = { current: null as HTMLElement | null }
  act(() => {
    root.render(probe({ ref }))
  })
  return {
    target: host.querySelector('div')!,
    host,
    unmount: () =>
      act(() => {
        root.unmount()
      }),
  }
}

function PinchProbe({
  ref,
  handlers,
}: {
  ref: MutableRefObject<HTMLElement | null>
  handlers: PinchZoomHandlers
}) {
  usePinchZoom(ref, handlers)
  return createElement('div', { ref })
}

function PanProbe({
  ref,
  handlers,
}: {
  ref: MutableRefObject<HTMLElement | null>
  handlers: {
    onPanStart?: (point: { x: number; y: number }) => void
    onPanMove: (delta: { x: number; y: number }, point: { x: number; y: number }) => void
    onPanEnd?: (velocity: { x: number; y: number }) => void
  }
}) {
  usePan(ref, handlers)
  return createElement('div', { ref })
}

describe('usePinchZoom', () => {
  it('reports scale and chord center from the two-pointer span', () => {
    const onStart = vi.fn()
    const onPinchZoom = vi.fn()
    const onEnd = vi.fn()
    const { target } = mountProbe(({ ref }) =>
      createElement(PinchProbe, {
        ref,
        handlers: { onPinchStart: onStart, onPinchZoom, onPinchEnd: onEnd },
      }),
    )

    act(() => {
      target.dispatchEvent(pointerEvent('pointerdown', 1, 10, 10))
      target.dispatchEvent(pointerEvent('pointerdown', 2, 110, 10)) // span 100
      target.dispatchEvent(pointerEvent('pointermove', 2, 210, 10)) // span 200
    })
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onPinchZoom).toHaveBeenCalledWith(2, { x: 110, y: 10 })

    act(() => {
      target.dispatchEvent(pointerEvent('pointerup', 2, 210, 10))
      target.dispatchEvent(pointerEvent('pointermove', 1, 300, 300)) // pinch over
    })
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onPinchZoom).toHaveBeenCalledTimes(1)
  })

  it('ignores single-pointer moves and guards a degenerate zero span', () => {
    const onPinchZoom = vi.fn()
    const { target } = mountProbe(({ ref }) =>
      createElement(PinchProbe, { ref, handlers: { onPinchZoom } }),
    )
    act(() => {
      target.dispatchEvent(pointerEvent('pointerdown', 1, 50, 50))
      target.dispatchEvent(pointerEvent('pointermove', 1, 80, 50))
    })
    expect(onPinchZoom).not.toHaveBeenCalled()
  })

  it('sets touch-action none while attached and restores it on unmount', () => {
    const ui = mountProbe(({ ref }) =>
      createElement(PinchProbe, { ref, handlers: { onPinchZoom: () => {} } }),
    )
    expect(ui.target.style.touchAction).toBe('none')
    ui.unmount()
    expect(ui.target.style.touchAction).toBe('')
  })
})

describe('usePan', () => {
  it('reports start, per-move deltas, and px/ms release velocity', () => {
    const onStart = vi.fn()
    const onPanMove = vi.fn()
    const onPanEnd = vi.fn()
    const { target } = mountProbe(({ ref }) =>
      createElement(PanProbe, { ref, handlers: { onPanStart: onStart, onPanMove, onPanEnd } }),
    )

    act(() => {
      target.dispatchEvent(pointerEvent('pointerdown', 1, 5, 5, 0))
      target.dispatchEvent(pointerEvent('pointermove', 1, 25, 15, 100)) // 20px / 100ms
      target.dispatchEvent(pointerEvent('pointermove', 1, 45, 15, 200)) // 20px / 100ms
      target.dispatchEvent(pointerEvent('pointerup', 1, 45, 15, 250))
    })
    expect(onStart).toHaveBeenCalledWith({ x: 5, y: 5 })
    expect(onPanMove).toHaveBeenNthCalledWith(1, { x: 20, y: 10 }, { x: 25, y: 15 })
    expect(onPanEnd).toHaveBeenCalledWith({ x: 0.2, y: 0 })
  })

  it('ignores a second pointer mid-drag and cancels without velocity', () => {
    const onStart = vi.fn()
    const onPanMove = vi.fn()
    const onPanEnd = vi.fn()
    const { target } = mountProbe(({ ref }) =>
      createElement(PanProbe, { ref, handlers: { onPanStart: onStart, onPanMove, onPanEnd } }),
    )
    act(() => {
      target.dispatchEvent(pointerEvent('pointerdown', 1, 0, 0))
      target.dispatchEvent(pointerEvent('pointerdown', 2, 50, 50)) // ignored
      target.dispatchEvent(pointerEvent('pointercancel', 1, 0, 0))
    })
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onPanMove).not.toHaveBeenCalled()
    expect(onPanEnd).toHaveBeenCalledWith({ x: 0, y: 0 })
  })
})
