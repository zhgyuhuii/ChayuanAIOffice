// Home tab command layer (B2): chain-spy equivalence against the legacy
// Ribbon onClick sequences. Every expectation below is written FROM the legacy
// closure bodies (components/Ribbon.tsx): same chain() calls, same order, same
// args. Ops that delegate to shared editor helpers (applyCase,
// setSelectionAlign, stepParagraphIndent, applyParagraphStyle) are equivalence-
// checked at the delegation boundary by mocking those modules.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import type { Mark } from '@tiptap/pm/model'
import type { Block, CustomNumberingLevel } from '@chatoffice/docx-engine'
import { createCommandRegistry, type CommandContext } from '@chatoffice/ribbon'
import { EMPTY_FORMAT_STATE } from '../src/renderer/components/ribbon-format-state'
import type { RibbonFormatState } from '../src/renderer/components/ribbon-format-state'
import {
  FontStepper,
  PainterService,
  PenPreferences,
  HOME_COMMANDS,
  type DocsCommandServices,
  type DocsCommandState,
} from '../src/renderer/ribbon'
import { applyCase } from '../src/renderer/editor/case-transform'
import { setParagraphDirection, setSelectionAlign } from '../src/renderer/editor/direction'
import { stepParagraphIndent } from '../src/renderer/editor/indent'
import { applyParagraphStyle, insertImageFromDataUrl } from '../src/renderer/components/ribbon-tabs'

vi.mock('../src/renderer/editor/case-transform', () => ({ applyCase: vi.fn() }))
vi.mock('../src/renderer/editor/direction', () => ({
  setParagraphDirection: vi.fn(),
  setSelectionAlign: vi.fn(),
}))
vi.mock('../src/renderer/editor/indent', () => ({ stepParagraphIndent: vi.fn() }))
vi.mock('../src/renderer/components/ribbon-tabs', () => ({
  applyParagraphStyle: vi.fn(),
  insertImageFromDataUrl: vi.fn(),
}))

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

type Call = [string, ...unknown[]]

/** editor mock whose chain() records every call in order (chain equivalence probe) */
function makeEditor(
  opts: {
    isActive?: (name: string, attrs?: Record<string, unknown>) => boolean
    attributes?: Record<string, unknown>
  } = {},
) {
  const calls: Call[] = []
  const chainProxy: unknown = new Proxy(
    {},
    {
      get:
        (_t, prop) =>
        (...args: unknown[]) => {
          calls.push([String(prop), ...args])
          return prop === 'run' ? true : chainProxy
        },
    },
  )
  const ed = {
    chain: () => {
      calls.push(['chain'])
      return chainProxy
    },
    commands: {
      focus: () => {
        calls.push(['commands.focus'])
        return true
      },
    },
    isActive: (name: string, attrs?: Record<string, unknown>) =>
      opts.isActive?.(name, attrs) ?? false,
    getAttributes: (_name: string) => opts.attributes ?? {},
    state: { selection: { anchor: 1, head: 1 }, doc: { nodesBetween: vi.fn() } },
    view: { pasteHTML: vi.fn(), pasteText: vi.fn(), dom: document.createElement('div') },
    isEditable: true,
  } as unknown as Editor
  return { ed, calls }
}

function makeState(
  format: Partial<RibbonFormatState> = {},
  overrides: Partial<DocsCommandState> = {},
): DocsCommandState {
  return {
    format: { ...EMPTY_FORMAT_STATE, editable: true, ...format },
    hasDoc: true,
    docEmpty: false,
    canEdit: true,
    selectionKind: 'text',
    hist: { canUndo: false, canRedo: false },
    view: {
      viewMode: 'print',
      readMode: false,
      showMarks: false,
      showRuler: true,
      showNav: false,
      showGrid: false,
      splitView: false,
      darkCanvas: false,
      zoom: 100,
    },
    review: {
      trackChanges: false,
      trackChangesForced: false,
      revisionDisplay: 'all',
      revisionCount: 0,
      commentCount: 0,
      openCommentCount: 0,
      canComment: true,
      isProtected: false,
      commentsAllowed: false,
      protectActive: false,
    },
    doc: {
      filePath: null,
      blocks: [],
      styles: undefined,
      docDefaults: undefined,
      section: null,
      activeSection: null,
      pageColor: null,
      watermark: null,
      themeFonts: null,
      themeColors: null,
      header: null,
      footer: null,
      titlePg: false,
      evenOddHf: false,
    },
    draw: {
      inkTool: 'select',
      inkPen: { color: '000000', width: 2 },
      inkHighlighter: { color: 'ffff00', width: 4 },
      inkCount: 0,
    },
    ai: { showAi: false },
    sources: [],
    chayuan: { formMode: false },
    ...overrides,
  }
}

