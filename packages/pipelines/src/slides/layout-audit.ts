import type {
  GroupRenderNode,
  RenderNode,
  RenderSlide,
  ShapeRenderNode,
} from '@chatoffice/pptx-render'

/**
 * Deterministic layout audit (modeled on the Google Slides add-in review_google_slides_addin geometry-only checks):
 * pure geometric computation, no LLM calls, no screenshots. Checks three kinds of problems:
 *  1. Elements extending past the canvas
 *  2. Pairwise overlap of content elements (text-text / text-image/media)
 *  3. Text overflowing its text box (uses the render layer's already-laid-out text.contentHeight — exact, not estimated)
 * Results are appended to layout tools' return values so the AI "sees" the real post-edit state (write → verify → fix loop).
 */

interface AuditEntry {
  id: string
  type: string
  x: number
  y: number
  w: number
  h: number
  hasText: boolean
  preview: string
  /** Pixels by which the text content height exceeds the box height (only meaningful when >0) */
  overflowPx: number
  /** Pixels by which the widest laid-out line exceeds the box inner width (wrap=false lines, over-wide tokens) */
  overflowXPx: number
  rotationDeg: number
}

const PREVIEW_MAX = 18

function textPreview(node: ShapeRenderNode): string {
  const t = (node.text?.lines ?? [])
    .map((l) => l.runs.map((r) => r.text).join(''))
    .join(' ')
    .trim()
  return t.length > PREVIEW_MAX ? `${t.slice(0, PREVIEW_MAX)}…` : t
}

/** Collect the top-level nodes that take part in the audit (skip master/layout decoration; a group counts as one box). */
function collectEntries(nodes: RenderNode[]): AuditEntry[] {
  const out: AuditEntry[] = []
  for (const n of nodes) {
    if (n.decoration) continue
    const { x, y, w, h } = n.box
    let hasText = false
    let preview = ''
    let overflowPx = 0
    let overflowXPx = 0
    if (n.type === 'shape' || n.type === 'text') {
      const sn = n as ShapeRenderNode
      preview = textPreview(sn)
      hasText = preview.length > 0
      if (sn.text && hasText) {
        const inner = h - sn.text.insets.t - sn.text.insets.b
        overflowPx = Math.round(sn.text.contentHeight - inner)
        const innerW = w - sn.text.insets.l - sn.text.insets.r
        // Laid-out right edge of the widest line (run.x already includes marL/indent/alignment,
        // so the content-area comparison below is exact). Catches wrap=false lines and
        // unbreakable tokens wider than the box -- the height-only check misses both, and
        // the text then overlaps whatever sits next to it.
        // Vertical text (vert/vert270/eaVert/wordArtVert) keeps horizontal layout
        // convention in the renderer's lines, so run.x/widthPx mix axes — the width
        // check would false-positive on every vertical box; skip it (the height
        // check above still applies via contentHeight, which the renderer computes
        // correctly for both orientations).
        if (sn.text.vert) {
          overflowXPx = 0
        } else {
          const widest = sn.text.lines.reduce(
            (acc, ln) =>
              Math.max(
                acc,
                ln.runs.reduce((m, r) => Math.max(m, r.x + r.widthPx), -Infinity),
              ),
            -Infinity,
          )
          overflowXPx = Math.round(Number.isFinite(widest) ? widest - innerW : 0)
        }
      }
    } else if (n.type === 'group') {
      // If any child in the group has text, treat it as text content for overlap detection
      hasText = groupHasText(n as GroupRenderNode)
      preview = '(group)'
    }
    out.push({
      id: n.sourceId,
      type: n.type,
      x,
      y,
      w,
      h,
      hasText,
      preview,
      overflowPx,
      overflowXPx,
      rotationDeg: n.box.rotationDeg,
    })
  }
  return out
}

function groupHasText(g: GroupRenderNode): boolean {
  for (const c of g.children) {
    if (c.type === 'group') {
      if (groupHasText(c as GroupRenderNode)) return true
    } else if (c.type === 'shape' || c.type === 'text') {
      const t = (c as ShapeRenderNode).text?.lines ?? []
      if (t.some((l) => l.runs.some((r) => r.text.trim()))) return true
    }
  }
  return false
}

const MEDIA_TYPES = new Set(['picture', 'table', 'chart', 'placeholder-chip'])

/** Whether it's a content element (participates in overlap detection): has text, or is a picture/table/chart. */
function isContent(e: AuditEntry): boolean {
  return e.hasText || MEDIA_TYPES.has(e.type)
}

