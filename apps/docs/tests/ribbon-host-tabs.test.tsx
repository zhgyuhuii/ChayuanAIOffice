// @vitest-environment jsdom
// Hosted tabs (strangler step 3): the renderBody adapters must render every
// extracted tab component through both ribbon renderers off the real
// DOCS_SCHEMA — file menu as three command-backed items, each hosted tab
// producing its legacy body when its chip is selected.
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { createCommandRegistry, DesktopRibbon, MobileRibbon } from '@chatoffice/ribbon'
import { DOCS_COMMANDS } from '../src/renderer/ribbon'
import { EMPTY_FORMAT_STATE } from '../src/renderer/components/ribbon-format-state'
import { DOCS_SCHEMA } from '../src/renderer/ribbon/schema/view-tab'
import {
  FontStepper,
  PainterService,
  PenPreferences,
  type DocsCommandServices,
  type DocsCommandState,
} from '../src/renderer/ribbon'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

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
      filePath: '/work/report.docx',
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

/** Minimal editor stand-in: legacy tab bodies read editor state during render. */
function fakeEditor(): DocsCommandServices['editor'] extends never ? never : Editor {
  const chainable: unknown = new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'run' ? () => true : chainable),
    apply: () => chainable,
  })
  const base = {
    isActive: () => false,
    getAttributes: () => ({}),
    state: { selection: {} },
  }
  return new Proxy(base, {
    get: (target, prop) =>
      prop in target ? (target as Record<PropertyKey, unknown>)[prop] : chainable,
  }) as unknown as Editor
}

function makeServices(): DocsCommandServices {
  const fn = () => vi.fn()
  return {
    editor: { main: vi.fn(fakeEditor) },
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

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn()
})

/** Real mount helper (desktop + mobile) against DOCS_SCHEMA + DOCS_COMMANDS. */
function mountSchema(
  renderer: 'desktop' | 'mobile',
  state: DocsCommandState,
  services: DocsCommandServices,
): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  cleanups.push(() => {
    act(() => {
      root.unmount()
    })
  })
  const registry = createRegistry()
  const props = {
    schema: DOCS_SCHEMA,
    registry,
    state,
    services,
    t: (key: string) => key,
    defaultTab: 'insert',
  }
  act(() => {
    root.render(
      renderer === 'desktop'
        ? h(DesktopRibbon<DocsCommandState, DocsCommandServices>, props)
        : h(MobileRibbon<DocsCommandState, DocsCommandServices>, props),
    )
  })
  return host
}

function createRegistry() {
  return createCommandRegistry<DocsCommandState, DocsCommandServices>(DOCS_COMMANDS)
}

function chipByLabel(host: HTMLElement, label: string): HTMLButtonElement {
  const chip = [...host.querySelectorAll('button')].find((b) => b.textContent === label)
  if (!chip) throw new Error(`chip "${label}" not found`)
  return chip
}

describe('hosted tabs (desktop renderer)', () => {
  it('renders a non-empty legacy body for every hosted tab', () => {
    const services = makeServices()
    const host = mountSchema('desktop', makeState(), services)
    for (const label of [
      'ribbonTabInsert',
      'ribbonTabDraw',
      'ribbonTabPage',
      'ribbonTabReferences',
      'ribbonTabReview',
    ]) {
      act(() => {
        chipByLabel(host, label).click()
      })
      const body = host.querySelector('.ribbon-body')!
      expect(body.children.length, label).toBeGreaterThan(0)
    }
  })
})

describe('file tab (mobile renderer)', () => {
  it('shows the three command-backed menu items and gates save on hasDoc', () => {
    const services = makeServices()
    const host = mountSchema('mobile', makeState(), services)
    act(() => {
      ;(host.querySelector('.mrib-file') as HTMLElement).click()
    })
    const sheet = host.querySelector('.mrib-sheet')!
    expect(sheet.querySelectorAll('.mrib-row')).toHaveLength(3)
    expect(sheet.querySelector('.mrib-row .file-menu-key')!.textContent).toBe('Ctrl+O')
    const save = [...sheet.querySelectorAll('.mrib-row')].find((row) =>
      row.textContent?.startsWith('ribbonSave'),
    ) as HTMLButtonElement
    expect(save.disabled).toBe(false)

    const noDoc = mountSchema('mobile', makeState({ hasDoc: false }), services)
    act(() => {
      ;(noDoc.querySelector('.mrib-file') as HTMLElement).click()
    })
    const sheet2 = noDoc.querySelector('.mrib-sheet')!
    const save2 = [...sheet2.querySelectorAll('.mrib-row')].find((row) =>
      row.textContent?.startsWith('ribbonSave'),
    ) as HTMLButtonElement
    expect(save2.disabled).toBe(true)
  })
})
