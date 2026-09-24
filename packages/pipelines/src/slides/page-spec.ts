/**
 * Local single-page generation: a structured JSON slide spec (written by an
 * LLM through the app's own AI transport) is built directly into a one-slide
 * PPTX with pptx-engine primitives — no HTML intermediate, no conversion step.
 *
 * The spec's element model mirrors what an editable deck needs (and what
 * ChatOffice's gen_pptx capture emits): absolutely positioned shapes, images
 * (center-cropped to their frame) and text runs on a fixed px canvas.
 *
 * Host facilities (network fetch, image decoding, font metrics) are injected so
 * this module stays testable in plain Node and usable from the chatoffice CLI.
 */
import {
  addElement,
  addPicture,
  addSvgPicture,
  setSlideNotes,
  createBlankPptx,
  editPictureSrcRect,
  openPptx,
  promoteSlideBackground,
  savePptx,
  type Paragraph,
  type TextElement,
  type TextRun,
} from '@chatoffice/pptx-engine'
import { buildRenderSlide, EMU_PER_PX_96, type FontMetricsProvider } from '@chatoffice/pptx-render'
import { coverCropFractions } from './cover-crop'

export const SPEC_CANVAS_W = 1280
export const SPEC_CANVAS_H = 720

const MAX_ELEMENTS = 48
const MAX_IMAGES = 8
const MAX_TEXT_LEN = 4000
/** hard parser cap for an inline SVG element (the writer prompt asks for ≤1500) */
const MAX_SVG_CHARS = 4000
/** hard parser cap for an inline data URI (≈9MB binary) */
const MAX_DATAURI_CHARS = 12_000_000
/** raster mimes a data URI may carry (svg payloads go through the `svg` field) */
const DATA_URI_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/
const PNG_DATA_URI_RE = /^data:image\/png;base64,[A-Za-z0-9+/=\s]+$/

/** Preset geometries the spec may use; unknown kinds fall back to rect instead of emitting invalid prst XML. */
const SHAPE_KINDS = new Set([
  'rect',
  'roundRect',
  'ellipse',
  'triangle',
  'rightArrow',
  'leftArrow',
  'upArrow',
  'downArrow',
  'chevron',
  'diamond',
  'parallelogram',
  'trapezoid',
  'hexagon',
  'pentagon',
  'pie',
  'donut',
  'star5',
  'heart',
  'cloud',
  'line',
  'lineArrow',
])

export interface SpecRun {
  text: string
  sizePt?: number
  bold?: boolean
  italic?: boolean
  color?: string
  font?: string
}

export interface SpecParagraph {
  runs: SpecRun[]
  align?: 'left' | 'center' | 'right' | 'justify'
  lineSpacingPct?: number
  spaceBeforePt?: number
  spaceAfterPt?: number
  bullet?: boolean
}

interface SpecBase {
  x: number
  y: number
  w: number
  h: number
}

export interface SpecShape extends SpecBase {
  type: 'shape'
  shape: string
  fill?: string
  stroke?: { color: string; widthPt: number }
  paragraphs?: SpecParagraph[]
  valign?: 'top' | 'middle' | 'bottom'
}

export interface SpecText extends SpecBase {
  type: 'text'
  paragraphs: SpecParagraph[]
  valign?: 'top' | 'middle' | 'bottom'
}

export interface SpecImage extends SpecBase {
  type: 'image'
  /** one of the three sources below must be present (validated in that order) */
  /** http(s) URL fetched at build time */
  url?: string
  /** inline raster data URI (data:image/png|jpeg|webp|gif;base64,...) */
  dataUri?: string
  /** inline SVG source — vector picture (double part with the PNG fallback) */
  svg?: string
  /** required companion of `svg`: renderer-rasterized PNG fallback data URI */
  pngDataUri?: string
}

export type SpecElement = SpecShape | SpecText | SpecImage

export interface PageSpec {
  background?: string
  elements: SpecElement[]
  /**
   * Optional deterministic layout skeleton (item 11): when set, the named
   * skeleton's elements are emitted FIRST and the model's own elements layer
   * on top — the model fills content, the skeleton fixes the geometry.
   */
  layout?: string
  layoutContent?: Record<string, string>
  /** speaker notes produced in the same LLM call (item 12) — written into the page pptx */
  notes?: string
}

