/**
 * Feedback channel to aidooo.com (shared endpoint with chayuan-wps and the
 * 察元 super-agent desktop). Main-process side of the bridge: the renderer CSP
 * (connect-src 'self') blocks cross-origin fetch, so the shell proxies the
 * feedback REST calls here.
 *
 * Endpoint contract mirrors website/server/feedback-routes.js:
 *   POST /api/feedback          JSON body, HMAC auth headers (x-cy-ts/x-cy-sig)
 *   POST /api/feedback/upload   raw binary body, x-filename header
 *   GET  /api/feedback/captcha  cheap liveness probe
 */

import { createHash, createHmac } from 'node:crypto'

export const FEEDBACK_APP = 'office'
export const FEEDBACK_APP_NAME = '察元AIOffice'

const DEFAULT_SIGN_SECRET = 'cy-fb-sign-2026-7Qx9Kp2Vw8Lm4Zr'
const FETCH_TIMEOUT_MS = 15_000
const PROBE_TIMEOUT_MS = 5_000
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

// aidooo.com 经 XOR 0x5a + base64 混淆（与各客户端反馈实现同源）
const _H = 'OzM+NTU1dDk1Nw=='
// HMAC 密钥：base64 编码存储，运行时解码（源码混淆，非加密）
const _SK = 'Y3ktZmItc2lnbi0yMDI2LTdReDlLcDJWdzhMbTRacg=='

function deobfuscateDomain(): string {
  const raw = Buffer.from(_H, 'base64')
  let h = ''
  for (let i = 0; i < raw.length; i++) h += String.fromCharCode(raw[i] ^ 0x5a)
  return h
}

function secretString(): string {
  return Buffer.from(_SK, 'base64').toString('utf8')
}

/** Server-side signing algorithm (feedback-routes.js signFeedback), node port. */
export function signFeedback(
  secret: string,
  { mid, app, ts, content }: { mid: string; app: string; ts: number; content: string },
): string {
  const canonical = `${mid}\n${app}\n${ts}\n${createHash('sha256').update(String(content ?? '')).digest('hex')}`
  return createHmac('sha256', secret).update(canonical).digest('hex')
}

export interface FeedbackAttachmentMeta {
  name: string
  url: string
  kind: 'image' | 'file'
  size: number
}

/** What the renderer sends: device id + diagnostics + the form itself. */
export interface FeedbackSubmitPayload {
  mid: string
  type: string
  content: string
  attachments: FeedbackAttachmentMeta[]
  logJson: string
  appVersion?: string
  os?: string
  osVer?: string
  arch?: string
}

export interface FeedbackSubmitResult {
  ok: boolean
  id?: string
  status?: string
  /** true when the failure looks like "no network" (renderer offers a draft) */
  offline?: boolean
  error?: string
}

export interface FeedbackUploadResult {
  ok: boolean
  name?: string
  url?: string
  kind?: 'image' | 'file'
  size?: number
  error?: string
}

function baseUrl(): string {
  try {
    return `https://${deobfuscateDomain()}`
  } catch {
    return 'https://aidooo.com'
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

function withTimeout(ms: number): { signal?: AbortSignal; clear(): void } {
  const ac = new AbortController()
  const tid = setTimeout(() => ac.abort(), ms)
  return { signal: ac.signal, clear: () => clearTimeout(tid) }
}

export function createFeedbackClient(options: { fetchImpl?: FetchLike; secret?: string } = {}) {
  const doFetch = options.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, init))
  const secret = options.secret ?? secretString()

  /** cheap connectivity probe against the feedback API (captcha endpoint). */
  async function probe(): Promise<boolean> {
    const { signal, clear } = withTimeout(PROBE_TIMEOUT_MS)
    try {
      const res = await doFetch(`${baseUrl()}/api/feedback/captcha`, { signal })
      return res.ok
    } catch {
      return false
    } finally {
      clear()
    }
  }

  async function upload(name: string, mime: string, data: Uint8Array): Promise<FeedbackUploadResult> {
    if (!(data instanceof Uint8Array) || data.byteLength === 0) {
      return { ok: false, error: 'empty' }
    }
    if (data.byteLength > MAX_UPLOAD_BYTES) {
      return { ok: false, error: 'too_large' }
    }
    const safeName = name.replace(/[\\/]/g, '_').slice(0, 80) || 'attachment.bin'
    const { signal, clear } = withTimeout(FETCH_TIMEOUT_MS)
    try {
      const res = await doFetch(`${baseUrl()}/api/feedback/upload`, {
        method: 'POST',
        headers: { 'content-type': mime || 'application/octet-stream', 'x-filename': safeName },
        body: new Uint8Array(data),
        signal,
      })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const json = (await res.json()) as { id: string; url: string; kind: 'image' | 'file'; size: number }
      return { ok: true, name: safeName, url: json.url, kind: json.kind, size: json.size }
    } catch {
      return { ok: false, error: 'network' }
    } finally {
      clear()
    }
  }

  async function submit(payload: FeedbackSubmitPayload): Promise<FeedbackSubmitResult> {
    const ts = Date.now()
    const sig = signFeedback(secret, { mid: payload.mid, app: FEEDBACK_APP, ts, content: payload.content })
    const body = {
      mid: payload.mid,
      app: FEEDBACK_APP,
      appName: FEEDBACK_APP_NAME,
      appVersion: payload.appVersion ?? '',
      os: payload.os ?? '',
      osVer: payload.osVer ?? '',
      arch: payload.arch ?? '',
      type: payload.type,
      content: payload.content,
      attachments: Array.isArray(payload.attachments) ? payload.attachments.slice(0, 9) : [],
      logJson: payload.logJson ?? '',
    }
    const { signal, clear } = withTimeout(FETCH_TIMEOUT_MS)
    try {
      const res = await doFetch(`${baseUrl()}/api/feedback`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cy-ts': String(ts),
          'x-cy-sig': sig,
        },
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` }
      }
      const json = (await res.json()) as { ok: boolean; id: string; status: string }
      return { ok: true, id: json.id, status: json.status }
    } catch {
      return { ok: false, offline: true, error: 'network' }
    } finally {
      clear()
    }
  }

  return { probe, upload, submit }
}
