/**
 * Wrapper around chaoffice (ChaOffice CLI, @chaoffice/cli) — search / image generation /
 * media analysis / upload / transcription.
 *
 * Execution: the main process spawns the CLI's JS entry with
 * ELECTRON_RUN_AS_NODE=1 so Electron itself acts as Node (the variable is a
 * no-op in a plain Node environment), avoiding the Windows problem where
 * .cmd files cannot be passed to execFile.
 *
 * Auth: chaofficeCliApiKey() below. When not logged in, hasChaOfficeAuth() returns false and
 * callers should fall back to other implementations (e.g. Serper search).
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unwatchFile, watchFile, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import {
  isCopyrightHost,
  asRecord,
  firstItem,
  chaofficeProxyUrl,
  safeHost,
  type ImageSearchResult,
  type WebSearchResult,
} from './shared'
// LOCAL(2026-09-22, f5247d3..476e5023): 上游 #657 watch 函数重放为 chaoffice 命名
// LOCAL(2026-10-15, sync/24): 上游 #1950 拒键(401)恢复流并入,recoverFromRejectedGskKey→recoverFromRejectedChaofficeKey
import {
  chaofficeApiKey as chaofficeAuthApiKey,
  chaofficeAuthPath,
  recoverFromRejectedChaofficeKey,
  reloadChaofficeAuth,
  type ChaOfficeRecoveryOutcome,
} from './chaoffice-auth'

const SEARCH_TIMEOUT_MS = 60_000
const GENERATE_TIMEOUT_MS = 600_000
const MAX_BUFFER = 32 * 1024 * 1024

// ── CLI resolution & auth ───────────────────────────────────────────

let cachedEntry: string | null | undefined

/** JS entry of @chaoffice/cli (null if not found). Can be overridden via GSK_CLI_PATH. */
export function resolveChaOfficeEntry(): string | null {
  if (process.env.GSK_CLI_PATH) return process.env.GSK_CLI_PATH
  if (cachedEntry !== undefined) return cachedEntry
  try {
    const require = createRequire(import.meta.url)
    cachedEntry = require.resolve('@chaoffice/cli/dist/index.js')
  } catch {
    // The packaged app has no node_modules; electron-builder extraResources
    // copies the CLI into Resources/chaoffice/
    const resourcesPath = (process as { resourcesPath?: string }).resourcesPath
    const packed = resourcesPath
      ? join(resourcesPath, 'chaoffice', 'node_modules', '@chaoffice', 'cli', 'dist', 'index.js')
      : null
    cachedEntry = packed && existsSync(packed) ? packed : null
  }
  return cachedEntry
}

let compatPath: string | null | undefined

/**
 * Under Electron-as-Node, Commander.js sees process.versions.electron and
 * parses argv with Electron conventions (skipping one argument fewer), so it
 * treats the entry path as a command and prints help. Workaround: --require a
 * script that deletes versions.electron. In a plain Node environment
 * (tests/tsx) no handling is needed and an empty array is returned.
 */
function electronCompatArgs(): string[] {
  if (!process.versions.electron) return []
  if (compatPath === undefined) {
    try {
      const dir = join(homedir(), '.chaoffice', 'bin')
      mkdirSync(dir, { recursive: true })
      compatPath = join(dir, 'electron-compat.js')
      writeFileSync(compatPath, 'delete process.versions.electron;\n')
    } catch {
      compatPath = null
    }
  }
  return compatPath ? ['--require', compatPath] : []
}

/**
 * API key for ChaOffice LLM proxy / tool_cli auth; '' when not logged in.
 * Priority: CHAOFFICE_API_KEY env → ChaOffice's own key (bills to us via its
 * key_name) → shared chaoffice CLI login (bills to the Claw bucket).
 */
export function chaofficeCliApiKey(): string {
  const env = process.env.CHAOFFICE_API_KEY
  if (env && !rejectedKeys.has(env)) return env
  const own = chaofficeAuthApiKey()
  if (own && !rejectedKeys.has(own)) return own
  try {
    const configPath = join(homedir(), '.chaoffice-tool-cli', 'config.json')
    if (!existsSync(configPath)) return ''
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { api_key?: string }
    const shared = config.api_key ?? ''
    return rejectedKeys.has(shared) ? '' : shared
  } catch {
    return ''
  }
}

