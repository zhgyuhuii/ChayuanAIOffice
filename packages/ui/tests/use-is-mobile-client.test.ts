// @vitest-environment jsdom
// Client-side wiring for use-is-mobile: the media query factory must run once
// per query per mount (getSnapshot reuses the memoized MediaQueryList, it does
// not rebuild it), and change events on that list must re-render the hook.
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useIsMobile, type MediaQuerySource, type MediaQuerySnapshot } from '../src/use-is-mobile'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function fakeMql(matches: boolean): MediaQuerySnapshot & { set: (v: boolean) => void } {
  const listeners = new Set<() => void>()
  const list = {
    matches,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    set: (v: boolean) => {
      ;(list as { matches: boolean }).matches = v
      for (const listener of listeners) listener()
    },
  }
  return list
}

function Probe({ source }: { source: MediaQuerySource }) {
  const isMobile = useIsMobile({ mediaQuerySource: source })
  return createElement('span', null, isMobile ? 'mobile' : 'desktop')
}

describe('useIsMobile client wiring', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    for (const fn of cleanups.splice(0).reverse()) fn()
  })

  function mount(source: MediaQuerySource): { host: HTMLElement; rerender: () => void } {
    const host = document.createElement('div')
    document.body.append(host)
    const root: Root = createRoot(host)
    cleanups.push(() => root.unmount())
    const render = () =>
      act(() => {
        root.render(createElement(Probe, { source }))
      })
    render()
    return { host, rerender: render }
  }

  it('builds each media query once per mount and reuses the list across re-renders', () => {
    const factory = vi.fn((query: string) => fakeMql(query.includes('coarse')))
    const ui = mount(factory)
    expect(ui.host.textContent).toBe('desktop') // coarse && !narrow → desktop in AND mode
    ui.rerender()
    ui.rerender()
    expect(factory).toHaveBeenCalledTimes(2) // coarse + narrow, once each
  })

  it('updates when the memoized MediaQueryList fires change', () => {
    const lists = new Map<string, ReturnType<typeof fakeMql>>()
    const source: MediaQuerySource = (query) => {
      let list = lists.get(query)
      if (!list) {
        list = fakeMql(false)
        lists.set(query, list)
      }
      return list
    }
    const ui = mount(source)
    expect(ui.host.textContent).toBe('desktop')
    const narrow = lists.get('(max-width: 767px)')!
    const coarse = lists.get('(pointer: coarse)')!
    act(() => {
      narrow.set(true)
      coarse.set(true)
    })
    expect(ui.host.textContent).toBe('mobile')
  })
})
