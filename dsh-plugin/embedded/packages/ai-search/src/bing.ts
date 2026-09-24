/**
 * Bing Images scraper — the China-reachable keyless backend in the image
 * fallback chain (chatoffice → Serper → Bing → Openverse). Scraping is
 * inherently brittle: every parse failure throws so the chain moves on to
 * Openverse instead of surfacing an empty gallery.
 */

import { isCopyrightHost, safeHost, type ImageSearchResult } from './shared'

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
}

/** decode the HTML entities Bing escapes its `m` JSON attribute with */
function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * Parse a Bing Images results page. Thumbnails/meta live in `m="{...}"`
 * attributes on `a.iusc` tiles: murl = full image URL, turl = thumbnail,
 * purl = source page, t = title. Exported for tests.
 */
export function parseBingImagesHtml(html: string, maxResults: number): ImageSearchResult[] {
  const out: ImageSearchResult[] = []
  const re = /m="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && out.length < maxResults) {
    let meta: Record<string, unknown>
    try {
      meta = JSON.parse(decodeEntities(m[1]!)) as Record<string, unknown>
    } catch {
      continue
    }
    const imageUrl = typeof meta.murl === 'string' ? meta.murl : ''
    if (!imageUrl || isCopyrightHost(imageUrl)) continue
    const title = typeof meta.t === 'string' ? meta.t : ''
    const entry: ImageSearchResult = {
      title,
      imageUrl,
      sourceUrl: typeof meta.purl === 'string' ? meta.purl : '',
      source: safeHost(meta.purl) || 'bing',
    }
    if (typeof meta.turl === 'string' && meta.turl) {
      ;(entry as { thumbnail?: string }).thumbnail = meta.turl
    }
    out.push(entry)
  }
  return out
}

export async function bingImageSearch(
  query: string,
  maxResults: number,
  /** 1-based page; Bing exposes result offset via the `first` URL param */
  page = 1,
): Promise<ImageSearchResult[]> {
  const url =
    `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2` +
    (page > 1 ? `&first=${(page - 1) * maxResults + 1}` : '')
  let resp: Response
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 8000)
    try {
      resp = await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal })
    } finally {
      clearTimeout(t)
    }
  } catch (cause) {
    throw new Error(`bing: ${String(cause)}`, { cause })
  }
  if (!resp.ok) throw new Error(`bing: http ${resp.status}`)
  const html = await resp.text()
  const images = parseBingImagesHtml(html, maxResults)
  if (!images.length) throw new Error('bing: no results parsed')
  return images
}
