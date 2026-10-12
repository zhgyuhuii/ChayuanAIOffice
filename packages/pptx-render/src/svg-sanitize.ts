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

/** HTML-only named entities an LLM habitually writes into SVG text — SVG is
    XML 1.0, where these are undefined and fail the <img> decode. */
const HTML_ONLY_ENTITIES: Record<string, string> = {
  nbsp: '&#160;',
  copy: '&#169;',
  reg: '&#174;',
  trade: '&#8482;',
  mdash: '&#8212;',
  ndash: '&#8211;',
  hellip: '&#8230;',
  lsquo: '&#8216;',
  rsquo: '&#8217;',
  ldquo: '&#8220;',
  rdquo: '&#8221;',
  bull: '&#8226;',
  deg: '&#176;',
  plusmn: '&#177;',
  times: '&#215;',
  divide: '&#247;',
  middot: '&#183;',
  laquo: '&#171;',
  raquo: '&#187;',
  frac12: '&#189;',
  euro: '&#8364;',
  pound: '&#163;',
  yen: '&#165;',
  cent: '&#162;',
  larr: '&#8592;',
  uarr: '&#8593;',
  rarr: '&#8594;',
  darr: '&#8595;',
  infin: '&#8734;',
  ne: '&#8800;',
  le: '&#8804;',
  ge: '&#8805;',
}

/** `&` not opening a well-formed entity/character reference — the single most
    common model markup error (R&D, M&A, "Q&A", path data with raw &) */
const BARE_AMP_RE = /&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g
const NAMED_ENTITY_RE = /&([a-zA-Z][a-zA-Z0-9]*);/g

/**
 * Repair the entity-level markup mistakes that make an otherwise-valid SVG
 * fail the XML decode: bare ampersands become `&amp;`, HTML-only named
 * entities become their numeric character references. The five predefined XML
 * entities (`amp lt gt quot apos`) and numeric refs pass through untouched,
 * so valid markup is byte-identical. Pure string transform — apply to every
 * SVG text that is stored or rasterized, so the vector part never breaks on a
 * construct the raster check silently repaired.
 */
export function repairSvgEntities(svg: string): string {
  return svg
    .replace(NAMED_ENTITY_RE, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(HTML_ONLY_ENTITIES, name)
        ? HTML_ONLY_ENTITIES[name]!
        : match,
    )
    .replace(BARE_AMP_RE, '&amp;')
}
