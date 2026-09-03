/**
 * Home tab command definitions (B2): every clipboard/font/paragraph/styles
 * action the legacy home ribbon can trigger, registered as docs.* commands.
 * run() bodies execute the exact chain() sequences the legacy onClick handlers
 * run (via the shared ops in ../format-ops) — pinned by chain-spy equivalence
 * tests in tests/ribbon-commands-home.test.ts. Stateful interactions (font
 * size stepping, format painter, pen colors) stay in services; commands are
 * stateless wrappers over them (plan risks #1/#3).
 */
import { commandId, type AnyCommandDefinition, type CommandContext } from '@chatoffice/ribbon'
import type { Editor } from '@tiptap/core'
import type { CustomNumberingLevel } from '@chatoffice/docx-engine'
import type { CaseMode } from '../../editor/case-transform'
import type { DocsCommandState } from '../command-state'
import type { DocsCommandServices } from '../host-services'
import {
  activeAlignOf,
  applyCharStyle,
  applyListPreset,
  applyParaStyle,
  changeCase,
  changeIndent,
  clampFontSizePt,
  clearFormatting,
  clearList,
  clipboardCutCopy,
  clipboardPaste,
  deriveActiveStyleKey,
  hasGalleryCharStyles,
  presetAccentOf,
  setFont,
  setParaAttr,
  setTextStyle,
  toggleList,
  toggleMark,
  toggleVertAlign,
} from '../format-ops'
import { setParagraphDirection, setSelectionAlign } from '../../editor/direction'

type State = DocsCommandState
type Services = DocsCommandServices
type Ctx = CommandContext<State, Services>
/** heterogeneous store form: run() args are typed by each definition's own annotation */
type Def = AnyCommandDefinition<State, Services>

/** the editor ribbon commands act on: textbox sub-editor when focused, else the main editor */
function activeEditor(ctx: Ctx): Editor | null {
  return ctx.state.format.sub ?? ctx.services.editor.main()
}

/** active editor when editable; commands no-op on a read-only/protected document */
function editableEditor(ctx: Ctx): Editor | null {
  return ctx.state.canEdit ? activeEditor(ctx) : null
}

const canEdit = (ctx: Ctx) => ctx.state.canEdit
const canEditOutsideSub = (ctx: Ctx) => ctx.state.canEdit && !ctx.state.format.sub
const hasDoc = (ctx: Ctx) => ctx.state.hasDoc

const clipboardCommands: Def[] = [
  // undo/redo availability comes from the history plugin via state.hist (the
  // desktop quick-access toolbar drives the same state)
  {
    id: commandId('docs.edit.undo'),
    isEnabled: (ctx) => ctx.state.hasDoc && ctx.state.hist.canUndo,
    run: (ctx) => {
      const ed = activeEditor(ctx)
      if (!ed) return
      ed.chain().focus().undo().run()
    },
  },
  {
    id: commandId('docs.edit.redo'),
    isEnabled: (ctx) => ctx.state.hasDoc && ctx.state.hist.canRedo,
    run: (ctx) => {
      const ed = activeEditor(ctx)
      if (!ed) return
      ed.chain().focus().redo().run()
    },
  },
  {
    id: commandId('docs.edit.paste'),
    isEnabled: canEdit,
    run: (ctx) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      void clipboardPaste(ed)
    },
  },
  {
    id: commandId('docs.edit.cut'),
    isEnabled: canEdit,
    run: (ctx) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      clipboardCutCopy(ed, 'cut')
    },
  },
  {
    // copy stays available on read-only documents (legacy: disabled={!hasDoc})
    id: commandId('docs.edit.copy'),
    isEnabled: hasDoc,
    run: (ctx) => {
      const ed = activeEditor(ctx)
      if (!ed) return
      clipboardCutCopy(ed, 'copy')
    },
  },
  {
    id: commandId('docs.edit.togglePainter'),
    isEnabled: canEditOutsideSub,
    isActive: (ctx) => ctx.services.painter.current !== null,
    run: (ctx) => {
      // the painter reads the MAIN editor even though activeEditor would do:
      // the sub-guard above makes them identical, and the legacy closure read `editor`
      const ed = ctx.services.editor.main()
      if (!ed) return
      ctx.services.painter.toggle(ed, {
        canEdit: ctx.state.canEdit,
        styles: ctx.state.doc.styles,
        docDefaults: ctx.state.doc.docDefaults,
      })
    },
  },
]

