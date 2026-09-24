/**
 * Post-processes a raw page-spec JSON before it reaches the main-process
 * build: for every image element carrying inline `svg`, sanitize + rasterize
 * in the renderer (Chromium's image pipeline, the same one the generate_svg
 * closed loop uses) and attach the PNG fallback as `pngDataUri` — the double
 * part the OOXML insert requires. Failed SVGs are dropped from the spec (the
 * page continues without them; parsePageSpec would reject an svg element
 * without its raster fallback anyway), matching the per-element no-page-harm
 * rule for generated imagery.
 */
import { sanitizeSvg } from '@chatoffice/pptx-render'
import { rasterizeSvg } from './svg-raster'

export interface SvgHydrateResult {
  json: string
  /** inline SVG elements that made it through sanitize + decode + raster */
  svgOk: number
  /** inline SVG elements dropped (markup failure / no intrinsic size / blank raster / text inside SVG) */
  svgFailed: number
}

export async function hydrateSpecSvg(specJson: string): Promise<SvgHydrateResult> {
  const start = specJson.indexOf('{')
  const end = specJson.lastIndexOf('}')
  if (start < 0 || end <= start) return { json: specJson, svgOk: 0, svgFailed: 0 }
  let parsed: unknown
  try {
    parsed = JSON.parse(specJson.slice(start, end + 1))
  } catch {
    return { json: specJson, svgOk: 0, svgFailed: 0 } // the main-process parse reports the real error
  }
  const root = parsed as { elements?: Array<Record<string, unknown>> }
  if (!Array.isArray(root.elements)) return { json: specJson, svgOk: 0, svgFailed: 0 }
  let svgOk = 0
  let svgFailed = 0
  const kept: Array<Record<string, unknown>> = []
  for (const el of root.elements) {
    const svg = typeof el?.svg === 'string' ? el.svg.trim() : ''
    if (!svg) {
      kept.push(el)
      continue
    }
    // Writer SVGs are graphics-only: text must land as native text elements
    // (editable, real fonts). An SVG carrying <text> would rasterize its words
    // into an uneditable picture — reject it so the page stays minimal-unit.
    if (/<text[\s/>]/i.test(svg) || /<text>/i.test(svg)) {
      svgFailed++
      continue
    }
    const clean = sanitizeSvg(svg)
    if (!clean.ok) {
      svgFailed++
      continue
    }
    try {
      const r = await rasterizeSvg(clean.svg)
      if (!r.ok || !r.base64 || (r.paintRatio ?? 1) < 0.005) {
        svgFailed++
        continue
      }
      kept.push({ ...el, svg: clean.svg, pngDataUri: `data:image/png;base64,${r.base64}` })
      svgOk++
    } catch {
      svgFailed++
    }
  }
  root.elements = kept
  return { json: JSON.stringify(root), svgOk, svgFailed }
}
