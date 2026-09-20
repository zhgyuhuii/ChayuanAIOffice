// @vitest-environment jsdom
/**
 * Purchase toast (LOCAL purchase feature): renders on {kind:'reminder'} from
 * the main-process scheduler, auto-dismisses after 60s, click (and the
 * {kind:'open-page'} event) opens the purchase dialog via the
 * chatoffice-purchase-open window event. Mounts only when the Electron
 * bridge exists.
 */
import { act, createElement } from 'react'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { PurchaseToast } from '../src/renderer/src/PurchaseToast'
import { LocaleProvider } from '../src/renderer/src/locale'

type EventListener = (payload: { kind: 'open-page' } | { kind: 'reminder' }) => void

function mountWithBridge(onEvent: EventListener) {
  let listener: EventListener | null = null
  Object.defineProperty(window, 'chatOfficePurchase', {
    configurable: true,
    value: {
      onEvent: (l: EventListener) => {
        listener = l
        return () => {}
      },
      state: vi.fn(async () => ({
        fingerprint: 'c22e86ce6642e192',
        freeDaysLeft: 0,
        entitled: false,
        expireAt: null,
        serialMasked: null,
        keyConfigured: true,
      })),
      activate: vi.fn(),
    },
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(LocaleProvider, { initial: 'zh' }, createElement(PurchaseToast)))
  })
  return {
    fire: (payload: { kind: 'open-page' } | { kind: 'reminder' }) =>
      act(() => {
        listener?.(payload)
      }),
    container,
    unmount: () =>
      act(() => {
        root.unmount()
      }),
  }
}

describe('PurchaseToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    delete (window as { chatOfficePurchase?: unknown }).chatOfficePurchase
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('hidden until a reminder event arrives, then shows gentle copy', () => {
    const h = mountWithBridge(() => {})
    expect(document.querySelector('[data-purchase-toast]')).toBeNull()
    h.fire({ kind: 'reminder' })
    expect(document.querySelector('[data-purchase-toast]')).not.toBeNull()
    h.unmount()
  })

  it('auto-dismisses after 60 seconds', () => {
    const h = mountWithBridge(() => {})
    h.fire({ kind: 'reminder' })
    expect(document.querySelector('[data-purchase-toast]')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(61_000)
    })
    expect(document.querySelector('[data-purchase-toast]')).toBeNull()
    h.unmount()
  })

  it('open-page event does not toast; toast click dispatches the dialog event', () => {
    const events: string[] = []
    const onOpen = () => events.push('open')
    window.addEventListener('chatoffice-purchase-open', onOpen)
    const h = mountWithBridge(() => {})
    h.fire({ kind: 'open-page' })
    expect(document.querySelector('[data-purchase-toast]')).toBeNull()
    h.fire({ kind: 'reminder' })
    const openBtn = document.querySelector('[data-purchase-toast-open]') as HTMLButtonElement
    expect(openBtn).not.toBeNull()
    act(() => {
      openBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    // open-page opens the dialog directly (one 'open'), then the toast click
    // opens it again — both funnel into the same window event.
    expect(events).toEqual(['open', 'open'])
    expect(document.querySelector('[data-purchase-toast]')).toBeNull()
    h.unmount()
    window.removeEventListener('chatoffice-purchase-open', onOpen)
  })
})