function label(e: AuditEntry, idOf: (sourceId: string) => string): string {
  const id = idOf(e.id)
  return e.preview && e.preview !== '(group)' ? `${id}"${e.preview}"` : `${id}(${e.type})`
}

const EDGE_TOLERANCE_PX = 8
const OVERFLOW_TOLERANCE_PX = 4
/** Threshold for overlap area as a fraction of the smaller element's area */
const OVERLAP_RATIO = 0.12
/** Absolute overlap area floor (px²), filtering out noise like touching trims */
const OVERLAP_MIN_AREA = 400
/** Background color blocks (≥70% of canvas area) don't participate in overlap detection */
const BACKGROUND_AREA_RATIO = 0.7
const MAX_ISSUES = 12
/** slack a suggested box adds beyond the measured need */
const SUGGEST_SLACK_PX = 4
const EMU_PER_PX = 9525

export type AuditCode = 'out_of_bounds' | 'text_overflow' | 'text_overflow_width' | 'overlap'

export interface AuditBox {
  x: number
  y: number
  w: number
  h: number
}

/** A `setTransform` an agent can apply as is (EMU); `target.slide` is added by the deck-level caller. */
export interface AuditSuggest {
  op: 'setTransform'
  target: { slide?: number | string; el: string }
  box: { x: number; y: number; cx: number; cy: number }
  rotDeg?: number
}

export interface AuditFinding {
  code: AuditCode
  level: 'error' | 'warning'
  /** id of the element (idOf applied); overlap: the first of the pair */
  el: string
  els?: string[]
  message: string
  /** element box in slide px */
  box: AuditBox
  /** px the text exceeds the box (text_overflow: height, text_overflow_width: width) */
  overflowPx?: number
  suggest?: AuditSuggest
}

/**
 * Audit one page's layout and return the list of problems (empty array = pass).
 * `idOf` maps a node's source id to the id the caller's tools accept (durable ids in the CLI).
 */
export function auditSlideLayout(
  slide: RenderSlide,
  idOf: (sourceId: string) => string = (id) => id,
): string[] {
  return auditSlideFindings(slide, idOf).map((f) => f.message)
}

