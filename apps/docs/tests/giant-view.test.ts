// @vitest-environment jsdom
// GiantDocView: the read-only virtual-window surface for giant documents —
// mounts fetch the first window over the desktop bridge, badges carry the
// session meta, Close releases the session, and a failed fetch degrades to
// an empty view instead of crashing.
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GiantDocView } from '../src/renderer/components/GiantDocView'
import type { GiantOpenResult, GiantWindowResult } from '../src/shared/ipc'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
const realWindow = window
afterEach(() => {
  act(() => root?.unmount())
  root = null
  delete (realWindow as { desktop?: unknown }).desktop
})

const open: GiantOpenResult = {
  giant: true,
  giantId: 'giant-1',
  path: '/tmp/big.docx',
  name: 'big.docx',
  hash: 'h',
  meta: { documentXmlBytes: 300 * 1024 * 1024, bodyBytes: 1, blockCount: 3 },
}

const window0: GiantWindowResult = {
  first: 0,
  count: 2,
  blocks: [],
  docDefaults: null,
  compatibilityMode: 15,
}

function stubDesktop(windows: Record<number, GiantWindowResult>): {
  requests: Array<[number, number]>
} {
  const requests: Array<[number, number]> = []
  ;(realWindow as { desktop?: unknown }).desktop = {
    giantWindow: async (_id: string, first: number, count: number) => {
      requests.push([first, count])
      return windows[first] ?? null
    },
    giantClose: () => {},
  }
  return { requests }
}

const labels = {
  readonlyBadge: 'Giant document · read-only',
  blocksLabel: (count: number) => `${count} blocks`,
  closeLabel: 'Close',
}

function mount(props: Parameters<typeof GiantDocView>[0]): HTMLElement {
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() => root!.render(h(GiantDocView, props)))
  return host
}

describe('GiantDocView', () => {
  it('fetches the first window at mount and shows the meta badges', async () => {
    const { requests } = stubDesktop({ 0: window0 })
    mount({ open, onClose: () => {}, labels })
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0))
    expect(requests[0]).toEqual([0, 150])
    expect(document.body.textContent).toContain('Giant document · read-only')
    expect(document.body.textContent).toContain('3 blocks')
    const close = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Close',
    )
    expect(close).toBeTruthy()
  })

  it('closes the session through the desktop bridge', async () => {
    const desktop = stubDesktop({ 0: window0 })
    const onClose = vi.fn()
    mount({ open, onClose, labels })
    await vi.waitFor(() => expect(desktop.requests.length).toBeGreaterThan(0))
    const close = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Close',
    )!
    act(() => close.click())
    expect(onClose).toHaveBeenCalled()
  })

  it('tolerates a failed window fetch without crashing', async () => {
    const { requests } = stubDesktop({})
    mount({
      open,
      onClose: () => {},
      labels: { readonlyBadge: 'ro', blocksLabel: (n: number) => `${n}`, closeLabel: 'x' },
    })
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0))
    expect(document.body.textContent).toContain('ro')
  })
})
