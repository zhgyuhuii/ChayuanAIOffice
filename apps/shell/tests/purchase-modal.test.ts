// @vitest-environment jsdom
/**
 * Purchase dialog (renderer side of the scan-to-buy flow): opens on the
 * chatoffice-purchase-open event (what the scheduler and the toast funnel
 * into), renders a locally generated QR of the buy/share URL (qrcode lib is
 * mocked — jsdom has no canvas), offers open-in-browser + copy-link, shows
 * the machine fingerprint, runs the activate round trip through the preload
 * bridge (success copy auto-names the product and duration from the serial's
 * module bitmap + days, failure reasons map to friendly i18n buckets, Enter
 * submits), and stays informative when the bridge is absent (web/dsh forms).
 * No local price tiers exist — prices live on the buy page the QR encodes.
 */
import { act, createElement } from 'react'
import type { Root } from 'react-dom/client'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { PurchaseModal, PURCHASE_OPEN_EVENT } from '../src/renderer/src/PurchaseModal'
import type { PurchaseActivateResult, PurchaseSnapshot } from '../src/shared/purchase-api'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const qrDataUrl = 'data:image/png;base64,UORSTUB'
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => qrDataUrl) } }))

const DAY = 86400_000
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString()
const BUY_URL = 'https://aidooo.com/buy?app=office&mid=c22e86ce6642e192'
const SHARE_URL = 'https://aidooo.com/share?mid=c22e86ce6642e192'

function snapshot(over: Partial<PurchaseSnapshot> = {}): PurchaseSnapshot {
  return {
    fingerprint: 'c22e86ce6642e192',
    firstRunAt: iso(-30 * DAY),
    freeUntil: iso(60 * DAY),
    freeDaysLeft: 60,
    entitled: false,
    expireAt: null,
    activatedAt: null,
    serialMasked: null,
    keyConfigured: true,
    buyUrl: BUY_URL,
    shareUrl: SHARE_URL,
    ...over,
  }
}

let host: HTMLDivElement
let root: Root
let current: PurchaseSnapshot
let activateResult: PurchaseActivateResult
const stateMock = vi.fn(async () => current)
const activateMock = vi.fn(async (_serial: string): Promise<PurchaseActivateResult> => activateResult)
const openExternalMock = vi.fn(async () => {})

