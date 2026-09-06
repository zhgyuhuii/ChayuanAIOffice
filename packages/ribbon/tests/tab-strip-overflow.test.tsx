// @vitest-environment jsdom
// Tab-strip overflow hook: hidden-edge detection (LTR + RTL), wheel
// interception only while overflowing, page scrolling, and the arrow pair's
// visibility driven by those flags. jsdom has no layout, so viewport metrics
// are stubbed per scenario.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TabStripArrows, useTabStripOverflow, type TabStripOverflow } from '../src/index'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let latest: TabStripOverflow | null = null

function Harness() {
  const overflow = useTabStripOverflow()
  latest = overflow
  return h(
    'div',
    { ref: overflow.viewportRef, 'data-testid': 'viewport' },
    h('div', { ref: overflow.trackRef }, h('button', null, '开始'), h('button', null, '视图')),
    h(TabStripArrows, { overflow, leadLabel: 'lead', tailLabel: 'tail' }),
  )
}

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = []
  callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    ResizeObserverStub.instances.push(this)
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  trigger(): void {
    this.callback([], this as unknown as ResizeObserver)
  }
}

function stubMetrics(viewport: HTMLElement, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: scrollWidth })
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: clientWidth })
}

function arrows(container: HTMLElement): { lead: Element | null; tail: Element | null } {
  return {
    lead: container.querySelector('.rb-strip-arrow-lead'),
    tail: container.querySelector('.rb-strip-arrow-tail'),
  }
}

describe('useTabStripOverflow', () => {
  let root: Root
  let container: HTMLElement
  let viewport: HTMLElement

  beforeEach(() => {
    ResizeObserverStub.instances = []
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(h(Harness)))
    viewport = container.querySelector('[data-testid="viewport"]') as HTMLElement
    expect(viewport).toBeTruthy()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    latest = null
  })

  it('reports no hidden edges when the strip fits', () => {
    stubMetrics(viewport, 400, 400)
    act(() => {
      ResizeObserverStub.instances[0]?.trigger()
    })
    expect(latest?.hiddenStart).toBe(false)
    expect(latest?.hiddenEnd).toBe(false)
    const { lead, tail } = arrows(container)
    expect(lead).toBeNull()
    expect(tail).toBeNull()
  })

  it('shows the tail arrow at scroll origin and both after scrolling (LTR)', () => {
    stubMetrics(viewport, 900, 400)
    Object.defineProperty(viewport, 'scrollLeft', { configurable: true, value: 0, writable: true })
    act(() => {
      ResizeObserverStub.instances[0]?.trigger()
    })
    expect(latest?.hiddenStart).toBe(false)
    expect(latest?.hiddenEnd).toBe(true)
    expect(arrows(container).lead).toBeNull()
    expect(arrows(container).tail).toBeTruthy()

    act(() => {
      Object.defineProperty(viewport, 'scrollLeft', {
        configurable: true,
        value: 250,
        writable: true,
      })
      viewport.dispatchEvent(new Event('scroll'))
    })
    expect(latest?.hiddenStart).toBe(true)
    expect(latest?.hiddenEnd).toBe(true)
    expect(arrows(container).lead).toBeTruthy()

    act(() => {
      Object.defineProperty(viewport, 'scrollLeft', {
        configurable: true,
        value: 500,
        writable: true,
      })
      viewport.dispatchEvent(new Event('scroll'))
    })
    expect(latest?.hiddenStart).toBe(true)
    expect(latest?.hiddenEnd).toBe(false)
    expect(arrows(container).tail).toBeNull()
  })

  it('normalizes RTL scrollLeft (0 = right end, -max = left end)', () => {
    stubMetrics(viewport, 900, 400)
    vi.stubGlobal('getComputedStyle', () => ({ direction: 'rtl' }) as CSSStyleDeclaration)
    Object.defineProperty(viewport, 'scrollLeft', { configurable: true, value: 0, writable: true })
    act(() => {
      ResizeObserverStub.instances[0]?.trigger()
    })
    // at the physical right end: everything else hides to the left
    expect(latest?.hiddenStart).toBe(true)
    expect(latest?.hiddenEnd).toBe(false)

    act(() => {
      Object.defineProperty(viewport, 'scrollLeft', {
        configurable: true,
        value: -250,
        writable: true,
      })
      viewport.dispatchEvent(new Event('scroll'))
    })
    expect(latest?.hiddenStart).toBe(true)
    expect(latest?.hiddenEnd).toBe(true)
  })

  it('pages by 80% of the viewport via scrollBy', () => {
    stubMetrics(viewport, 900, 400)
    const scrollBy = vi.fn()
    Object.defineProperty(viewport, 'scrollBy', { configurable: true, value: scrollBy })
    act(() => {
      latest?.scrollByPage(1)
    })
    expect(scrollBy).toHaveBeenCalledWith({ left: 320, behavior: 'smooth' })
    act(() => {
      latest?.scrollByPage(-1)
    })
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -320, behavior: 'smooth' })
  })

  it('intercepts the wheel only while tabs are clipped', () => {
    stubMetrics(viewport, 400, 400)
    let prevented = false
    const fit = new WheelEvent('wheel', { deltaY: 120, cancelable: true })
    Object.defineProperty(fit, 'preventDefault', { value: () => (prevented = true) })
    act(() => {
      viewport.dispatchEvent(fit)
    })
    expect(prevented).toBe(false)

    stubMetrics(viewport, 900, 400)
    act(() => {
      ResizeObserverStub.instances[0]?.trigger()
    })
    const overflowEvent = new WheelEvent('wheel', { deltaY: 120, cancelable: true })
    Object.defineProperty(overflowEvent, 'preventDefault', { value: () => (prevented = true) })
    act(() => {
      viewport.dispatchEvent(overflowEvent)
    })
    expect(prevented).toBe(true)
  })

  it('clicking the tail arrow pages forward', () => {
    stubMetrics(viewport, 900, 400)
    const scrollBy = vi.fn()
    Object.defineProperty(viewport, 'scrollBy', { configurable: true, value: scrollBy })
    act(() => {
      ResizeObserverStub.instances[0]?.trigger()
    })
    const tail = arrows(container).tail as HTMLButtonElement
    act(() => {
      tail.click()
    })
    expect(scrollBy).toHaveBeenCalledWith({ left: 320, behavior: 'smooth' })
  })
})