function makeServices(ed: Editor | null): DocsCommandServices {
  const fn = () => vi.fn()
  return {
    editor: { main: () => ed },
    pen: new PenPreferences(),
    painter: new PainterService(),
    fontStep: new FontStepper(),
    file: { open: fn(), save: fn(), saveAs: fn(), compare: fn(), exportPdf: fn(), printDoc: fn() },
    insert: {
      sectionBreak: fn(),
      note: fn(),
      field: fn(),
      allocateNumId: vi.fn(() => null),
      createListDef: vi.fn(() => null),
    },
    layout: { setSection: fn() },
    design: { setPageColor: fn(), setWatermark: fn(), setThemeFonts: fn(), setThemeColors: fn() },
    draw: { setInkTool: fn(), setInkPen: fn(), setInkHighlighter: fn(), clearAll: fn() },
    references: { addSource: fn(), headingPages: vi.fn(() => null) },
    review: {
      showComments: fn(),
      newComment: fn(),
      setTrackChanges: fn(),
      setRevisionDisplay: fn(),
      acceptRevision: fn(),
      rejectRevision: fn(),
      gotoRevision: fn(),
    },
    view: {
      setViewMode: fn(),
      setReadMode: fn(),
      setShowMarks: fn(),
      setShowRuler: fn(),
      setShowNav: fn(),
      setShowGrid: fn(),
      setSplitView: fn(),
      setZoom: fn(),
      zoomFit: fn(),
      setDarkCanvas: fn(),
      pagePreview: fn(),
    },
    hf: { setHeader: fn(), setFooter: fn(), setTitlePg: fn(), setEvenOddHf: fn() },
    ai: { toggle: fn(), preset: fn() },
    dialogs: { paragraph: fn(), pageNumFormat: fn(), protectDoc: fn() },
    chayuan: {
          runAssistant: fn(),
          openDialog: fn(),
          runOp: fn(),
          exportAll: fn(),
          formModeActive: () => false,
        },
  }
}

const registry = createCommandRegistry<DocsCommandState, DocsCommandServices>(HOME_COMMANDS)

function ctxOf(state: DocsCommandState, services: DocsCommandServices) {
  const ctx: CommandContext<DocsCommandState, DocsCommandServices> = { state, services }
  return ctx
}

function run(id: string, state: DocsCommandState, services: DocsCommandServices, args?: unknown) {
  registry.execute(id, ctxOf(state, services), args)
}

const enabled = (id: string, state: DocsCommandState, services: DocsCommandServices) =>
  registry.isEnabled(id, ctxOf(state, services))

const mark = (name: string, attrs: Record<string, unknown> = {}): Mark =>
  ({ type: { name }, attrs }) as unknown as Mark

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

describe('home command registration', () => {
  it('registers exactly the home-tab command set', () => {
    expect([...registry.list('docs')].sort()).toEqual(
      [
        'docs.edit.copy',
        'docs.edit.cut',
        'docs.edit.paste',
        'docs.edit.redo',
        'docs.edit.togglePainter',
        'docs.edit.undo',
        'docs.format.changeCase',
        'docs.format.clearFormatting',
        'docs.format.fontColor.applyPen',
        'docs.format.fontColor.set',
        'docs.format.fontFamily.set',
        'docs.format.fontSize.nudgeGrow',
        'docs.format.fontSize.nudgeShrink',
        'docs.format.fontSize.set',
        'docs.format.fontSize.stepGrow',
        'docs.format.fontSize.stepShrink',
        'docs.format.highlight.applyPen',
        'docs.format.highlight.clear',
        'docs.format.highlight.set',
        'docs.format.toggleBold',
        'docs.format.toggleItalic',
        'docs.format.toggleStrike',
        'docs.format.toggleSubscript',
        'docs.format.toggleSuperscript',
        'docs.format.toggleUnderline',
        'docs.para.align.center',
        'docs.para.align.justify',
        'docs.para.align.left',
        'docs.para.align.right',
        'docs.para.borders.set',
        'docs.para.direction.ltr',
        'docs.para.direction.rtl',
        'docs.para.indent.decrease',
        'docs.para.indent.increase',
        'docs.para.lineSpacing.set',
        'docs.para.list.applyPreset',
        'docs.para.list.clear',
        'docs.para.list.toggleBullet',
        'docs.para.list.toggleOrdered',
        'docs.para.shading.set',
        'docs.style.applyChar',
        'docs.style.applyParagraph',
        'docs.view.toggleShowMarks',
      ].sort(),
    )
  })
})

// ---------------------------------------------------------------------------
// enablement gates (legacy disabled={...} attributes)
// ---------------------------------------------------------------------------