// ── Rejected keys (401) ─────────────────────────────────────────────

/**
 * Keys the server answered 401 for (expired / revoked). ChaOffice's own key
 * is also deleted from disk; env and shared chaoffice CLI keys belong to
 * someone else, so they are only skipped for the rest of this process.
 */
const rejectedKeys = new Set<string>()

/** Thrown when a chaoffice-key call is refused with 401 and no fresh key could be minted. */
export class ChaOfficeAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChaOfficeAuthError'
  }
}

/** Whether an error text reports an HTTP 401 (chaoffice CLI, tool_cli, LLM proxy shapes). */
export function isChaofficeUnauthorizedText(text: unknown): boolean {
  return /\bHTTP 401\b|\b401 Unauthorized\b/i.test(String(text ?? ''))
}

/**
 * Records that `key` was refused with 401: it stops being offered (so
 * hasChaOfficeAuth() / ai:chaoffice-status report signed-out and the existing
 * sign-in UI appears) and the re-mint / re-login recovery starts. The
 * invalidation is synchronous, before the first await, so a caller can report
 * the failure right after this returns.
 */
export function noteChaofficeKeyRejected(
  key: string,
  options: { allowLogin?: boolean } = {},
): Promise<ChaOfficeRecoveryOutcome> {
  if (key) rejectedKeys.add(key)
  return recoverFromRejectedChaofficeKey(key, options)
}

/**
 * For callers that used the chaoffice key outside this module (the ChaOffice
 * LLM proxy chat/stream): when `error` reports a 401, drop the key and start
 * the recovery in the background. Returns whether it was an auth failure.
 */
export function noteChaofficeCallFailure(key: string, error: unknown): boolean {
  if (!key) return false
  const text = error instanceof Error ? error.message : String(error ?? '')
  if (!isChaofficeUnauthorizedText(text)) return false
  void noteChaofficeKeyRejected(key).catch(() => {})
  return true
}

/**
 * Runs `call` with the current key; on a 401 drops the key and, when the
 * stored session minted a replacement, retries exactly once with it.
 */
async function withKeyRecovery<T>(
  call: (key: string) => Promise<T>,
  options: { allowLogin?: boolean } = {},
): Promise<T> {
  const key = chaofficeCliApiKey()
  try {
    return await call(key)
  } catch (err) {
    if (!(err instanceof ChaOfficeAuthError)) throw err
    const outcome = await noteChaofficeKeyRejected(key, options)
    const next = chaofficeCliApiKey()
    if (outcome !== 'reminted' || !next || next === key) throw err
    return call(next)
  }
}

/** Test hook: forget rejected keys. */
export function resetChaofficeRejectedKeys(): void {
  rejectedKeys.clear()
}

/**
 * Fires when the effective chaoffice key changes on disk — another
 * ChaOffice-family app re-logging in mints a new key and revokes the one this
 * process holds. Polls by path (watchFile): auth.json is replaced whole, and
 * fs.watch misses events for a moment after it is armed.
 */
export function watchChaofficeApiKey(
  onChange: (key: string) => void,
  intervalMs = 2000,
): () => void {
  let last = chaofficeCliApiKey()
  const check = (): void => {
    reloadChaofficeAuth()
    const key = chaofficeCliApiKey()
    if (key === last) return
    last = key
    onChange(key)
  }
  const files = [chaofficeAuthPath(), join(homedir(), '.chaoffice-tool-cli', 'config.json')]
  for (const f of files) watchFile(f, { persistent: false, interval: intervalMs }, check)
  return () => {
    for (const f of files) unwatchFile(f, check)
  }
}

/**
 * Whether chaoffice is usable (CLI installed and logged in / has a key). Callers use this to decide fallback.
 * Set AI_SEARCH_DISABLE_GSK=1 to force-disable (test isolation / force Serper).
 */
