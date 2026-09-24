import { aiFetch } from './fetch'
import { httpBodyDetail } from './http-error'
import type { ResolvedModelCall } from './settings-v2'

/**
 * BYOK video generation over the OpenAI video (Sora-style) REST shape, which
 * OpenAI-compatible gateways (agnes / new-api hosts) relay: POST {base}/videos
 * creates a job, GET {base}/videos/{id} polls it, GET {base}/videos/{id}/content
 * downloads the finished mp4. Gateways add a per-engine `mode` selector with no
 * discovery endpoint — the create call walks candidate modes until one passes
 * param validation ("mode 无效" → next candidate; anything else surfaces).
 * There is no cross-vendor standard beyond this shape; task-based vendors
 * (dashscope/zhipu/…) belong in media-jobs adapters instead.
 */

export interface VideoGenRequest {
  prompt: string
  /** clip length in seconds as the API expects it (e.g. '4'); gateway default when omitted */
  seconds?: string
  /** aspect hint forwarded when the host supports it (e.g. '1280x720') */
  size?: string
  /** force a specific engine mode (skips the candidate walk) */
  mode?: string
  signal?: AbortSignal
  /** liveness hook — the chat loop pings so the renderer's watchdog stays fed */
  onPing?: () => void
}

export interface VideoGenResult {
  /** inlined mp4 (data:video/mp4;base64,…) — the chat-safe form (CSP media-src data:) */
  dataUrl?: string
  /** raw link when the download failed or the job returned one directly */
  url?: string
}

const POLL_INTERVAL_MS = 3_000
const POLL_BUDGET_MS = 10 * 60_000

/** engine modes accepted by relaying gateways, best first */
const MODE_CANDIDATES = ['quality', 'pro', 't2v']

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v) return v
  }
  return undefined
}

async function postJson(
  url: string,
  body: unknown,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{
  ok: boolean
  status: number
  json: Record<string, unknown>
  bodyText: string
}> {
  const resp = await aiFetch(url, {
    method: 'POST',
    ...(signal ? { signal } : {}),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  const text = await resp.text()
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    /* non-JSON body — kept as text for the error path */
  }
  return { ok: resp.ok, status: resp.status, json, bodyText: text }
}

async function createJob(
  call: ResolvedModelCall,
  req: VideoGenRequest,
  mode: string,
): Promise<{ id?: string; fatal?: Error }> {
  const base = call.baseUrl.replace(/\/$/, '')
  const body: Record<string, unknown> = { model: call.model, prompt: req.prompt, mode }
  if (req.seconds) body.seconds = req.seconds
  if (req.size) body.size = req.size
  const r = await postJson(`${base}/videos`, body, call.apiKey, req.signal)
  if (!r.ok) {
    const nested = r.json.error as Record<string, unknown> | string | undefined
    const nestedMessage = typeof nested === 'object' && nested !== null ? nested.message : nested
    const message = String(nestedMessage ?? r.json.message ?? httpBodyDetail(r.bodyText))
    // wrong engine mode for this model: param-validation failure, try the next
    if (/mode/i.test(message) && r.status === 400) return {}
    return { fatal: new Error(`HTTP ${r.status}: ${message}`) }
  }
  const id = pickString(r.json, ['id', 'video_id', 'taskId', 'task_id'])
  if (!id) return { fatal: new Error('the video API returned no job id') }
  return { id }
}

async function pollJob(
  call: ResolvedModelCall,
  id: string,
  signal?: AbortSignal,
): Promise<{ status: string; url?: string; error?: string }> {
  const base = call.baseUrl.replace(/\/$/, '')
  const resp = await aiFetch(`${base}/videos/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${call.apiKey}` },
    ...(signal ? { signal } : {}),
  })
  const text = await resp.text()
  if (!resp.ok) return { status: 'error', error: `HTTP ${resp.status}: ${httpBodyDetail(text)}` }
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    return { status: 'error', error: 'the video API returned a non-JSON status' }
  }
  const status = (pickString(json, ['status', 'task_status', 'state']) ?? 'unknown').toLowerCase()
  const url = pickString(json, ['url', 'video_url', 'download_url'])
  const rawError: unknown = json.error
  const err =
    typeof rawError === 'object' && rawError !== null
      ? String((rawError as Record<string, unknown>).message ?? '')
      : typeof rawError === 'string'
        ? rawError
        : undefined
  return {
    status,
    ...(url !== undefined ? { url } : {}),
    ...(err !== undefined && err !== '' ? { error: err } : {}),
  }
}

