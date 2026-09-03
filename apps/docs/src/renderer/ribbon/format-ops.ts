/**
 * Home-tab format/edit operations: the exact chain() sequences the legacy
 * Ribbon onClick handlers run (components/Ribbon.tsx), lifted into standalone
 * functions so commands (commands/home.ts) and — after the C2 switchover — the
 * schema renderer execute the very same editor mutations. Each function takes
 * the ACTIVE editor (textbox sub-editor when focused, main editor otherwise);
 * enablement guards that legacy embedded in the closures stay embedded here so
 * any caller (button, command, menu) gets identical behavior.
 *
 * UI side effects the legacy closures also performed (closing a dropdown) are
 * deliberately NOT here: those belong to the renderer.
 */
import type { Editor } from '@tiptap/core'
import type { Block, CustomNumberingLevel, StyleInfo, ThemeColors } from '@chatoffice/docx-engine'
import { applyCase, type CaseMode } from '../editor/case-transform'
import { stepParagraphIndent } from '../editor/indent'
import { isEastAsianFontName } from '../font-list'
import { applyParagraphStyle, insertImageFromDataUrl } from '../components/ribbon-tabs'

/** legacy `chain()`: every mutation goes through focus() first */
const chain = (ed: Editor) => ed.chain().focus()

/** merge new attrs into the docTextStyle mark, preserving the rest.
 * Only the patch is passed: setMark merges per existing mark and with the caret's
 * stored mark. Rebuilding from getAttributes read-back dropped the previous call's
 * value on a collapsed cursor (stored-mark changes don't re-render). */
export function setTextStyle(ed: Editor, patch: Record<string, unknown>): void {
  chain(ed).setMark('docTextStyle', patch).run()
}

/** font picks target only their script's rFonts slot (Word never flattens the other one) */
export function setFont(ed: Editor, name: string | null): void {
  if (!name) setTextStyle(ed, { font: null, fontAscii: null })
  else if (isEastAsianFontName(name)) setTextStyle(ed, { font: name })
  else setTextStyle(ed, { fontAscii: name })
}

/** apply paragraph-level attrs to every block type in the selection */
export function setParaAttr(ed: Editor, sub: Editor | null, attrs: Record<string, unknown>): void {
  if (sub) {
    // textbox paragraphs only support alignment; other keys are ignored
    chain(ed).updateAttributes('docParagraph', attrs).run()
    return
  }
  let c = chain(ed)
    .updateAttributes('docParagraph', attrs)
    .updateAttributes('docHeading', attrs)
    .updateAttributes('docListItem', attrs)
  // alignment also applies to selected images (w:jc on the image paragraph)
  if ('align' in attrs) {
    c = c.updateAttributes('docProtected', { imageAlign: attrs.align ?? null })
  }
  c.run()
}

/** Theme accent used by the preset character styles when the doc theme has none */
export const DEFAULT_PRESET_ACCENT = '4472C4'

export function presetAccentOf(themeColors: ThemeColors | null | undefined): string {
  return themeColors?.accent1?.trim().toUpperCase() || DEFAULT_PRESET_ACCENT
}

/** Fallback character styles shown when the document has no character styles.
 * Emphasis = italic + accent color, Intense Emphasis = bold + accent color;
 * applied via the plain italic/bold marks plus docTextStyle color. */
export const CHAR_STYLE_PRESETS: Array<{
  styleId: string
  mark: 'italic' | 'bold'
}> = [
  { styleId: '__preset_emphasis', mark: 'italic' },
  { styleId: '__preset_strong', mark: 'bold' },
]

/** true when the style gallery shows real document character styles (not the
 * built-in presets) — the preset active-detection rule only applies to the
 * fallback gallery */
export function hasGalleryCharStyles(styles: Map<string, StyleInfo> | null | undefined): boolean {
  if (!styles) return false
  for (const [id, info] of styles) {
    if (info.type !== 'character') continue
    if (id === 'Hyperlink' || id === 'FollowedHyperlink' || id === 'DefaultParagraphFont') continue
    // Word rule: semiHidden and linked character shells ("Heading 1 Char") stay out of the style gallery
    if (info.semiHidden || info.linkedCharShell) continue
    return true
  }
  return false
}

