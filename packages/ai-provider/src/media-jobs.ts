import { aiFetch } from './fetch'
import { httpBodyDetail } from './http-error'

/**
 * MediaJobClient — the universal async-task abstraction behind every media
 * generation channel (text-to-video today, TTS/video variants later). Every
 * vendor surveyed (dashscope, zhipu, minimax, volcengine ark, kling, sora,
 * runway, luma, fal) exposes the same three-phase shape:
 *
 *   submit → job id · poll(job id) → queued/running/succeeded+url | failed
 *
 * so the loop lives here once; a vendor adapter only supplies four things:
 * auth header, submit body, poll mapping, and the result field. Adapters
 * register by vendorId; the capability matrix's VIDEO_GEN_VENDOR_IDS must
 * stay in sync with this registry.
 */

export interface MediaJobRequest {
  kind: 'video'
  /** vendor id, keys the adapter registry (must be in VIDEO_GEN_VENDOR_IDS) */
  vendorId: string
  /** vendor-native model id, e.g. wanx2.1-t2v-turbo / cogvideox-3 / video-01 */
  model: string
  apiKey: string
  prompt: string
  /** first-frame image for image-to-video (public URL; base64 only where the vendor takes it) */
  imageUrl?: string
  /** e.g. '16:9' — adapters map to their native field */
  aspectRatio?: string
  durationSeconds?: number
  signal?: AbortSignal
  /** UI progress hook (submitted → running[...]) */
  onProgress?(stage: 'submitted' | 'running', note?: string): void
}

export interface MediaJobResult {
  /** produced media URL (temporary or permanent per vendor) */
  url: string
  mime: string
  meta?: Record<string, unknown>
}

export type MediaJobPollResult =
  | { state: 'queued' }
  | { state: 'running'; note?: string }
  | { state: 'succeeded'; result: MediaJobResult }
  | { state: 'failed'; error: string }

export interface MediaJobAdapter {
  vendorId: string
  submit(req: MediaJobRequest): Promise<string>
  poll(jobId: string, req: MediaJobRequest): Promise<MediaJobPollResult>
  /** per-poll interval (default 5s) */
  pollIntervalMs?: number
  /** whole-job deadline (default 10min) */
  timeoutMs?: number
}

const DEFAULT_INTERVAL_MS = 5_000
const DEFAULT_TIMEOUT_MS = 10 * 60_000

const adapters = new Map<string, MediaJobAdapter>()

export function registerMediaJobAdapter(adapter: MediaJobAdapter): void {
  adapters.set(adapter.vendorId, adapter)
}

export function getMediaJobAdapter(vendorId: string): MediaJobAdapter | undefined {
  return adapters.get(vendorId)
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new Error('cancelled'))
      },
      { once: true },
    )
  })