export function hasChaOfficeAuth(): boolean {
  if (process.env.AI_SEARCH_DISABLE_GSK === '1') return false
  return !!chaofficeCliApiKey() && resolveChaOfficeEntry() !== null
}

// ── Child-process proxy plumbing ────────────────────────────────────

// The main process's undici dispatcher (see the apps' proxy bootstraps) never
// reaches child processes: without forwarding they dial genspark.ai directly.
export { setChaOfficeProxyUrl, chaofficeProxyUrl } from './shared'

/**
 * env for chaoffice CLI children: Electron-as-Node plus proxy forwarding. The CLI
 * uses Node's built-in fetch, which ignores proxy env vars unless
 * NODE_USE_ENV_PROXY=1 (Node >= 24 — Electron 41 ships Node 24). Only
 * http(s):// proxies are forwarded; undici's env proxy cannot speak SOCKS.
 */
export function chaofficeChildEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ELECTRON_RUN_AS_NODE: '1' }
  const proxy = [
    chaofficeProxyUrl(),
    base.HTTPS_PROXY,
    base.https_proxy,
    base.HTTP_PROXY,
    base.http_proxy,
    base.ALL_PROXY,
    base.all_proxy,
  ].find((v) => v && /^https?:\/\//.test(v))
  if (proxy) {
    // scrub inherited variants: undici's env proxy prefers the lowercase
    // names, so a leftover https_proxy/all_proxy would override the selection
    delete env.https_proxy
    delete env.http_proxy
    delete env.ALL_PROXY
    delete env.all_proxy
    env.NODE_USE_ENV_PROXY = '1'
    env.HTTPS_PROXY = proxy
    env.HTTP_PROXY = proxy
  }
  return env
}

// ── Low-level execution ─────────────────────────────────────────────

/**
 * chaoffice output may have [INFO] log lines mixed in before or after the JSON;
 * scan for a line starting with { or [ and parse the longest valid JSON
 * block from there, shrinking past any trailing logs.
 */
export function parseChaOfficeOutput(stdout: string): unknown {
  const trimmed = stdout.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    /* fall through to line-by-line scan */
  }
  // Pretty-printed output puts inner elements on their own `{` lines, so the
  // scan must start from the earliest candidate and take the longest parse.
  const lines = trimmed.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line.startsWith('{') || line.startsWith('[')) {
      for (let j = lines.length; j > i; j--) {
        try {
          return JSON.parse(lines.slice(i, j).join('\n'))
        } catch {
          continue
        }
      }
    }
  }
  throw new Error(`No JSON found in chaoffice output: ${stdout.slice(0, 300)}`)
}

/** `passive`: a status/background call — a rejected key is dropped but no browser login opens */
function runChaOffice(
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
  passive = false,
): Promise<unknown> {
  const entry = resolveChaOfficeEntry()
  if (!entry) return Promise.reject(new Error('@chaoffice/cli is not installed'))
  return withKeyRecovery((key) => runChaOfficeOnce(entry, key, args, timeoutMs, signal), {
    allowLogin: !passive,
  })
}

function runChaOfficeOnce(
  entry: string,
  key: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  // inject the resolved key so the CLI bills the same identity as our direct HTTP calls
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [...electronCompatArgs(), entry, ...args, '--output', 'json'],
      {
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER,
        env: {
          ...chaofficeChildEnv(),
          ...(key ? { CHAOFFICE_API_KEY: key } : {}),
        },
        ...(signal ? { signal } : {}),
      },
      (err, stdout, stderr) => {
        if (err) {
          // chaoffice's real failure reason (auth/network/quota) is in stderr; append it to ease debugging
          const errText = (stderr || '').toString().trim().slice(0, 500)
          const message = errText ? `${err.message} | stderr: ${errText}` : err.message
          // the CLI prints a refused call's {status:'error', message:'HTTP 401…'} on stdout
          const unauthorized =
            !!key && (isChaofficeUnauthorizedText(stdout) || isChaofficeUnauthorizedText(stderr))
          reject(unauthorized ? new ChaOfficeAuthError(message) : errText ? new Error(message) : err)
          return
        }
        try {
          const result = parseChaOfficeOutput(String(stdout))
          const rec = asRecord(result)
          if (rec.status && rec.status !== 'ok') {
            const message = `chaoffice returned an error: ${rec.message ?? rec.status}`
            reject(
              key && isChaofficeUnauthorizedText(rec.message)
                ? new ChaOfficeAuthError(message)
                : new Error(message),
            )
            return
          }
          resolve(result)
        } catch (parseErr) {
          reject(parseErr)
        }
      },
    )
  })
}