/** The style-gallery card that should render active for the given format state. */
export function deriveActiveStyleKey(
  fs: {
    headingLevel: number | null
    charStyleId: string | null
    italic: boolean
    bold: boolean
    textColor: string | null
  },
  opts: { usingPresetFallback: boolean; presetAccent: string },
): string {
  // Presets carry no styleId (they apply plain italic/bold + accent color), so
  // detect their active state from the format state instead of charStyleId.
  const presetActive = (mark: 'italic' | 'bold'): boolean =>
    opts.usingPresetFallback &&
    !fs.charStyleId &&
    (mark === 'italic' ? fs.italic : fs.bold) &&
    (fs.textColor ?? '').toUpperCase() === opts.presetAccent
  return fs.headingLevel !== null
    ? `h${fs.headingLevel}`
    : fs.charStyleId
      ? `char:${fs.charStyleId}`
      : presetActive('bold')
        ? 'char:__preset_strong'
        : presetActive('italic')
          ? 'char:__preset_emphasis'
          : 'p'
}

export interface CharStyleApplyContext {
  activeStyleKey: string
  activeCharStyleId: string | null
  presetAccent: string
}

/** character-style gallery cards: presets toggle mark+accent, doc char styles toggle the docTextStyle styleId */
export function applyCharStyle(ed: Editor, styleId: string, ctx: CharStyleApplyContext): void {
  const preset = CHAR_STYLE_PRESETS.find((p) => p.styleId === styleId)
  if (preset) {
    // Presets are plain italic/bold marks + accent color; toggle off when already active
    if (ctx.activeStyleKey === `char:${styleId}`) {
      chain(ed).unsetMark(preset.mark).setMark('docTextStyle', { color: null }).run()
    } else {
      // switching presets must drop the other's mark, otherwise both stay
      // active and the gallery highlight sticks on the wrong card
      let c = chain(ed)
      for (const p of CHAR_STYLE_PRESETS) if (p !== preset) c = c.unsetMark(p.mark)
      c.setMark(preset.mark).setMark('docTextStyle', { color: ctx.presetAccent }).run()
    }
    return
  }
  // Toggle: if already active, remove the mark; else set it
  if (ctx.activeCharStyleId === styleId) {
    chain(ed).unsetMark('docTextStyle').run()
  } else {
    chain(ed).setMark('docTextStyle', { styleId }).run()
  }
}

/** paragraph gallery cards (Normal / Heading 1-3): always the MAIN editor — textboxes have no heading styles */
export function applyParaStyle(mainEditor: Editor, key: 'p' | 'h1' | 'h2' | 'h3'): void {
  applyParagraphStyle(mainEditor, key)
}

export function findNumIdOfKind(blocks: Block[], kind: 'bullet' | 'ordered'): string | null {
  for (const b of blocks) {
    if (b.type === 'listItem' && b.list?.kind === kind) return b.list.numId
  }
  return null
}

export interface ListContext {
  sub: Editor | null
  blocks: Block[]
  /** fallback when a new list can't reuse a numId (adopt a document definition / create one) */
  allocateNumId: ((kind: 'bullet' | 'ordered') => string | null) | undefined
}

export function toggleList(ed: Editor, kind: 'bullet' | 'ordered', ctx: ListContext): void {
  if (ctx.sub) return // textboxes have no list numbering
  if (ed.isActive('docListItem', { kind })) {
    chain(ed).setNode('docParagraph').run()
    return
  }
  // reuse the numId of an existing same-kind instance in the body; otherwise adopt a document definition / create one (writes numbering.xml)
  const numId = findNumIdOfKind(ctx.blocks, kind) ?? ctx.allocateNumId?.(kind) ?? null
  chain(ed).setNode('docListItem', { kind, numId, ilvl: 0 }).run()
}

/** the gallery "None" card: drop list formatting, back to a plain paragraph */
export function clearList(ed: Editor, sub: Editor | null): void {
  if (sub) return
  if (ed.isActive('docListItem')) chain(ed).setNode('docParagraph').run()
}

