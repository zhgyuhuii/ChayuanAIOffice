/**
 * Search utilities (main process). Web search: Serper → Tavily → Linkup → SearxNG
 * → DuckDuckGo, with settings-driven provider selection and API keys. Image search:
 * Serper → Bing scrape → Openverse, each tier recorded as a SearchAttempt for the
 * dialog's diagnostics. Runs in the main process (Node fetch) to avoid renderer CORS.
 */

import {
  asRecord,
  isCopyrightHost,
  safeHost,
  type ImageSearchResult,
  type SearchAttempt,
  type WebSearchResult,
} from './shared'
import { bingImageSearch } from './bing'
import { openverseImageSearch } from './openverse'
import { linkupWebSearch } from './linkup'
import { searxngWebSearch } from './searxng'
import { parallelMcpSearch } from './parallel-mcp'

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
const LINKUP_KEY = () => process.env.LINKUP_API_KEY ?? ''
const PARALLEL_KEY = () => process.env.PARALLEL_API_KEY ?? ''

/** API keys resolved from settings (preferred) then env vars (fallback) */
interface SearchKeys {
  serper?: string
  tavily?: string
  linkup?: string
  searxngBaseUrl?: string
  parallelKey?: string
}


/** Parallel's API and free Search MCP return source excerpts, not a synthesized answer. */
async function parallelWebSearch(
  key: string,
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  let data: Record<string, unknown>
  if (key) {
    const resp = await fetchWithTimeout('https://api.parallel.ai/v1/search', {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ search_queries: [query], mode: 'fast' }),
    })
    if (!resp.ok) return []
    data = asRecord(await resp.json())
  } else {
    const mcp = await parallelMcpSearch(query)
    if (!mcp) return []
    data = asRecord(mcp)
  }
  const raw: unknown[] = Array.isArray(data.results) ? data.results : []
  const results: WebSearchResult[] = []
  for (const item of raw.slice(0, maxResults)) {
    const result = asRecord(item)
    if (typeof result.url !== 'string' || !/^https?:\/\//i.test(result.url)) continue
    const excerpts: unknown[] = Array.isArray(result.excerpts) ? result.excerpts : []
    results.push({
      title: typeof result.title === 'string' && result.title ? result.title : result.url,
      url: result.url,
      snippet: excerpts
        .filter((excerpt): excerpt is string => typeof excerpt === 'string')
        .join('\n'),
    })
  }
  return results
}

// ── Web search ──────────────────────────────────────────────────────

/**
 * Model-driven search args arrive unvalidated: clamp the result count to a
 * finite 1..20 and truncate the query so a wild maxResults cannot inflate
 * backend cost/loops and a megabyte query cannot flood request bodies.
 */
function normalizeSearchArgs(
  query: string,
  maxResults: number,
  fallback: number,
): { query: string; max: number } {
  const max = Number.isFinite(maxResults)
    ? Math.min(Math.max(1, Math.floor(maxResults)), 20)
    : fallback
  return { query: typeof query === 'string' ? query.slice(0, 500) : '', max }
}