describe('enablement gates', () => {
  it('format/edit commands require canEdit', () => {
    const { ed } = makeEditor()
    const services = makeServices(ed)
    const ro = makeState({}, { canEdit: false })
    for (const id of [
      'docs.edit.paste',
      'docs.edit.cut',
      'docs.format.toggleBold',
      'docs.format.fontFamily.set',
      'docs.format.fontSize.set',
      'docs.format.clearFormatting',
      'docs.para.align.left',
      'docs.para.lineSpacing.set',
    ]) {
      expect(enabled(id, ro, services), id).toBe(false)
    }
  })

  it('copy follows hasDoc, not canEdit (read-only documents can copy)', () => {
    const { ed } = makeEditor()
    const services = makeServices(ed)
    expect(enabled('docs.edit.copy', makeState({}, { canEdit: false }), services)).toBe(true)
    expect(enabled('docs.edit.copy', makeState({}, { hasDoc: false }), services)).toBe(false)
  })

  it('undo/redo gate on hasDoc AND history availability', () => {
    const { ed } = makeEditor()
    const services = makeServices(ed)
    const idle = makeState()
    expect(enabled('docs.edit.undo', idle, services)).toBe(false)
    expect(enabled('docs.edit.redo', idle, services)).toBe(false)
    const ready = makeState({}, { hist: { canUndo: true, canRedo: true } })
    expect(enabled('docs.edit.undo', ready, services)).toBe(true)
    expect(enabled('docs.edit.redo', ready, services)).toBe(true)
    const noDoc = makeState({}, { hasDoc: false, hist: { canUndo: true, canRedo: true } })
    expect(enabled('docs.edit.undo', noDoc, services)).toBe(false)
  })

  it('undo/redo run the history chain on the active editor', () => {
    const { ed, calls } = makeEditor()
    const services = makeServices(ed)
    run('docs.edit.undo', makeState({}, { hist: { canUndo: true, canRedo: false } }), services)
    run('docs.edit.redo', makeState({}, { hist: { canUndo: true, canRedo: true } }), services)
    expect(calls).toEqual([
      ['chain'],
      ['focus'],
      ['undo'],
      ['run'],
      ['chain'],
      ['focus'],
      ['redo'],
      ['run'],
    ])
  })

  it('run() no-ops without canEdit even if dispatched directly', () => {
    const { ed, calls } = makeEditor()
    const services = makeServices(ed)
    run('docs.format.toggleBold', makeState({}, { canEdit: false }), services)
    expect(calls).toEqual([])
  })

  it('textbox sub-editor disables list/indent/direction/painter but not marks or align', () => {
    const { ed: subEd } = makeEditor()
    const { ed } = makeEditor()
    const services = makeServices(ed)
    const inSub = makeState({ sub: subEd })
    for (const id of [
      'docs.para.list.toggleBullet',
      'docs.para.list.toggleOrdered',
      'docs.para.list.clear',
      'docs.para.list.applyPreset',
      'docs.para.indent.increase',
      'docs.para.indent.decrease',
      'docs.para.direction.ltr',
      'docs.para.direction.rtl',
      'docs.style.applyParagraph',
      'docs.edit.togglePainter',
    ]) {
      expect(enabled(id, inSub, services), id).toBe(false)
    }
    for (const id of ['docs.format.toggleBold', 'docs.para.align.center', 'docs.style.applyChar']) {
      expect(enabled(id, inSub, services), id).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// chain equivalence: font group
// ---------------------------------------------------------------------------

describe('font commands', () => {
  it('toggleMark buttons: chain().focus().toggleMark(name).run()', () => {
    for (const [id, name] of [
      ['docs.format.toggleBold', 'bold'],
      ['docs.format.toggleItalic', 'italic'],
      ['docs.format.toggleUnderline', 'underline'],
      ['docs.format.toggleStrike', 'strike'],
    ] as const) {
      const { ed, calls } = makeEditor()
      run(id, makeState(), makeServices(ed))
      expect(calls, id).toEqual([['chain'], ['focus'], ['toggleMark', name], ['run']])
    }
  })

  it('mark active state mirrors the format snapshot', () => {
    const { ed } = makeEditor()
    const services = makeServices(ed)
    expect(
      registry.isActive('docs.format.toggleBold', ctxOf(makeState({ bold: true }), services)),
    ).toBe(true)
    expect(registry.isActive('docs.format.toggleBold', ctxOf(makeState(), services))).toBe(false)
  })

  it('clearFormatting: chain().unsetAllMarks().run()', () => {
    const { ed, calls } = makeEditor()
    run('docs.format.clearFormatting', makeState(), makeServices(ed))
    expect(calls).toEqual([['chain'], ['focus'], ['unsetAllMarks'], ['run']])
  })

  it('sub/superscript toggle through docTextStyle vertAlign', () => {
    const { ed, calls } = makeEditor()
    run('docs.format.toggleSubscript', makeState({ vertAlign: null }), makeServices(ed))
    expect(calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { vertAlign: 'subscript' }],
      ['run'],
    ])

    const off = makeEditor()
    run('docs.format.toggleSubscript', makeState({ vertAlign: 'subscript' }), makeServices(off.ed))
    expect(off.calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { vertAlign: null }],
      ['run'],
    ])

    const other = makeEditor()
    run(
      'docs.format.toggleSuperscript',
      makeState({ vertAlign: 'subscript' }),
      makeServices(other.ed),
    )
    expect(other.calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { vertAlign: 'superscript' }],
      ['run'],
    ])
  })

  it('font family: latin names hit fontAscii, east-asian names hit font, empty clears both', () => {
    const latin = makeEditor()
    run('docs.format.fontFamily.set', makeState(), makeServices(latin.ed), { name: 'Arial' })
    expect(latin.calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { fontAscii: 'Arial' }],
      ['run'],
    ])

    const ea = makeEditor()
    run('docs.format.fontFamily.set', makeState(), makeServices(ea.ed), { name: '宋体' })
    expect(ea.calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { font: '宋体' }],
      ['run'],
    ])

    const cleared = makeEditor()
    run('docs.format.fontFamily.set', makeState(), makeServices(cleared.ed), { name: null })
    expect(cleared.calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { font: null, fontAscii: null }],
      ['run'],
    ])
  })

  it('font size set clamps to Word\u2019s 1–1638pt range and stores half-points', () => {
    const { ed, calls } = makeEditor()
    run('docs.format.fontSize.set', makeState(), makeServices(ed), { pt: 12 })
    expect(calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { sizeHalfPoints: 24 }],
      ['run'],
    ])

    const clamped = makeEditor()
    run('docs.format.fontSize.set', makeState(), makeServices(clamped.ed), { pt: 5000 })
    expect(clamped.calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { sizeHalfPoints: 3276 }],
      ['run'],
    ])
  })

  it('changeCase delegates to the shared case transform', () => {
    const { ed } = makeEditor()
    run('docs.format.changeCase', makeState(), makeServices(ed), { mode: 'upper' })
    expect(applyCase).toHaveBeenCalledWith(ed, 'upper')
  })

  it('highlight split button applies the pen color, toggling off a repeat', () => {
    const apply = makeEditor()
    run('docs.format.highlight.applyPen', makeState({ highlight: null }), makeServices(apply.ed))
    expect(apply.calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { highlight: 'yellow' }],
      ['run'],
    ])

    const off = makeEditor()
    run('docs.format.highlight.applyPen', makeState({ highlight: 'yellow' }), makeServices(off.ed))
    expect(off.calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { highlight: null }],
      ['run'],
    ])
  })

  it('highlight palette pick becomes the new pen color and applies', () => {
    const { ed, calls } = makeEditor()
    const services = makeServices(ed)
    run('docs.format.highlight.set', makeState(), services, { name: 'red' })
    expect(services.pen.highlight()).toBe('red')
    expect(calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { highlight: 'red' }],
      ['run'],
    ])
  })

  it('highlight none clears without touching the pen', () => {
    const { ed, calls } = makeEditor()
    const services = makeServices(ed)
    run('docs.format.highlight.clear', makeState({ highlight: 'red' }), services)
    expect(services.pen.highlight()).toBe('yellow')
    expect(calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { highlight: null }],
      ['run'],
    ])
  })

  it('font color split button applies the pen color (black renders as automatic)', () => {
    const apply = makeEditor()
    run('docs.format.fontColor.applyPen', makeState(), makeServices(apply.ed))
    expect(apply.calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { color: 'C00000' }],
      ['run'],
    ])

    const black = makeEditor()
    const services = makeServices(black.ed)
    services.pen.setColor('000000')
    run('docs.format.fontColor.applyPen', makeState(), services)
    expect(black.calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { color: null }],
      ['run'],
    ])
  })

  it('font color palette pick updates the pen; Automatic resets both', () => {
    const pick = makeEditor()
    const services = makeServices(pick.ed)
    run('docs.format.fontColor.set', makeState(), services, { hex: '00B050' })
    expect(services.pen.color()).toBe('00B050')
    expect(pick.calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { color: '00B050' }],
      ['run'],
    ])

    const auto = makeEditor()
    const services2 = makeServices(auto.ed)
    run('docs.format.fontColor.set', makeState(), services2, { hex: null })
    expect(services2.pen.color()).toBe('000000')
    expect(auto.calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { color: null }],
      ['run'],
    ])
  })
})

