/**
 * Format painter state + pickup logic, lifted verbatim out of Ribbon.tsx
 * (plan risk #3: the painter is a three-state machine — commands must stay
 * stateless wrappers over this service). The mouse/keyboard arming machinery
 * stays renderer-side (legacy useEffect now, DesktopRibbon wiring at C2);
 * what lives here is the armed state, the pickup computation, and the
 * subscription renderers use to re-render on arm/disarm.
 */
import type { Editor } from '@tiptap/core'
import type { Mark } from '@tiptap/pm/model'
import type { DocDefaults, StyleInfo } from '@chatoffice/docx-engine'

export interface PainterState {
  marks: Array<{ type: string; attrs: Record<string, unknown> }>
  /** source paragraph's node type + formatting attrs (null when the caret is not in a paintable block) */
  block: { type: string; attrs: Record<string, unknown> } | null
}

/** Character-formatting marks the painter transfers; semantic marks (links,
 *  comments, revisions, fields) are neither picked up nor stripped from the target. */
export const PAINTER_MARK_TYPES = ['bold', 'italic', 'underline', 'strike', 'docTextStyle']

/** Paragraph-formatting attrs the painter transfers. Identity/anchor attrs
 *  (docxIndex, bookmarks, comment ranges, revisions, sdtShell…) stay with the target. */
export const PAINTER_PARA_KEYS = [
  'styleId',
  'align',
  'lineSpacing',
  'lineRule',
  'lineRawTwips',
  'snapToGrid',
  'indentLeft',
  'indentRight',
  'indentFirstLine',
  'spaceBefore',
  'spaceAfter',
  'pageBreakBefore',
  'bidi',
  'autoSpace',
  'shadingFill',
  'emptyRunSize',
  'borders',
  'borderLines',
  'tabStops',
]

/** Per-block-type attrs that define the block's identity as formatting (heading level, list numbering) */
export const PAINTER_BLOCK_EXTRA: Record<string, string[]> = {
  docParagraph: [],
  docHeading: ['level'],
  docListItem: ['kind', 'numId', 'ilvl'],
}

export interface PainterPickupDeps {
  styles: Map<string, StyleInfo> | null | undefined
  docDefaults: DocDefaults | null | undefined
}

