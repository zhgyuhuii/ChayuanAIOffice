/**
 * Bridge client (runs inside the editor / home iframe): turns postMessage
 * into a promise-based `call(kind, channel, ...args)` plus event
 * subscriptions. The preload-shaped shims sit on top of this.
 */

import {
  BRIDGE_PROTOCOL,
  type BridgeEvent,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeSubscribe,
} from './protocol.js'

type Listener = (payload: unknown) => void

export class BridgeClient {
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private readonly listeners = new Map<string, Set<Listener>>()
  private ready = false

  constructor(
    private readonly targetOrigin = '*',
    private readonly win: Pick<Window, 'parent' | 'addEventListener' | 'removeEventListener'> = (
      typeof window !== 'undefined' ? window : undefined as unknown as Window
    ),
  ) {}

  /** Idempotent; the shim calls it when no real preload was detected. */
  start(): void {
    if (this.ready || typeof this.win?.addEventListener !== 'function') return
    this.ready = true
    this.win.addEventListener('message', (ev: MessageEvent) => {
      const data = ev.data as BridgeResponse | BridgeEvent
      if (!data || (data as BridgeResponse).proto !== BRIDGE_PROTOCOL) return
      if ('id' in data && (data as BridgeResponse).id !== undefined) {
        const res = data as BridgeResponse
        const entry = this.pending.get(res.id)
        if (!entry) return
        this.pending.delete(res.id)
        if (res.ok) entry.resolve(res.result)
        else {
          const err = res.error as (Partial<import('./protocol.js').BridgeError> & { message?: string }) | undefined
          const e = new Error(err?.message ?? 'bridge error') as Error & { code?: string; batch?: string }
          e.code = err?.code
          e.batch = err?.batch
          entry.reject(e)
        }
      } else if ('event' in data) {
        const evt = data as BridgeEvent
        for (const l of this.listeners.get(evt.event) ?? []) l(evt.payload)
      }
    })
  }

  call(kind: BridgeRequest['kind'], channel: string, ...args: unknown[]): Promise<unknown> {
    this.start()
    const id = this.nextId++
    const msg: BridgeRequest = { proto: BRIDGE_PROTOCOL, id, kind, channel, args }
    // host accepts messages from any iframe origin (editors are same-site)
    ;(this.win.parent as unknown as { postMessage(m: unknown, o: string): void }).postMessage(msg, this.targetOrigin)
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      // Safety net: nothing answered within 20s
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`bridge timeout: ${channel}`))
      }, 20_000)
    })
  }

  subscribe(event: string, listener: Listener): () => void {
    this.start()
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener)
    const msg: BridgeSubscribe = { proto: BRIDGE_PROTOCOL, subscribe: [event] }
    ;(this.win.parent as unknown as { postMessage(m: unknown, o: string): void }).postMessage(msg, this.targetOrigin)
    return () => {
      set?.delete(listener)
      const off: BridgeSubscribe = { proto: BRIDGE_PROTOCOL, unsubscribe: [event] }
      ;(this.win.parent as unknown as { postMessage(m: unknown, o: string): void }).postMessage(off, this.targetOrigin)
    }
  }
}

/** Shared singleton for an iframe. */
export const bridgeClient = new BridgeClient()