/** Custom levels picked in the gallery/dialog → create a definition and apply it to the current paragraph */
export function applyListPreset(
  ed: Editor,
  levels: CustomNumberingLevel[],
  ctx: {
    sub: Editor | null
    /** new list definitions with custom levels (bullet library / numbering library / multilevel list) */
    createListDef: ((levels: CustomNumberingLevel[]) => string | null) | undefined
  },
): void {
  if (ctx.sub) return
  const numId = ctx.createListDef?.(levels) ?? null
  if (!numId) return
  const kind = levels[0]?.numFmt === 'bullet' ? 'bullet' : 'ordered'
  const ilvl = ed.isActive('docListItem') ? Number(ed.getAttributes('docListItem').ilvl) || 0 : 0
  chain(ed).setNode('docListItem', { kind, numId, ilvl }).run()
}

export function changeIndent(ed: Editor, delta: 1 | -1, ctx: { sub: Editor | null }): void {
  if (ctx.sub) return
  stepParagraphIndent(ed, delta)
}

/** unset align follows the paragraph direction: start is left in LTR, right in RTL */
export function activeAlignOf(fs: { align: string | null; bidi: boolean }): string {
  return fs.align ?? (fs.bidi ? 'right' : 'left')
}

export function changeCase(ed: Editor, mode: CaseMode): void {
  applyCase(ed, mode)
}

export function toggleVertAlign(
  ed: Editor,
  kind: 'superscript' | 'subscript',
  currentVertAlign: string | null,
): void {
  setTextStyle(ed, { vertAlign: currentVertAlign === kind ? null : kind })
}

export function toggleMark(ed: Editor, name: string): void {
  chain(ed).toggleMark(name).run()
}

export function clearFormatting(ed: Editor): void {
  chain(ed).unsetAllMarks().run()
}

/**
 * Paste: same pipeline as Ctrl+V — pasteHTML/pasteText run the editor's full
 * paste machinery, where readText + insertContent flattened everything to
 * plain text (r127). The synthesized event carries a real clipboardData so
 * App's handlePaste branches (empty-paragraph wholesale replace, markdown
 * conversion, image priority) behave exactly as on a native paste.
 */
export async function clipboardPaste(ed: Editor): Promise<void> {
  const pasteEvent = (html: string | null, text: string): ClipboardEvent => {
    const data = new DataTransfer()
    if (html) data.setData('text/html', html)
    if (text) data.setData('text/plain', text)
    return new ClipboardEvent('paste', { clipboardData: data })
  }
  try {
    for (const item of await navigator.clipboard.read()) {
      const text = item.types.includes('text/plain')
        ? await (await item.getType('text/plain')).text()
        : ''
      if (item.types.includes('text/html')) {
        const html = await (await item.getType('text/html')).text()
        if (html) {
          ed.view.pasteHTML(html, pasteEvent(html, text))
          ed.commands.focus()
          return
        }
      }
      // image priority mirrors Ctrl+V: an image wins over missing or
      // whitespace-only plain text (OS clipboards often advertise an
      // empty text/plain beside image/png)
      const imageType = item.types.find((type) => type.startsWith('image/'))
      if (imageType && !text.trim()) {
        const blob = await item.getType(imageType)
        const reader = new FileReader()
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            void insertImageFromDataUrl(ed, reader.result, 'Image (pasted)')
          }
        }
        reader.readAsDataURL(blob)
        return
      }
    }
  } catch {
    /* clipboard.read unavailable/denied: plain-text fallback below */
  }
  const text = await navigator.clipboard.readText()
  if (text) {
    ed.view.pasteText(text, pasteEvent(null, text))
    ed.commands.focus()
  }
}

export function clipboardCutCopy(ed: Editor, action: 'cut' | 'copy'): void {
  document.execCommand(action)
  ed.commands.focus()
}

/** Word's 1–1638pt bounds applied by the size combobox commit */
export function clampFontSizePt(pt: number): number {
  return Math.min(1638, Math.max(1, pt))
}