/** Drive one media generation through submit → poll → result. */
export async function runMediaJob(req: MediaJobRequest): Promise<MediaJobResult> {
  const adapter = adapters.get(req.vendorId)
  if (!adapter) throw new Error(`No media-generation adapter is wired for vendor "${req.vendorId}"`)
  const jobId = await adapter.submit(req)
  req.onProgress?.('submitted')
  const deadline = Date.now() + (adapter.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const interval = adapter.pollIntervalMs ?? DEFAULT_INTERVAL_MS
  for (;;) {
    const poll = await adapter.poll(jobId, req)
    if (poll.state === 'succeeded') return poll.result
    if (poll.state === 'failed') throw new Error(poll.error)
    if (poll.state === 'running') req.onProgress?.('running', poll.note)
    if (Date.now() + interval > deadline) {
      throw new Error(
        `Media generation timed out after ${Math.round((adapter.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 60_000)} min (job ${jobId})`,
      )
    }
    await sleep(interval, req.signal)
  }
}

// ── shared helpers ──

async function readJson(res: Response): Promise<Record<string, unknown>> {
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${httpBodyDetail(await res.text())}`)
  return (await res.json()) as Record<string, unknown>
}

function dig(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

/** First non-empty string among candidate paths — vendors drift field names. */
function firstString(obj: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const v = dig(obj, path)
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}

// ── Aliyun DashScope (vendorId: aliyun-bailian) ──
// POST /api/v1/services/aigc/video-generation/video-synthesis (X-DashScope-Async: enable)
// → {output:{task_id}} · GET /api/v1/tasks/{id} → output.task_status / output.video_url

registerMediaJobAdapter({
  vendorId: 'aliyun-bailian',
  async submit(req) {
    const res = await aiFetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis', {
      method: 'POST',
      ...(req.signal ? { signal: req.signal } : {}),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req.apiKey}`, 'X-DashScope-Async': 'enable' },
      body: JSON.stringify({
        model: req.model,
        input: { prompt: req.prompt, ...(req.imageUrl ? { img_url: req.imageUrl } : {}) },
        parameters: { size: req.aspectRatio === '9:16' ? '720*1280' : '1280*720', ...(req.durationSeconds ? { duration: req.durationSeconds } : {}) },
      }),
    })
    const body = await readJson(res)
    const id = firstString(body, ['output.task_id'])
    if (!id) throw new Error(`dashscope: no task id in ${JSON.stringify(body).slice(0, 200)}`)
    return id
  },
  async poll(jobId, req) {
    const res = await aiFetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${jobId}`, {
      headers: { Authorization: `Bearer ${req.apiKey}` },
      ...(req.signal ? { signal: req.signal } : {}),
    })
    const body = await readJson(res)
    const status = String(dig(body, 'output.task_status') ?? '')
    if (status === 'SUCCEEDED') {
      const url = firstString(body, ['output.video_url', 'output.result_url'])
      if (!url) return { state: 'failed', error: 'dashscope: succeeded without a video_url' }
      return { state: 'succeeded', result: { url, mime: 'video/mp4', meta: { jobId } } }
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      return { state: 'failed', error: `dashscope task ${status}: ${JSON.stringify(dig(body, 'output') ?? body).slice(0, 300)}` }
    }
    return { state: status === 'PENDING' ? 'queued' : 'running' }
  },
})

// ── Zhipu (vendorId: zhipu) ──
// POST /api/paas/v4/videos/generations {model,prompt,image_url?} → {id,task_status}
// GET /api/paas/v4/videos/generations/{id} → task_status SUCCESS/FAIL + video_result[].url

registerMediaJobAdapter({
  vendorId: 'zhipu',
  async submit(req) {
    const res = await aiFetch('https://open.bigmodel.cn/api/paas/v4/videos/generations', {
      method: 'POST',
      ...(req.signal ? { signal: req.signal } : {}),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req.apiKey}` },
      body: JSON.stringify({
        model: req.model,
        prompt: req.prompt,
        ...(req.imageUrl ? { image_url: req.imageUrl } : {}),
        ...(req.durationSeconds ? { duration: req.durationSeconds } : {}),
      }),
    })
    const body = await readJson(res)
    const id = firstString(body, ['id', 'task_id'])
    if (!id) throw new Error(`zhipu: no task id in ${JSON.stringify(body).slice(0, 200)}`)
    return id
  },
  async poll(jobId, req) {
    const res = await aiFetch(`https://open.bigmodel.cn/api/paas/v4/videos/generations/${jobId}`, {
      headers: { Authorization: `Bearer ${req.apiKey}` },
      ...(req.signal ? { signal: req.signal } : {}),
    })
    const body = await readJson(res)
    const status = String(dig(body, 'task_status') ?? '')
    if (status === 'SUCCESS') {
      const url =
        firstString(body, ['video_result.0.url', 'video_result.0.cover_image_url']) ??
        firstString(body, ['video_url'])
      if (!url) return { state: 'failed', error: 'zhipu: SUCCESS without a video url' }
      return { state: 'succeeded', result: { url, mime: 'video/mp4', meta: { jobId } } }
    }
    if (status === 'FAIL') return { state: 'failed', error: `zhipu task FAIL: ${JSON.stringify(body).slice(0, 300)}` }
    return { state: status === 'PROCESSING' ? 'running' : 'queued' }
  },
})

