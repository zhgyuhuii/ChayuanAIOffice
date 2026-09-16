/**
 * Linkup web search (BYOK). POSTs to https://api.linkup.so/v1/search.
 * Throws on any failure so the fallback chain can move on.
 */

import { asRecord, type WebSearchResult } from './shared'

const LINKUP_TIMEOUT_MS = 10000

export async function linkupWebSearch(
  query: string,
  maxResults: number,
  apiKey: string,
): Promise<WebSearchResult[]> {
  const resp = await fetchWithTimeout('https://api.linkup.so/v1/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, depth: 'standard', output_type: 'searchResults' }),
  })
  if (!resp.ok) throw new Error(`http ${resp.status}`)
  const data = asRecord(await resp.json())
  const raw: unknown[] = Array.isArray(data.results) ? data.results : []
  const results: WebSearchResult[] = []
  for (const item of raw) {
    if (results.length >= maxResults) break
    const o = asRecord(item)
    const type = String(o.type ?? '')
    if (type && type !== 'searchResult') continue
    const url = String(o.url ?? '')
    const title = String(o.title ?? '')
    if (!url || !title) continue
    results.push({ title, url, snippet: String(o.content ?? '') })
  }
  if (!results.length) throw new Error('0 results')
  return results
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), init.timeoutMs ?? LINKUP_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(t)
  }
}
