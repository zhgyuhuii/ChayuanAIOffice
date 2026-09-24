// @vitest-environment jsdom
// Keyboard avoidance: the pure inset decision is covered in node-style cases
// here too; the hook wiring runs against a mocked visualViewport, and the
// spacer must track it.
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { computeKeyboardInset, KeyboardSpacer, useKeyboardInset } from '../src/keyboard/inset'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type FakeViewport = EventTarget & { height: number; offsetTop: number }

function makeViewport(height: number, offsetTop = 0): FakeViewport {
  const viewport = new EventTarget() as FakeViewport
  viewport.height = height
  viewport.offsetTop = offsetTop
  return viewport
}

function installViewport(viewport: FakeViewport | undefined, innerHeight = 800): void {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight })
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
}

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn()
  Reflect.deleteProperty(window, 'visualViewport')
})

describe('computeKeyboardInset', () => {
  it('reports zero without a visual viewport', () => {
    expect(computeKeyboardInset(800, null)).toEqual({ insetBottom: 0, visible: false })
    expect(computeKeyboardInset(800, undefined)).toEqual({ insetBottom: 0, visible: false })
  })

  it('counts the keyboard inset from viewport minus visual viewport', () => {
    expect(computeKeyboardInset(800, makeViewport(500))).toEqual({
      insetBottom: 300,
      visible: true,
    })
  })

  it('treats browser-chrome-sized insets as hidden so toolbars do not hop', () => {
    // 50px: URL-bar show/hide territory, not a keyboard
    expect(computeKeyboardInset(800, makeViewport(750))).toEqual({ insetBottom: 0, visible: false })
  })

  it('accounts for the visual viewport scroll offset', () => {
    expect(computeKeyboardInset(800, makeViewport(750, 150))).toEqual({
      insetBottom: 0,
      visible: false,
    })
    expect(computeKeyboardInset(900, makeViewport(600, 150))).toEqual({
      insetBottom: 150,
      visible: true,
    })
  })
})

describe('useKeyboardInset wiring', () => {
  function mount(): { host: HTMLElement; text: () => string } {
    const host = document.createElement('div')
    document.body.append(host)
    const root: Root = createRoot(host)
    cleanups.push(() => root.unmount())
    act(() => {
      root.render(
        createElement(() => {
          const inset = useKeyboardInset()
          return createElement('span', null, `${inset.visible}:${inset.insetBottom}`)
        }),
      )
    })
    return { host, text: () => host.textContent ?? '' }
  }

  it('starts from the live viewport state and follows resize/scroll events', () => {
    const viewport = makeViewport(800)
    installViewport(viewport)
    const ui = mount()
    expect(ui.text()).toBe('false:0')

    act(() => {
      viewport.height = 550
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(ui.text()).toBe('true:250')

    act(() => {
      viewport.height = 800
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(ui.text()).toBe('false:0')
  })

  it('keeps a static zero inset when visualViewport is missing', () => {
    installViewport(undefined)
    const ui = mount()
    expect(ui.text()).toBe('false:0')
  })
})

describe('KeyboardSpacer', () => {
  it('grows to the keyboard inset and stays aria-hidden', () => {
    const viewport = makeViewport(800)
    installViewport(viewport)
    const host = document.createElement('div')
    document.body.append(host)
    const root: Root = createRoot(host)
    cleanups.push(() => root.unmount())
    act(() => {
      root.render(createElement(KeyboardSpacer))
    })
    const spacer = host.querySelector<HTMLElement>('.kmt-keyboard-spacer')!
    expect(spacer.getAttribute('aria-hidden')).toBe('true')
    expect(spacer.style.height).toBe('0px')

    act(() => {
      viewport.height = 550
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(spacer.style.height).toBe('250px')
  })
})
