import { aiFetch } from './fetch'
import { httpBodyDetail } from './http-error'
import type { AiModelType } from './model-type'
import { inferModelType } from './model-type'
import { MODE_CANDIDATES } from './videojob'
import { VENDORS } from './vendor-catalog'

/**
 * Vendor contract discovery — the auto-match pipeline for unfamiliar
 * OpenAI-compatible gateways. Given nothing but a base URL + key it:
 *
 *   1. fingerprints the vendor (models list → model kinds, catalog match),
 *   2. hunts down machine-readable docs (llms.txt index → model pages),
 *   3. converges on a working request shape by reading the gateway's own
 *      parameter-validation errors (chatty validators reject pre-billing),
 *   4. emits a VendorContractProfile — the enums and shapes a caller needs
 *      to drive this gateway without a hand-written adapter.
 *
 * Deterministic by design — no LLM in the loop. The error taxonomy is small
 * (missing/invalid param, rate limited, not found) and the docs conventions
 * (Mintlify-style llms.txt, markdown param tables) parse with regex. An LLM
 * layer for unparseable docs can ride on top later.
 *
 * Cost note: a converged video/image probe creates one real job (billable on
 * paid vendors; validation failures are free). Callers can disable either
 * probe via options.
 */

export interface DiscoveredModel {
  id: string
  kind: AiModelType
}

export interface ProbeEvent {
  step: string
  request: string
  outcome: string
}

export interface VendorContractProfile {
  baseUrl: string
  /** catalog id when the base URL matched, else 'unknown' */
  vendorHint: string
  detectedAt: string
  models: DiscoveredModel[]
  docs: {
    /** the llms.txt index URL that parsed, null when none found */
    source: string | null
    /** mode enum values parsed from the video model page */
    videoModes: string[]
    /** size literals parsed from the docs, e.g. '720P' / '1280x720' */
    sizeHints: string[]
    notes: string[]
  }
  video: {
    supported: boolean
    createPath: string
    /** the request body that passed validation, null when unsupported */
    requestShape: Record<string, unknown> | null
    modesRejected: string[]
    /** enum values that validated but require media inputs (keyframe/reference) */
    modesNeedingMedia: string[]
    idField: string | null
    poll: {
      statusesSeen: string[]
      fieldsSeen: string[]
      /** where the finished url lived: 'url' | 'metadata.url' | … */
      resultFieldPaths: string[]
    }
  }
  image: {
    supported: boolean
    createPath: string
    requestShape: Record<string, unknown> | null
    responseKind: 'url' | 'b64_json' | null
  }
  /** every network step in order — the audit trail for profile review */
  probes: ProbeEvent[]
}

export interface DiscoveryOptions {
  /** min gap between requests; free tiers 429 fast (agnes: ~3 in a row) */
  minIntervalMs?: number
  /** wait before the first poll of a created video job */
  pollDelayMs?: number
  /** extra sleep after a 429 before retrying */
  backoffMs?: number
  /** keep polling to a terminal state (minutes) instead of one shape peek */
  fullVerify?: boolean
  probeVideo?: boolean
  probeImage?: boolean
  signal?: AbortSignal
}

const DEFAULTS = {
  minIntervalMs: 5_000,
  pollDelayMs: 6_000,
  backoffMs: 30_000,
  pollBudgetMs: 10 * 60_000,
}

const PROBE_PROMPT = 'a calm abstract gradient background, minimal'

/** table-row cells we never want to read as enum values */
const NON_ENUM_TOKENS = new Set(['mode', 'string', 'integer', 'boolean', '是', '否', 'size'])

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**paces every request — the discovery loop must be gentler than the app*/
class Pacer {
  private nextAt = 0
  constructor(private readonly intervalMs: number) {}
  async wait(): Promise<void> {
    const now = Date.now()
    if (now < this.nextAt) await sleep(this.nextAt - now)
    this.nextAt = Date.now() + this.intervalMs
  }
}

async function readJson(resp: Response): Promise<{ json: Record<string, unknown>; text: string }> {
  const text = await resp.text()
  try {
    return { json: JSON.parse(text) as Record<string, unknown>, text }
  } catch {
    return { json: {}, text }
  }
}

function errMessage(json: Record<string, unknown>, text: string): string {
  const nested = json.error as Record<string, unknown> | string | undefined
  const nestedMessage = typeof nested === 'object' && nested !== null ? nested.message : nested
  return String(nestedMessage ?? json.message ?? httpBodyDetail(text))
}