/** The same audit with each finding typed, located and, where geometry alone fixes it, carrying the op. */
export function auditSlideFindings(
  slide: RenderSlide,
  idOf: (sourceId: string) => string = (id) => id,
): AuditFinding[] {
  const entries = collectEntries(slide.nodes)
  const findings: AuditFinding[] = []
  const W = slide.widthPx
  const H = slide.heightPx
  const boxOf = (e: AuditEntry): AuditBox => ({ x: e.x, y: e.y, w: e.w, h: e.h })
  const outside = (e: AuditEntry): string[] => {
    const parts: string[] = []
    if (e.x < -EDGE_TOLERANCE_PX) parts.push(`${Math.round(-e.x)}px past the left edge`)
    if (e.y < -EDGE_TOLERANCE_PX) parts.push(`${Math.round(-e.y)}px past the top edge`)
    if (e.x + e.w > W + EDGE_TOLERANCE_PX)
      parts.push(`${Math.round(e.x + e.w - W)}px past the right edge`)
    if (e.y + e.h > H + EDGE_TOLERANCE_PX)
      parts.push(`${Math.round(e.y + e.h - H)}px past the bottom edge`)
    return parts
  }
  // One box per element that answers every finding on it at once (grown for the text,
  // then brought inside the canvas), so applying the suggestions in any order converges.
  interface Plan {
    suggest?: AuditSuggest
    grewW: boolean
    grewH: boolean
  }
  const plans = new Map<AuditEntry, Plan>()
  const planFor = (e: AuditEntry): Plan => {
    const cached = plans.get(e)
    if (cached) return cached
    // A grown axis that would not fit the slide is left alone: the message then asks for a
    // smaller font instead of a suggestion that cannot clear the finding.
    const wantW =
      e.w + (e.overflowXPx > OVERFLOW_TOLERANCE_PX ? e.overflowXPx + SUGGEST_SLACK_PX : 0)
    const wantH = e.h + (e.overflowPx > OVERFLOW_TOLERANCE_PX ? e.overflowPx + SUGGEST_SLACK_PX : 0)
    const grewW = wantW > e.w && wantW <= W
    const grewH = wantH > e.h && wantH <= H
    const w = Math.min(grewW ? wantW : e.w, W)
    const h = Math.min(grewH ? wantH : e.h, H)
    const box = { x: clamp(e.x, 0, W - w), y: clamp(e.y, 0, H - h), w, h }
    const same = box.x === e.x && box.y === e.y && box.w === e.w && box.h === e.h
    const plan: Plan = {
      grewW,
      grewH,
      ...(same
        ? {}
        : {
            suggest: {
              op: 'setTransform' as const,
              target: { el: idOf(e.id) },
              box: {
                x: Math.round(box.x * EMU_PER_PX),
                y: Math.round(box.y * EMU_PER_PX),
                cx: Math.round(box.w * EMU_PER_PX),
                cy: Math.round(box.h * EMU_PER_PX),
              },
              ...(e.rotationDeg ? { rotDeg: e.rotationDeg } : {}),
            },
          }),
    }
    plans.set(e, plan)
    return plan
  }
  const withSuggest = (e: AuditEntry, when: (plan: Plan) => boolean = () => true) => {
    const plan = planFor(e)
    return plan.suggest && when(plan) ? { suggest: plan.suggest } : {}
  }

  // 1. Out of bounds
  for (const e of entries) {
    const parts = outside(e)
    if (!parts.length) continue
    findings.push({
      code: 'out_of_bounds',
      level: 'error',
      el: idOf(e.id),
      message: `Out of bounds: ${label(e, idOf)} ${parts.join(', ')}`,
      box: boxOf(e),
      ...withSuggest(e),
    })
  }

  // 2. Text overflow
  for (const e of entries) {
    if (e.overflowPx > OVERFLOW_TOLERANCE_PX) {
      findings.push({
        code: 'text_overflow',
        level: 'error',
        el: idOf(e.id),
        message: `Text overflow: ${label(e, idOf)} content exceeds the box height by ${e.overflowPx}px (make the box taller or reduce the font size)`,
        box: boxOf(e),
        overflowPx: e.overflowPx,
        ...withSuggest(e, (plan) => plan.grewH),
      })
    }
  }

  // 2b. Horizontal overflow: a line wider than the box (wrap=false, or a single token wider
  // than the available width) spills over the box and overlaps neighbors. PowerPoint renders
  // nowrap overflow as-is, so this is an audit-only signal that lets the AI widen the box,
  // shrink the font, or enable wrapping instead of leaving invisible overlap.
  for (const e of entries) {
    if (e.overflowXPx > OVERFLOW_TOLERANCE_PX) {
      findings.push({
        code: 'text_overflow_width',
        level: 'warning',
        el: idOf(e.id),
        message: `Text overflow (width): ${label(e, idOf)} content exceeds the box width by ${e.overflowXPx}px (widen the box, reduce the font size, or turn on wrapping)`,
        box: boxOf(e),
        overflowPx: e.overflowXPx,
        ...withSuggest(e, (plan) => plan.grewW),
      })
    }
  }

  // 3. Pairwise overlap of content elements
  const content = entries.filter((e) => isContent(e) && e.w * e.h < W * H * BACKGROUND_AREA_RATIO)
  for (let i = 0; i < content.length; i++) {
    for (let j = i + 1; j < content.length; j++) {
      const a = content[i]!
      const b = content[j]!
      // Only report text<->text and text<->media; media-on-media (e.g. a chart on an image) is often intentional design, don't report
      if (!a.hasText && !b.hasText) continue
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      if (ix <= 0 || iy <= 0) continue
      const inter = ix * iy
      const minArea = Math.min(a.w * a.h, b.w * b.h)
      if (inter < OVERLAP_MIN_AREA || inter < minArea * OVERLAP_RATIO) continue
      findings.push({
        code: 'overlap',
        level: 'warning',
        el: idOf(a.id),
        els: [idOf(a.id), idOf(b.id)],
        message: `Overlap: ${label(a, idOf)} and ${label(b, idOf)} intersect by ${Math.round(ix)}×${Math.round(iy)}px`,
        box: boxOf(a),
      })
      if (findings.length >= MAX_ISSUES) break
    }
    if (findings.length >= MAX_ISSUES) break
  }

  return findings.slice(0, MAX_ISSUES)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Format the audit result as trailing text for a tool's return value. */
export function formatAudit(issues: string[], round?: string): string {
  if (issues.length === 0)
    return '\n<layout-audit>✅ Passed: no overlap/out-of-bounds/text overflow.</layout-audit>'
  const head = `\n<layout-audit>⚠️ Found ${issues.length} issue(s):\n`
  const body = issues.map((s) => `- ${s}`).join('\n')
  const tail = round
    ? `\n${round}\n</layout-audit>`
    : "\n→ Immediately write another execute_slide_script to fix these issues (don't stop, don't ask the user, don't declare completion). els reflects the new positions after the last apply; compute from it directly. At most 2 fix rounds; only if still unresolved tell the user honestly.\n</layout-audit>"
  return head + body + tail
}

// ── Deck-level consistency audit (item 13) ──
// Deterministic cross-page checks that a per-page pass cannot see: title-size
// rhythm, body-size band, accent-color drift, and text-color spread.

interface PageTextStats {
  /** largest font size on the page (px) */
  headlinePx: number
  /** most common body font size (px, mode of non-headline runs) */
  bodyPx: number
  /** distinct text colors weighted by run length */
  colors: Map<string, number>
}

function pageTextStats(slide: RenderSlide): PageTextStats {
  const sizes: Array<{ px: number; len: number }> = []
  const colors = new Map<string, number>()
  const walk = (nodes: RenderNode[]): void => {
    for (const n of nodes) {
      if (n.decoration) continue
      if (n.type === 'group') {
        walk((n as GroupRenderNode).children)
        continue
      }
      if (n.type !== 'shape' && n.type !== 'text') continue
      const sn = n as ShapeRenderNode
      for (const line of sn.text?.lines ?? []) {
        for (const r of line.runs) {
          if (!r.text.trim()) continue
          const len = Math.max(1, r.text.length)
          sizes.push({ px: r.fontSizePx, len })
          colors.set(r.color, (colors.get(r.color) ?? 0) + len)
        }
      }
    }
  }
  walk(slide.nodes)
  sizes.sort((a, b) => b.px - a.px)
  const headlinePx = sizes[0]?.px ?? 0
  const bodyCandidates = sizes.filter((s) => s.px < headlinePx * 0.8)
  const tally = new Map<number, number>()
  for (const s2 of bodyCandidates) tally.set(s2.px, (tally.get(s2.px) ?? 0) + s2.len)
  const bodyPx = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? headlinePx
  return { headlinePx, bodyPx, colors }
}

/**
 * Cross-page consistency audit. Returns localized-ready findings (English
 * strings, same convention as auditSlideLayout) plus an overall verdict word.
 */
export function auditDeckConsistency(slides: RenderSlide[]): string[] {
  const findings: string[] = []
  const stats = slides.map((s) => pageTextStats(s))
  const contentPages = stats.map((st, i) => ({ st, i })).filter(({ st }) => st.headlinePx > 0)

  // 1) headline rhythm: the biggest heading per page should stay in one band
  //    (±35% around the median) — a random giant title screams template decay
  const heads = contentPages.map(({ st }) => st.headlinePx).sort((a, b) => a - b)
  if (heads.length >= 4) {
    const median = heads[Math.floor(heads.length / 2)]!
    const outliers = contentPages
      .filter(({ st }) => st.headlinePx > median * 1.35 || st.headlinePx < median * 0.65)
      .map(({ i }) => i + 1)
    if (outliers.length > 0) {
      findings.push(
        `Headline size rhythm drifts on page(s) ${outliers.join(', ')} — keep the largest heading within ±35% of the deck median (~${Math.round(median)}px).`,
      )
    }
  }

  // 2) body-size band: body text should not jump wildly between pages
  const bodies = contentPages.map(({ st }) => st.bodyPx).sort((a, b) => a - b)
  if (bodies.length >= 4) {
    const spread = bodies[bodies.length - 1]! / Math.max(1, bodies[0]!)
    if (spread > 2.2) {
      findings.push(
        `Body text size spans ${Math.round(bodies[0]!)}–${Math.round(bodies[bodies.length - 1]!)}px across pages — pick one body size (±1pt) and keep it.`,
      )
    }
  }

  // 3) text-color spread: a deck should hold to a small palette of text colors
  const palette = new Map<string, number>()
  for (const st of stats) for (const [c, n] of st.colors) palette.set(c, (palette.get(c) ?? 0) + n)
  const heavy = [...palette.entries()].filter(([, n]) => n >= 30).sort((a, b) => b[1] - a[1])
  if (heavy.length > 6) {
    findings.push(
      `${heavy.length} distinct heavy text colors across the deck (top: ${heavy
        .slice(0, 4)
        .map(([c]) => c)
        .join(', ')}) — consolidate to 1 primary + 1 secondary text color.`,
    )
  }

  return findings
}
