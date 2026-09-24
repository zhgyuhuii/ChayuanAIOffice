// @vitest-environment jsdom
// Mobile chrome swap: Ribbon in bodyOnly mode must drop the tab strip (the
// outer MobileRibbon bar owns navigation) while keeping the body alive, and
// must report contextual auto-activation through onActiveTabChange so the
// bar stays in sync.
import { act, createElement as h } from 'react'
import type { Editor } from '@tiptap/core'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_FORMAT_STATE } from '../src/renderer/components/ribbon-format-state'
import { Ribbon } from '../src/renderer/components/Ribbon'
import {
  ribbonPropsFromHost,
  FontStepper,
  PainterService,
  PenPreferences,
} from '../src/renderer/ribbon'
import type { DocsCommandServices, DocsCommandState } from '../src/renderer/ribbon'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** Minimal editor stand-in: tab bodies read editor state during render. */
function fakeEditor(): Editor {
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

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn()
})

function mountRibbon(ui: { bodyOnly?: boolean; onActiveTabChange?: (tab: string) => void }): {
  host: HTMLElement
  setTabRequest: (tab: string) => void
} {
  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  cleanups.push(() => {
    act(() => {
      root.unmount()
    })
  })
  const services = makeServices()
  let tabRequest: { tab: string; nonce: number } | null = null
  const render = () =>
    act(() => {
      root.render(
        h(Ribbon, {
          actionsRef: { current: {} },
          quickActions: null,
          trailingActions: null,
          editor: fakeEditor(),
          tabRequest,
          bodyOnly: ui.bodyOnly,
          onActiveTabChange: ui.onActiveTabChange,
          ...ribbonPropsFromHost(makeState(), services),
        }),
      )
    })
  render()
  return {
    host,
    setTabRequest: (tab: string) => {
      tabRequest = { tab, nonce: Date.now() }
      render()
    },
  }
}

describe('Ribbon bodyOnly (mobile chrome swap)', () => {
  it('renders the body without the tab strip or file tab', () => {
    const { host } = mountRibbon({ bodyOnly: true })
    expect(host.querySelectorAll('.ribbon-tabs')).toHaveLength(0)
    expect(host.querySelector('.ribbon-body')).not.toBeNull()
    // home body is alive inside the body-only shell
    expect(host.querySelectorAll('.ribbon-group').length).toBeGreaterThan(0)
  })

  it('keeps the full chrome (strip + body) on desktop', () => {
    const { host } = mountRibbon({})
    expect(host.querySelectorAll('.ribbon-tabs')).toHaveLength(1)
    expect(host.querySelector('.ribbon-body')).not.toBeNull()
  })

  it('announces tab switches (tabRequest) through onActiveTabChange', () => {
    const onActiveTabChange = vi.fn()
    const ui = mountRibbon({ bodyOnly: true, onActiveTabChange })
    expect(onActiveTabChange).toHaveBeenCalledWith('home')
    ui.setTabRequest('page')
    expect(onActiveTabChange).toHaveBeenCalledWith('page')
  })
})
