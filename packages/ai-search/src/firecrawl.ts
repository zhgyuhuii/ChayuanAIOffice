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

/**
 * Firecrawl's /v2/search groups results by source; the web list is the
 * snippet-bearing one (news carries `snippet` instead of `description` and
 * serves as the fallback). No scrapeOptions: scraping costs extra credits and
 * the plain description is exactly the snippet shape we need.
 * (#1944-era R18G 挂账销账: 移植上游实现至本地函数 API。)
 */
export async function firecrawlWebSearch(
  key: string,
  query: string,
  maxResults: number,
): Promise<{ results: WebSearchResult[]; method: string } | null> {
  if (!key) return null
  try {
    return await fetchWithTimeout(
      'https://api.firecrawl.dev/v2/search',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: maxResults }),
      },
      async (resp) => {
        if (!resp.ok) return null
        const data = asRecord(asRecord(await resp.json()).data)
        // an empty web list must fall through to news, not read as "no results"
        const web = Array.isArray(data.web) ? data.web : []
        const news = Array.isArray(data.news) ? data.news : []
        const raw: unknown[] = web.length > 0 ? web : news
        const results: WebSearchResult[] = []
        for (const item of raw) {
          if (results.length >= maxResults) break
          const o = asRecord(item)
          const url = typeof o.url === 'string' ? o.url : ''
          if (!/^https?:\/\//i.test(url)) continue
          results.push({
            title: String(o.title ?? url),
            url,
            snippet: String(o.description ?? o.snippet ?? ''),
          })
        }
        return results.length ? { results, method: 'firecrawl' } : null
      },
    )
  } catch {
    return null
  }
}
