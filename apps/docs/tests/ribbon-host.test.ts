// Ribbon host (B1): selectionKind derivation mirrors RibbonInner's contextual-tab
// triggers, and the legacy adapter must map every flat RibbonProps field the old
// assembly passed (typechecked against RibbonProps; runtime spot-checks here).
import { describe, expect, it, vi } from 'vitest'

import { EMPTY_FORMAT_STATE } from '../src/renderer/components/ribbon-format-state'
import {
  deriveSelectionKind,
  ribbonPropsFromHost,
  FontStepper,
  PainterService,
  PenPreferences,
  type DocsCommandServices,
  type DocsCommandState,
} from '../src/renderer/ribbon'

function makeState(overrides: Partial<DocsCommandState> = {}): DocsCommandState {
  return {
    format: { ...EMPTY_FORMAT_STATE },
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

function makeServices(): DocsCommandServices {
  const fn = () => vi.fn()
  return {
    editor: { main: vi.fn(() => null) },
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

describe('deriveSelectionKind', () => {
  it('is text for a plain caret', () => {
    expect(deriveSelectionKind({ ...EMPTY_FORMAT_STATE })).toBe('text')
  })

  it('is table while the cursor is in a table', () => {
    expect(deriveSelectionKind({ ...EMPTY_FORMAT_STATE, inTable: true })).toBe('table')
  })

  it('is image for a selected image block in the main editor', () => {
    expect(deriveSelectionKind({ ...EMPTY_FORMAT_STATE, imageSelected: true })).toBe('image')
  })

  it('demotes image selection while a textbox sub-editor has focus', () => {
    const sub = {} as (typeof EMPTY_FORMAT_STATE)['sub']
    expect(deriveSelectionKind({ ...EMPTY_FORMAT_STATE, imageSelected: true, sub })).toBe('text')
  })

  it('keeps shape selection standing through the sub-editor (Word behavior)', () => {
    const sub = {} as (typeof EMPTY_FORMAT_STATE)['sub']
    expect(deriveSelectionKind({ ...EMPTY_FORMAT_STATE, textboxSelected: true, sub })).toBe('shape')
  })

  it('table wins over shape when both read true', () => {
    expect(
      deriveSelectionKind({ ...EMPTY_FORMAT_STATE, inTable: true, textboxSelected: true }),
    ).toBe('table')
  })
})

describe('ribbonPropsFromHost', () => {
  it('maps state values onto the legacy flat props', () => {
    const state = makeState({
      view: { ...makeState().view, zoom: 144, darkCanvas: true },
      review: { ...makeState().review, revisionCount: 7, protectActive: true },
    })
    const props = ribbonPropsFromHost(state, makeServices())
    expect(props.formatState).toBe(state.format)
    expect(props.hasDoc).toBe(true)
    expect(props.zoom).toBe(144)
    expect(props.darkCanvas).toBe(true)
    expect(props.revisionCount).toBe(7)
    expect(props.protectActive).toBe(true)
    expect(props.showAi).toBe(false)
  })

  it('wires every legacy callback to its domain service', () => {
    const services = makeServices()
    const props = ribbonPropsFromHost(makeState(), services)
    props.onSave()
    expect(services.file.save).toHaveBeenCalledOnce()
    props.onTrackChanges(true)
    expect(services.review.setTrackChanges).toHaveBeenCalledWith(true)
    props.onZoomFit('page')
    expect(services.view.zoomFit).toHaveBeenCalledWith('page')
    props.onInkClearAll()
    expect(services.draw.clearAll).toHaveBeenCalledOnce()
    props.onParagraphDialog?.()
    expect(services.dialogs.paragraph).toHaveBeenCalledOnce()
    props.onProtectDoc()
    expect(services.dialogs.protectDoc).toHaveBeenCalledOnce()
    props.onAiPreset('translate')
    expect(services.ai.preset).toHaveBeenCalledWith('translate')
    props.onTitlePg(true)
    expect(services.hf.setTitlePg).toHaveBeenCalledWith(true)
  })
})
