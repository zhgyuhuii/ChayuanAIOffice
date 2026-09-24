// @vitest-environment jsdom
// Schema migration beachhead (1/N): the View tab as DOCS_SCHEMA must render
// through BOTH ribbon renderers off the live DOCS_COMMANDS registry — pressed
// looks from command isActive, dispatches reaching the view services, the
// page-preview gate, and the mobile sheet exposing the same commands as rows.
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCommandRegistry, DesktopRibbon, MobileRibbon } from '@chatoffice/ribbon'
import { EMPTY_FORMAT_STATE } from '../src/renderer/components/ribbon-format-state'
import { DOCS_COMMANDS, DOCS_SCHEMA } from '../src/renderer/ribbon'
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

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn()
  delete (window as unknown as { desktop?: unknown }).desktop
})

/** Renders one renderer against the real DOCS_SCHEMA + DOCS_COMMANDS registry. */
function mount(
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
  const registry = createCommandRegistry<DocsCommandState, DocsCommandServices>(DOCS_COMMANDS)
  const props = {
    schema: DOCS_SCHEMA,
    registry,
    state,
    services,
    t: (key: string) => key,
    defaultTab: 'view',
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

function buttonByLabel(host: HTMLElement, label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  )
  if (!button) throw new Error(`button "${label}" not found`)
  return button
}

describe('DOCS_SCHEMA view tab (desktop renderer)', () => {
  it('renders all five groups and seventeen big buttons', () => {
    const host = mount('desktop', makeState(), makeServices())
    const labels = [...host.querySelectorAll('.ribbon-group-label')].map((el) => el.textContent)
    expect(labels).toEqual([
      'ribbonGroupViews',
      'ribbonGroupZoom',
      'ribbonGroupAppearance',
      'ribbonGroupShow',
      'ribbonGroupWindow',
    ])
    expect(host.querySelectorAll('.rb-big')).toHaveLength(17)
  })

  it('carries the pressed look from command isActive', () => {
    const host = mount('desktop', makeState(), makeServices())
    // print layout is the active view, ruler is on
    expect(buttonByLabel(host, 'ribbonPrintLayout').className).toContain('active')
    expect(buttonByLabel(host, 'ribbonRuler').className).toContain('active')
    expect(buttonByLabel(host, 'ribbonWebLayout').className).not.toContain('active')
  })

  it('dispatches toggles through the registry to the view services', () => {
    const services = makeServices()
    const host = mount('desktop', makeState(), services)
    act(() => {
      buttonByLabel(host, 'ribbonZoomIn').click()
    })
    expect(services.view.setZoom).toHaveBeenCalledWith(110)
    act(() => {
      buttonByLabel(host, 'ribbonWebLayout').click()
    })
    expect(services.view.setViewMode).toHaveBeenCalledWith('web')
    act(() => {
      buttonByLabel(host, 'ribbonDarkMode').click()
    })
    expect(services.view.setDarkCanvas).toHaveBeenCalledWith(true)
  })

  it('gates page preview on print layout + editing mode', () => {
    const web = makeState({ view: { ...makeState().view, viewMode: 'web' } })
    const host = mount('desktop', web, makeServices())
    expect(buttonByLabel(host, 'ribbonPagePreview').disabled).toBe(true)
    const reading = makeState({ view: { ...makeState().view, readMode: true } })
    const host2 = mount('desktop', reading, makeServices())
    expect(buttonByLabel(host2, 'ribbonPagePreview').disabled).toBe(true)
  })
})

describe('DOCS_SCHEMA view tab (mobile renderer)', () => {
  function openTools(host: HTMLElement): HTMLElement {
    act(() => {
      ;(host.querySelector('.mrib-tab-trigger') as HTMLElement).click()
    })
    return host.querySelector('.mrib-sheet')!
  }

  it('exposes the same seventeen commands as sheet rows', () => {
    const host = mount('mobile', makeState(), makeServices())
    expect(host.querySelector('.mrib-tab-trigger')!.textContent).toContain('ribbonTabView')
    const sheet = openTools(host)
    const labels = [...sheet.querySelectorAll('.mrib-row-label')].map((el) => el.textContent)
    expect(labels).toContain('ribbonZoomIn')
    expect(labels).toContain('ribbonSplit')
    expect(sheet.querySelectorAll('.mrib-group')).toHaveLength(5)
  })

  it('dispatches rows through the same registry', () => {
    const services = makeServices()
    const host = mount('mobile', makeState(), services)
    const sheet = openTools(host)
    act(() => {
      buttonByLabel(sheet, 'ribbonZoomOut').click()
    })
    expect(services.view.setZoom).toHaveBeenCalledWith(90)
  })

  it('disables gated rows (page preview off print layout)', () => {
    const web = makeState({ view: { ...makeState().view, viewMode: 'web' } })
    const host = mount('mobile', web, makeServices())
    const sheet = openTools(host)
    expect(buttonByLabel(sheet, 'ribbonPagePreview').disabled).toBe(true)
  })

  it('reaches window.desktop for the new-tab command', () => {
    const openNewTab = vi.fn()
    ;(window as unknown as { desktop: unknown }).desktop = { openNewTab }
    const services = makeServices()
    const host = mount('mobile', makeState(), services)
    const sheet = openTools(host)
    act(() => {
      buttonByLabel(sheet, 'ribbonNewTab').click()
    })
    expect(openNewTab).toHaveBeenCalledWith('/work/report.docx')
  })
})
