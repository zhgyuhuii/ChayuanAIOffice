import { asRecord, type WebSearchResult } from './shared'

/** same bounded fetch the other key backends use (linkup.ts keeps its own copy) */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  handle: (resp: Response) => Promise<{ results: WebSearchResult[]; method: string } | null>,
): Promise<{ results: WebSearchResult[]; method: string } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal })
    return await handle(resp)
  } finally {
    clearTimeout(timer)
  }
}

/** The keyless endpoint identifies the calling app by this header instead of a key. */
const KEENABLE_TITLE = 'ChaAI Office'
const KEENABLE_SNIPPET_CHARS = 500

/**
 * Keenable's search API: with a key /v1/search, without one the free
 * /v1/search/public (rate-limited per IP). The keyless call runs only when
 * Keenable is the selected provider, so the default chain never reaches it.
 * `snippet` carries raw page text (`description` is empty), capped like Exa's
 * text pass. Results only, no synthesized answer. (adapted: 上游 #2124 移植
 * 至本地函数 API，函数形状随 exa.ts/firecrawl.ts 惯例。)
 */
export async function keenableWebSearch(
  key: string,
  query: string,
  maxResults: number,
  keyless: boolean,
): Promise<{ results: WebSearchResult[]; method: string } | null> {
  key = key.trim()
  if (!key && !keyless) return null
  try {
    return await fetchWithTimeout(
      key ? 'https://api.keenable.ai/v1/search' : 'https://api.keenable.ai/v1/search/public',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Keenable-Title': KEENABLE_TITLE,
          ...(key ? { 'X-API-Key': key } : {}),
        },
        body: JSON.stringify({ query, max_results: maxResults }),
      },
      async (resp) => {
        if (!resp.ok) return null
        const data = asRecord(await resp.json())
        const raw: unknown[] = Array.isArray(data.results) ? data.results : []
        const results: WebSearchResult[] = []
        for (const item of raw) {
          if (results.length >= maxResults) break
          const o = asRecord(item)
          const url = typeof o.url === 'string' ? o.url : ''
          if (!/^https?:\/\//i.test(url)) continue
          const text = String(o.snippet || o.description || '').trim()
          results.push({
            title: typeof o.title === 'string' && o.title ? o.title : url,
            url,
            snippet: text.slice(0, KEENABLE_SNIPPET_CHARS),
          })
        }
        return results.length ? { results, method: 'keenable' } : null
      },
    )
  } catch {
    return null
  }
}