export async function webSearch(
  query: string,
  maxResults = 6,
  _useChatOffice?: boolean,
  keys?: SearchKeys,
  /** preferred provider id (settings default): tried first, chain still backs it up */
  prefer?: string,
): Promise<{
  results: WebSearchResult[]
  answer?: string
  method: string
  error?: string
}> {
  const { query: q, max } = normalizeSearchArgs(query, maxResults, 6)
  type Tier = {
    id: string
    run: () => Promise<{ results: WebSearchResult[]; answer?: string; method: string } | null>
  }
  const tiers: Tier[] = [
    {
      id: 'serper',
      run: async () => {
        const serperKey = keys?.serper ?? SERPER_KEY()
        if (!serperKey) return null
        try {
          const resp = await fetchWithTimeout('https://google.serper.dev/search', {
            method: 'POST',
            headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: q, num: max, gl: 'us', hl: 'en' }),
          })
          if (resp.ok) {
            const data = asRecord(await resp.json())
            const organic: unknown[] = Array.isArray(data.organic) ? data.organic : []
            const results: WebSearchResult[] = organic.slice(0, max).map((item) => {
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
          /* fall through to the next tier */
        }
        return null
      },
    },
    {
      id: 'tavily',
      run: async () => {
        const tavilyKey = keys?.tavily ?? TAVILY_KEY()
        if (!tavilyKey) return null
        try {
          const resp = await fetchWithTimeout('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: tavilyKey,
              query: q,
              max_results: max,
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
          /* fall through to the next tier */
        }
        return null
      },
    },
    {
      id: 'linkup',
      run: async () => {
        const linkupKey = keys?.linkup ?? LINKUP_KEY()
        if (!linkupKey) return null
        try {
          const results = await linkupWebSearch(q, max, linkupKey)
          if (results.length) return { results, method: 'linkup' }
        } catch {
          /* fall through to the next tier */
        }
        return null
      },
    },
    {
      id: 'searxng',
      run: async () => {
        const searxngBase = keys?.searxngBaseUrl
        if (!searxngBase) return null
        try {
          const results = await searxngWebSearch(q, max, searxngBase)
          if (results.length) return { results, method: 'searxng' }
        } catch {
          /* fall through to the next tier */
        }
        return null
      },
    },
    {
      id: 'parallel',
      // A key uses Parallel's REST API; selecting Parallel with no key opts into
      // its free anonymous Search MCP (15s bounded handshake + tool call).
      run: async () => {
        const parallelKey = (keys?.parallelKey ?? PARALLEL_KEY()).trim()
        if (!parallelKey && prefer !== 'parallel') return null
        try {
          const results = await parallelWebSearch(parallelKey, q, max)
          if (results.length) return { results, method: 'parallel' }
        } catch {
          /* fall through to the next tier */
        }
        return null
      },
    },
    {
      id: 'duckduckgo',
      run: async () => {
        try {
          return { results: await duckWebSearch(q, max), method: 'duckduckgo' }
        } catch (err) {
          duckError = err
        }
        return null
      },
    },
  ]
  // the preferred provider (settings default) gets the first shot; the rest
  // keep their order as the fallback chain
  const ordered = prefer
    ? [...tiers.filter((t) => t.id === prefer), ...tiers.filter((t) => t.id !== prefer)]
    : tiers
  let duckError: unknown = null
  for (const tier of ordered) {
    if (tier.id === 'duckduckgo') {
      // the terminal tier's failure detail rides the error line (historical contract)
      try {
        return { results: await duckWebSearch(q, max), method: 'duckduckgo' }
      } catch (err) {
        duckError = err
      }
      continue
    }
    const r = await tier.run()
    if (r) return r
  }
  return {
    results: [],
    method: 'error',
    error: `duckduckgo: ${String(duckError ?? 'all web search backends failed')}`,
  }
}

// ── Image search ────────────────────────────────────────────────────

/**
 * Image search fallback chain: Serper (key) → Bing scrape (keyless, China-reachable)
 * → Openverse (CC, keyless). Every tier records a SearchAttempt so the caller can
 * diagnose an empty gallery instead of reading it as "no matches".
 */
export async function imageSearch(
  query: string,
  maxResults = 8,
  _useChatOffice?: boolean,
  serperKeyOverride?: string,
  /** 1-based result page; each tier maps it to its own offset (insert-dialog "next batch") */
  page = 1,
  /** run ONLY this tier ('serper' | 'bing' | 'openverse') — the insert dialog's per-platform pick */
  only?: 'serper' | 'bing' | 'openverse',
): Promise<{
  images: ImageSearchResult[]
  method: string
  error?: string
  attempts: SearchAttempt[]
}> {
  const attempts: SearchAttempt[] = []

  const serperTier = async (): Promise<{ images: ImageSearchResult[]; method: string } | null> => {
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
            if (isCopyrightHost(imageUrl)) continue
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
            return { images, method: 'serper' }
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
    return null
  }

  const bingTier = async (): Promise<{ images: ImageSearchResult[]; method: string } | null> => {
    try {
      const images = await bingImageSearch(query, maxResults, page)
      attempts.push({ backend: 'bing', status: 'ok', count: images.length })
      return { images, method: 'bing' }
    } catch (err) {
      attempts.push({ backend: 'bing', status: 'error', detail: String(err) })
    }
    return null
  }

  const openverseTier = async (): Promise<{
    images: ImageSearchResult[]
    method: string
  } | null> => {
    try {
      const images = await openverseImageSearch(query, maxResults, page)
      attempts.push({ backend: 'openverse', status: 'ok', count: images.length })
      return { images, method: 'openverse' }
    } catch (err) {
      attempts.push({ backend: 'openverse', status: 'error', detail: String(err) })
    }
    return null
  }

  if (only === 'serper' || only === 'bing' || only === 'openverse') {
    const tier = only === 'serper' ? serperTier : only === 'bing' ? bingTier : openverseTier
    const r = await tier()
    if (r) return { images: r.images, method: r.method, attempts }
    return { images: [], method: 'error', error: `${only} image search failed`, attempts }
  }

  const chained = (await serperTier()) ?? (await bingTier()) ?? (await openverseTier())
  if (chained) return { images: chained.images, method: chained.method, attempts }
  return { images: [], method: 'error', error: 'all image backends failed', attempts }
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
    throw new Error(
      `Unsupported content type ${contentType.split(';')[0]} — only web pages can be read`,
    )
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