// ── Deterministic layout skeletons ──
// Each maps semantic content slots to fixed geometry on the 1280×720 canvas.
// Colors are neutral on purpose; a page's accent comes from background/covers
// and the model's own layered elements.

const textEl = (x: number, y: number, w: number, h: number, text: string, sizePt: number, o: Partial<SpecText> = {}): SpecText => ({
  type: 'text',
  x,
  y,
  w,
  h,
  valign: 'top',
  paragraphs: [{ runs: [{ text, sizePt, bold: o.paragraphs ? true : false, color: '#1A1A1A' }] }],
  ...o,
})

function stripTo(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export const LAYOUT_SKELETONS: Record<string, (W: number, H: number, c: Record<string, string>) => SpecElement[]> = {
  // big centered title + subtitle line
  titleSlide: (W, H, c) => [
    textEl(W * 0.08, H * 0.34, W * 0.84, H * 0.18, stripTo(c.title ?? '', 60), 44, { valign: 'top', paragraphs: [{ runs: [{ text: stripTo(c.title ?? '', 60), sizePt: 44, bold: true, color: '#1A1A1A' }] }] }),
    textEl(W * 0.08, H * 0.58, W * 0.84, H * 0.12, stripTo(c.subtitle ?? '', 100), 20, { paragraphs: [{ runs: [{ text: stripTo(c.subtitle ?? '', 100), sizePt: 20, color: '#555555' }] }] }),
  ],
  // title band + one content block
  titleContent: (W, H, c) => [
    textEl(W * 0.07, H * 0.08, W * 0.86, H * 0.14, stripTo(c.title ?? '', 60), 32, { paragraphs: [{ runs: [{ text: stripTo(c.title ?? '', 60), sizePt: 32, bold: true, color: '#1A1A1A' }] }] }),
    { type: 'shape', shape: 'rect', x: W * 0.07, y: H * 0.26, w: W * 0.86, h: H * 0.64, fill: '#F2F2F2', paragraphs: c.body ? [{ runs: [{ text: stripTo(c.body, 500), sizePt: 15, color: '#333333' }] }] : [], valign: 'top' },
  ],
  // title band + left/right cards
  twoCol: (W, H, c) => [
    textEl(W * 0.07, H * 0.08, W * 0.86, H * 0.14, stripTo(c.title ?? '', 60), 32, { paragraphs: [{ runs: [{ text: stripTo(c.title ?? '', 60), sizePt: 32, bold: true, color: '#1A1A1A' }] }] }),
    { type: 'shape', shape: 'roundRect', x: W * 0.05, y: H * 0.28, w: W * 0.43, h: H * 0.6, fill: '#F2F2F2', paragraphs: c.left ? [{ runs: [{ text: stripTo(c.left, 300), sizePt: 14, color: '#333333' }] }] : [], valign: 'top' },
    { type: 'shape', shape: 'roundRect', x: W * 0.52, y: H * 0.28, w: W * 0.43, h: H * 0.6, fill: '#F2F2F2', paragraphs: c.right ? [{ runs: [{ text: stripTo(c.right, 300), sizePt: 14, color: '#333333' }] }] : [], valign: 'top' },
  ],
  // full-bleed image with a bottom title bar
  fullImage: (W, H, c) => [
    ...(c.image_url ? [{ type: 'image', url: c.image_url, x: 0, y: 0, w: W, h: H } as SpecImage] : []),
    { type: 'shape', shape: 'rect', x: 0, y: H * 0.74, w: W, h: H * 0.26, fill: '#111111' },
    textEl(W * 0.06, H * 0.79, W * 0.88, H * 0.16, stripTo(c.title ?? '', 70), 30, { paragraphs: [{ runs: [{ text: stripTo(c.title ?? '', 70), sizePt: 30, bold: true, color: '#FFFFFF' }] }] }),
  ],
  // one giant statement, centered
  statement: (W, H, c) => [
    textEl(W * 0.1, H * 0.38, W * 0.8, H * 0.24, stripTo(c.text ?? c.title ?? '', 40), 48, { valign: 'middle', paragraphs: [{ runs: [{ text: stripTo(c.text ?? c.title ?? '', 40), sizePt: 48, bold: true, color: '#1A1A1A' }] }] }),
  ],
  // section divider: number + section title
  sectionHeader: (W, H, c) => [
    textEl(W * 0.07, H * 0.3, W * 0.2, H * 0.25, stripTo(c.index ?? '01', 8), 64, { paragraphs: [{ runs: [{ text: stripTo(c.index ?? '01', 8), sizePt: 64, bold: true, color: '#DDDDDD' }] }] }),
    textEl(W * 0.3, H * 0.4, W * 0.62, H * 0.18, stripTo(c.title ?? '', 40), 36, { paragraphs: [{ runs: [{ text: stripTo(c.title ?? '', 40), sizePt: 36, bold: true, color: '#1A1A1A' }] }] }),
  ],
}

const EMU_PER_PT = 12700

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

/** #RGB / #RRGGBB / #RRGGBBAA → normalized #RRGGBB(AA), else undefined */
function normColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  let hex = v.trim().replace(/^#/, '').toUpperCase()
  if (/^[0-9A-F]{3}$/.test(hex)) hex = [...hex].map((c) => c + c).join('')
  return /^[0-9A-F]{6}([0-9A-F]{2})?$/.test(hex) ? `#${hex}` : undefined
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

/**
 * Extracts and validates the spec from raw LLM output. Tolerant of fences and
 * junk around the JSON; invalid elements are dropped with a warning rather
 * than failing the page. Returns an error only when nothing usable remains,
 * phrased so it can be fed back to the model for a corrected attempt.
 */
export interface ParseSpecOptions {
  /** Accept local file paths and data: URLs as image sources (the CLI); default http(s) only. */
  localImages?: boolean
}

export function parsePageSpec(
  raw: string,
  canvasW = SPEC_CANVAS_W,
  canvasH = SPEC_CANVAS_H,
  opts: ParseSpecOptions = {},
): { ok: true; spec: PageSpec; warnings: string[] } | { ok: false; error: string } {
  const text = String(raw ?? '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return { ok: false, error: 'no JSON object found in the output' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
  return parsePageSpecObject(parsed, canvasW, canvasH, opts)
}

/** Same validation as parsePageSpec for an already-parsed JSON value (one page of a deck spec). */
export function parsePageSpecObject(
  parsed: unknown,
  canvasW = SPEC_CANVAS_W,
  canvasH = SPEC_CANVAS_H,
  opts: ParseSpecOptions = {},
): { ok: true; spec: PageSpec; warnings: string[] } | { ok: false; error: string } {
  const root = asRecord(parsed)
  const rawEls = Array.isArray(root.elements) ? root.elements : []
  if (rawEls.length === 0) return { ok: false, error: 'the "elements" array is missing or empty' }

  const warnings: string[] = []
  const elements: SpecElement[] = []
  let images = 0

  const parseParagraphs = (v: unknown): SpecParagraph[] => {
    if (!Array.isArray(v)) return []
    const out: SpecParagraph[] = []
    for (const p of v) {
      const pr = asRecord(p)
      const runsRaw = Array.isArray(pr.runs) ? pr.runs : []
      const runs: SpecRun[] = []
      for (const r of runsRaw) {
        const rr = asRecord(r)
        const t = typeof rr.text === 'string' ? rr.text.slice(0, MAX_TEXT_LEN) : ''
        const sizePt = num(rr.sizePt)
        runs.push({
          text: t,
          ...(sizePt ? { sizePt: Math.min(Math.max(sizePt, 6), 160) } : {}),
          ...(rr.bold === true ? { bold: true } : {}),
          ...(rr.italic === true ? { italic: true } : {}),
          ...(normColor(rr.color) ? { color: normColor(rr.color) } : {}),
          ...(typeof rr.font === 'string' && rr.font.trim()
            ? { font: rr.font.trim().slice(0, 80) }
            : {}),
        })
      }
      if (runs.length === 0) runs.push({ text: '' })
      const align = pr.align
      const lineSpacingPct = num(pr.lineSpacingPct)
      const spaceBeforePt = num(pr.spaceBeforePt)
      const spaceAfterPt = num(pr.spaceAfterPt)
      out.push({
        runs,
        ...(align === 'left' || align === 'center' || align === 'right' || align === 'justify'
          ? { align }
          : {}),
        ...(lineSpacingPct ? { lineSpacingPct: Math.min(Math.max(lineSpacingPct, 60), 300) } : {}),
        ...(spaceBeforePt !== undefined
          ? { spaceBeforePt: Math.min(Math.max(spaceBeforePt, 0), 96) }
          : {}),
        ...(spaceAfterPt !== undefined
          ? { spaceAfterPt: Math.min(Math.max(spaceAfterPt, 0), 96) }
          : {}),
        ...(pr.bullet === true ? { bullet: true } : {}),
      })
    }
    return out
  }

  for (const [i, rawEl] of rawEls.entries()) {
    if (elements.length >= MAX_ELEMENTS) {
      warnings.push(`element cap ${MAX_ELEMENTS} reached; the rest were dropped`)
      break
    }
    const el = asRecord(rawEl)
    const x = num(el.x)
    const y = num(el.y)
    const w = num(el.w)
    const h = num(el.h)
    if (x === undefined || y === undefined || w === undefined || h === undefined) {
      warnings.push(`element ${i}: missing/non-numeric x/y/w/h, dropped`)
      continue
    }
    // Clamp into the canvas; drop elements whose origin already lies outside
    if (x >= canvasW || y >= canvasH || x + w <= 0 || y + h <= 0) {
      warnings.push(`element ${i}: outside the ${canvasW}x${canvasH} canvas, dropped`)
      continue
    }
    const cx = Math.max(0, Math.min(x, canvasW - 1))
    const cy = Math.max(0, Math.min(y, canvasH - 1))
    const cw = Math.max(0, Math.min(w - (cx - x), canvasW - cx))
    const ch = Math.max(0, Math.min(h - (cy - y), canvasH - cy))
    if (cw < 1 || ch < 1) {
      warnings.push(`element ${i}: outside the ${canvasW}x${canvasH} canvas, dropped`)
      continue
    }
    const base = { x: cx, y: cy, w: cw, h: ch }
    const type = el.type

    if (type === 'image') {
      const url = typeof el.url === 'string' ? el.url.trim() : ''
      const dataUri = typeof el.dataUri === 'string' ? el.dataUri.trim() : ''
      const svg = typeof el.svg === 'string' ? el.svg.trim() : ''
      const pngDataUri = typeof el.pngDataUri === 'string' ? el.pngDataUri.trim() : ''
      if (svg) {
        if (svg.length > MAX_SVG_CHARS) {
          warnings.push(`element ${i}: inline svg exceeds ${MAX_SVG_CHARS} chars, dropped`)
          continue
        }
        if (!/^<svg[\s>]/i.test(svg)) {
          warnings.push(`element ${i}: inline svg must start with <svg>, dropped`)
          continue
        }
        if (!PNG_DATA_URI_RE.test(pngDataUri)) {
          warnings.push(`element ${i}: inline svg without a pngDataUri raster fallback, dropped`)
          continue
        }
        if (images >= MAX_IMAGES) {
          warnings.push(`element ${i}: image cap ${MAX_IMAGES} reached, dropped`)
          continue
        }
        images += 1
        elements.push({ type: 'image', svg, pngDataUri, ...base })
        continue
      }
      if (dataUri) {
        if (dataUri.length > MAX_DATAURI_CHARS) {
          warnings.push(`element ${i}: inline dataUri exceeds the size cap, dropped`)
          continue
        }
        if (!DATA_URI_RE.test(dataUri)) {
          warnings.push(
            `element ${i}: dataUri must be data:image/png|jpeg|webp|gif;base64, dropped`,
          )
          continue
        }
        if (images >= MAX_IMAGES) {
          warnings.push(`element ${i}: image cap ${MAX_IMAGES} reached, dropped`)
          continue
        }
        images += 1
        elements.push({ type: 'image', dataUri, ...base })
        continue
      }
      if (!/^https?:\/\//.test(url) && !(opts.localImages && url)) {
        warnings.push(`element ${i}: image url must be http(s), dropped`)
        continue
      }
      if (images >= MAX_IMAGES) {
        warnings.push(`element ${i}: image cap ${MAX_IMAGES} reached, dropped`)
        continue
      }
      images += 1
      elements.push({ type: 'image', url, ...base })
      continue
    }

    if (type === 'text') {
      const paragraphs = parseParagraphs(el.paragraphs)
      if (paragraphs.length === 0 || paragraphs.every((p) => !p.runs.some((r) => r.text.trim()))) {
        warnings.push(`element ${i}: text element without any text, dropped`)
        continue
      }
      const valign = el.valign
      elements.push({
        type: 'text',
        ...base,
        paragraphs,
        ...(valign === 'top' || valign === 'middle' || valign === 'bottom' ? { valign } : {}),
      })
      continue
    }

    if (type === 'shape') {
      let shape = typeof el.shape === 'string' ? el.shape.trim() : 'rect'
      if (!SHAPE_KINDS.has(shape)) {
        warnings.push(`element ${i}: unknown shape "${shape}", using rect`)
        shape = 'rect'
      }
      const fill = normColor(el.fill)
      const strokeRec = asRecord(el.stroke)
      const strokeColor = normColor(strokeRec.color)
      const strokeWidth = num(strokeRec.widthPt)
      const stroke = strokeColor
        ? { color: strokeColor, widthPt: Math.min(Math.max(strokeWidth ?? 1, 0.25), 24) }
        : undefined
      const isLine = shape === 'line' || shape === 'lineArrow'
      if (!fill && !stroke && !isLine) {
        warnings.push(`element ${i}: shape without fill or stroke, dropped`)
        continue
      }
      const paragraphs = parseParagraphs(el.paragraphs)
      const valign = el.valign
      elements.push({
        type: 'shape',
        shape,
        ...base,
        ...(fill ? { fill } : {}),
        ...(stroke ? { stroke } : {}),
        ...(paragraphs.some((p) => p.runs.some((r) => r.text.trim())) ? { paragraphs } : {}),
        ...(valign === 'top' || valign === 'middle' || valign === 'bottom' ? { valign } : {}),
      })
      continue
    }

    warnings.push(`element ${i}: unknown type "${String(type)}", dropped`)
  }

  if (elements.length === 0) {
    return {
      ok: false,
      error: `no valid elements (${warnings.join('; ') || 'all dropped'})`,
    }
  }
  warnings.push(...nearDuplicateTextWarnings(rawEls))
  return {
    ok: true,
    spec: {
      ...(normColor(root.background) ? { background: normColor(root.background) } : {}),
      ...(typeof root.layout === 'string' && LAYOUT_SKELETONS[root.layout]
        ? { layout: root.layout }
        : {}),
      ...(typeof root.notes === 'string' && root.notes.trim()
        ? { notes: root.notes.trim().slice(0, 2000) }
        : {}),
      ...(root.layoutContent && typeof root.layoutContent === 'object' && !Array.isArray(root.layoutContent)
        ? {
            layoutContent: Object.fromEntries(
              Object.entries(root.layoutContent as Record<string, unknown>)
                .filter(([, v]) => typeof v === 'string')
                .map(([k, v]) => [k, String(v)]),
            ),
          }
        : {}),
      elements,
    },
    warnings,
  }
}

/** Text of a raw spec element for the duplicate check, or null when it has none. */
function rawElementText(el: unknown): string | null {
  const rec = asRecord(el)
  if (rec.type !== 'text' && rec.type !== 'shape') return null
  if (!Array.isArray(rec.paragraphs)) return null
  const text = rec.paragraphs
    .flatMap((p) => (Array.isArray(asRecord(p).runs) ? (asRecord(p).runs as unknown[]) : []))
    .map((r) => (typeof asRecord(r).text === 'string' ? (asRecord(r).text as string) : ''))
    .join('')
  return text.trim() ? text : null
}

/** Lower-cased text without spaces or punctuation, so "A · B" and "A（B）" compare equal. */
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

const DUP_MIN_CHARS = 12
const DUP_MIN_PREFIX = 10
const DUP_PREFIX_SHARE = 0.6

/**
 * Two text boxes on one page that say (nearly) the same thing are almost
 * always an authoring slip — a subtitle restating the chart caption, a
 * heading pasted twice. Compared on normalized text: identical, or sharing a
 * long common prefix that covers most of the shorter one. Advice only.
 */
export function nearDuplicateTextWarnings(rawEls: unknown[]): string[] {
  const texts: { i: number; text: string; norm: string }[] = []
  for (const [i, el] of rawEls.entries()) {
    const text = rawElementText(el)
    if (text === null) continue
    const norm = normalizeText(text)
    if (norm.length >= DUP_MIN_CHARS) texts.push({ i, text, norm })
  }
  const out: string[] = []
  for (let a = 0; a < texts.length; a++) {
    for (let b = a + 1; b < texts.length; b++) {
      const x = texts[a]!
      const y = texts[b]!
      const shorter = Math.min(x.norm.length, y.norm.length)
      let prefix = 0
      while (prefix < shorter && x.norm[prefix] === y.norm[prefix]) prefix++
      const same = x.norm === y.norm
      if (!same && (prefix < DUP_MIN_PREFIX || prefix < shorter * DUP_PREFIX_SHARE)) continue
      const quote = (t: string) => (t.length > 40 ? `${t.slice(0, 40)}…` : t)
      out.push(
        `elements ${x.i} and ${y.i}: ${same ? 'identical' : 'near-duplicate'} text ("${quote(x.text)}" / "${quote(y.text)}"); merge them or make one say something else`,
      )
    }
  }
  return out
}

export interface BuildPageDeps {
  /** Downloads an image; null on failure (page continues without it) */
  fetchImage: (url: string) => Promise<{ bytes: Uint8Array; ext: string } | null>
  /** Decodes natural pixel size for cover-cropping; null skips the crop */
  imageDims?: (bytes: Uint8Array) => { width: number; height: number } | null
  /** Font metrics for the post-build text measurement; absent skips the box-height fix */
  fontMetrics?: FontMetricsProvider
}

interface ResolvedImage {
  bytes: Uint8Array
  ext: string
  /** set for inline svg elements: the vector source for the double part */
  svgBytes?: Uint8Array
}

/** data URI → image bytes; null when the mime or base64 payload is unusable */
function decodeDataUri(uri: string): ResolvedImage | null {
  const m = /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,([\sA-Za-z0-9+/=]+)$/.exec(uri)
  if (!m) return null
  const ext = m[1] === 'jpeg' || m[1] === 'jpg' ? 'jpg' : m[1] === 'svg+xml' ? 'svg' : m[1]!
  const b64 = m[2]!.replace(/\s+/g, '')
  try {
    return { bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), ext }
  } catch {
    return null
  }
}

/**
 * The LLM sizes text boxes from a rough chars-per-line heuristic, which routinely
 * undersizes big CJK titles; the box has no autofit, so the canvas draws the overflow
 * past the selection frame (and PowerPoint past the shape). Re-measure every text box
 * with the real layout engine — on the reopened (parsed) model, the exact input the
 * landed page will render from — and grow too-short boxes to their content height.
 * Grow-only, plain text boxes only (shape label boxes are design intent); middle/bottom
 * anchored boxes shift up so the rendered glyphs stay exactly where they were.
 * Returns the re-saved bytes, or null when every box already fits.
 */
async function growTextBoxesToContent(
  bytes: Uint8Array,
  metrics: FontMetricsProvider,
): Promise<Uint8Array | null> {
  const opened = await openPptx(bytes)
  const slide = opened.deck.slides[0]
  if (!slide) return null
  const baseWidthPx = opened.deck.size.cx / EMU_PER_PX_96 // native px → vp.scale = 1
  const rendered = buildRenderSlide(slide, opened.deck.size, { fitWidthPx: baseWidthPx, metrics })
  let changed = false
  for (const node of rendered.nodes) {
    if (node.type !== 'text' || !node.text) continue
    const el = slide.elements.find((e) => e.id === node.sourceId)
    if (el?.type !== 'text') continue
    const t = node.text
    const needH = Math.max(t.contentHeight, t.inkBottom ?? 0) + t.insets.t + t.insets.b
    const growPx = needH - node.box.h
    if (growPx < 0.5) continue
    const tel = el as TextElement
    const offset = { ...tel.transform.offset, cy: Math.max(1, Math.round(needH * EMU_PER_PX_96)) }
    if (t.anchor === 'middle') offset.y -= Math.round((growPx / 2) * EMU_PER_PX_96)
    else if (t.anchor === 'bottom') offset.y -= Math.round(growPx * EMU_PER_PX_96)
    tel.transform = { ...tel.transform, offset }
    tel.dirtyTransform = true
    changed = true
  }
  return changed ? savePptx(opened) : null
}

function toEngineParagraphs(paragraphs: SpecParagraph[]): Paragraph[] {
  return paragraphs.map((p) => {
    const runs: TextRun[] = p.runs.map((r) => ({
      text: r.text,
      ...(r.sizePt ? { fontSize: r.sizePt } : {}),
      ...(r.bold ? { bold: true } : {}),
      ...(r.italic ? { italic: true } : {}),
      ...(r.color ? { color: r.color } : {}),
      ...(r.font ? { fontFamily: r.font, latinFont: r.font, eaFont: r.font } : {}),
    }))
    return {
      runs,
      ...(p.align ? { align: p.align } : {}),
      ...(p.lineSpacingPct ? { lineHeight: p.lineSpacingPct } : {}),
      ...(p.spaceBeforePt !== undefined ? { spaceBefore: p.spaceBeforePt } : {}),
      ...(p.spaceAfterPt !== undefined ? { spaceAfter: p.spaceAfterPt } : {}),
      ...(p.bullet
        ? { bullet: { type: 'char' as const, char: '•' }, marL: 228600, indent: -228600 }
        : {}),
    }
  })
}

/**
 * Builds a one-slide PPTX from the spec. Elements are added in array order
 * (spec order = z-order); a background color becomes a full-bleed rect that
 * the landing pipeline's promoteSlideBackground lifts to the slide background.
 */
export async function buildPagePptx(
  spec: PageSpec,
  deps: BuildPageDeps,
  canvasW = SPEC_CANVAS_W,
): Promise<{ bytes: Uint8Array; imageFailures: string[]; imageWarnings: string[] }> {
  const opened = await openPptx(await createBlankPptx())
  const slide = opened.deck.slides[0]!
  const scale = opened.deck.size.cx / canvasW
  const toEmu = (px: number) => Math.round(px * scale)
  const anchorOf = (
    v: 'top' | 'middle' | 'bottom' | undefined,
    dflt: 't' | 'ctr',
  ): 't' | 'ctr' | 'b' => (v === 'top' ? 't' : v === 'middle' ? 'ctr' : v === 'bottom' ? 'b' : dflt)
  // Zero insets: the spec's boxes are exact; PowerPoint's default 0.1in/0.05in
  // insets would shift every text off its planned spot.
  const zeroInsets = { l: 0, t: 0, r: 0, b: 0 }

  const resolved = resolvedSpecElements(spec)
  const imageFailures: string[] = []
  const imageWarnings: string[] = []
  // Three image sources resolve differently (fetch / decode / decode+vector) but
  // share the cover-crop and insert path below; keyed by resolved-array index.
  const imgByIndex = new Map<number, ResolvedImage | null>()
  await Promise.all(
    resolved.map(async (el, idx) => {
      if (el.type !== 'image') return
      try {
        if (el.svg) {
          const png = decodeDataUri(el.pngDataUri ?? '')
          // Uint8Array.from copies into the local realm — cross-realm typed
          // arrays (e.g. TextEncoder output under jsdom) fail jszip's instanceof
          const svgBytes = Uint8Array.from(new TextEncoder().encode(el.svg))
          imgByIndex.set(idx, png ? { ...png, ext: 'png', svgBytes } : null)
        } else if (el.dataUri) {
          imgByIndex.set(idx, decodeDataUri(el.dataUri))
        } else {
          imgByIndex.set(idx, await deps.fetchImage(el.url ?? ''))
        }
      } catch {
        imgByIndex.set(idx, null)
      }
    }),
  )

  if (spec.background) {
    addElement(slide, {
      kind: 'rect',
      offset: { x: 0, y: 0, cx: opened.deck.size.cx, cy: opened.deck.size.cy },
      fillColor: spec.background,
    })
  }

  for (const [idx, el] of resolved.entries()) {
    const offset = {
      x: toEmu(el.x),
      y: toEmu(el.y),
      cx: Math.max(1, toEmu(el.w)),
      cy: Math.max(1, toEmu(el.h)),
    }
    if (el.type === 'image') {
      const img = imgByIndex.get(idx)
      const label = el.svg ? 'inline svg' : el.dataUri ? 'inline image' : (el.url ?? 'image')
      if (!img) {
        imageFailures.push(label)
        continue
      }
      const pic = img.svgBytes
        ? addSvgPicture(opened, slide, {
            svgBytes: img.svgBytes,
            bytes: img.bytes,
            fallbackExt: img.ext,
            offset,
          })
        : addPicture(opened, slide, { bytes: img.bytes, ext: img.ext, offset })
      if (!pic) {
        imageFailures.push(label)
        continue
      }
      const dims = deps.imageDims?.(img.bytes) ?? null
      if (dims) {
        const crop = coverCropFractions(dims.width, dims.height, el.w, el.h)
        if (crop) {
          editPictureSrcRect(slide, pic.id, crop)
          const warning = heavyCropWarning(el, dims, crop)
          if (warning) imageWarnings.push(warning)
        }
      }
      continue
    }
    if (el.type === 'text') {
      addElement(slide, {
        kind: 'textbox',
        offset,
        paragraphs: toEngineParagraphs(el.paragraphs),
        bodyPr: { wrap: 'square', anchor: anchorOf(el.valign, 't'), insetsEmu: zeroInsets },
      })
      continue
    }
    addElement(slide, {
      kind: el.shape,
      offset,
      ...(el.fill ? { fillColor: el.fill } : {}),
      ...(el.stroke
        ? {
            stroke: {
              color: el.stroke.color,
              widthEmu: Math.round(el.stroke.widthPt * EMU_PER_PT),
            },
          }
        : {}),
      ...(el.paragraphs ? { paragraphs: toEngineParagraphs(el.paragraphs) } : {}),
      ...(el.paragraphs
        ? { bodyPr: { wrap: 'square', anchor: anchorOf(el.valign, 'ctr'), insetsEmu: zeroInsets } }
        : {}),
    })
  }

  promoteSlideBackground(slide, opened.deck.size)
  if (spec.notes) setSlideNotes(opened, 0, spec.notes)
  let bytes = await savePptx(opened)
  if (deps.fontMetrics) bytes = (await growTextBoxesToContent(bytes, deps.fontMetrics)) ?? bytes
  return { bytes, imageFailures, imageWarnings }
}

/** Below this share of the source left visible, the center crop is reported (a square photo in a 16:9 banner keeps 56% and passes). */
export const HEAVY_CROP_KEEP = 0.5

/**
 * A box whose aspect is far from the picture's throws most of the picture
 * away: a 1200×1500 product shot in a 314×96 strip shows a quarter of it, cut
 * through the middle. The build still lands it (cover-crop never distorts),
 * but the author should hear about it.
 */
function heavyCropWarning(
  el: SpecImage,
  dims: { width: number; height: number },
  crop: { l: number; t: number; r: number; b: number },
): string | null {
  const kept = (1 - crop.l - crop.r) * (1 - crop.t - crop.b)
  if (kept >= HEAVY_CROP_KEEP) return null
  const axis = crop.t > 0 ? 'top and bottom' : 'left and right'
  return `image ${el.url}: the ${Math.round(el.w)}×${Math.round(el.h)} box shows only ${Math.round(kept * 100)}% of the ${dims.width}×${dims.height} picture (center crop, ${axis} cut off); size the box nearer the picture's aspect ratio or crop the file first`
}

/** Layout skeleton (item 11): when the spec names a known layout, its
 * deterministic elements go FIRST (z-order bottom) and the model's own
 * elements layer on top as supplements. */
function resolvedSpecElements(spec: PageSpec): SpecElement[] {
  const skeleton = spec.layout
    ? LAYOUT_SKELETONS[spec.layout]?.(SPEC_CANVAS_W, SPEC_CANVAS_H, spec.layoutContent ?? {})
    : undefined
  return skeleton ? [...skeleton, ...spec.elements] : spec.elements
}
