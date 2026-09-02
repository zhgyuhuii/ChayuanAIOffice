/**
 * Bridge protocol (plan v2.2, decisions #2/#4): the SAME channel surface the
 * Electron preload bridges expose, carried over postMessage between an editor
 * / home iframe and the web host. The host routes each call:
 *
 *   kind 'rpc'    → sidecar / BFF  POST /rpc/:service/:method
 *   kind 'file'   → host-side File System Access handle operations
 *   kind 'local'  → host-local state (tabs, recents, theme, language)
 *
 * Renderers never see this module — the preload-shaped shims do.
 */

export const BRIDGE_PROTOCOL = 'chatoffice-bridge/1'

/** iframe → host */
export interface BridgeRequest {
  proto: typeof BRIDGE_PROTOCOL
  id: number
  kind: 'rpc' | 'file' | 'local'
  /** rpc: "service.method"; file/local: plain channel name */
  channel: string
  args: unknown[]
}

/** host → iframe, answers a request */
export interface BridgeResponse {
  proto: typeof BRIDGE_PROTOCOL
  id: number
  ok: boolean
  result?: unknown
  /** structured failure: degraded calls carry the degrade reason here */
  error?: BridgeError
}

/** host → iframe, unsolicited push (stream chunks, tab changes, …) */
export interface BridgeEvent {
  proto: typeof BRIDGE_PROTOCOL
  event: string
  payload: unknown
}

/** iframe → host, subscribe to push channels */
export interface BridgeSubscribe {
  proto: typeof BRIDGE_PROTOCOL
  subscribe?: string[]
  unsubscribe?: string[]
}

export type BridgeInbound = BridgeRequest | BridgeSubscribe
export type BridgeOutbound = BridgeResponse | BridgeEvent

export interface BridgeError {
  code: 'degraded' | 'unsupported' | 'denied' | 'not-found' | 'internal'
  message: string
  /** which future batch enables a degraded channel, for UI tooltips */
  batch?: string
}

export function isBridgeRequest(msg: unknown): msg is BridgeRequest {
  const m = msg as BridgeRequest
  return (
    !!m && m.proto === BRIDGE_PROTOCOL && typeof m.id === 'number' &&
    (m.kind === 'rpc' || m.kind === 'file' || m.kind === 'local') &&
    typeof m.channel === 'string' && Array.isArray(m.args)
  )
}

export function isBridgeSubscribe(msg: unknown): msg is BridgeSubscribe {
  const m = msg as BridgeSubscribe
  return !!m && m.proto === BRIDGE_PROTOCOL && (Array.isArray(m.subscribe) || Array.isArray(m.unsubscribe))
}