// ── MiniMax / Hailuo (vendorId: minimax) ──
// POST /v1/video_generation {model,prompt} → {file_id}
// GET /v1/query/video_generation?file_id= → status FileDownloading.../Success + file.download_url

registerMediaJobAdapter({
  vendorId: 'minimax',
  pollIntervalMs: 6_000,
  async submit(req) {
    const res = await aiFetch('https://api.minimax.chat/v1/video_generation', {
      method: 'POST',
      ...(req.signal ? { signal: req.signal } : {}),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req.apiKey}` },
      body: JSON.stringify({
        model: req.model,
        prompt: req.prompt,
        ...(req.imageUrl ? { first_frame_image: req.imageUrl } : {}),
        ...(req.durationSeconds ? { duration: req.durationSeconds } : {}),
      }),
    })
    const body = await readJson(res)
    const id = firstString(body, ['file_id', 'task_id'])
    if (!id) throw new Error(`minimax: no file_id in ${JSON.stringify(body).slice(0, 200)}`)
    return id
  },
  async poll(jobId, req) {
    const res = await aiFetch(`https://api.minimax.chat/v1/query/video_generation?file_id=${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${req.apiKey}` },
      ...(req.signal ? { signal: req.signal } : {}),
    })
    const body = await readJson(res)
    const status = String(dig(body, 'status') ?? '')
    if (status === 'Success') {
      const url = firstString(body, ['file.download_url', 'file.download_url2'])
      if (!url) return { state: 'failed', error: 'minimax: Success without a download_url' }
      return { state: 'succeeded', result: { url, mime: 'video/mp4', meta: { jobId } } }
    }
    if (/Fail/i.test(status)) return { state: 'failed', error: `minimax task ${status}` }
    return { state: 'running', note: status }
  },
})

// ── Volcengine Ark / Seedance (vendorId: volcengine) ──
// POST /api/v3/contents/generations/tasks {model, content:[text, image_url?]} → {id}
// GET /api/v3/contents/generations/tasks/{id} → status queued/running/succeeded/failed + content.video_url

