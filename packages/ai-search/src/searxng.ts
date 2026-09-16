/**
 * SearxNG web search (self-hosted meta-search engine). GETs {baseUrl}/search?format=json.
 * Throws on any failure so the fallback chain can move on.
 */

import { asRecord, type WebSearchResult } from './shared'

const SEARXNG_TIMEOUT_MS = 10000

export async function searxngWebSearch(
  query: string,
  maxResults: number,
  baseUrl: string,
): Promise<WebSearchResult[]> {
  const normalized = baseUrl.replace(/\/+$/, '')
  const url = `${normalized}/search?q=${encodeURIComponent(query)}&format=json`
  const resp = await fetchWithTimeout(url, {
    headers: { Accept: 'application/json' },
  })
  if (!resp.ok) throw new Error(`http ${resp.status}`)
  const data = asRecord(await resp.json())
  const raw: unknown[] = Array.isArray(data.results) ? data.results : []
  const results: WebSearchResult[] = []
  for (const item of raw) {
    if (results.length >= maxResults) break
    const o = asRecord(item)
    const link = String(o.url ?? '')
    const title = String(o.title ?? '')
    if (!link || !title) continue
    results.push({ title, url: link, snippet: String(o.content ?? '') })
  }
  if (!results.length) throw new Error('0 results')
  return results
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), init.timeoutMs ?? SEARXNG_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(t)
  }
}