/** `api.agnes-ai.cn` → `agnes-ai.cn` (naive last-two-labels; probe-only) */
function registrableDomain(host: string): string {
  const labels = host.split('.').filter(Boolean)
  return labels.length <= 2 ? host : labels.slice(-2).join('.')
}

interface Classify400 {
  kind: 'mode' | 'size' | 'media' | 'seconds' | 'other'
}

function classifyValidation(message: string): Classify400['kind'] {
  if (/\bsize\b|分辨率|尺寸/i.test(message)) return 'size'
  if (/first_frame|last_frame|\bimages\b|\baudios\b|参考图|首帧|尾帧/i.test(message)) return 'media'
  if (/\bseconds\b|\bduration\b|时长/i.test(message)) return 'seconds'
  if (/\bmode\b/i.test(message)) return 'mode'
  return 'other'
}

function parseLlmsIndex(text: string): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = []
  for (const line of text.split('\n')) {
    const m = /^\s*-\s*\[([^\]]+)\]\(([^)]+)\)/.exec(line)
    if (m) out.push({ title: m[1]!, url: m[2]! })
  }
  return out
}

/** pick the doc page whose title best matches the detected model id */
function pickDocPage(
  entries: Array<{ title: string; url: string }>,
  modelId: string,
): { title: string; url: string } | undefined {
  const tokens = modelId.toLowerCase().split(/[-_\s.]/).filter((t) => t.length > 1)
  let best: { entry: { title: string; url: string }; score: number } | undefined
  for (const entry of entries) {
    const title = entry.title.toLowerCase()
    let score = 0
    for (const t of tokens) if (title.includes(t)) score++
    if (score > (best?.score ?? 0)) best = { entry, score }
  }
  return best?.entry
}

