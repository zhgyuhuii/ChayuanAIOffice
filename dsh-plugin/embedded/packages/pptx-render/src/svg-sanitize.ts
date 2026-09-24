/**
 * SVG sanitizer for model-generated vector graphics. Strips what an <img>
 * decode or an OOXML svgBlip part must never carry: script code, event
 * handlers, foreignObject HTML smuggling, and external references (they fail
 * the decode at best, and in an editor context could attempt loads at worst).
 * Pure string transform — no DOM — so it runs in renderers, main processes and
 * plain-Node tests alike. Runs BEFORE rasterization.
 */

/** attributes that may carry an external reference */
const HREF_ATTR_RE = /\s+(?:href|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi
/** url(...) inside style attributes / <style> blocks pointing off-document */
const EXTERNAL_URL_RE = /url\(\s*(?:['"]?)\s*(?:https?:|\/\/)[^)]*\)/gi
/** internal + data references are the only hrefs an embedded SVG may keep */
const SAFE_HREF_RE = /^\s*(?:#|data:image\/)/i

function count(svg: string, re: RegExp): number {
  return (svg.match(new RegExp(re.source, re.flags)) ?? []).length
}

function stripScriptBlocks(svg: string): string {
  return svg
    .replace(/<script[\s>][\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
}

function stripForeignObjects(svg: string): string {
  return svg.replace(/<foreignObject[\s>][\s\S]*?<\/foreignObject\s*>/gi, '')
}

function stripEventHandlers(svg: string): string {
  return svg.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}

/** drop href/xlink:href attributes whose target is not #anchor / data:image */
function stripExternalHrefs(svg: string): string {
  return svg.replace(HREF_ATTR_RE, (match, quoted: string) => {
    const value = quoted.replace(/^["']|["']$/g, '')
    return SAFE_HREF_RE.test(value) ? match : ''
  })
}

export interface SvgSanitizeResult {
  ok: boolean
  /** cleaned markup (input unchanged when already clean) */
  svg: string
  /** dropped constructs, for diagnostics */
  removed: string[]
}

/** Sanitize one SVG document; `ok:false` only when nothing usable remains. */
export function sanitizeSvg(input: string): SvgSanitizeResult {
  const removed: string[] = []
  const steps: Array<[RegExp, string, (svg: string) => string]> = [
    [/<script[\s>]/i, 'script', stripScriptBlocks],
    [/<foreignObject[\s>]/i, 'foreignObject', stripForeignObjects],
    [/\s+on[a-z]+\s*=/i, 'event handler', stripEventHandlers],
    [HREF_ATTR_RE, 'external href', stripExternalHrefs],
    [EXTERNAL_URL_RE, 'external url()', (svg) => svg.replace(EXTERNAL_URL_RE, 'none')],
  ]
  let svg = input.trim()
  for (const [probe, label, strip] of steps) {
    const n = count(svg, probe)
    if (!n) continue
    removed.push(`${n}× ${label}`)
    svg = strip(svg)
  }
  svg = svg.trim()
  return { ok: /^<svg[\s>]/i.test(svg) && svg.includes('</svg>'), svg, removed }
}
