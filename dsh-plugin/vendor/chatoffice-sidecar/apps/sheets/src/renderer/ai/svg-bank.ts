/**
 * Session-scoped bank for renderer-rasterized SVG graphics (the sheets SVG
 * imagery tier). The generate_svg tool rasterizes the model's markup and
 * registers the PNG data URL here; the model then places it with
 * propose_operations add_image using the short `dataref:` token — the token
 * keeps multi-KB base64 payloads out of the model's context. Resolved at
 * apply time (App.tsx image preloading).
 */

const SVG_REF_PREFIX = 'dataref:svg-'
const bank = new Map<string, string>()
let counter = 0

export function registerSvgDataUrl(dataUrl: string): string {
  counter += 1
  const ref = `${SVG_REF_PREFIX}${counter}`
  bank.set(ref, dataUrl)
  // keep the bank bounded: the last 32 rasterized graphics are resolvable
  if (bank.size > 32) {
    const oldest = bank.keys().next().value
    if (oldest) bank.delete(oldest)
  }
  return ref
}

export function resolveSvgDataUrl(ref: string): string | undefined {
  return bank.get(ref)
}

export function isSvgRef(path: string): boolean {
  return path.startsWith(SVG_REF_PREFIX)
}
