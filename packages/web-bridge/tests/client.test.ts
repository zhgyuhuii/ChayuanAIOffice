import { describe, expect, it, vi } from 'vitest'
import { BridgeClient, BRIDGE_PROTOCOL, type BridgeResponse } from '../src/index.js'

/** Minimal window double: records postMessage, lets tests reply. */
function fakeWindow() {
  const sent: unknown[] = []
  const handlers = new Set<(ev: { data: unknown }) => void>()
  const win = {
    addEventListener: (_: string, h: (ev: { data: unknown }) => void) => handlers.add(h),
    removeEventListener: (_: string, h: (ev: { data: unknown }) => void) => handlers.delete(h),
    parent: {} as object,
  }
  const post = (msg: unknown) => {
    for (const h of [...handlers]) h({ data: msg })
  }
  const parentPost = (m: unknown) => sent.push(m)
  ;(win.parent as unknown as { postMessage(m: unknown, o: string): void }).postMessage = (m) => parentPost(m)
  return { win, sent, post }
}

describe('BridgeClient', () => {
  it('round-trips a call through postMessage', async () => {
    const fw = fakeWindow()
    const client = new BridgeClient('*', fw.win as unknown as Window)
    const p = client.call('rpc', 'chatHistory.listProjects') as Promise<unknown[]>
    // host answers with the request's id
    const req = fw.sent[0] as { id: number }
    const res: BridgeResponse = { proto: BRIDGE_PROTOCOL, id: req.id, ok: true, result: [{ id: 'default' }] }
    setTimeout(() => fw.post(res), 0)
    const result = (await p) as Array<{ id: string }>
    expect(result[0].id).toBe('default')
  })

  it('rejects with structured error info for degraded channels', async () => {
    const fw = fakeWindow()
    const client = new BridgeClient('*', fw.win as unknown as Window)
    const p = client.call('local', 'chatOffice.revealPath', '/x')
    const req = fw.sent[0] as { id: number }
    setTimeout(
      () =>
        fw.post({
          proto: BRIDGE_PROTOCOL,
          id: req.id,
          ok: false,
          error: { code: 'unsupported', message: '浏览器环境不支持该系统能力' },
        }),
      0,
    )
    await expect(p).rejects.toMatchObject({ message: expect.stringContaining('浏览器') })
  })

  it('delivers subscribed events', () => {
    const fw = fakeWindow()
    const client = new BridgeClient('*', fw.win as unknown as Window)
    const seen: string[] = []
    client.subscribe('tabs:changed', (p) => seen.push(String((p as { name: string }).name)))
    const sub = fw.sent[0] as { subscribe: string[] }
    expect(sub.subscribe).toEqual(['tabs:changed'])
    fw.post({ proto: BRIDGE_PROTOCOL, event: 'tabs:changed', payload: { name: 'Docs' } })
    expect(seen).toEqual(['Docs'])
  })

  it('times out when nothing answers', async () => {
    const fw = fakeWindow()
    const client = new BridgeClient('*', fw.win as unknown as Window)
    vi.useFakeTimers()
    const p = client.call('rpc', 'never.answers')
    const guard = expect(p).rejects.toThrow('bridge timeout')
    await vi.advanceTimersByTimeAsync(21_000)
    await guard
    vi.useRealTimers()
  })
})