/** format painter pickup: read the formatting the next selection will receive */
export function pickupPainterFormatting(editor: Editor, deps: PainterPickupDeps): PainterState {
  const { styles, docDefaults } = deps
  const { state } = editor
  const { $from, $head, from, to, empty } = state.selection
  // Word picks up the FIRST character's formatting of a range selection (a
  // triple-clicked paragraph whose last run is plain must still pick up the
  // leading run's look); a collapsed caret reads the marks at the caret.
  const picked: Mark[] = []
  if (empty) {
    picked.push(...$head.marks())
  } else {
    let found = false
    state.doc.nodesBetween(from, to, (node) => {
      if (found) return false
      if (node.isText) {
        found = true
        picked.push(...node.marks)
        return false
      }
      return true
    })
  }
  // Paragraph formatting is picked up per Word's ¶-mark rule: a caret pickup
  // or a cross-paragraph selection carries the block identity (heading
  // level / list numbering / styleId) — which then applies to whole target
  // paragraphs. A PARTIAL in-paragraph drag copies character formatting
  // only — but a selection covering the paragraph's ENTIRE content counts
  // as including the ¶ mark, exactly like Word's triple-click (alpha ledger
  // r134: "select whole paragraph → painter" dropped line spacing/indents
  // while a caret pickup carried them — backwards to any user).
  const { $to } = state.selection
  const coversWholeParagraph =
    !empty &&
    $from.parent.isTextblock && // AllSelection's parent is the doc (bugbot)
    $from.sameParent($to) &&
    $from.parentOffset === 0 &&
    $to.parentOffset === $to.parent.content.size
  const includesParaMark = empty || !$from.sameParent($to) || coversWholeParagraph
  const marks = picked
    .filter((m) => PAINTER_MARK_TYPES.includes(m.type.name) && m.type.name !== 'docTextStyle')
    .map((m) => ({ type: m.type.name, attrs: { ...m.attrs } as Record<string, unknown> }))
  const tsMark = picked.find((m) => m.type.name === 'docTextStyle')
  const ts: Record<string, unknown> = { ...(tsMark?.attrs ?? {}) }
  // raw rPr pass-through belongs to the source run; stamping it on foreign
  // runs would smuggle unmodeled properties across the document
  delete ts.rawRPr
  if (!includesParaMark) {
    // Char-only brush: resolve the EFFECTIVE character formatting (direct
    // marks → character style → paragraph style → docDefaults) and record it
    // as direct formatting, so the brush reproduces what the source LOOKS
    // like even when that look comes from a style. Without this, picking up
    // plain body text (no marks at all) and brushing heading-styled text
    // changes nothing. When the block travels (¶ pickup) it carries the
    // style itself, so no resolved values are stamped there.
    const styleDisplayOf = (id: unknown) =>
      typeof id === 'string' && id ? styles?.get(id)?.display : undefined
    const charStyle = styleDisplayOf(tsMark?.attrs.styleId)
    const paraStyle = styleDisplayOf($from.parent.attrs.styleId)
    for (const t of ['bold', 'italic', 'underline', 'strike'] as const) {
      const styleFlag =
        charStyle?.[t] ??
        paraStyle?.[t] ??
        (t === 'bold' ? docDefaults?.bold : t === 'italic' ? docDefaults?.italic : undefined)
      if (styleFlag && !picked.some((m) => m.type.name === t)) marks.push({ type: t, attrs: {} })
    }
    ts.sizeHalfPoints ??=
      charStyle?.sizeHalfPoints ?? paraStyle?.sizeHalfPoints ?? docDefaults?.sizeHalfPoints ?? null
    ts.color ??= charStyle?.color ?? paraStyle?.color ?? docDefaults?.color ?? null
    ts.fontAscii ??= charStyle?.fontAscii ?? paraStyle?.fontAscii ?? docDefaults?.asciiFont ?? null
    if (ts.font == null) {
      // an empty-EA-theme-slot backfill face is not a document font choice — don't stamp it
      if (charStyle?.font && !charStyle.eaSlotEmpty) ts.font = charStyle.font
      else if (paraStyle?.font && !paraStyle.eaSlotEmpty) ts.font = paraStyle.font
      else if (docDefaults?.eastAsiaFont && !docDefaults.eaSlotEmpty)
        ts.font = docDefaults.eastAsiaFont
    }
    ts.csFont ??= charStyle?.csFont ?? paraStyle?.csFont ?? null
    ts.charSpacingTwips ??= charStyle?.charSpacingTwips ?? paraStyle?.charSpacingTwips ?? null
  }
  if (Object.values(ts).some((v) => v != null)) marks.push({ type: 'docTextStyle', attrs: ts })
  const para = $from.parent
  let block: PainterState['block'] = null
  const extra = PAINTER_BLOCK_EXTRA[para.type.name]
  if (includesParaMark && extra) {
    const attrs: Record<string, unknown> = {}
    for (const k of [...PAINTER_PARA_KEYS, ...extra]) attrs[k] = para.attrs[k]
    block = { type: para.type.name, attrs }
  }
  return { marks, block }
}

export class PainterService {
  private state: PainterState | null = null
  private readonly listeners = new Set<() => void>()

  /** the armed brush (null = painter off) */
  get current(): PainterState | null {
    return this.state
  }

  /** renderer reactivity: fired on arm, disarm, and consume */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(next: PainterState | null): void {
    this.state = next
    for (const fn of this.listeners) fn()
  }

  /** legacy togglePainter: active → disarm; otherwise pick up from the current selection */
  toggle(editor: Editor, deps: PainterPickupDeps & { canEdit: boolean }): void {
    if (this.state) {
      this.set(null)
      return
    }
    if (!deps.canEdit) return
    this.set(pickupPainterFormatting(editor, deps))
  }

  /** disarm without applying (Esc / source command again) */
  cancel(): void {
    if (this.state) this.set(null)
  }

  /** the arming machinery calls this once the brush lands on a target */
  consume(): void {
    if (this.state) this.set(null)
  }
}