registerMediaJobAdapter({
  vendorId: 'volcengine',
  async submit(req) {
    const content: unknown[] = [{ type: 'text', text: req.prompt }]
    if (req.imageUrl) content.push({ type: 'image_url', image_url: { url: req.imageUrl } })
    const res = await aiFetch('https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks', {
      method: 'POST',
      ...(req.signal ? { signal: req.signal } : {}),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req.apiKey}` },
      body: JSON.stringify({ model: req.model, content }),
    })
    const body = await readJson(res)
    const id = firstString(body, ['id', 'task_id'])
    if (!id) throw new Error(`ark: no task id in ${JSON.stringify(body).slice(0, 200)}`)
    return id
  },
  async poll(jobId, req) {
    const res = await aiFetch(`https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${jobId}`, {
      headers: { Authorization: `Bearer ${req.apiKey}` },
      ...(req.signal ? { signal: req.signal } : {}),
    })
    const body = await readJson(res)
    const status = String(dig(body, 'status') ?? '')
    if (status === 'succeeded') {
      const url = firstString(body, ['content.video_url', 'content.video.video_url'])
      if (!url) return { state: 'failed', error: 'ark: succeeded without a video_url' }
      return { state: 'succeeded', result: { url, mime: 'video/mp4', meta: { jobId } } }
    }
    if (status === 'failed' || status === 'cancelled') {
      return { state: 'failed', error: `ark task ${status}: ${JSON.stringify(dig(body, 'error') ?? body).slice(0, 300)}` }
    }
    return { state: status === 'queued' ? 'queued' : 'running' }
  },
})

// ── Kling AI (vendorId: kling) ──
// JWT (HS256, accessKey/secretKey) → POST /v1/videos/text2video {model_name,prompt}
// → {data:{task_id}} · GET /v1/videos/text2video/{id} → data.task_status succeed/failed + data.task_result.videos[0].url
// The API key field carries "accessKey:secretKey" (colon-separated).

async function klingJwt(apiKey: string): Promise<string> {
  const [ak, sk] = apiKey.split(':')
  if (!ak || !sk) throw new Error('Kling key must be "accessKey:secretKey" (see the Kling console)')
  // Web Crypto (global in Node 18+ and browsers) — this module also compiles
  // into renderer-context projects, so node:crypto is off the table
  const enc = new TextEncoder()
  const b64u = (bytes: Uint8Array): string => {
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  const now = Math.floor(Date.now() / 1000)
  const header = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payload = b64u(enc.encode(JSON.stringify({ iss: ak, exp: now + 1800, nbf: now - 5 })))
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(sk),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${payload}`))
  return `${header}.${payload}.${b64u(new Uint8Array(sigBuf))}`
}

registerMediaJobAdapter({
  vendorId: 'kling',
  pollIntervalMs: 6_000,
  timeoutMs: 15 * 60_000,
  async submit(req) {
    const auth = await klingJwt(req.apiKey)
    const res = await aiFetch('https://api.klingai.com/v1/videos/text2video', {
      method: 'POST',
      ...(req.signal ? { signal: req.signal } : {}),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
      body: JSON.stringify({
        model_name: req.model || 'kling-v1',
        prompt: req.prompt,
        ...(req.imageUrl ? { image: req.imageUrl } : {}),
        cfg_scale: 0.5,
        ...(req.aspectRatio ? { aspect_ratio: req.aspectRatio } : {}),
        ...(req.durationSeconds ? { duration: String(req.durationSeconds) } : {}),
      }),
    })
    const body = await readJson(res)
    const id = firstString(body, ['data.task_id'])
    if (!id) throw new Error(`kling: no task id in ${JSON.stringify(body).slice(0, 200)}`)
    return id
  },
  async poll(jobId, req) {
    const auth = await klingJwt(req.apiKey)
    const res = await aiFetch(`https://api.klingai.com/v1/videos/text2video/${jobId}`, {
      headers: { Authorization: `Bearer ${auth}` },
      ...(req.signal ? { signal: req.signal } : {}),
    })
    const body = await readJson(res)
    const status = String(dig(body, 'data.task_status') ?? '')
    if (status === 'succeed') {
      const url = firstString(body, ['data.task_result.videos.0.url'])
      if (!url) return { state: 'failed', error: 'kling: succeed without a video url' }
      return { state: 'succeeded', result: { url, mime: 'video/mp4', meta: { jobId } } }
    }
    if (status === 'failed') {
      return { state: 'failed', error: `kling task failed: ${JSON.stringify(dig(body, 'data') ?? body).slice(0, 300)}` }
    }
    return { state: status === 'submitted' ? 'queued' : 'running' }
  },
})

// ── Luma Dream Machine (vendorId: luma) ──
// POST /dream-machine/v1/generations {prompt, model:'ray-2', resolution, duration}
// → {id} · GET /dream-machine/v1/generations/{id} → state queued/dreaming/completed/failed + assets.video

registerMediaJobAdapter({
  vendorId: 'luma',
  pollIntervalMs: 6_000,
  timeoutMs: 15 * 60_000,
  async submit(req) {
    const res = await aiFetch('https://api.lumalabs.ai/dream-machine/v1/generations', {
      method: 'POST',
      ...(req.signal ? { signal: req.signal } : {}),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req.apiKey}`, accept: 'application/json' },
      body: JSON.stringify({
        prompt: req.prompt,
        model: req.model || 'ray-2',
        ...(req.imageUrl ? { keyframes: { frame0: { type: 'image', url: req.imageUrl } } } : {}),
        ...(req.aspectRatio ? { aspect_ratio: req.aspectRatio } : {}),
        ...(req.durationSeconds ? { duration: `${req.durationSeconds}s` } : {}),
      }),
    })
    const body = await readJson(res)
    const id = firstString(body, ['id'])
    if (!id) throw new Error(`luma: no generation id in ${JSON.stringify(body).slice(0, 200)}`)
    return id
  },
  async poll(jobId, req) {
    const res = await aiFetch(`https://api.lumalabs.ai/dream-machine/v1/generations/${jobId}`, {
      headers: { Authorization: `Bearer ${req.apiKey}`, accept: 'application/json' },
      ...(req.signal ? { signal: req.signal } : {}),
    })
    const body = await readJson(res)
    const state = String(dig(body, 'state') ?? '')
    if (state === 'completed') {
      const url = firstString(body, ['assets.video'])
      if (!url) return { state: 'failed', error: 'luma: completed without assets.video' }
      return { state: 'succeeded', result: { url, mime: 'video/mp4', meta: { jobId } } }
    }
    if (state === 'failed') return { state: 'failed', error: `luma generation failed: ${JSON.stringify(dig(body, 'failure_reason') ?? body).slice(0, 300)}` }
    return { state: state === 'queued' ? 'queued' : 'running' }
  },
})

