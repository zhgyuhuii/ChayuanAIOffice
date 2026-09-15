/**
 * Search utilities (main process). Web search: chatoffice (ChatOffice CLI)
 * first, then Serper Google API, then Tavily, with DuckDuckGo as the keyless
 * last resort. Image search: chatoffice → Serper → Bing scrape → Openverse, each
 * tier recorded as a SearchAttempt for the dialog's diagnostics. Runs in the main
 * process (Node fetch / child process) to avoid renderer CORS; the Serper key
 * reuses SERPER_API_KEY (settings-first via the caller's override), the Tavily
 * key reuses TAVILY_API_KEY.
 * For chatoffice auth see ./chatoffice.ts (`chatoffice login` or CHATOFFICE_API_KEY).
 */

import {
  COPYRIGHT_HOSTS,
  asRecord,
  safeHost,
  type ImageSearchResult,
  type SearchAttempt,
  type WebSearchResult,
} from './shared'
import { chatofficeImageSearch, chatofficeWebSearch, hasChatOfficeAuth } from './chatoffice'
import { bingImageSearch } from './bing'
import { openverseImageSearch } from './openverse'

export type { ImageSearchResult, SearchAttempt, WebSearchResult } from './shared'
export {
  searchStockImages,
  StockSearchError,
  type StockSource,
  type StockImageResult,
} from './stock'
export * from './chatoffice'
export * from './chatoffice-auth'

const SERPER_KEY = () => process.env.SERPER_API_KEY ?? ''
const TAVILY_KEY = () => process.env.TAVILY_API_KEY ?? ''

// ── Web search ──────────────────────────────────────────────────────

export async function webSearch(
  query: string,
  maxResults = 6,
  useChatOffice = true,
): Promise<{
  results: WebSearchResult[]
  answer?: string
  method: string
  error?: string
}> {
  // useChatOffice=false: the user turned ChatOffice cloud tools off — skip straight to the free backends
  if (useChatOffice && hasChatOfficeAuth()) {
    try {
      const r = await chatofficeWebSearch(query, maxResults)
      if (r.results.length) return { ...r, method: 'chatoffice' }
    } catch {
      /* fall back to Serper/Tavily/DuckDuckGo */
    }
  }
  const key = SERPER_KEY()
  if (key) {
    try {
      const resp = await fetchWithTimeout('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: maxResults, gl: 'us', hl: 'en' }),
      })
      if (resp.ok) {
        const data = asRecord(await resp.json())
        const organic: unknown[] = Array.isArray(data.organic) ? data.organic : []
        const results: WebSearchResult[] = organic.slice(0, maxResults).map((item) => {
          const o = asRecord(item)
          return {
            title: String(o.title ?? ''),
            url: String(o.link ?? ''),
            snippet: String(o.snippet ?? ''),
          }
        })
        const answerBox = asRecord(data.answerBox)
        const answerRaw =
          answerBox.answer || answerBox.snippet || asRecord(data.knowledgeGraph).description
        const answer = typeof answerRaw === 'string' && answerRaw ? answerRaw : undefined
        if (results.length) {
          return answer !== undefined
            ? { results, answer, method: 'serper' }
            : { results, method: 'serper' }
        }
      }
    } catch {
      /* fall back to Tavily/DuckDuckGo */
    }
  }
  const tavilyKey = TAVILY_KEY()
  if (tavilyKey) {
    try {
      const resp = await fetchWithTimeout('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query,
          max_results: maxResults,
          include_answer: true,
        }),
      })
      if (resp.ok) {
        const data = asRecord(await resp.json())
        const raw: unknown[] = Array.isArray(data.results) ? data.results : []
        const results: WebSearchResult[] = raw.slice(0, maxResults).map((item) => {
          const o = asRecord(item)
          return {
            title: String(o.title ?? ''),
            url: String(o.url ?? ''),
            snippet: String(o.content ?? ''),
          }
        })
        const answerRaw = data.answer
        const answer = typeof answerRaw === 'string' && answerRaw ? answerRaw : undefined
        if (results.length) {
          return answer !== undefined
            ? { results, answer, method: 'tavily' }
            : { results, method: 'tavily' }
        }
      }
    } catch {
      /* fall back to DuckDuckGo */
    }
  }
  try {
    return { results: await duckWebSearch(query, maxResults), method: 'duckduckgo' }
  } catch (err) {
    // an unreachable backend must not read as an empty result set
    return { results: [], method: 'error', error: `duckduckgo: ${String(err)}` }
  }
}

// ── Image search ────────────────────────────────────────────────────

/**
 * Image search fallback chain: chatoffice (login) → Serper (key) →
 * Bing scrape (keyless, China-reachable) → Openverse (CC, keyless). Every
 * tier records a SearchAttempt so the caller can diagnose an empty gallery
 * instead of reading it as "no matches".
 */
