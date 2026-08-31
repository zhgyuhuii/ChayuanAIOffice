/**
 * Shim factory: build a preload-shaped bridge object where implemented
 * methods run over the web bridge and EVERYTHING ELSE auto-degrades
 * (on*-subscribers become no-op unsubscribes, calls reject with batch info).
 * This lets each editor's full API surface exist from day one.
 */

import { BridgeClient } from './client.js'

type AnyFn = (...args: never[]) => unknown

export interface ShimSpec {
  /** implemented methods */
  impl: Record<string, AnyFn>
  /** degrade prefix for unimplemented calls, e.g. 'docs' → 'docs.<method>' */
  prefix: string
  /** method-name predicates */
  isSubscriber?: (name: string) => boolean
}

export function makeShim(client: BridgeClient, spec: ShimSpec): Record<string, AnyFn> {
  return new Proxy(spec.impl, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      if (typeof prop !== 'string' || prop === 'then') return undefined
      // event subscribers: return a no-op that yields an unsubscribe
      if (spec.isSubscriber?.(prop) || /^on[A-Z]/.test(prop)) {
        return () => () => undefined
      }
      // State getters (get*/list*/has*/count*) degrade to SAFE EMPTY values —
      // rejecting them stalls editor initialization awaits (docs booted to a
      // 0x0 edit surface this way). Action methods keep the structured reject.
      if (/^(get|list|has|count|is|notify|report|set)[A-Z]/.test(prop)) {
        // Arrays are the common expectation (sections/files/lists) — reading
        // .length off null crashed the slides renderer; return [] where the
        // name implies a collection, undefined otherwise.
        const collection = /^(list|get[A-Za-z]*(Files|Sections|Entries|Slides|Comments|Notes|Recent|Providers|Fonts|Keys|Sources))/.test(prop)
        return async () => (collection ? [] : undefined)
      }
      return async () => {
        const err = new Error(`该能力尚未在网页版开放（${spec.prefix}.${prop}）`) as Error & {
          code: string
        }
        err.code = 'degraded'
        throw err
      }
    },
  })
}

/** SHA-256 hex of bytes (docs uses it to archive the original file). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** #gofile=<id>&name=<n> injected by the host when opening a file. */
export function pendingFromHash(): { fileId: string; name: string } | null {
  const m = /[?#&]gofile=([^&]+)(?:&name=([^&]*))?/.exec(location.hash + location.search)
  if (!m) return null
  return { fileId: decodeURIComponent(m[1]), name: decodeURIComponent(m[2] ?? '文件') }
}
