/** Stock-photo library search (Pexels / Pixabay) — the desktop-own harvest.
 *  Pure fetch callers: the shared ai-host IPC passes the user's API key in
 *  (resolved main-side from ai-settings; never shipped to the renderer). */

export type StockSource = 'pexels' | 'pixabay'

export interface StockImageResult {
  /** preview thumbnail URL (hotlinked per provider terms) */
  readonly thumbnail: string
  /** full-size image URL */
  readonly full: string
  readonly width: number
  readonly height: number
  /** photographer / attribution string when the provider gives one */
  readonly attribution?: string
  readonly source: StockSource
}

export class StockSearchError extends Error {
  constructor(
    message: string,
    readonly code: 'no-key' | 'quota' | 'network' = 'network',
  ) {
    super(message)
  }
}

export async function searchStockImages(
  source: StockSource,
  apiKey: string,
  query: string,
  maxResults = 12,
): Promise<StockImageResult[]> {
  if (!apiKey) throw new StockSearchError(`${source} API key is not configured.`, 'no-key')
  if (source === 'pexels') return searchPexels(apiKey, query, maxResults)
  return searchPixabay(apiKey, query, maxResults)
}

/** https://www.pexels.com/api/documentation/#photos-search */
async function searchPexels(
  apiKey: string,
  query: string,
  maxResults: number,
): Promise<StockImageResult[]> {
  const url =
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}` +
    `&per_page=${Math.min(maxResults, 30)}`
  let resp: Response
  try {
    resp = await fetch(url, { headers: { Authorization: apiKey } })
  } catch (cause) {
    throw new StockSearchError(`Pexels request failed: ${String(cause)}`, 'network')
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new StockSearchError('Pexels rejected the API key.', 'no-key')
  }
  if (resp.status === 429) throw new StockSearchError('Pexels quota exceeded.', 'quota')
  if (!resp.ok) throw new StockSearchError(`Pexels HTTP ${resp.status}.`, 'network')
  const data = (await resp.json()) as {
    photos?: {
      src?: { medium?: string; large2x?: string; large?: string; original?: string }
      width?: number
      height?: number
      photographer?: string
    }[]
  }
  return (data.photos ?? [])
    .map((photo) => ({
      thumbnail: photo.src?.medium ?? photo.src?.large ?? '',
      full: photo.src?.large2x ?? photo.src?.large ?? photo.src?.original ?? '',
      width: photo.width ?? 0,
      height: photo.height ?? 0,
      attribution: photo.photographer ? `Pexels · ${photo.photographer}` : 'Pexels',
      source: 'pexels' as const,
    }))
    .filter((item) => item.thumbnail !== '' && item.full !== '')
}

/** https://pixabay.com/api/docs/ */
async function searchPixabay(
  apiKey: string,
  query: string,
  maxResults: number,
): Promise<StockImageResult[]> {
  const url =
    `https://pixabay.com/api/?key=${encodeURIComponent(apiKey)}` +
    `&q=${encodeURIComponent(query)}&per_page=${Math.min(maxResults, 30)}&safesearch=true`
  let resp: Response
  try {
    resp = await fetch(url)
  } catch (cause) {
    throw new StockSearchError(`Pixabay request failed: ${String(cause)}`, 'network')
  }
  if (resp.status === 401) throw new StockSearchError('Pixabay rejected the API key.', 'no-key')
  if (resp.status === 429) throw new StockSearchError('Pixabay quota exceeded.', 'quota')
  if (!resp.ok) throw new StockSearchError(`Pixabay HTTP ${resp.status}.`, 'network')
  const data = (await resp.json()) as {
    hits?: {
      webformatURL?: string
      largeImageURL?: string
      imageWidth?: number
      imageHeight?: number
      user?: string
    }[]
  }
  return (data.hits ?? [])
    .map((hit) => ({
      thumbnail: hit.webformatURL ?? '',
      full: hit.largeImageURL ?? hit.webformatURL ?? '',
      width: hit.imageWidth ?? 0,
      height: hit.imageHeight ?? 0,
      attribution: hit.user ? `Pixabay · ${hit.user}` : 'Pixabay',
      source: 'pixabay' as const,
    }))
    .filter((item) => item.thumbnail !== '' && item.full !== '')
}