// ── Search ──────────────────────────────────────────────────────────

// LOCAL(2026-09-22, f5247d3..476e5023): 上游 #555 结果数/字段长度钳制——随 gsk.ts→chaoffice.ts
// 重命名跟随,符号名 MAX_GSK_*→MAX_CHAOFFICE_*(第十二轮同型坑)
/** Max search results kept; longest snippet/title chars (prevents MB fields blowing context). */
export const MAX_CHAOFFICE_RESULTS = 20
export const MAX_CHAOFFICE_SNIPPET_CHARS = 2_000
const MAX_CHAOFFICE_URL_CHARS = 8_192

function normalizeMaxResults(n: number): number {
  if (!Number.isFinite(n)) return 6
  return Math.min(20, Math.max(1, Math.floor(n)))
}

function clipField(v: unknown, max = MAX_CHAOFFICE_SNIPPET_CHARS): string {
  const s = String(v ?? '')
  return s.length > max ? s.slice(0, max) : s
}

/** Parses the `chaoffice search` response shape data.organic_results[{title,link,snippet}] (exported for tests) */
export function parseChaOfficeWebSearch(
  raw: unknown,
  maxResults: number,
): { results: WebSearchResult[]; answer?: string } {
  const bounded = normalizeMaxResults(maxResults)
  const data = asRecord(asRecord(raw).data ?? raw)
  const organic: unknown[] = Array.isArray(data.organic_results) ? data.organic_results : []
  const results: WebSearchResult[] = organic.slice(0, bounded).map((item) => {
    const o = asRecord(item)
    return {
      title: clipField(o.title),
      url: clipField(o.link, MAX_CHAOFFICE_URL_CHARS),
      snippet: clipField(o.snippet),
    }
  })
  const answerRaw = typeof data.answer === 'string' && data.answer ? data.answer : undefined
  const answer =
    answerRaw !== undefined && answerRaw.length > MAX_CHAOFFICE_SNIPPET_CHARS
      ? `${answerRaw.slice(0, MAX_CHAOFFICE_SNIPPET_CHARS)}…`
      : answerRaw
  return answer !== undefined ? { results, answer } : { results }
}

export async function chaofficeWebSearch(
  query: string,
  maxResults = 6,
): Promise<{ results: WebSearchResult[]; answer?: string }> {
  const raw = await runChaOffice(['search', query], SEARCH_TIMEOUT_MS)
  return parseChaOfficeWebSearch(raw, maxResults)
}

/** Parses the `chaoffice img-search` response shape data[{image_url,title,source,link,width,height}] (exported for tests) */
export function parseChaOfficeImageSearch(raw: unknown, maxResults: number): ImageSearchResult[] {
  const dataRaw = asRecord(raw).data
  const data: unknown[] = Array.isArray(dataRaw) ? dataRaw : []
  const images: ImageSearchResult[] = []
  for (const item of data) {
    const img = asRecord(item)
    const imageUrl = String(img.image_url ?? img.imageUrl ?? '')
    if (!imageUrl) continue
    if (isCopyrightHost(imageUrl)) continue
    const width = Number(img.width)
    const height = Number(img.height)
    const entry: ImageSearchResult = {
      title: String(img.title ?? ''),
      imageUrl,
      sourceUrl: String(img.link ?? ''),
      source: String(img.source ?? safeHost(img.link)),
    }
    if (Number.isFinite(width) && width > 0) entry.width = width
    if (Number.isFinite(height) && height > 0) entry.height = height
    images.push(entry)
    if (images.length >= maxResults) break
  }
  return images
}

