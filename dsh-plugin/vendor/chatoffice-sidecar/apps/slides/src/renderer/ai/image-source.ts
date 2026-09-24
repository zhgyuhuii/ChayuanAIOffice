/**
 * Deck imagery source resolution + slot allocation — the pure core of the
 * generate_deck imagery stage (docs/image-source-plan.md #2/#3), unit-testable
 * without a renderer.
 *
 * Sources:
 *   web   — keyword → web image search (existing channel)
 *   model — keyword → AI image generation (BYOK image model, URL result)
 *   local — data-URI pool from the user's folder, allocated in order
 *   svg   — keywords stay briefs; the page writer draws them inline
 * 'auto' resolves model→web before allocation; an explicit 'local' pref with
 * an empty pool falls back to the auto chain (nothing was picked, nothing to
 * fail). Any source's per-slot failure/zero-results degrades THAT slot to a
 * brief — never a silent switch to another possibly-paid source.
 */
import type { AiImageSource } from '@chatoffice/ai-provider'

export type DeckImageSource = 'web' | 'model' | 'local' | 'svg'

export interface ResolvedDeckSource {
  source: DeckImageSource
  /** set when a 'local' pref found an empty pool and the auto chain took over */
  emptyPoolNote?: boolean
}

export function resolveDeckImageSource(
  pref: AiImageSource,
  hasImageModel: boolean,
  poolCount: number,
): ResolvedDeckSource {
  const auto = (): DeckImageSource => (hasImageModel ? 'model' : 'web')
  if (pref === 'auto') return { source: auto() }
  if (pref === 'local' && poolCount === 0) return { source: auto(), emptyPoolNote: true }
  return { source: pref }
}

export interface ImagerySlot {
  /** sourced image URLs/data-URIs for this page (explicit ones kept as-is) */
  urls: string[]
  /** keywords whose sourcing failed (all of them for 'svg') — drawn inline by the page writer */
  briefs: string[]
}

const isResolvedUrl = (s: string) => /^(https?:\/\/|data:image\/)/i.test(s)

/**
 * Allocate imagery for every page. `candidates` maps a normalized keyword to
 * its sourced URLs (search results / generations / pool items). Allocation
 * skips URLs already used by earlier pages (cross-page dedup) and reuses a
 * keyword's last candidate when all are taken (an image beats no image).
 * Keywords with no candidates become briefs. Returns slots aligned with the
 * input pages array; explicit http(s)/data URLs pass through untouched.
 */
export function allocateImagery(
  pages: Array<Record<string, unknown>>,
  source: DeckImageSource,
  candidates: Map<string, string[]>,
): ImagerySlot[] {
  const normKw = (s: string) => s.toLowerCase().replace(/\s+/g, ' ')
  const used = new Set<string>()
  for (const p of pages) {
    for (const q of Array.isArray(p.image_queries) ? (p.image_queries as unknown[]) : []) {
      const s = String(q).trim()
      if (isResolvedUrl(s)) used.add(s)
    }
  }
  return pages.map((p) => {
    const queries = Array.isArray(p.image_queries) ? (p.image_queries as unknown[]) : []
    const urls: string[] = []
    const briefs: string[] = []
    for (const q of queries) {
      const s = String(q).trim()
      if (!s) continue
      if (isResolvedUrl(s)) {
        urls.push(s)
        continue
      }
      if (source === 'svg') {
        briefs.push(s)
        continue
      }
      const list = candidates.get(normKw(s)) ?? []
      const pick = list.find((u) => !used.has(u)) ?? list[0]
      if (pick) {
        used.add(pick)
        urls.push(pick)
      } else {
        briefs.push(s)
      }
    }
    return { urls, briefs }
  })
}