export async function imageSearch(
  query: string,
  maxResults = 8,
  useChatOffice = true,
  serperKeyOverride?: string,
  /** 1-based result page; each tier maps it to its own offset (insert-dialog "next batch") */
  page = 1,
): Promise<{
  images: ImageSearchResult[]
  method: string
  error?: string
  attempts: SearchAttempt[]
}> {
  const attempts: SearchAttempt[] = []
  if (useChatOffice && hasChatOfficeAuth()) {
    try {
      const images = await chatofficeImageSearch(query, maxResults, page)
      if (images.length) {
        attempts.push({ backend: 'chatoffice', status: 'ok', count: images.length })
        return { images, method: 'chatoffice', attempts }
      }
      attempts.push({ backend: 'chatoffice', status: 'error', detail: '0 results' })
    } catch (err) {
      attempts.push({ backend: 'chatoffice', status: 'error', detail: String(err) })
    }
  } else {
    attempts.push({
      backend: 'chatoffice',
      status: 'skipped',
      detail: useChatOffice ? 'not signed in' : 'cloud tools off',
    })
  }

  const key = serperKeyOverride ?? SERPER_KEY()
  if (key) {
    try {
      const resp = await fetchWithTimeout('https://google.serper.dev/images', {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: query,
          num: Math.min(maxResults, 20),
          gl: 'us',
          hl: 'en',
          ...(page > 1 ? { page } : {}),
        }),
      })
      if (resp.ok) {
        const data = asRecord(await resp.json())
        const raw: unknown[] = Array.isArray(data.images) ? data.images : []
        const images: ImageSearchResult[] = []
        for (const item of raw) {
          const img = asRecord(item)
          const imageUrl = String(img.imageUrl ?? img.original ?? '')
          if (!imageUrl) continue
          if (COPYRIGHT_HOSTS.some((d) => imageUrl.toLowerCase().includes(d))) continue
          const entry: ImageSearchResult = {
            title: String(img.title ?? ''),
            imageUrl,
            sourceUrl: String(img.link ?? ''),
            source: String(img.source ?? safeHost(img.link)),
          }
          if (typeof img.thumbnailUrl === 'string' && img.thumbnailUrl) {
            entry.thumbnail = img.thumbnailUrl
          }
          if (typeof img.imageWidth === 'number') entry.width = img.imageWidth
          if (typeof img.imageHeight === 'number') entry.height = img.imageHeight
          images.push(entry)
          if (images.length >= maxResults) break
        }
        if (images.length) {
          attempts.push({ backend: 'serper', status: 'ok', count: images.length })
          return { images, method: 'serper', attempts }
        }
        attempts.push({ backend: 'serper', status: 'error', detail: '0 results' })
      } else {
        attempts.push({ backend: 'serper', status: 'error', detail: `http ${resp.status}` })
      }
    } catch (err) {
      attempts.push({ backend: 'serper', status: 'error', detail: String(err) })
    }
  } else {
    attempts.push({ backend: 'serper', status: 'skipped', detail: 'no API key' })
  }

  try {
    const images = await bingImageSearch(query, maxResults, page)
    attempts.push({ backend: 'bing', status: 'ok', count: images.length })
    return { images, method: 'bing', attempts }
  } catch (err) {
    attempts.push({ backend: 'bing', status: 'error', detail: String(err) })
  }

  try {
    const images = await openverseImageSearch(query, maxResults, page)
    attempts.push({ backend: 'openverse', status: 'ok', count: images.length })
    return { images, method: 'openverse', attempts }
  } catch (err) {
    attempts.push({ backend: 'openverse', status: 'error', detail: String(err) })
    return { images: [], method: 'error', error: 'all image backends failed', attempts }
  }
}

// ── DuckDuckGo fallback (no key / quota exhausted) ──────────────────
// These throw on network/HTTP failure so the caller can distinguish
// "backend unreachable" from a genuinely empty result set.

// short timeout: an unreachable backend should fail fast so the next one gets its turn
const FALLBACK_TIMEOUT_MS = 5000

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
}

async function duckWebSearch(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const resp = await fetchWithTimeout(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { headers: BROWSER_HEADERS, timeoutMs: FALLBACK_TIMEOUT_MS },
  )
  if (!resp.ok) throw new Error(`http ${resp.status}`)
  const html = await resp.text()
  const results: WebSearchResult[] = []
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && results.length < maxResults) {
    const url = decodeDuckUrl(m[1]!)
    const title = stripTags(m[2]!)
    if (url && title) results.push({ title, url, snippet: '' })
  }
  return results
}

// ── utils ───────────────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), init.timeoutMs ?? 15000)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(t)
  }
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

function decodeDuckUrl(href: string): string {
  // DuckDuckGo result links are often /l/?uddg=<encoded>
  const m = /[?&]uddg=([^&]+)/.exec(href)
  if (m) return decodeURIComponent(m[1]!)
  return href.startsWith('http') ? href : ''
}

// ── URL reading (read_url tool) ──

const READ_URL_MAX_BYTES = 300_000
const READ_URL_TEXT_MAX = 8_000

/** Minimal HTML→text: strip scripts/styles/tags, decode entities, keep line structure. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[^>]*-->/g, ' ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n')
    .trim()
}

/**
 * Fetch a public page and return its title + extracted body text — the
 * read_url tool's engine ("make this link into a deck" material chain).
 * Rejects non-HTML content and caps both fetch size and output length.
 */
export async function readUrlContent(
  rawUrl: string,
): Promise<{ url: string; title: string; text: string; truncated: boolean }> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http(s) URLs are supported, got ${url.protocol}`)
  }
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChaAIBot/1.0)' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType && !/text\/html|text\/plain|xhtml/i.test(contentType)) {
    throw new Error(`Unsupported content type ${contentType.split(';')[0]} — only web pages can be read`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const truncatedFetch = buf.length > READ_URL_MAX_BYTES
  const html = buf.subarray(0, READ_URL_MAX_BYTES).toString('utf-8')
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? ''
  const text = htmlToText(html)
  const body = text.length > READ_URL_TEXT_MAX ? text.slice(0, READ_URL_TEXT_MAX) : text
  return {
    url: url.toString(),
    title: title.slice(0, 200),
    text: body,
    truncated: truncatedFetch || text.length > READ_URL_TEXT_MAX,
  }
}
export * from './media-tools'
export * from './search-tools'
