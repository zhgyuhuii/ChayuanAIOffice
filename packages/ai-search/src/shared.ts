/** Search result types and shared constants (used by both the index and chatoffice backends) */

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

export interface ImageSearchResult {
  title: string
  imageUrl: string
  sourceUrl: string
  source: string
  /** hotlinkable preview URL when the backend offers one distinct from imageUrl */
  thumbnail?: string
  /** attribution string (creator · license) when the backend provides one */
  attribution?: string
  width?: number
  height?: number
}

/** one tier of the image-search fallback chain, for the dialog's diagnostics */
export interface SearchAttempt {
  backend: 'serper' | 'tavily' | 'linkup' | 'searxng' | 'duckduckgo' | 'bing' | 'openverse'
  status: 'skipped' | 'ok' | 'error'
  /** skip reason (not configured / turned off) or the error message */
  detail?: string
  /** image count on success */
  count?: number
}

// Stock/preview hosts skipped during image search (substring-matched against the
// image URL). Beyond the classic international agencies, the major watermark-
// preview stock sites are blocked: their CDN previews carry visible watermarks
// that would land straight onto generated slides.
export const COPYRIGHT_HOSTS = [
  // international agencies
  'gettyimages',
  'istockphoto',
  'shutterstock',
  'corbis',
  '123rf',
  'dreamstime',
  'alamy',
  'depositphotos',
  'stock.adobe',
  'bigstockphoto',
  'agefotostock',
  'colourbox',
  'canstockphoto',
  'freepik',
  // China stock/preview sites (视觉中国/图虫/千图/摄图/包图/昵图/我图/千库/觅元素/稿定)
  'vcg.com',
  'vcg.cn',
  'tuchong',
  '58pic',
  '699pic',
  'ibaotu',
  'nipic',
  'photophoto',
  '588ku',
  '51yuansu',
  'gaoding',
]

/**
 * True when an image URL lives on a stock-photo host. Scoped to the hostname
 * (not a full-URL substring): a blog image whose *path* merely mentions a
 * stock site ("…/shutterstock-review.png") is kept, while host matching keeps
 * the previous behavior (gettyimages.com and its subdomains stay blocked).
 */
const SECOND_LEVEL_SUFFIXES = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'])

/// 'shutterstock' for shutterstock.com, sub.shutterstock.co.uk, ...
function registrableLabel(labels: string[]): string | undefined {
  if (labels.length < 2) return undefined
  const tld = labels[labels.length - 1]!
  const second = labels[labels.length - 2]!
  if (labels.length >= 3 && tld.length === 2 && SECOND_LEVEL_SUFFIXES.has(second))
    return labels[labels.length - 3]
  return second
}

export function isCopyrightHost(imageUrl: string): boolean {
  const host = safeHost(imageUrl).toLowerCase()
  if (!host) return false
  const labels = host.split('.')
  return COPYRIGHT_HOSTS.some((entry) => {
    const d = entry.toLowerCase()
    // Exact host or subdomain suffix match.
    if (host === d || host.endsWith('.' + d)) return true
    // Bare stock names match the registrable domain label, so
    // myshutterstock.com stays allowed while sub.shutterstock.com stays blocked.
    return registrableLabel(labels) === d
  })
}

export function safeHost(url: unknown): string {
  try {
    return new URL(String(url)).hostname
  } catch {
    return ''
  }
}

/**
 * View untrusted JSON as a string-keyed record so properties can be probed
 * without `any`; non-object inputs read as an empty record.
 */
export function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
}

/** First element when the value is an array, otherwise undefined (loose JSON probing). */
export function firstItem(v: unknown): unknown {
  return Array.isArray(v) ? (v as unknown[])[0] : undefined
}

let explicitProxyUrl = ''

/**
 * Proxy resolved by the apps' proxy bootstraps (env vars, else the system
 * proxy via session.resolveProxy); consumed by chatofficeChildEnv() and the login
 * flow's proxy fallback.
 */
export function setChatOfficeProxyUrl(url: string): void {
  explicitProxyUrl = url
}

export function chatofficeProxyUrl(): string {
  return explicitProxyUrl
}