// ---------------------------------------------------------------------------
// chain equivalence: paragraph group
// ---------------------------------------------------------------------------

describe('paragraph commands', () => {
  it('bullet toggle off an active list demotes to a plain paragraph', () => {
    const { ed, calls } = makeEditor({ isActive: (name) => name === 'docListItem' })
    run('docs.para.list.toggleBullet', makeState({ listBullet: true }), makeServices(ed))
    expect(calls).toEqual([['chain'], ['focus'], ['setNode', 'docParagraph'], ['run']])
  })

  it('bullet toggle adopts an existing same-kind numId from the body', () => {
    const blocks = [{ type: 'listItem', list: { kind: 'bullet', numId: '42' } }] as Block[]
    const { ed, calls } = makeEditor()
    const services = makeServices(ed)
    run(
      'docs.para.list.toggleBullet',
      makeState({}, { doc: { ...makeState().doc, blocks } }),
      services,
    )
    expect(services.insert.allocateNumId).not.toHaveBeenCalled()
    expect(calls).toEqual([
      ['chain'],
      ['focus'],
      ['setNode', 'docListItem', { kind: 'bullet', numId: '42', ilvl: 0 }],
      ['run'],
    ])
  })

  it('ordered toggle falls back to allocateNumId when nothing is reusable', () => {
    const { ed, calls } = makeEditor()
    const services = makeServices(ed)
    ;(services.insert.allocateNumId as ReturnType<typeof vi.fn>).mockReturnValue('7')
    run('docs.para.list.toggleOrdered', makeState(), services)
    expect(services.insert.allocateNumId).toHaveBeenCalledWith('ordered')
    expect(calls).toEqual([
      ['chain'],
      ['focus'],
      ['setNode', 'docListItem', { kind: 'ordered', numId: '7', ilvl: 0 }],
      ['run'],
    ])
  })

  it('list None card clears only an active list', () => {
    const active = makeEditor({ isActive: (name) => name === 'docListItem' })
    run('docs.para.list.clear', makeState({ listBullet: true }), makeServices(active.ed))
    expect(active.calls).toEqual([['chain'], ['focus'], ['setNode', 'docParagraph'], ['run']])

    const plain = makeEditor()
    run('docs.para.list.clear', makeState(), makeServices(plain.ed))
    expect(plain.calls).toEqual([])
  })

  it('list preset creates a definition, keeps the current ilvl, maps kind from level 1', () => {
    const levels: CustomNumberingLevel[] = [
      { numFmt: 'decimal', lvlText: '%1.', indentLeft: 720, hanging: 360 },
    ]
    const inList = makeEditor({
      isActive: (name) => name === 'docListItem',
      attributes: { ilvl: 2 },
    })
    const services = makeServices(inList.ed)
    ;(services.insert.createListDef as ReturnType<typeof vi.fn>).mockReturnValue('9')
    run('docs.para.list.applyPreset', makeState({ listOrdered: true }), services, { levels })
    expect(services.insert.createListDef).toHaveBeenCalledWith(levels)
    expect(inList.calls).toEqual([
      ['chain'],
      ['focus'],
      ['setNode', 'docListItem', { kind: 'ordered', numId: '9', ilvl: 2 }],
      ['run'],
    ])
  })

  it('list preset is a no-op when the host cannot create a definition', () => {
    const { ed, calls } = makeEditor()
    run('docs.para.list.applyPreset', makeState(), makeServices(ed), {
      levels: [{ numFmt: 'bullet', lvlText: '•', indentLeft: 720, hanging: 360 }],
    })
    expect(calls).toEqual([])
  })

  it('indent commands delegate to the shared indent stepper', () => {
    const { ed } = makeEditor()
    run('docs.para.indent.increase', makeState(), makeServices(ed))
    expect(stepParagraphIndent).toHaveBeenCalledWith(ed, 1)
    run('docs.para.indent.decrease', makeState(), makeServices(ed))
    expect(stepParagraphIndent).toHaveBeenCalledWith(ed, -1)
  })

  it('align buttons delegate to the shared selection aligner and track the active align', () => {
    const { ed } = makeEditor()
    const services = makeServices(ed)
    run('docs.para.align.center', makeState(), services)
    expect(setSelectionAlign).toHaveBeenCalledWith(ed, 'center')
    // unset align follows paragraph direction: LTR → left, RTL → right
    expect(
      registry.isActive(
        'docs.para.align.left',
        ctxOf(makeState({ align: null, bidi: false }), services),
      ),
    ).toBe(true)
    expect(
      registry.isActive(
        'docs.para.align.right',
        ctxOf(makeState({ align: null, bidi: true }), services),
      ),
    ).toBe(true)
    expect(
      registry.isActive(
        'docs.para.align.justify',
        ctxOf(makeState({ align: 'justify' }), services),
      ),
    ).toBe(true)
  })

  it('direction buttons act on the main editor and track bidi', () => {
    const { ed } = makeEditor()
    const services = makeServices(ed)
    run('docs.para.direction.rtl', makeState(), services)
    expect(setParagraphDirection).toHaveBeenCalledWith(ed, 'rtl')
    expect(
      registry.isActive('docs.para.direction.rtl', ctxOf(makeState({ bidi: true }), services)),
    ).toBe(true)
    expect(
      registry.isActive('docs.para.direction.ltr', ctxOf(makeState({ bidi: false }), services)),
    ).toBe(true)
  })

  it('line spacing presets clear atLeast/exact rules; default clears the spacing too', () => {
    const { ed, calls } = makeEditor()
    run('docs.para.lineSpacing.set', makeState(), makeServices(ed), { spacing: 1.5 })
    const attrs = { lineSpacing: 1.5, lineRule: null, lineRawTwips: null }
    expect(calls).toEqual([
      ['chain'],
      ['focus'],
      ['updateAttributes', 'docParagraph', attrs],
      ['updateAttributes', 'docHeading', attrs],
      ['updateAttributes', 'docListItem', attrs],
      ['run'],
    ])

    const cleared = makeEditor()
    run('docs.para.lineSpacing.set', makeState(), makeServices(cleared.ed), { spacing: null })
    expect(cleared.calls[2]).toEqual([
      'updateAttributes',
      'docParagraph',
      { lineSpacing: null, lineRule: null, lineRawTwips: null },
    ])
  })

  it('paragraph attrs hit only docParagraph inside a textbox', () => {
    const { ed: subEd, calls } = makeEditor()
    const { ed } = makeEditor()
    run('docs.para.lineSpacing.set', makeState({ sub: subEd }), makeServices(ed), { spacing: 2 })
    expect(calls).toEqual([
      ['chain'],
      ['focus'],
      ['updateAttributes', 'docParagraph', { lineSpacing: 2, lineRule: null, lineRawTwips: null }],
      ['run'],
    ])
  })

  it('shading and borders go through the shared paragraph-attr op', () => {
    const shaded = makeEditor()
    run('docs.para.shading.set', makeState(), makeServices(shaded.ed), { hex: 'FFFF00' })
    expect(shaded.calls[2]).toEqual(['updateAttributes', 'docParagraph', { shadingFill: 'FFFF00' }])

    const boxed = makeEditor()
    run('docs.para.borders.set', makeState(), makeServices(boxed.ed), { borders: 'tblr' })
    expect(boxed.calls[2]).toEqual(['updateAttributes', 'docParagraph', { borders: 'tblr' }])

    const cleared = makeEditor()
    run('docs.para.borders.set', makeState({ paraBorders: 'tblr' }), makeServices(cleared.ed), {
      borders: null,
    })
    expect(cleared.calls[2]).toEqual(['updateAttributes', 'docParagraph', { borders: null }])
  })
})

