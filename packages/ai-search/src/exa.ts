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
 * Exa's AI search (api.exa.ai/search): results carry the page contents we ask
 * for, so a capped text pass (not the default full text) serves as the
 * snippet. No synthesized answer on this endpoint — results only.
 * (#1944-era R18G 挂账销账: 移植上游实现至本地函数 API。)
 */
export async function exaWebSearch(
  key: string,
  query: string,
  maxResults: number,
): Promise<{ results: WebSearchResult[]; method: string } | null> {
  if (!key) return null
  try {
    return await fetchWithTimeout(
      'https://api.exa.ai/search',
      {
        method: 'POST',
        headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          numResults: maxResults,
          contents: { text: { maxCharacters: 500 } },
        }),
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
          const text = o.text
          const summary = o.summary
          results.push({
            title: String(o.title ?? url),
            url,
            snippet:
              typeof text === 'string' && text ? text : typeof summary === 'string' ? summary : '',
          })
        }
        return results.length ? { results, method: 'exa' } : null
      },
    )
  } catch {
    return null
  }
}