async function fetchContentAsDataUrl(
  call: ResolvedModelCall,
  id: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const base = call.baseUrl.replace(/\/$/, '')
    const resp = await aiFetch(`${base}/videos/${encodeURIComponent(id)}/content`, {
      headers: { Authorization: `Bearer ${call.apiKey}` },
      ...(signal ? { signal } : {}),
    })
    if (!resp.ok) return null
    const buf = Buffer.from(await resp.arrayBuffer())
    if (!buf.byteLength) return null
    const mime = (resp.headers.get('content-type') || '').split(';')[0]!.trim() || 'video/mp4'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

export async function generateVideoWithModel(
  call: ResolvedModelCall,
  req: VideoGenRequest,
): Promise<VideoGenResult> {
  if (!req.prompt.trim()) throw new Error('prompt must not be empty')

  // create: walk mode candidates (or the forced one) past param validation
  const modes = req.mode ? [req.mode] : MODE_CANDIDATES
  let id: string | undefined
  let lastFatal: Error | undefined
  for (const mode of modes) {
    const r = await createJob(call, req, mode)
    if (r.fatal) {
      lastFatal = r.fatal
      // a rejected mode is worth the next candidate; anything else stops here
      if (!/mode/i.test(r.fatal.message)) throw r.fatal
      continue
    }
    if (r.id) {
      id = r.id
      break
    }
  }
  if (!id) throw lastFatal ?? new Error('the video API rejected every engine mode')

  // poll to a terminal state, pinging so the chat watchdog stays fed
  const deadline = Date.now() + POLL_BUDGET_MS
  let lastUrl: string | undefined
  let completed = false
  while (Date.now() < deadline) {
    if (req.signal?.aborted) throw new Error('aborted')
    req.onPing?.()
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const r = await pollJob(call, id, req.signal)
    if (r.status === 'error') throw new Error(r.error ?? 'video job status fetch failed')
    if (r.url) lastUrl = r.url
    if (['completed', 'succeeded', 'success', 'finished'].includes(r.status)) {
      lastUrl = r.url ?? lastUrl
      completed = true
      break
    }
    if (['failed', 'canceled', 'cancelled', 'error'].includes(r.status)) {
      throw new Error(r.error ?? `video job ${r.status}`)
    }
  }
  if (!completed && !lastUrl) throw new Error('video job timed out')

  // prefer inline bytes (plays everywhere via CSP media-src data:); fall back
  // to the job's own URL, then the content endpoint
  if (lastUrl) {
    const inline = await downloadInline(lastUrl, req.signal)
    if (inline) return { dataUrl: inline }
    return { url: lastUrl }
  }
  const content = await fetchContentAsDataUrl(call, id!, req.signal)
  if (content) return { dataUrl: content }
  return { url: `${call.baseUrl.replace(/\/$/, '')}/videos/${id}/content` }
}

async function downloadInline(url: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const resp = await aiFetch(url, { ...(signal ? { signal } : {}) })
    if (!resp.ok) return null
    const buf = Buffer.from(await resp.arrayBuffer())
    if (!buf.byteLength || buf.byteLength > 40 * 1024 * 1024) return null
    const mime = (resp.headers.get('content-type') || '').split(';')[0]!.trim() || 'video/mp4'
    if (!mime.startsWith('video/') && !mime.startsWith('application/octet-stream')) return null
    return `data:${mime === 'application/octet-stream' ? 'video/mp4' : mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}