// ---------------------------------------------------------------------------
// chain equivalence: styles + view
// ---------------------------------------------------------------------------

describe('style commands', () => {
  it('paragraph gallery cards delegate to applyParagraphStyle on the main editor', () => {
    const { ed } = makeEditor()
    run('docs.style.applyParagraph', makeState(), makeServices(ed), { key: 'h2' })
    expect(applyParagraphStyle).toHaveBeenCalledWith(ed, 'h2')
  })

  it('doc character styles toggle the docTextStyle styleId', () => {
    const on = makeEditor()
    run('docs.style.applyChar', makeState({ charStyleId: null }), makeServices(on.ed), {
      styleId: 'Strong',
    })
    expect(on.calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { styleId: 'Strong' }],
      ['run'],
    ])

    const off = makeEditor()
    run('docs.style.applyChar', makeState({ charStyleId: 'Strong' }), makeServices(off.ed), {
      styleId: 'Strong',
    })
    expect(off.calls).toEqual([['chain'], ['focus'], ['unsetMark', 'docTextStyle'], ['run']])
  })

  it('preset char styles set mark + accent, dropping the other preset mark', () => {
    const { ed, calls } = makeEditor()
    run('docs.style.applyChar', makeState(), makeServices(ed), { styleId: '__preset_strong' })
    expect(calls).toEqual([
      ['chain'],
      ['focus'],
      ['unsetMark', 'italic'],
      ['setMark', 'bold'],
      ['setMark', 'docTextStyle', { color: '4472C4' }],
      ['run'],
    ])
  })

  it('preset char styles use the doc theme accent when present (uppercased)', () => {
    const { ed, calls } = makeEditor()
    const state = makeState(
      {},
      {
        doc: {
          ...makeState().doc,
          themeColors: { accent1: 'ff0000' } as never,
        },
      },
    )
    run('docs.style.applyChar', state, makeServices(ed), { styleId: '__preset_emphasis' })
    expect(calls).toEqual([
      ['chain'],
      ['focus'],
      ['unsetMark', 'bold'],
      ['setMark', 'italic'],
      ['setMark', 'docTextStyle', { color: 'FF0000' }],
      ['run'],
    ])
  })

  it('an active preset toggles off (mark out, color cleared)', () => {
    const { ed, calls } = makeEditor()
    // activeStyleKey === 'char:__preset_strong': bold + accent text, no char style/heading
    run('docs.style.applyChar', makeState({ bold: true, textColor: '4472C4' }), makeServices(ed), {
      styleId: '__preset_strong',
    })
    expect(calls).toEqual([
      ['chain'],
      ['focus'],
      ['unsetMark', 'bold'],
      ['setMark', 'docTextStyle', { color: null }],
      ['run'],
    ])
  })

  it('pilcrow toggles the view service and tracks state', () => {
    const services = makeServices(null)
    run('docs.view.toggleShowMarks', makeState(), services)
    expect(services.view.setShowMarks).toHaveBeenCalledWith(true)
    run(
      'docs.view.toggleShowMarks',
      makeState({}, { view: { ...makeState().view, showMarks: true } }),
      services,
    )
    expect(services.view.setShowMarks).toHaveBeenCalledWith(false)
    expect(
      registry.isActive(
        'docs.view.toggleShowMarks',
        ctxOf(makeState({}, { view: { ...makeState().view, showMarks: true } }), services),
      ),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// FontStepper: coalesce window + stale-apply guard (plan risk #1)
// ---------------------------------------------------------------------------

describe('FontStepper', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const target = (ed: Editor, size = 11) => ({ ed, currentSize: size, canEdit: true })

  it('a lone click applies immediately through the focus chain', () => {
    const { ed, calls } = makeEditor()
    const stepper = new FontStepper()
    stepper.step(1, target(ed))
    expect(calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { sizeHalfPoints: 24 }], // 11 → 12pt
      ['run'],
    ])
    vi.advanceTimersByTime(300)
    expect(calls).toHaveLength(4) // pending === applied: no trailing apply
    stepper.dispose()
  })

  it('a click burst coalesces into one trailing apply without focus', () => {
    const { ed, calls } = makeEditor()
    const stepper = new FontStepper()
    stepper.step(1, target(ed)) // 11 → 12 applied immediately
    stepper.step(1, target(ed)) // 12 → 14 pending
    stepper.step(1, target(ed)) // 14 → 16 pending
    expect(calls).toHaveLength(4)
    vi.advanceTimersByTime(300)
    expect(calls).toEqual([
      ['chain'],
      ['focus'],
      ['setMark', 'docTextStyle', { sizeHalfPoints: 24 }],
      ['run'],
      ['chain'], // trailing: deliberately no focus()
      ['setMark', 'docTextStyle', { sizeHalfPoints: 32 }],
      ['run'],
    ])
    stepper.dispose()
  })

  it('drops the trailing apply when the selection moved meanwhile', () => {
    const { ed, calls } = makeEditor()
    const stepper = new FontStepper()
    stepper.step(1, target(ed))
    stepper.step(1, target(ed))
    ;(ed.state.selection as { anchor: number }).anchor = 99 // selection moved: stale
    vi.advanceTimersByTime(300)
    expect(calls).toHaveLength(4)
    stepper.dispose()
  })

  it('drops the trailing apply when the document changed meanwhile', () => {
    const { ed, calls } = makeEditor()
    const stepper = new FontStepper()
    stepper.step(1, target(ed))
    stepper.step(1, target(ed))
    ;(ed.state as { doc: unknown }).doc = {} // undo/external edit: stale
    vi.advanceTimersByTime(300)
    expect(calls).toHaveLength(4)
    stepper.dispose()
  })

  it('nudge moves exactly one point within 1–1638pt', () => {
    const { ed, calls } = makeEditor()
    const stepper = new FontStepper()
    stepper.nudge(1, target(ed, 11.5))
    expect(calls[2]).toEqual(['setMark', 'docTextStyle', { sizeHalfPoints: 26 }]) // round(11.5)+1=13 → 26hp
    stepper.dispose()

    const top = makeEditor()
    const stepper2 = new FontStepper()
    stepper2.nudge(1, target(top.ed, 1638))
    expect(top.calls[2]).toEqual(['setMark', 'docTextStyle', { sizeHalfPoints: 3276 }])
    stepper2.dispose()
  })

  it('step walks Word\u2019s preset list from an in-between size', () => {
    const { ed, calls } = makeEditor()
    const stepper = new FontStepper()
    stepper.step(1, target(ed, 11.3)) // between 11 and 12 → 12
    expect(calls[2]).toEqual(['setMark', 'docTextStyle', { sizeHalfPoints: 24 }])
    stepper.dispose()

    const down = makeEditor()
    const stepper2 = new FontStepper()
    stepper2.step(-1, target(down.ed, 11))
    expect(down.calls[2]).toEqual(['setMark', 'docTextStyle', { sizeHalfPoints: 21 }]) // → 10.5
    stepper2.dispose()
  })
})