const fontCommands: Def[] = [
  {
    id: commandId('docs.format.fontFamily.set'),
    isEnabled: canEdit,
    getVisualState: (ctx) => ({ value: ctx.state.format.fontFamily }),
    run: (ctx, args: { name: string | null }) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      setFont(ed, args.name)
    },
  },
  {
    id: commandId('docs.format.fontSize.set'),
    isEnabled: canEdit,
    getVisualState: (ctx) => ({ value: ctx.state.format.fontSizePt }),
    run: (ctx, args: { pt: number }) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      setTextStyle(ed, { sizeHalfPoints: Math.round(clampFontSizePt(args.pt) * 2) })
    },
  },
  {
    id: commandId('docs.format.fontSize.stepGrow'),
    isEnabled: canEdit,
    run: (ctx) => stepFont(ctx, 1, 'step'),
  },
  {
    id: commandId('docs.format.fontSize.stepShrink'),
    isEnabled: canEdit,
    run: (ctx) => stepFont(ctx, -1, 'step'),
  },
  {
    id: commandId('docs.format.fontSize.nudgeGrow'),
    isEnabled: canEdit,
    run: (ctx) => stepFont(ctx, 1, 'nudge'),
  },
  {
    id: commandId('docs.format.fontSize.nudgeShrink'),
    isEnabled: canEdit,
    run: (ctx) => stepFont(ctx, -1, 'nudge'),
  },
  {
    id: commandId('docs.format.changeCase'),
    isEnabled: canEdit,
    run: (ctx, args: { mode: CaseMode }) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      changeCase(ed, args.mode)
    },
  },
  {
    id: commandId('docs.format.clearFormatting'),
    isEnabled: canEdit,
    run: (ctx) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      clearFormatting(ed)
    },
  },
  ...(['bold', 'italic', 'underline', 'strike'] as const).map((mark): Def => ({
    id: commandId(`docs.format.toggle${mark[0].toUpperCase()}${mark.slice(1)}`),
    isEnabled: canEdit,
    isActive: (ctx) => ctx.state.format[mark],
    run: (ctx) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      toggleMark(ed, mark)
    },
  })),
  ...(['subscript', 'superscript'] as const).map((kind): Def => ({
    id: commandId(`docs.format.toggle${kind === 'subscript' ? 'Subscript' : 'Superscript'}`),
    isEnabled: canEdit,
    isActive: (ctx) => ctx.state.format.vertAlign === kind,
    run: (ctx) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      toggleVertAlign(ed, kind, ctx.state.format.vertAlign)
    },
  })),
  {
    // split-button main half: apply the pen highlight, toggle off when already on it
    id: commandId('docs.format.highlight.applyPen'),
    isEnabled: canEdit,
    isActive: (ctx) => !!ctx.state.format.highlight,
    getVisualState: (ctx) => ({ value: ctx.services.pen.highlight() }),
    run: (ctx) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      const pen = ctx.services.pen.highlight()
      setTextStyle(ed, { highlight: ctx.state.format.highlight === pen ? null : pen })
    },
  },
  {
    // palette swatch: becomes the new pen color AND applies
    id: commandId('docs.format.highlight.set'),
    isEnabled: canEdit,
    run: (ctx, args: { name: string }) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      ctx.services.pen.setHighlight(args.name)
      setTextStyle(ed, { highlight: args.name })
    },
  },
  {
    id: commandId('docs.format.highlight.clear'),
    isEnabled: canEdit,
    run: (ctx) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      setTextStyle(ed, { highlight: null })
    },
  },
  {
    // split-button main half: apply the pen color ('000000' renders as automatic)
    id: commandId('docs.format.fontColor.applyPen'),
    isEnabled: canEdit,
    getVisualState: (ctx) => ({ value: ctx.services.pen.color() }),
    run: (ctx) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      const pen = ctx.services.pen.color()
      setTextStyle(ed, { color: pen === '000000' ? null : pen })
    },
  },
  {
    // palette pick: becomes the new pen color AND applies (null = Automatic)
    id: commandId('docs.format.fontColor.set'),
    isEnabled: canEdit,
    run: (ctx, args: { hex: string | null }) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      if (!args.hex) {
        ctx.services.pen.setColor('000000')
        setTextStyle(ed, { color: null })
      } else {
        ctx.services.pen.setColor(args.hex)
        setTextStyle(ed, { color: args.hex === '000000' ? null : args.hex })
      }
    },
  },
]

function stepFont(ctx: Ctx, dir: 1 | -1, how: 'step' | 'nudge'): void {
  const ed = editableEditor(ctx)
  if (!ed) return
  const target = { ed, currentSize: ctx.state.format.fontSizePt, canEdit: ctx.state.canEdit }
  if (how === 'step') ctx.services.fontStep.step(dir, target)
  else ctx.services.fontStep.nudge(dir, target)
}

