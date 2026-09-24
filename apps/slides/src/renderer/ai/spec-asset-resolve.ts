/**
 * Deck brand assets → page spec resolution. The local page writer references
 * pre-registered assets by handle (`{"type":"image","asset":"deck:1"}`) so the
 * multi-KB data URI never round-trips through the model's output token budget.
 * This pass rewrites every handle into the parser's native `dataUri` field.
 *
 * Aspect safety: picture inserts cover-crop to their frame, which would shave
 * a logo whose box aspect differs from the image's. When the asset's natural
 * size is known the box is re-fit (contain, centered) so the whole mark stays
 * visible. Unknown handles drop their element — the page continues without it
 * (same no-page-harm rule as the SVG hydrate path).
 */
import type { DeckImageAsset } from './slides-skill'

export interface SpecAssetResolution {
  json: string
  /** handles rewritten to inline data URIs */
  resolved: number
  /** elements dropped for an unknown/missing handle */
  dropped: number
}

/** Contain-fit the (x,y,w,h) box around the asset aspect, anchored at the box center. */
export function fitBoxToAsset(
  box: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  if (!(width > 0) || !(height > 0) || !(box.w > 0) || !(box.h > 0)) return box
  const scale = Math.min(box.w / width, box.h / height)
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  return { x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + (box.h - h) / 2), w, h }
}

export function resolveSpecAssets(specJson: string, assets: DeckImageAsset[]): SpecAssetResolution {
  const start = specJson.indexOf('{')
  const end = specJson.lastIndexOf('}')
  if (start < 0 || end <= start) return { json: specJson, resolved: 0, dropped: 0 }
  let parsed: unknown
  try {
    parsed = JSON.parse(specJson.slice(start, end + 1))
  } catch {
    return { json: specJson, resolved: 0, dropped: 0 } // the main-process parse reports the real error
  }
  const root = parsed as { elements?: Array<Record<string, unknown>> }
  if (!Array.isArray(root.elements)) return { json: specJson, resolved: 0, dropped: 0 }
  let resolved = 0
  let dropped = 0
  const kept: Array<Record<string, unknown>> = []
  for (const el of root.elements) {
    const handle = typeof el?.asset === 'string' ? el.asset.trim() : ''
    if (!handle) {
      kept.push(el)
      continue
    }
    const asset = assets.find((a) => a.id === handle)
    if (!asset) {
      dropped++
      continue
    }
    const x = typeof el.x === 'number' ? el.x : Number(el.x)
    const y = typeof el.y === 'number' ? el.y : Number(el.y)
    const w = typeof el.w === 'number' ? el.w : Number(el.w)
    const h = typeof el.h === 'number' ? el.h : Number(el.h)
    const box = { x, y, w, h }
    const fitted =
      asset.width && asset.height
        ? fitBoxToAsset(box, asset.width, asset.height)
        : Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h)
          ? box
          : null
    if (!fitted) {
      dropped++
      continue
    }
    const { asset: _asset, ...rest } = el
    kept.push({ ...rest, ...fitted, dataUri: asset.dataUri })
    resolved++
  }
  root.elements = kept
  return { json: JSON.stringify(root), resolved, dropped }
}