export async function chaofficeImageSearch(
  query: string,
  maxResults = 8,
  /** 1-based page; mapped to --offset for the CLI (unrecognized flags degrade to page 1) */
  page = 1,
): Promise<ImageSearchResult[]> {
  const args = ['img-search', query]
  if (page > 1) args.push('--offset', String((page - 1) * maxResults))
  const raw = await runChaOffice(args, SEARCH_TIMEOUT_MS)
  return parseChaOfficeImageSearch(raw, maxResults)
}

// ── Image generation ────────────────────────────────────────────────

export interface ChaOfficeGenerateImageOptions {
  /** Image description (English works better; text that must appear in the image stays verbatim) */
  prompt: string
  /** Generation model; defaults to the CLI default (nano-banana-2). Special-purpose: fal-bria-rmbg background removal, fal-ai/recraft-clarity-upscale upscaling, flux-pro/outpaint outpainting, fal-ai/image-editing/text-removal watermark text removal */
  model?: string
  /** Reference/edit-target image URLs (local paths also supported; the CLI uploads them automatically) */
  referenceImageUrls?: string[]
  /** 1:1 | 4:3 | 16:9 | 9:16 | 3:4 | 2:3 | 3:2 | auto */
  aspectRatio?: string
  /** auto | 0.5k | 1k | 2k | 3k | 4k */
  imageSize?: string
}

export interface ChaOfficeGeneratedImage {
  /** Watermark-free image URL (preferred); can be downloaded and inserted directly */
  url: string
  taskId: string
}

/** Parses `chaoffice img` results: prefers data.generated_images[].image_urls_nowatermark (exported for tests) */
export function parseChaOfficeGeneratedImage(raw: unknown): ChaOfficeGeneratedImage {
  const data = asRecord(asRecord(raw).data ?? raw)
  const img = asRecord(firstItem(data.generated_images ?? data.images ?? []))
  const url = firstItem(img.image_urls_nowatermark) ?? firstItem(img.image_urls) ?? img.url ?? ''
  if (!url) {
    throw new Error(
      `chaoffice image generation returned no result: ${JSON.stringify(raw).slice(0, 200)}`,
    )
  }
  return { url: String(url), taskId: String(img.task_id ?? '') }
}

export async function chaofficeGenerateImage(
  options: ChaOfficeGenerateImageOptions,
  signal?: AbortSignal,
): Promise<ChaOfficeGeneratedImage> {
  const args = ['img', options.prompt]
  if (options.model) args.push('-m', options.model)
  if (options.referenceImageUrls?.length) args.push('--image_urls', ...options.referenceImageUrls)
  if (options.aspectRatio) args.push('--aspect_ratio', options.aspectRatio)
  if (options.imageSize) args.push('--image_size', options.imageSize)
  const raw = await runChaOffice(args, GENERATE_TIMEOUT_MS, signal)
  const result = parseChaOfficeGeneratedImage(raw)
  // Bare chaoffice file URLs (/api/files/) return 403; swap for a signed direct link with a token
  // so later plain fetch downloads (e.g. insert_web_image) need no auth
  result.url = await chaofficeResolveDownloadUrl(result.url)
  return result
}

/**
 * Swaps a chaoffice file wrapper URL for an anonymously downloadable signed direct link (`chaoffice download`).
 * Non-chaoffice file URLs are returned as-is; on swap failure the URL is also returned as-is
 * (callers handle download failures themselves).
 */
export async function chaofficeResolveDownloadUrl(url: string): Promise<string> {
  if (!url.includes('/api/files/')) return url
  try {
    const raw = asRecord(await runChaOffice(['download', url], SEARCH_TIMEOUT_MS))
    const downloadUrl = asRecord(raw.data).download_url ?? raw.download_url
    return downloadUrl ? String(downloadUrl) : url
  } catch {
    return url
  }
}

// ── Cloud single-slide generation (ChaOffice slide_generate) ─────────

