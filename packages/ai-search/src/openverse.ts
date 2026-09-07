/**
 * Openverse (CC-licensed images) — the legally clean keyless last resort of
 * the image fallback chain. Anonymous access is rate-limited, which is fine
 * for a fallback tier; failures throw so the caller can report the attempt.
 */

import { asRecord, type ImageSearchResult } from './shared'

export async function openverseImageSearch(
  query: string,
  maxResults: number,
  /** 1-based page (native Openverse pagination param) */
  page = 1,
): Promise<ImageSearchResult[]> {
  const url =
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}` +
    `&page_size=${Math.min(maxResults, 20)}&mature=false` +
    (page > 1 ? `&page=${page}` : '')
  let resp: Response
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 10000)
    try {
      resp = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
    } finally {
      clearTimeout(t)
    }
  } catch (cause) {
    throw new Error(`openverse: ${String(cause)}`, { cause })
  }
  if (resp.status === 429) throw new Error('openverse: rate limited')
  if (!resp.ok) throw new Error(`openverse: http ${resp.status}`)
  const data = asRecord(await resp.json())
  const raw: unknown[] = Array.isArray(data.results) ? data.results : []
  const images: ImageSearchResult[] = []
  for (const item of raw) {
    const img = asRecord(item)
    const imageUrl = String(img.url ?? '')
    if (!imageUrl) continue
    const creator = typeof img.creator === 'string' ? img.creator : ''
    const license = typeof img.license === 'string' ? img.license.toUpperCase() : 'CC'
    const entry: ImageSearchResult = {
      title: typeof img.title === 'string' ? img.title : '',
      imageUrl,
      sourceUrl: String(img.foreign_landing_url ?? ''),
      source: 'openverse',
    }
    if (typeof img.thumbnail === 'string' && img.thumbnail) {
      ;(entry as { thumbnail?: string }).thumbnail = img.thumbnail
    }
    if (creator) {
      ;(entry as { attribution?: string }).attribution = `${creator} · CC ${license}`
    }
    if (typeof img.width === 'number') entry.width = img.width
    if (typeof img.height === 'number') entry.height = img.height
    images.push(entry)
    if (images.length >= maxResults) break
  }
  if (!images.length) throw new Error('openverse: no results')
  return images
}