beforeEach(() => {
  current = snapshot()
  activateResult = { ok: false, reason: 'signature' }
  stateMock.mockClear()
  activateMock.mockClear()
  openExternalMock.mockClear()
  Object.defineProperty(window, 'chatOfficePurchase', {
    configurable: true,
    value: { state: stateMock, activate: activateMock, onEvent: () => () => {} },
  })
  Object.defineProperty(window, 'chatOffice', {
    configurable: true,
    value: { openExternal: openExternalMock },
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root.render(createElement(LocaleProvider, { initial: 'zh' }, createElement(PurchaseModal)))
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (window as { chatOfficePurchase?: unknown }).chatOfficePurchase
  delete (window as { chatOffice?: unknown }).chatOffice
})

const openDialog = async () => {
  await act(async () => {
    window.dispatchEvent(new Event(PURCHASE_OPEN_EVENT))
  })
}

const q = <T extends HTMLElement>(sel: string) => host.querySelector<T>(sel)!

const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

function typeInto(input: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('PurchaseModal', () => {
  it('is hidden until the open event, then paints tabs, the local QR of the buy URL, fingerprint and the serial form — no local prices', async () => {
    expect(host.querySelector('[data-purchase-dialog]')).toBeNull()
    await openDialog()
    const dialog = q('[data-purchase-dialog]')
    expect(q('[data-purchase-title]').textContent).toContain('购买授权')
    expect(q('[data-purchase-status]').textContent).toContain('还剩 60 天')

    // buy tab is active by default; the QR encodes the buy URL (with the
    // fingerprint), the caption names the payment channels, prices stay on
    // the buy page — the dialog itself renders no tier/price cards.
    expect(dialog.querySelector('[data-purchase-tab="buy"]')!.getAttribute('aria-selected')).toBe('true')
    expect((q('[data-purchase-qr]') as HTMLImageElement).src).toBe(qrDataUrl)
    expect(q('[data-purchase-qr-caption]').textContent).toContain('微信 / 支付宝')
    expect(dialog.querySelector('.purchase-tier')).toBeNull()
    expect(dialog.textContent).not.toContain('¥')

    // share tab swaps the QR target
    click(q('[data-purchase-tab="share"]'))
    expect(q('[data-purchase-tab="share"]')!.getAttribute('aria-selected')).toBe('true')
    expect(q('[data-purchase-qr-caption]').textContent).toContain('分享')

    expect(q('[data-purchase-fingerprint-code]').textContent).toBe('c22e86ce6642e192')
    const input = q<HTMLInputElement>('[data-purchase-serial-input]')
    expect(input.placeholder).toContain('XXXXX')
    expect((q('[data-purchase-activate]') as HTMLButtonElement).disabled).toBe(true)

    // Purchase guide (how to buy) unfolds on demand.
    expect(q('[data-purchase-guide-body]')).toBeNull()
    click(q('[data-purchase-guide-toggle]'))
    expect(q('[data-purchase-guide-body]').textContent).toContain('购买页')
  })

  it('open-in-browser hits the active URL; copy-link copies it to the clipboard', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await openDialog()
    click(q('[data-purchase-open-link]'))
    expect(openExternalMock).toHaveBeenCalledWith(BUY_URL)
    await act(async () => {
      click(q('[data-purchase-copy-link]'))
    })
    expect(writeText).toHaveBeenCalledWith(BUY_URL)
    expect(q('[data-purchase-copy-link]').textContent).toContain('已复制')

    click(q('[data-purchase-tab="share"]'))
    click(q('[data-purchase-open-link]'))
    expect(openExternalMock).toHaveBeenLastCalledWith(SHARE_URL)
  })

  it('activation success names what the serial bought (module bitmap + days) and flips status to entitled', async () => {
    activateResult = { ok: true, expireAt: iso(365 * DAY), days: 365, modules: 1 << 12 }
    // The real flow persists activation before the dialog refreshes its
    // snapshot, so the post-activate state() must already report entitled.
    current = snapshot({ entitled: true, expireAt: iso(365 * DAY), serialMasked: '21000•••••••••••••S64X~' })
    await openDialog()
    const input = q<HTMLInputElement>('[data-purchase-serial-input]')
    typeInto(input, ' 21000-BD10V-43SGS-A1AW2-S64X~ ')
    await act(async () => {
      click(q('[data-purchase-activate]'))
    })
    expect(activateMock).toHaveBeenCalledWith('21000-BD10V-43SGS-A1AW2-S64X~')
    const result = q('[data-purchase-result]')
    expect(result.textContent).toContain('激活成功')
    expect(result.textContent).toMatch(/\d{4}-\d{2}-\d{2}/)
    // auto-recognized tier: office bit → 察元AI Office · 续期 365 天
    expect(result.textContent).toContain('察元AI Office')
    expect(result.textContent).toContain('续期 365 天')
    expect(input.value).toBe('')
    expect(q('[data-purchase-status]').textContent).toContain('已激活')
  })

  it('an OS-bit serial is recognized as 察元AI OS coverage', async () => {
    activateResult = { ok: true, expireAt: iso(90 * DAY), days: 90, modules: 1 << 11 }
    await openDialog()
    const input = q<HTMLInputElement>('[data-purchase-serial-input]')
    typeInto(input, '21000-2T10V-4WQDJ-Q2ZKF-Z5SJ0')
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(q('[data-purchase-result]').textContent).toContain('察元AI OS')
    expect(q('[data-purchase-result]').textContent).toContain('续期 90 天')
  })

  it('Enter submits and failure reasons map to friendly copy buckets', async () => {
    await openDialog()
    const input = q<HTMLInputElement>('[data-purchase-serial-input]')
    typeInto(input, '21000-BD10V-43SGS-A1AW2-S64X~')
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(activateMock).toHaveBeenCalledTimes(1)
    // signature → "与本机不匹配"
    expect(q('[data-purchase-result]').textContent).toContain('与本机不匹配')

    activateResult = { ok: false, reason: 'module' }
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(q('[data-purchase-result]').textContent).toContain('不适用于察元AI Office')
  })

  it('copy fingerprint uses the clipboard and flips the button label', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await openDialog()
    await act(async () => {
      click(q('[data-purchase-fp-copy]'))
    })
    expect(writeText).toHaveBeenCalledWith('c22e86ce6642e192')
    expect(q('[data-purchase-fp-copy]').textContent).toContain('已复制')
  })

  it('Escape and overlay mousedown close; inner dialog clicks do not', async () => {
    await openDialog()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(host.querySelector('[data-purchase-dialog]')).toBeNull()

    await openDialog()
    click(q('[data-purchase-close]'))
    expect(host.querySelector('[data-purchase-dialog]')).toBeNull()

    await openDialog()
    act(() => {
      q('[data-purchase-dialog]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(host.querySelector('[data-purchase-dialog]')).toBeNull()

    await openDialog()
    act(() => {
      q('.purchase-dialog').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })
    expect(host.querySelector('[data-purchase-dialog]')).not.toBeNull()
  })

  it('without the Electron bridge (web/dsh form) it opens with the unavailable status and never activates', async () => {
    delete (window as { chatOfficePurchase?: unknown }).chatOfficePurchase
    await openDialog()
    expect(q('[data-purchase-status]').textContent).toContain('当前环境暂不支持激活')
    const input = q<HTMLInputElement>('[data-purchase-serial-input]')
    typeInto(input, '21000-BD10V-43SGS-A1AW2-S64X~')
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(q('[data-purchase-result]')).toBeNull()
    expect(activateMock).not.toHaveBeenCalled()
  })
})
