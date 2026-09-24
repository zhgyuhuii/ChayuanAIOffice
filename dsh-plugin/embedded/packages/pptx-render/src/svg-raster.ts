/**
 * SVG rasterization + diagnostics in the renderer (roadmap v3 §8 Q4: the
 * generate_svg closed loop). The LLM writes SVG markup; this decodes it through
 * Chromium's image pipeline (the same renderer the canvas uses), reports
 * deterministic diagnostics back to the model, and produces the PNG fallback
 * bytes the double-part OOXML insert requires (old PowerPoint/WPS never show
 * the asvg:svgBlip part). Scripts never execute in an <img> context; external
 * references simply fail the decode and surface as diagnostics.
 */

export interface SvgRasterResult {
  ok: boolean
  /** PNG bytes, base64 (no data: prefix) — the a:blip fallback payload */
  base64?: string
  /** intrinsic SVG size (from viewBox/width/height) */
  width?: number
  height?: number
  /** share of sampled pixels that carry paint (non-transparent, non-near-white) */
  paintRatio?: number
  error?: string
}

const MAX_RASTER_PX = 4096

async function decodeSvg(svgText: string): Promise<HTMLImageElement> {
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () =>
      reject(new Error('SVG failed to decode (markup error, or an unsupported/external reference)'))
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText)
  })
  return img
}

/** fraction of painted pixels on a ≤64px downscaled sample (blank-detection) */
function paintRatio(img: HTMLImageElement): number {
  const s = Math.min(64 / img.naturalWidth, 64 / img.naturalHeight, 1)
  const w = Math.max(1, Math.round(img.naturalWidth * s))
  const h = Math.max(1, Math.round(img.naturalHeight * s))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return 1 // cannot sample — assume painted rather than block the insert
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  let painted = 0
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]!
    if (alpha < 16) continue
    // near-white counts as unpainted: an all-white rect "renders" but shows nothing
    if (data[i]! > 244 && data[i + 1]! > 244 && data[i + 2]! > 244) continue
    painted++
  }
  return painted / (w * h)
}

/**
 * Decode + rasterize one SVG. Throws with an actionable message on markup
 * errors / missing intrinsic size; `paintRatio < 0.005` signals a blank render.
 */
export async function rasterizeSvg(
  svgText: string,
  target?: { wPx?: number; hPx?: number },
): Promise<SvgRasterResult> {
  const img = await decodeSvg(svgText)
  const width = img.naturalWidth
  const height = img.naturalHeight
  if (!width || !height) {
    throw new Error('SVG has no intrinsic size — add viewBox="0 0 W H" (and width/height) to the root <svg>')
  }
  const scale = Math.min(
    1,
    MAX_RASTER_PX / width,
    MAX_RASTER_PX / height,
    target?.wPx ? target.wPx * 2 / width : 1,
    target?.hPx ? target.hPx * 2 / height : 1,
  )
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is unavailable in this renderer')
  ctx.drawImage(img, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('PNG encoding failed')
  const buf = new Uint8Array(await blob.arrayBuffer())
  let base64 = ''
  for (let i = 0; i < buf.length; i += 0x8000) {
    base64 += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  }
  return {
    ok: true,
    base64: btoa(base64),
    width,
    height,
    paintRatio: paintRatio(img),
  }
}
