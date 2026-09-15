// File menu commands (B3): service delegation + the legacy enablement gates
// (open always available; save/saveAs require an open document).
import { describe, expect, it, vi } from 'vitest'
import { createCommandRegistry, type CommandContext } from '@chatoffice/ribbon'
import { FILE_COMMANDS } from '../src/renderer/ribbon/commands/file'
import { DOCS_COMMANDS } from '../src/renderer/ribbon/commands'
import type { DocsCommandServices, DocsCommandState } from '../src/renderer/ribbon'
import { FontStepper, PainterService, PenPreferences } from '../src/renderer/ribbon'
import { EMPTY_FORMAT_STATE } from '../src/renderer/components/ribbon-format-state'

function services(): DocsCommandServices {
  const fn = () => vi.fn()
  return {
    editor: { main: () => null },
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

function state(hasDoc: boolean): DocsCommandState {
  return {
    format: { ...EMPTY_FORMAT_STATE, editable: hasDoc },
    hasDoc,
    docEmpty: !hasDoc,
    canEdit: hasDoc,
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
      canComment: false,
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
  }
}

const registry = createCommandRegistry<DocsCommandState, DocsCommandServices>(FILE_COMMANDS)
const ctx = (
  hasDoc: boolean,
  svc: DocsCommandServices,
): CommandContext<DocsCommandState, DocsCommandServices> => ({
  state: state(hasDoc),
  services: svc,
})

describe('file commands', () => {
  it('open/save/saveAs delegate to the file service', () => {
    const svc = services()
    registry.execute('docs.file.open', ctx(true, svc))
    expect(svc.file.open).toHaveBeenCalledOnce()
    registry.execute('docs.file.save', ctx(true, svc))
    expect(svc.file.save).toHaveBeenCalledOnce()
    registry.execute('docs.file.saveAs', ctx(true, svc))
    expect(svc.file.saveAs).toHaveBeenCalledOnce()
  })

  it('open stays available without a document; save/saveAs do not', () => {
    const svc = services()
    expect(registry.isEnabled('docs.file.open', ctx(false, svc))).toBe(true)
    expect(registry.isEnabled('docs.file.save', ctx(false, svc))).toBe(false)
    expect(registry.isEnabled('docs.file.saveAs', ctx(false, svc))).toBe(false)
    expect(registry.isEnabled('docs.file.save', ctx(true, svc))).toBe(true)
  })

  it('DOCS_COMMANDS aggregates without id collisions', () => {
    const all = createCommandRegistry<DocsCommandState, DocsCommandServices>(DOCS_COMMANDS)
    expect(all.list('docs.file').sort()).toEqual([
      'docs.file.open',
      'docs.file.save',
      'docs.file.saveAs',
    ])
    // 60 legacy commands + the 5 察元 AI commands
    expect(all.list('docs').length).toBe(FILE_COMMANDS.length + 65)
  })
})
