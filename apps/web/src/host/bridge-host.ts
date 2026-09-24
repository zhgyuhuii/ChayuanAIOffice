/**
 * Bridge server for the editor iframes (plan v2.2 decision #4): answers
 * postMessage requests by routing — rpc → same-origin /rpc on the sidecar,
 * file → the FS Access handle store, local → host state. Editors are
 * same-origin children; only they may talk to us.
 */

import {
  BRIDGE_PROTOCOL,
  degradeInfo,
  isBridgeRequest,
  isBridgeSubscribe,
  type BridgeResponse,
} from '@chatoffice/web-bridge'
import { fileStore } from './file-open.js'
import { tabManager } from './tab-manager.js'

function bffBase(): string {
  // Dev: the vite host on 5180 proxies /rpc (and /ai) to the BFF on 8787, so
  // the page stays single-origin (no CORS). In production the sidecar serves
  // both under one origin; behind the dsh-plugin proxy the app lives under
  // /chatoffice-app/ and a path-relative rpc URL keeps the proxy in front of
  // the sidecar.
  const dir = location.pathname.replace(/\/$/, '')
  return dir.endsWith('/chatoffice-app') ? dir : ''
}

async function handleRpc(channel: string, args: unknown[]): Promise<unknown> {
  const [service, method] = channel.split('.')
  if (!service || !method) throw new Error(`bad rpc channel: ${channel}`)
  const res = await fetch(`${bffBase()}/rpc/${service}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args }),
  })
  const doc = (await res.json()) as { ok: boolean; result?: unknown; error?: string }
  if (!doc.ok) throw new Error(doc.error ?? `rpc ${channel} failed`)
  return doc.result
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function handleFile(channel: string, args: unknown[]): Promise<unknown> {
  switch (channel) {
    case 'fs.read':
      return fileStore.read(String(args[0]))
    case 'fs.write':
      return fileStore.write(String(args[0]), b64ToBytes(String(args[1])))
    case 'fs.saveAs':
      return fileStore.saveAsPicker(String(args[1] ?? 'untitled'), b64ToBytes(String(args[0])))
    case 'fs.name':
      return fileStore.name(String(args[0]))
    default:
      throw new Error(`unknown file channel: ${channel}`)
  }
}

async function handleLocal(channel: string, args: unknown[]): Promise<unknown> {
  switch (channel) {
    case 'tab.setTitle':
      tabManager.setTitleByFile(String(args[0]), String(args[1]))
      return undefined
    case 'recent.record': {
      const { recordRecent } = await import('./recents.js')
      recordRecent(
        String(args[0]),
        String(args[1]),
        args[2] as 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown',
      )
      return undefined
    }
    default:
      throw new Error(`unknown local channel: ${channel}`)
  }
}

export function startBridgeHost(): void {
  const subscribers = new Map<HTMLIFrameElement, Set<string>>()

  window.addEventListener('message', (ev: MessageEvent) => {
    const frame = (() => {
      for (const f of document.querySelectorAll('iframe')) {
        if (f.contentWindow === ev.source) return f as HTMLIFrameElement
      }
      return null
    })()
    if (!frame) return // not from our editors

    if (isBridgeSubscribe(ev.data)) {
      const sub = ev.data.subscribe ?? []
      const set = subscribers.get(frame) ?? new Set<string>()
      for (const s of sub) set.add(s)
      subscribers.set(frame, set)
      return
    }
    if (!isBridgeRequest(ev.data)) return
    const req = ev.data
    const reply = (res: BridgeResponse) => frame.contentWindow?.postMessage(res, '*')

    void (async () => {
      const channelKey = `${req.kind === 'rpc' ? '' : ''}${req.channel}`
      const info = degradeInfo(req.channel) ?? degradeInfo(channelKey)
      if (info) {
        reply({
          proto: BRIDGE_PROTOCOL,
          id: req.id,
          ok: false,
          error: {
            code: 'degraded',
            message: info.reason,
            ...(info.batch ? { batch: info.batch } : {}),
          },
        })
        return
      }
      try {
        const result =
          req.kind === 'rpc'
            ? await handleRpc(req.channel, req.args)
            : req.kind === 'file'
              ? await handleFile(req.channel, req.args)
              : await handleLocal(req.channel, req.args)
        reply({ proto: BRIDGE_PROTOCOL, id: req.id, ok: true, result })
      } catch (err) {
        reply({
          proto: BRIDGE_PROTOCOL,
          id: req.id,
          ok: false,
          error: { code: 'internal', message: err instanceof Error ? err.message : String(err) },
        })
      }
    })()
  })
}