/**
 * Calls the tool_cli HTTP endpoint directly so structured params
 * (deck_context/images) are sent as JSON rather than through the CLI's
 * string-based argument passing.
 */
const GSK_TOOL_CLI_BASE = 'https://www.genspark.ai/api/tool_cli'
const SLIDE_GENERATE_TIMEOUT_MS = 240_000

export interface ChaOfficeSlideGenerateOptions {
  /** Content and layout brief for this page */
  brief: string
  title?: string
  /** Deck-level visual system / typography / palette rules (Style Skill text) */
  styleSkill?: string
  /** Deck topic, page index, total pages, neighboring-page context */
  deckContext?: Record<string, unknown>
  /** HTTPS image candidates for this page */
  images?: { url: string; caption?: string }[]
  width?: number
  height?: number
  /** Slides model tier: ultra = opus-class model, standard (server default) = lighter model */
  tier?: 'standard' | 'ultra'
  signal?: AbortSignal
}

/** Final NDJSON line = the result; heartbeat lines have no status field */
export function parseToolCliNdjson(text: string): Record<string, unknown> {
  const lines = text.trim().split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    if (!line.startsWith('{')) continue
    try {
      const obj: unknown = JSON.parse(line)
      if (obj && typeof obj === 'object' && 'status' in obj) return obj as Record<string, unknown>
    } catch {
      continue
    }
  }
  throw new Error(`No result line in tool_cli response: ${text.slice(0, 300)}`)
}

async function toolCliPost(
  path: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!chaofficeCliApiKey()) throw new Error('Not logged in to ChaOffice (chaoffice login)')
  return withKeyRecovery((key) => toolCliPostOnce(key, path, body, timeoutMs, signal))
}