// ---------------------------------------------------------------------------
// PainterService: pickup rules (plan risk #3)
// ---------------------------------------------------------------------------

describe('PainterService', () => {
  function painterEditor(opts: {
    empty: boolean
    caretMarks?: Mark[]
    firstTextMarks?: Mark[]
    parentAttrs?: Record<string, unknown>
    parentType?: string
    wholeParagraph?: boolean
    crossParagraph?: boolean
  }) {
    const size = 10
    const parent = {
      isTextblock: true,
      type: { name: opts.parentType ?? 'docParagraph' },
      attrs: opts.parentAttrs ?? {},
      content: { size },
    }
    const $from = {
      parent,
      parentOffset: 0,
      sameParent: () => !opts.crossParagraph,
    }
    const $to = {
      parent: opts.crossParagraph ? { ...parent } : parent,
      parentOffset: opts.wholeParagraph ? size : 4,
    }
    const selection = {
      $from,
      $to,
      $head: { marks: () => opts.caretMarks ?? [] },
      from: 1,
      to: opts.empty ? 1 : 11,
      empty: opts.empty,
    }
    const doc = {
      nodesBetween: (_from: number, _to: number, fn: (node: unknown) => boolean | void) => {
        fn({ isText: true, marks: opts.firstTextMarks ?? [] })
      },
    }
    return { state: { selection, doc } } as unknown as Editor
  }

  it('caret pickup reads the caret marks, strips rawRPr, and carries the block', () => {
    const ed = painterEditor({
      empty: true,
      caretMarks: [
        mark('bold'),
        mark('docTextStyle', { color: 'FF0000', rawRPr: '<w:rPr/>' }),
        mark('commentRange', { id: 1 }), // semantic marks are never picked up
      ],
      parentAttrs: { styleId: 'S1', align: 'center', indentLeft: 720 },
    })
    const painter = new PainterService()
    painter.toggle(ed, { canEdit: true, styles: undefined, docDefaults: undefined })
    expect(painter.current).toEqual({
      marks: [
        { type: 'bold', attrs: {} },
        { type: 'docTextStyle', attrs: { color: 'FF0000' } },
      ],
      block: {
        type: 'docParagraph',
        attrs: expect.objectContaining({ styleId: 'S1', align: 'center', indentLeft: 720 }),
      },
    })
  })

  it('a range pickup takes the FIRST character\u2019s marks', () => {
    const ed = painterEditor({
      empty: false,
      firstTextMarks: [mark('italic')],
      parentAttrs: {},
      wholeParagraph: true,
    })
    const painter = new PainterService()
    painter.toggle(ed, { canEdit: true, styles: undefined, docDefaults: undefined })
    expect(painter.current?.marks).toEqual([{ type: 'italic', attrs: {} }])
    expect(painter.current?.block?.type).toBe('docParagraph')
  })

  it('a partial in-paragraph drag is char-only but resolves style/docDefaults looks', () => {
    const ed = painterEditor({
      empty: false,
      firstTextMarks: [],
      parentAttrs: { styleId: 'Body' },
      wholeParagraph: false,
    })
    const styles = new Map([
      [
        'Body',
        {
          styleId: 'Body',
          name: 'Body',
          type: 'paragraph',
          display: { italic: true, sizeHalfPoints: 28, color: '00B050', fontAscii: 'Georgia' },
        },
      ],
    ]) as never
    const painter = new PainterService()
    painter.toggle(ed, {
      canEdit: true,
      styles,
      docDefaults: { bold: true, asciiFont: 'Calibri' } as never,
    })
    // bold from docDefaults, italic from the paragraph style (bold iterates first);
    // ts.font stays unset: no source provides one (the EA-slot guard assigns nothing)
    expect(painter.current?.marks).toEqual([
      { type: 'bold', attrs: {} },
      { type: 'italic', attrs: {} },
      {
        type: 'docTextStyle',
        attrs: {
          sizeHalfPoints: 28,
          color: '00B050',
          fontAscii: 'Georgia',
          csFont: null,
          charSpacingTwips: null,
        },
      },
    ])
    expect(painter.current?.block).toBeNull()
  })

  it('a whole-paragraph drag carries the block identity (heading level)', () => {
    const ed = painterEditor({
      empty: false,
      firstTextMarks: [mark('bold')],
      parentType: 'docHeading',
      parentAttrs: { level: 2, align: 'left' },
      wholeParagraph: true,
    })
    const painter = new PainterService()
    painter.toggle(ed, { canEdit: true, styles: undefined, docDefaults: undefined })
    expect(painter.current?.block).toEqual({
      type: 'docHeading',
      attrs: expect.objectContaining({ level: 2, align: 'left' }),
    })
  })

  it('toggle disarms an armed painter; canEdit=false never arms; subscribers fire', () => {
    const ed = painterEditor({ empty: true, caretMarks: [mark('bold')] })
    const painter = new PainterService()
    const seen: Array<boolean> = []
    const unsub = painter.subscribe(() => seen.push(painter.current !== null))
    painter.toggle(ed, { canEdit: false, styles: undefined, docDefaults: undefined })
    expect(painter.current).toBeNull()
    expect(seen).toEqual([])
    painter.toggle(ed, { canEdit: true, styles: undefined, docDefaults: undefined })
    expect(painter.current).not.toBeNull()
    painter.toggle(ed, { canEdit: true, styles: undefined, docDefaults: undefined })
    expect(painter.current).toBeNull()
    expect(seen).toEqual([true, false])
    unsub()
    painter.toggle(ed, { canEdit: true, styles: undefined, docDefaults: undefined })
    expect(seen).toEqual([true, false])
  })

  it('the togglePainter command arms/disarms through the service and reports active', () => {
    const ed = painterEditor({ empty: true, caretMarks: [mark('bold')] })
    const services = makeServices(ed)
    const state = makeState()
    run('docs.edit.togglePainter', state, services)
    expect(services.painter.current?.marks).toEqual([{ type: 'bold', attrs: {} }])
    expect(registry.isActive('docs.edit.togglePainter', ctxOf(state, services))).toBe(true)
    run('docs.edit.togglePainter', state, services)
    expect(services.painter.current).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// clipboard commands (DOM stubs: jsdom lacks DataTransfer/ClipboardEvent)
// ---------------------------------------------------------------------------

describe('clipboard commands', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'DataTransfer',
      class {
        private data = new Map<string, string>()
        setData(type: string, value: string) {
          this.data.set(type, value)
        }
        getData(type: string) {
          return this.data.get(type) ?? ''
        }
      },
    )
    vi.stubGlobal(
      'ClipboardEvent',
      class extends Event {
        clipboardData: unknown
        constructor(type: string, init?: { clipboardData?: unknown }) {
          super(type)
          this.clipboardData = init?.clipboardData
        }
      },
    )
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn(() => true),
      configurable: true,
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  function stubClipboard(
    impl: Partial<{
      read: () => Promise<unknown[]>
      readText: () => Promise<string>
    }>,
  ) {
    Object.defineProperty(navigator, 'clipboard', { value: impl, configurable: true })
  }

  it('cut/copy go through execCommand + focus; copy works without canEdit', () => {
    const { ed, calls } = makeEditor()
    run('docs.edit.cut', makeState(), makeServices(ed))
    expect(document.execCommand).toHaveBeenCalledWith('cut')
    expect(calls).toEqual([['commands.focus']])

    vi.mocked(document.execCommand).mockClear()
    const ro = makeEditor()
    run('docs.edit.copy', makeState({}, { canEdit: false }), makeServices(ro.ed))
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(ro.calls).toEqual([['commands.focus']])
  })

  it('paste prefers text/html and hands the full pipeline a real clipboard event', async () => {
    stubClipboard({
      read: async () => [
        {
          types: ['text/html', 'text/plain'],
          getType: async (type: string) => ({
            text: async () => (type === 'text/html' ? '<b>hi</b>' : 'hi'),
          }),
        },
      ],
      readText: async () => '',
    })
    const { ed, calls } = makeEditor()
    run('docs.edit.paste', makeState(), makeServices(ed))
    await vi.waitFor(() => expect(ed.view.pasteHTML).toHaveBeenCalled())
    const [html, event] = vi.mocked(ed.view.pasteHTML).mock.calls[0]
    expect(html).toBe('<b>hi</b>')
    expect((event as ClipboardEvent).clipboardData).toBeTruthy()
    expect(calls).toEqual([['commands.focus']])
  })

  it('paste falls back to readText when clipboard.read is denied', async () => {
    stubClipboard({
      read: async () => {
        throw new Error('denied')
      },
      readText: async () => 'plain text',
    })
    const { ed, calls } = makeEditor()
    run('docs.edit.paste', makeState(), makeServices(ed))
    await vi.waitFor(() => expect(ed.view.pasteText).toHaveBeenCalled())
    expect(vi.mocked(ed.view.pasteText).mock.calls[0][0]).toBe('plain text')
    expect(calls).toEqual([['commands.focus']])
  })

  it('an image item with no usable text routes to the image pipeline', async () => {
    stubClipboard({
      read: async () => [
        {
          types: ['image/png', 'text/plain'],
          getType: async (type: string) =>
            type === 'text/plain' ? { text: async () => '   ' } : new Blob(['png']),
        },
      ],
      readText: async () => '',
    })
    const { ed } = makeEditor()
    run('docs.edit.paste', makeState(), makeServices(ed))
    await vi.waitFor(() => expect(insertImageFromDataUrl).toHaveBeenCalled())
    expect(ed.view.pasteHTML).not.toHaveBeenCalled()
    expect(vi.mocked(insertImageFromDataUrl).mock.calls[0][0]).toBe(ed)
  })
})