const paragraphCommands: Def[] = [
  ...(['bullet', 'ordered'] as const).map((kind): Def => ({
    id: commandId(`docs.para.list.toggle${kind === 'bullet' ? 'Bullet' : 'Ordered'}`),
    isEnabled: canEditOutsideSub,
    isActive: (ctx) =>
      kind === 'bullet' ? ctx.state.format.listBullet : ctx.state.format.listOrdered,
    run: (ctx) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      toggleList(ed, kind, {
        sub: ctx.state.format.sub,
        blocks: [...ctx.state.doc.blocks],
        allocateNumId: ctx.services.insert.allocateNumId,
      })
    },
  })),
  {
    // the gallery "None" card: drop list formatting, back to a plain paragraph
    id: commandId('docs.para.list.clear'),
    isEnabled: canEditOutsideSub,
    run: (ctx) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      clearList(ed, ctx.state.format.sub)
    },
  },
  {
    // gallery preset / custom dialog levels: create a definition, then apply it
    id: commandId('docs.para.list.applyPreset'),
    isEnabled: canEditOutsideSub,
    run: (ctx, args: { levels: CustomNumberingLevel[] }) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      applyListPreset(ed, args.levels, {
        sub: ctx.state.format.sub,
        createListDef: ctx.services.insert.createListDef,
      })
    },
  },
  ...([1, -1] as const).map((delta): Def => ({
    id: commandId(`docs.para.indent.${delta === 1 ? 'increase' : 'decrease'}`),
    isEnabled: canEditOutsideSub,
    run: (ctx) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      changeIndent(ed, delta, { sub: ctx.state.format.sub })
    },
  })),
  ...(['left', 'center', 'right', 'justify'] as const).map((align): Def => ({
    id: commandId(`docs.para.align.${align}`),
    isEnabled: canEdit,
    isActive: (ctx) => activeAlignOf(ctx.state.format) === align,
    run: (ctx) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      setSelectionAlign(ed, align)
    },
  })),
  ...(['ltr', 'rtl'] as const).map((dir): Def => ({
    id: commandId(`docs.para.direction.${dir}`),
    isEnabled: canEditOutsideSub,
    isActive: (ctx) => (dir === 'rtl' ? ctx.state.format.bidi : !ctx.state.format.bidi),
    run: (ctx) => {
      if (!ctx.state.canEdit || ctx.state.format.sub) return
      // legacy passes the MAIN editor here (sub-guarded, so identical to activeEditor)
      const ed = ctx.services.editor.main()
      if (!ed) return
      setParagraphDirection(ed, dir)
    },
  })),
  {
    // presets are multiples: clear any atLeast/exact rule so they take effect (null = Word default)
    id: commandId('docs.para.lineSpacing.set'),
    isEnabled: canEdit,
    getVisualState: (ctx) => ({ value: ctx.state.format.lineSpacing }),
    run: (ctx, args: { spacing: number | null }) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      setParaAttr(ed, ctx.state.format.sub, {
        lineSpacing: args.spacing,
        lineRule: null,
        lineRawTwips: null,
      })
    },
  },
  {
    id: commandId('docs.para.shading.set'),
    isEnabled: canEdit,
    isActive: (ctx) => !!ctx.state.format.shadingFill,
    run: (ctx, args: { hex: string | null }) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      setParaAttr(ed, ctx.state.format.sub, { shadingFill: args.hex })
    },
  },
  {
    id: commandId('docs.para.borders.set'),
    isEnabled: canEdit,
    isActive: (ctx) => !!ctx.state.format.paraBorders,
    run: (ctx, args: { borders: 'b' | 't' | 'l' | 'r' | 'tblr' | null }) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      setParaAttr(ed, ctx.state.format.sub, { borders: args.borders })
    },
  },
]

const styleCommands: Def[] = [
  {
    // paragraph gallery cards (Normal / Heading 1-3). Per-card active state is
    // arg-dependent (key vs deriveActiveStyleKey), so the renderer computes it.
    id: commandId('docs.style.applyParagraph'),
    isEnabled: canEditOutsideSub,
    run: (ctx, args: { key: 'p' | 'h1' | 'h2' | 'h3' }) => {
      if (!ctx.state.canEdit || ctx.state.format.sub) return
      const ed = ctx.services.editor.main()
      if (!ed) return
      applyParaStyle(ed, args.key)
    },
  },
  {
    // character styles: doc's own char styles plus the built-in Emphasis/Intense Emphasis presets
    id: commandId('docs.style.applyChar'),
    isEnabled: canEdit,
    run: (ctx, args: { styleId: string }) => {
      const ed = editableEditor(ctx)
      if (!ed) return
      applyCharStyle(ed, args.styleId, {
        activeStyleKey: deriveActiveStyleKey(ctx.state.format, {
          usingPresetFallback: !hasGalleryCharStyles(ctx.state.doc.styles),
          presetAccent: presetAccentOf(ctx.state.doc.themeColors),
        }),
        activeCharStyleId: ctx.state.format.charStyleId,
        presetAccent: presetAccentOf(ctx.state.doc.themeColors),
      })
    },
  },
]

const viewCommands: Def[] = [
  {
    // pilcrow (¶) toggle lives on the home tab but flips a view concern
    id: commandId('docs.view.toggleShowMarks'),
    isEnabled: hasDoc,
    isActive: (ctx) => ctx.state.view.showMarks,
    run: (ctx) => ctx.services.view.setShowMarks(!ctx.state.view.showMarks),
  },
]

/** every home-tab command, in ribbon visual order (clipboard → font → paragraph → styles → view) */
export const HOME_COMMANDS: readonly AnyCommandDefinition<State, Services>[] = [
  ...clipboardCommands,
  ...fontCommands,
  ...paragraphCommands,
  ...styleCommands,
  ...viewCommands,
]