async function toolCliPostOnce(
  key: string,
  path: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const resp = await fetch(`${GSK_TOOL_CLI_BASE}${path}`, {
      method: 'POST',
      // X-Agent-Type splits ChaOffice usage out of the proxy's "Claw" billing bucket
      headers: {
        'X-Api-Key': key,
        'Content-Type': 'application/json',
        'X-Agent-Type': 'chaoffice',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await resp.text()
    if (!resp.ok) {
      const message = `tool_cli ${path} HTTP ${resp.status}: ${text.slice(0, 200)}`
      throw resp.status === 401 ? new ChaOfficeAuthError(message) : new Error(message)
    }
    const result = parseToolCliNdjson(text)
    if (result.status !== 'ok') {
      throw new Error(`tool_cli ${path} failed: ${result.message ?? result.status}`)
    }
    return result.data
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Generates one editable slide in the cloud (brief → HTML → one-slide PPTX)
 * and returns the downloaded PPTX bytes plus the model that produced it.
 */
export async function chaofficeSlideGenerate(
  options: ChaOfficeSlideGenerateOptions,
): Promise<{ bytes: Uint8Array; model: string }> {
  const { signal } = options
  const body: Record<string, unknown> = { brief: options.brief }
  if (options.title) body.title = options.title
  if (options.styleSkill) body.style_skill = options.styleSkill
  if (options.deckContext) body.deck_context = options.deckContext
  if (options.images?.length) body.images = options.images
  if (options.width) body.width = options.width
  if (options.height) body.height = options.height
  if (options.tier) body.tier = options.tier
  const data = asRecord(
    await toolCliPost('/slide_generate', body, SLIDE_GENERATE_TIMEOUT_MS, signal),
  )
  const pptxUrl = data.pptx_url
  if (!pptxUrl)
    throw new Error(`slide_generate returned no pptx_url: ${JSON.stringify(data).slice(0, 200)}`)
  // The bare file-wrapper URL 403s on plain GET; swap for a signed direct link first
  const dl = asRecord(
    await toolCliPost('/file/download', { file_wrapper_url: pptxUrl }, SEARCH_TIMEOUT_MS, signal),
  )
  const downloadUrl = dl.download_url
  if (!downloadUrl) throw new Error('file/download returned no download_url')
  const resp = await fetch(String(downloadUrl), signal ? { signal } : undefined)
  if (!resp.ok) throw new Error(`PPTX download failed: HTTP ${resp.status}`)
  return { bytes: new Uint8Array(await resp.arrayBuffer()), model: String(data.model ?? '') }
}

// ── File conversion (PDF → DOCX) ────────────────────────────────────

/** Extracts the download link from file_convert's markdown result text (exported for tests) */
export function parseChaOfficeConvertResult(raw: unknown): string {
  const data = asRecord(asRecord(raw).data ?? raw)
  const text = typeof data.result === 'string' ? data.result : ''
  const url = /\((https?:\/\/[^)\s]+)\)/.exec(text)?.[1] ?? /https?:\/\/\S+/.exec(text)?.[0]
  if (!url) {
    throw new Error(`file_convert returned no link: ${JSON.stringify(raw).slice(0, 200)}`)
  }
  return url
}

/**
 * Uploads a local PDF and converts it to DOCX in the cloud (`chaoffice convert`,
 * costs 5 credits); returns the DOCX bytes.
 */
export async function chaofficeConvertPdfToDocx(
  filePath: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const wrapperUrl = await chaofficeUpload(filePath)
  const raw = await runChaOffice(['convert', wrapperUrl], GENERATE_TIMEOUT_MS, signal)
  const link = parseChaOfficeConvertResult(raw)
  const downloadUrl = await chaofficeResolveDownloadUrl(link)
  const resp = await fetch(downloadUrl, signal ? { signal } : undefined)
  if (!resp.ok) throw new Error(`DOCX download failed: HTTP ${resp.status}`)
  return new Uint8Array(await resp.arrayBuffer())
}

// ── Media analysis / transcription ──────────────────────────────────

/** Best-effort text extraction from chaoffice analysis-type command output (shape varies by task, so be lenient; exported for tests) */
export function extractChaOfficeText(raw: unknown): string {
  const data = asRecord(raw).data ?? raw
  if (typeof data === 'string') return data
  if (data && typeof data === 'object') {
    for (const key of [
      'analysis',
      'analysis_result',
      'result',
      'content',
      'text',
      'answer',
      'transcript',
    ]) {
      const v = (data as Record<string, unknown>)[key]
      if (typeof v === 'string' && v.trim()) return v
    }
  }
  return JSON.stringify(data ?? raw)
}

export interface ChaOfficeAnalyzeMediaOptions {
  /** Media URLs or local paths (image/audio/video; the CLI uploads local files automatically) */
  mediaUrls: string[]
  /** Analysis requirements (in English): what info to extract and what it's for */
  requirements: string
}

export async function chaofficeAnalyzeMedia(
  options: ChaOfficeAnalyzeMediaOptions,
  signal?: AbortSignal,
): Promise<string> {
  const args = [
    'media-analyze',
    '--media_urls',
    ...options.mediaUrls,
    '--requirements',
    options.requirements,
  ]
  const raw = await runChaOffice(args, GENERATE_TIMEOUT_MS, signal)
  return extractChaOfficeText(raw)
}

export interface ChaOfficeTranscribeOptions {
  /** Audio URLs or local paths */
  audioUrls: string[]
  /** Prompt (context / proper nouns; can improve recognition quality) */
  prompt?: string
  /** whisper-1 (default, with timestamps) | gemini-3-flash-preview | elevenlabs_scribe_v2 */
  model?: string
}

export async function chaofficeTranscribe(
  options: ChaOfficeTranscribeOptions,
  signal?: AbortSignal,
): Promise<string> {
  const args = ['transcribe', '--audio_urls', ...options.audioUrls]
  if (options.prompt) args.push('--prompt', options.prompt)
  if (options.model) args.push('-m', options.model)
  const raw = await runChaOffice(args, GENERATE_TIMEOUT_MS, signal)
  return extractChaOfficeText(raw)
}

// ── File upload / login ─────────────────────────────────────────────

/** Uploads a local file and returns a file wrapper URL (usable as input to other chaoffice commands) */
export async function chaofficeUpload(filePath: string): Promise<string> {
  const raw = asRecord(await runChaOffice(['upload', filePath], GENERATE_TIMEOUT_MS))
  const dataRec = asRecord(raw.data)
  const url = dataRec.file_wrapper_url ?? raw.url ?? dataRec.url
  if (!url)
    throw new Error(`chaoffice upload did not return a URL: ${JSON.stringify(raw).slice(0, 200)}`)
  return String(url)
}

// ── Past projects (ChaOffice web) ────────────────────────────────────

export interface ChaOfficePastProject {
  projectId: string
  /** raw project type, e.g. 'slides_agent_git' */
  type: string
  title: string
  /** creation time, ISO-like string from the API */
  ctime: string
  /** relative web URL, e.g. '/agents?id=...' — join with https://www.genspark.ai */
  projectUrl: string
}

export interface ChaOfficePastProjectsPage {
  projects: ChaOfficePastProject[]
  total: number
  hasMore: boolean
}

/**
 * Parses `chaoffice projects`. data.projects lacks project_url — it only appears in
 * session_state.past_projects — so take it from there, falling back to
 * deriving it from the project id. (exported for tests)
 */
export function parseChaOfficePastProjects(raw: unknown): ChaOfficePastProjectsPage {
  const rec = asRecord(raw)
  const data = asRecord(rec.data ?? raw)
  const urlById = new Map<string, string>()
  const sessionProjects = asRecord(asRecord(rec.session_state).past_projects).projects
  if (Array.isArray(sessionProjects)) {
    for (const item of sessionProjects) {
      const p = asRecord(item)
      if (p.project_id && typeof p.project_url === 'string' && p.project_url) {
        urlById.set(String(p.project_id), p.project_url)
      }
    }
  }
  const listRaw: unknown[] = Array.isArray(data.projects) ? data.projects : []
  const projects: ChaOfficePastProject[] = []
  for (const item of listRaw) {
    const p = asRecord(item)
    const projectId = String(p.project_id ?? '')
    if (!projectId) continue
    projects.push({
      projectId,
      type: String(p.type ?? ''),
      title: String(p.title ?? ''),
      ctime: String(p.ctime ?? ''),
      projectUrl: urlById.get(projectId) ?? `/agents?id=${projectId}`,
    })
  }
  const total = Number(data.total)
  return {
    projects,
    total: Number.isFinite(total) ? total : projects.length,
    hasMore: data.has_more === true,
  }
}

export interface ChaOfficeListPastProjectsOptions {
  /** 'slides' | 'docs' | 'sheets' | ...; omit for all kinds */
  artifactTypes?: string[]
  /** page size, CLI default 20, max 100 */
  limit?: number
  offset?: number
  signal?: AbortSignal
}

/** Lists the user's own past ChaOffice web projects, newest first (`chaoffice projects`). */
export async function chaofficeListPastProjects(
  options: ChaOfficeListPastProjectsOptions = {},
): Promise<ChaOfficePastProjectsPage> {
  const args = ['projects']
  if (options.artifactTypes?.length) args.push('--artifact_types', ...options.artifactTypes)
  if (options.limit !== undefined) args.push('--limit', String(options.limit))
  if (options.offset) args.push('--offset', String(options.offset))
  // background sync: never the reason a browser window opens
  const raw = await runChaOffice(args, SEARCH_TIMEOUT_MS, options.signal, true)
  return parseChaOfficePastProjects(raw)
}

export interface ChaOfficeLoginInfo {
  email: string
  plan: string
  creditBalance?: number
}

/** Current login info; null when not logged in */
export async function chaofficeLoginInfo(): Promise<ChaOfficeLoginInfo | null> {
  try {
    const raw = await runChaOffice(['login-info'], SEARCH_TIMEOUT_MS, undefined, true)
    const d = asRecord(asRecord(raw).data ?? raw)
    if (!d.email) return null
    const info: ChaOfficeLoginInfo = {
      email: String(d.email),
      plan: String(d.plan ?? d.personal_plan ?? ''),
    }
    const balance = Number(d.credit_balance)
    if (Number.isFinite(balance)) info.creditBalance = balance
    return info
  } catch {
    return null
  }
}