/** backticked tokens from markdown table rows that mention the param name */
function extractEnums(md: string, param: string): string[] {
  const values = new Set<string>()
  for (const line of md.split('\n')) {
    if (!/^ *\|/.test(line)) continue
    const cells = line.split('|').map((c) => c.trim())
    if (!cells.some((c) => c.replace(/`/g, '').toLowerCase() === param)) continue
    for (const cell of cells) {
      for (const m of cell.matchAll(/`([a-z0-9_.-]+)`/gi)) {
        const v = m[1]!.toLowerCase()
        if (!NON_ENUM_TOKENS.has(v)) values.add(v)
      }
    }
  }
  return [...values]
}

function extractSizeHints(md: string): string[] {
  const out = new Set<string>()
  for (const line of md.split('\n')) {
    if (!/size/i.test(line)) continue
    for (const m of line.matchAll(/"(\d{3,4}P)"/g)) out.add(m[1]!)
    for (const m of line.matchAll(/`(\d{3,4}x\d{3,4})`/g)) out.add(m[1]!)
  }
  return [...out]
}

export async function discoverVendorContract(
  baseUrl: string,
  apiKey: string,
  opts: DiscoveryOptions = {},
): Promise<VendorContractProfile> {
  const o = { ...DEFAULTS, ...opts }
  const base = baseUrl.replace(/\/$/, '')
  const pacer = new Pacer(o.minIntervalMs)
  const probes: ProbeEvent[] = []
  const notes: string[] = []

  const record = (step: string, request: string, outcome: string): void => {
    probes.push({ step, request, outcome })
  }

  const fetchJson = async (
    url: string,
    init: RequestInit,
    label: string,
  ): Promise<{ ok: boolean; status: number; json: Record<string, unknown>; text: string }> => {
    await pacer.wait()
    const resp = await aiFetch(url, init)
    const r = await readJson(resp)
    record(label, `${init.method ?? 'GET'} ${url}`, `${resp.status} ${resp.ok ? 'ok' : errMessage(r.json, r.text).slice(0, 120)}`)
    return { ok: resp.ok, status: resp.status, json: r.json, text: r.text }
  }

  // ---- stage 1: fingerprint -------------------------------------------------
  let host: string
  try {
    host = new URL(base).host
  } catch {
    throw new Error(`invalid base URL: ${baseUrl}`)
  }
  const catalogHit = VENDORS.find((v) => v.defaultUrl.replace(/\/$/, '') === base)
  const vendorHint = catalogHit?.id ?? 'unknown'
  if (!catalogHit) notes.push(`no catalog entry for ${host}`)

  const models: DiscoveredModel[] = []
  const modelsR = await fetchJson(`${base}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }, 'fingerprint')
  if (modelsR.ok && Array.isArray(modelsR.json.data)) {
    for (const item of modelsR.json.data as Array<Record<string, unknown>>) {
      const id = typeof item.id === 'string' ? item.id : ''
      if (id) models.push({ id, kind: inferModelType(id) })
    }
  } else {
    notes.push('model list unavailable — probes skipped (NO_MODELS_API-style vendor)')
  }

  const videoModel = models.find((m) => m.kind === 'video-generation')
  const imageModel = models.find((m) => m.kind === 'image-generation')

  // ---- stage 2: docs discovery ----------------------------------------------
  const docsCandidates: string[] = []
  if (catalogHit?.docsUrl) {
    try {
      docsCandidates.push(`${new URL(catalogHit.docsUrl).origin}/llms.txt`)
    } catch {
      /* malformed catalog URL — fall through to domain guesses */
    }
  }
  const root = registrableDomain(host)
  docsCandidates.push(`https://wiki.${root}/llms.txt`, `https://docs.${root}/llms.txt`, `https://${root}/llms.txt`)

  let docsSource: string | null = null
  let videoModes: string[] = []
  let sizeHints: string[] = []
  for (const candidate of [...new Set(docsCandidates)]) {
    if (o.signal?.aborted) throw new Error('aborted')
    await pacer.wait()
    let resp: Response
    try {
      resp = await aiFetch(candidate, {})
    } catch {
      record('docs', `GET ${candidate}`, 'network error')
      continue
    }
    const text = await resp.text()
    record('docs', `GET ${candidate}`, `${resp.status}`)
    if (!resp.ok || !text.includes('](')) continue
    const entries = parseLlmsIndex(text)
    if (!entries.length) continue
    docsSource = candidate
    const wanted = videoModel ?? imageModel
    if (wanted) {
      const page =
        (videoModel ? pickDocPage(entries.filter((e) => /video/i.test(e.title)), videoModel.id) : undefined) ??
        (imageModel ? pickDocPage(entries.filter((e) => /image/i.test(e.title)), imageModel.id) : undefined)
      if (page) {
        await pacer.wait()
        try {
          const pageResp = await aiFetch(page.url, {})
          const md = await pageResp.text()
          record('docs', `GET ${page.url}`, `${pageResp.status} (${md.length} bytes)`)
          if (pageResp.ok) {
            videoModes = extractEnums(md, 'mode')
            sizeHints = extractSizeHints(md)
          }
        } catch {
          record('docs', `GET ${page.url}`, 'network error')
        }
      }
    }
    break // first index that parses wins
  }

  // ---- stage 3a: video contract probe ----------------------------------------
  const video: VendorContractProfile['video'] = {
    supported: false,
    createPath: '/videos',
    requestShape: null,
    modesRejected: [],
    modesNeedingMedia: [],
    idField: null,
    poll: { statusesSeen: [], fieldsSeen: [], resultFieldPaths: [] },
  }
  const doProbeVideo = (opts.probeVideo ?? true) && !!videoModel
  if (videoModel && !doProbeVideo) notes.push('video probe disabled by caller')
  if (doProbeVideo && videoModel) {
    video.supported = true
    const candidates = [...new Set([...(videoModes.length ? videoModes : []), ...MODE_CANDIDATES])]
    const sizesFromDocs = [...new Set([...sizeHints, '720P'])]
    let converged = false

    for (const mode of candidates) {
      if (converged || o.signal?.aborted) break
      let body: Record<string, unknown> = {
        model: videoModel.id,
        prompt: PROBE_PROMPT,
        mode,
        seconds: '4',
      }
      let sizeAttempt = 0
      // per-mode retry loop: 429s retry, size complaints walk size hints, other
      // validation failures move to the next mode candidate
      for (let attempt = 0; attempt < 8; attempt++) {
        const r = await fetchJson(`${base}/videos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        }, `video-create(mode=${mode}${body.size ? `,size=${String(body.size)}` : ''})`)
        if (r.ok) {
          const idField = ['id', 'video_id', 'task_id'].find((k) => typeof r.json[k] === 'string')
          if (!idField) {
            record('video-create', 'response', 'no job id field — treating as failure')
            break
          }
          video.requestShape = body
          video.idField = idField
          converged = true
          const id = String(r.json[idField])
          // one shape peek (or a full terminal wait when verifying)
          await sleep(o.pollDelayMs)
          const deadline = Date.now() + DEFAULTS.pollBudgetMs
          for (;;) {
            const p = await fetchJson(`${base}/videos/${encodeURIComponent(id)}`, {
              headers: { Authorization: `Bearer ${apiKey}` },
            }, 'video-poll')
            if (p.ok) {
              const status = String(p.json.status ?? p.json.task_status ?? p.json.state ?? 'unknown').toLowerCase()
              if (!video.poll.statusesSeen.includes(status)) video.poll.statusesSeen.push(status)
              video.poll.fieldsSeen = Object.keys(p.json)
              if (typeof p.json.url === 'string') addOnce(video.poll.resultFieldPaths, 'url')
              if (typeof p.json.video_url === 'string') addOnce(video.poll.resultFieldPaths, 'video_url')
              const meta = p.json.metadata
              if (typeof meta === 'object' && meta !== null && typeof (meta as Record<string, unknown>).url === 'string') {
                addOnce(video.poll.resultFieldPaths, 'metadata.url')
              }
              const terminal = ['completed', 'succeeded', 'success', 'finished'].includes(status)
              const failed = ['failed', 'canceled', 'cancelled', 'error'].includes(status)
              if (terminal || failed || !(o.fullVerify ?? false)) {
                if (failed) notes.push(`probe job ${status}`)
                break
              }
            } else if (p.status !== 404 || !(o.fullVerify ?? false)) {
              // non-transient poll error, or a transient 404 we won't wait out
              break
            }
            if (Date.now() > deadline) {
              notes.push('full verify timed out (contract shape still recorded)')
              break
            }
            await sleep(o.minIntervalMs)
          }
          break
        }
        const message = errMessage(r.json, r.text)
        if (r.status === 429 || /rate|频繁/i.test(message)) {
          record('video-create', 'backoff', `429 → sleep ${o.backoffMs}ms`)
          await sleep(o.backoffMs)
          continue
        }
        if (r.status === 400) {
          const kind = classifyValidation(message)
          if (kind === 'mode') {
            video.modesRejected.push(mode)
            break
          }
          if (kind === 'media') {
            video.modesNeedingMedia.push(mode)
            break
          }
          if (kind === 'size') {
            const next = sizesFromDocs[sizeAttempt++]
            if (next) {
              body = { ...body, size: next }
              continue
            }
            notes.push(`size rejected, exhausted hints: ${message.slice(0, 120)}`)
            break
          }
          if (kind === 'seconds') {
            delete body.seconds
            continue
          }
          notes.push(`unrecognized 400 (mode=${mode}): ${message.slice(0, 120)}`)
          break
        }
        notes.push(`video create failed (mode=${mode}): HTTP ${r.status} ${message.slice(0, 120)}`)
        break
      }
    }
    if (!converged) {
      video.supported = false
      notes.push('every mode candidate rejected — profile kept for review')
    }
  }

  // ---- stage 3b: image contract probe ----------------------------------------
  const image: VendorContractProfile['image'] = {
    supported: false,
    createPath: '/images/generations',
    requestShape: null,
    responseKind: null,
  }
  const doProbeImage = (opts.probeImage ?? true) && !!imageModel
  if (imageModel && !doProbeImage) notes.push('image probe disabled by caller')
  if (doProbeImage && imageModel) {
    let body: Record<string, unknown> = { model: imageModel.id, prompt: PROBE_PROMPT, n: 1 }
    for (let attempt = 0; attempt < 6; attempt++) {
      if (o.signal?.aborted) break
      const r = await fetchJson(`${base}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      }, 'image-create')
      if (r.ok) {
        const first = Array.isArray(r.json.data)
          ? ((r.json.data as Array<Record<string, unknown>>)[0] ?? {})
          : {}
        image.supported = true
        image.requestShape = body
        image.responseKind = typeof first.url === 'string' && first.url ? 'url' : 'b64_json'
        break
      }
      const message = errMessage(r.json, r.text)
      if (r.status === 429 || /rate|频繁/i.test(message)) {
        record('image-create', 'backoff', `429 → sleep ${o.backoffMs}ms`)
        await sleep(o.backoffMs)
        continue
      }
      if (r.status === 400 && /\bsize\b|分辨率|尺寸/i.test(message)) {
        const next = ['1024x1024', '720P', '1792x1024'][attempt % 3]
        body = { ...body, size: next }
        continue
      }
      notes.push(`image create failed: HTTP ${r.status} ${message.slice(0, 120)}`)
      break
    }
  }

  // ---- stage 4: assemble ------------------------------------------------------
  return {
    baseUrl: base,
    vendorHint,
    detectedAt: new Date().toISOString(),
    models,
    docs: { source: docsSource, videoModes, sizeHints, notes },
    video,
    image,
    probes,
  }
}

function addOnce(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value)
}