// ── fal.ai queue (vendorId: fal) ──
// model is the full fal route, e.g. "fal-ai/kling-video/v2/master/text-to-video"
// POST https://queue.fal.run/{model} → {status_url, response_url}
// GET status_url → COMPLETED · GET response_url → {video:{url}}

registerMediaJobAdapter({
  vendorId: 'fal',
  pollIntervalMs: 4_000,
  timeoutMs: 15 * 60_000,
  async submit(req) {
    const base = 'https://queue.fal.run'
    const res = await aiFetch(`${base}/${req.model}`, {
      method: 'POST',
      ...(req.signal ? { signal: req.signal } : {}),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req.apiKey}` },
      body: JSON.stringify({
        prompt: req.prompt,
        ...(req.imageUrl ? { image_url: req.imageUrl } : {}),
        ...(req.aspectRatio ? { aspect_ratio: req.aspectRatio } : {}),
        ...(req.durationSeconds ? { duration: String(req.durationSeconds) } : {}),
      }),
    })
    const body = await readJson(res)
    const statusUrl = firstString(body, ['status_url'])
    if (!statusUrl) throw new Error(`fal: no status_url in ${JSON.stringify(body).slice(0, 200)}`)
    return statusUrl
  },
  async poll(jobId, req) {
    const res = await aiFetch(jobId, {
      headers: { Authorization: `Bearer ${req.apiKey}` },
      ...(req.signal ? { signal: req.signal } : {}),
    })
    const body = await readJson(res)
    const status = String(dig(body, 'status') ?? '')
    if (status === 'COMPLETED') {
      const responseUrl = firstString(body, ['response_url'])
      if (!responseUrl) return { state: 'failed', error: 'fal: COMPLETED without response_url' }
      const out = await aiFetch(responseUrl, {
        headers: { Authorization: `Bearer ${req.apiKey}` },
        ...(req.signal ? { signal: req.signal } : {}),
      })
      const payload = await readJson(out)
      const url =
        firstString(payload, ['video.url', 'video_url', 'videos.0.url']) ??
        firstString(payload, ['images.0.url'])
      if (!url) return { state: 'failed', error: `fal: no media url in ${JSON.stringify(payload).slice(0, 300)}` }
      return { state: 'succeeded', result: { url, mime: 'video/mp4', meta: { jobId } } }
    }
    if (status === 'FAILED') return { state: 'failed', error: 'fal queue reported FAILED' }
    return { state: status === 'IN_QUEUE' ? 'queued' : 'running', note: status || undefined } as MediaJobPollResult
  },
})
