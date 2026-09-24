import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => {
  const realpathSync = ((path?: string) => {
    if (path === undefined) return undefined
    if (path === '/real/file' || path === '/canonical/file' || path === '/REAL/FILE')
      return '/real/file'
    return path
  }) as typeof import('node:fs').realpathSync

  realpathSync.native = ((path?: string) => {
    if (path === undefined) return undefined
    if (path === '/real/file' || path === '/canonical/file' || path === '/REAL/FILE')
      return '/real/file'
    return path
  }) as typeof import('node:fs').realpathSync.native

  return { realpathSync }
})

/**
 * TabManager (src/main/tab-manager.ts): tab list state, activation,
 * close guards, and view lifecycle inside the shell's single window.
 * Electron and the per-module main entrypoints are mocked; only the
 * manager's own observable behavior is asserted.
 */

interface FakeWebContents {
  id: number
  on: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  reload: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  listeners: Map<string, () => void>
}

interface FakeView {
  webContents: FakeWebContents
  setVisible: ReturnType<typeof vi.fn>
  setBounds: ReturnType<typeof vi.fn>
}

let nextWebContentsId = 1

function makeFakeView(): FakeView {
  const listeners = new Map<string, () => void>()
  const remember = (event: string, handler: () => void) => {
    listeners.set(event, handler)
  }
  return {
    webContents: {
      id: nextWebContentsId++,
      listeners,
      on: vi.fn(remember),
      once: vi.fn(remember),
      close: vi.fn(),
      reload: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
    },
    setVisible: vi.fn(),
    setBounds: vi.fn(),
  }
}

vi.mock('electron', () => ({
  BrowserWindow: class {},
  // editor mains build their brand window icon at import time (see
  // tools/gen-app-icon.mjs); the mock must expose nativeImage for that
  nativeImage: { createFromPath: () => ({ addRepresentation: () => {} }) },
}))

const createDocsView = vi.fn(() => makeFakeView())
const docsQueryDirty = vi.fn(() => Promise.resolve(false))
const queueDocsAiContent = vi.fn()
const markDocsNewBlank = vi.fn()
const requestDocsClose = vi.fn(() => Promise.resolve(true))
const setActiveDocsResolver = vi.fn()
const teardownDocsRenderer = vi.fn()

vi.mock('../../docs/src/main/docs-main', () => ({
  createDocsView: (...args: unknown[]) => createDocsView(...(args as [])),
  docsQueryDirty: (...args: unknown[]) => docsQueryDirty(...(args as [])),
  markDocsNewBlank: (...args: unknown[]) => markDocsNewBlank(...(args as [])),
  queueDocsAiContent: (...args: unknown[]) => queueDocsAiContent(...(args as [])),
  requestDocsClose: (...args: unknown[]) => requestDocsClose(...(args as [])),
  setActiveDocsResolver: (...args: unknown[]) => setActiveDocsResolver(...(args as [])),
  teardownDocsRenderer: (...args: unknown[]) => teardownDocsRenderer(...(args as [])),
}))

const createPdfView = vi.fn(() => makeFakeView())
const pdfIsDirty = vi.fn(() => false)
const clearPdfDirty = vi.fn()
const requestPdfClose = vi.fn(() => Promise.resolve(true))

vi.mock('../../pdf/src/main/pdf-main', () => ({
  createPdfView: (...args: unknown[]) => createPdfView(...(args as [])),
  pdfIsDirty: (...args: unknown[]) => pdfIsDirty(...(args as [])),
  clearPdfDirty: (...args: unknown[]) => clearPdfDirty(...(args as [])),
  requestPdfClose: (...args: unknown[]) => requestPdfClose(...(args as [])),
}))

const createSheetsView = vi.fn(() => makeFakeView())
const nudgeQueuedWorkbook = vi.fn()
const queueWorkbookForView = vi.fn()
const requestSheetsClose = vi.fn(() => Promise.resolve(true))
const setActiveSheetsWebContents = vi.fn()
const setSheetsNewBlank = vi.fn()
const sheetsPendingEditCount = vi.fn(() => 0)

vi.mock('../../sheets/src/main/sheets-main', () => ({
  createSheetsView: (...args: unknown[]) => createSheetsView(...(args as [])),
  nudgeQueuedWorkbook: (...args: unknown[]) => nudgeQueuedWorkbook(...args),
  queueWorkbookForView: (...args: unknown[]) => queueWorkbookForView(...args),
  requestSheetsClose: (...args: unknown[]) => requestSheetsClose(...(args as [])),
  setActiveSheetsWebContents: (...args: unknown[]) => setActiveSheetsWebContents(...args),
  setSheetsNewBlank: (...args: unknown[]) => setSheetsNewBlank(...args),
  sheetsPendingEditCount: (...args: unknown[]) => sheetsPendingEditCount(...(args as [])),
}))

const createSlidesView = vi.fn(() => makeFakeView())
const requestSlidesClose = vi.fn(() => Promise.resolve(true))
const setActiveSlidesWebContents = vi.fn()
const slidesIsDirty = vi.fn(() => false)

vi.mock('../../slides/src/main/slides-main', () => ({
  createSlidesView: (...args: unknown[]) => createSlidesView(...(args as [])),
  requestSlidesClose: (...args: unknown[]) => requestSlidesClose(...(args as [])),
  setActiveSlidesWebContents: (...args: unknown[]) => setActiveSlidesWebContents(...(args as [])),
  slidesIsDirty: (...args: unknown[]) => slidesIsDirty(...(args as [])),
}))

const createMarkdownView = vi.fn(() => makeFakeView())
const markdownIsDirty = vi.fn(() => false)
const queueMarkdownAiContent = vi.fn()
const requestMarkdownClose = vi.fn(() => Promise.resolve(true))

vi.mock('../../markdown/src/main/markdown-main', () => ({
  createMarkdownView: (...args: unknown[]) => createMarkdownView(...(args as [])),
  markdownIsDirty: (...args: unknown[]) => markdownIsDirty(...(args as [])),
  queueMarkdownAiContent: (...args: unknown[]) => queueMarkdownAiContent(...(args as [])),
  requestMarkdownClose: (...args: unknown[]) => requestMarkdownClose(...(args as [])),
}))

const createHtmlView = vi.fn(() => makeFakeView())
const createHtmlPresentView = vi.fn(() => makeFakeView())
const htmlIsDirty = vi.fn(() => false)
const requestHtmlClose = vi.fn(() => Promise.resolve(true))
const queueHtmlAiContent = vi.fn()

vi.mock('../../html/src/main/html-main', () => ({
  createHtmlView: (...args: unknown[]) => createHtmlView(...(args as [])),
  createHtmlPresentView: (...args: unknown[]) => createHtmlPresentView(...(args as [])),
  htmlIsDirty: (...args: unknown[]) => htmlIsDirty(...(args as [])),
  requestHtmlClose: (...args: unknown[]) => requestHtmlClose(...(args as [])),
  queueHtmlAiContent: (...args: unknown[]) => queueHtmlAiContent(...(args as [])),
}))

import { TabManager } from '../src/main/tab-manager'

const TAB_STRIP_HEIGHT = 40
const TREE_SIDEBAR_WIDTH = 232
const WINDOW_WIDTH = 800
const WINDOW_HEIGHT = 600

interface FakeShellWindow {
  on: ReturnType<typeof vi.fn>
  webContents: { once: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> }
  isDestroyed: ReturnType<typeof vi.fn>
  isFocused: ReturnType<typeof vi.fn>
  getContentBounds: () => { x: number; y: number; width: number; height: number }
  contentView: {
    addChildView: ReturnType<typeof vi.fn>
    removeChildView: ReturnType<typeof vi.fn>
    /** maintained by the addChildView/removeChildView implementations */
    children: FakeView[]
  }
}

function makeShellWindow(): FakeShellWindow {
  const children: FakeView[] = []
  return {
    on: vi.fn(),
    webContents: { once: vi.fn(), focus: vi.fn() },
    isDestroyed: vi.fn(() => false),
    isFocused: vi.fn(() => true),
    getContentBounds: () => ({ x: 0, y: 0, width: WINDOW_WIDTH, height: WINDOW_HEIGHT }),
    contentView: {
      addChildView: vi.fn((view: FakeView) => {
        children.push(view)
      }),
      removeChildView: vi.fn((view: FakeView) => {
        const idx = children.indexOf(view)
        if (idx >= 0) children.splice(idx, 1)
      }),
      children,
    },
  }
}

let shellWindow: FakeShellWindow
let onChanged: ReturnType<typeof vi.fn>
let applyMenuFor: ReturnType<typeof vi.fn>
let manager: TabManager

function lastCreatedView(factory: ReturnType<typeof vi.fn>): FakeView {
  return factory.mock.results.at(-1)!.value as FakeView
}

beforeEach(() => {
  vi.clearAllMocks()
  nextWebContentsId = 1
  docsQueryDirty.mockImplementation(() => Promise.resolve(false))
  requestDocsClose.mockImplementation(() => Promise.resolve(true))
  pdfIsDirty.mockImplementation(() => false)
  sheetsPendingEditCount.mockImplementation(() => 0)
  slidesIsDirty.mockImplementation(() => false)
  shellWindow = makeShellWindow()
  onChanged = vi.fn()
  applyMenuFor = vi.fn()
  manager = new TabManager(
    shellWindow as never,
    () => onChanged(),
    (kind) => applyMenuFor(kind),
  )
})

describe('initial state', () => {
  it('starts with only the non-closable, active Home tab', () => {
    expect(manager.list()).toEqual([
      { id: 'home', kind: 'home', title: 'ChaAI Office', closable: false, active: true },
    ])
  })
})

describe('opening tabs', () => {
  it('opens a docs tab, activates it, and attaches its view to the window', () => {
    const id = manager.openDocsTab()
    const tabs = manager.list()
    expect(tabs).toHaveLength(2)
    expect(tabs[1]).toMatchObject({
      id,
      kind: 'docs',
      title: 'ChaAI Office Docs',
      closable: true,
      active: true,
    })
    expect(tabs[0].active).toBe(false)
    expect(shellWindow.contentView.addChildView).toHaveBeenCalledTimes(1)
    expect(applyMenuFor).toHaveBeenLastCalledWith('docs')
    expect(onChanged).toHaveBeenCalled()
  })

  it('titles file-backed tabs with the file basename', () => {
    manager.openDocsTab('/tmp/report.docx')
    manager.openSheetsTab('/tmp/budget.xlsx')
    manager.openSlidesTab('/tmp/deck.pptx')
    manager.openPdfTab('/tmp/scan.pdf')
    expect(manager.list().map((t) => t.title)).toEqual([
      'ChaAI Office',
      'report.docx',
      'budget.xlsx',
      'deck.pptx',
      'scan.pdf',
    ])
  })

  it('uses module default titles for pathless tabs', () => {
    manager.openSheetsTab()
    manager.openSlidesTab()
    expect(manager.list().map((t) => t.title)).toEqual(['ChaAI Office', 'AI Sheets', 'AI Slides'])
  })

  it('assigns unique, monotonic tab ids', () => {
    const a = manager.openDocsTab()
    const b = manager.openSheetsTab()
    expect(a).not.toBe(b)
    expect(a).toBe('t1')
    expect(b).toBe('t2')
  })

  it('forwards the new-blank flag to the module', () => {
    manager.openDocsTab(undefined, { newBlank: true })
    expect(markDocsNewBlank).toHaveBeenCalledTimes(1)
    manager.openSheetsTab(undefined, { newBlank: true })
    expect(setSheetsNewBlank).toHaveBeenCalledTimes(1)
  })

  it('seeds an untitled html tab with AI content and titles it with the suggested name', () => {
    const id = manager.openHtmlTabWithContent('<html><body>x</body></html>', '大美中国')
    expect(manager.list().at(-1)).toMatchObject({
      id,
      kind: 'html',
      title: '大美中国',
      closable: true,
      active: true,
    })
    // the view is created pathless (untitled) and the content rides the
    // queue the renderer drains on boot — nothing is written to disk
    expect(createHtmlView).toHaveBeenLastCalledWith(undefined)
    expect(queueHtmlAiContent).toHaveBeenCalledWith(
      lastCreatedView(createHtmlView).webContents,
      '<html><body>x</body></html>',
      '大美中国',
    )
  })
})

describe('spare sheets view', () => {
  function homeLoaded(): void {
    const call = shellWindow.webContents.once.mock.calls.find(
      ([event]) => event === 'did-finish-load',
    )
    ;(call![1] as () => void)()
  }

  it('warms a hidden sheets view after the home page loads and hands it to the next open', () => {
    vi.useFakeTimers()
    try {
      homeLoaded()
      expect(createSheetsView).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1500)
      expect(createSheetsView).toHaveBeenCalledTimes(1)
      const spare = lastCreatedView(createSheetsView)
      expect(setActiveSheetsWebContents).toHaveBeenLastCalledWith(null)
      expect(shellWindow.contentView.addChildView).toHaveBeenCalledWith(spare)
      expect(spare.setVisible).toHaveBeenLastCalledWith(false)
      expect(manager.list()).toHaveLength(1)

      manager.openSheetsTab('/tmp/budget.xlsx')
      expect(createSheetsView).toHaveBeenCalledTimes(1)
      expect(shellWindow.contentView.addChildView).toHaveBeenCalledTimes(1)
      expect(queueWorkbookForView).toHaveBeenCalledWith(spare.webContents, '/tmp/budget.xlsx')
      expect(nudgeQueuedWorkbook).toHaveBeenCalledWith(spare.webContents)
      expect(spare.setVisible).toHaveBeenLastCalledWith(true)
      expect(manager.list()[1]).toMatchObject({
        kind: 'sheets',
        title: 'budget.xlsx',
        active: true,
      })

      vi.advanceTimersByTime(3000)
      expect(createSheetsView).toHaveBeenCalledTimes(2)
      expect(lastCreatedView(createSheetsView)).not.toBe(spare)
      expect(setActiveSheetsWebContents).toHaveBeenLastCalledWith(spare.webContents)
    } finally {
      vi.useRealTimers()
    }
  })

  it('creates a fresh view when no spare is ready and does not nudge it', () => {
    manager.openSheetsTab('/tmp/budget.xlsx')
    expect(createSheetsView).toHaveBeenCalledTimes(1)
    expect(nudgeQueuedWorkbook).not.toHaveBeenCalled()
  })

  it('drops a spare whose renderer died instead of handing it out', () => {
    vi.useFakeTimers()
    try {
      homeLoaded()
      vi.advanceTimersByTime(1500)
      const spare = lastCreatedView(createSheetsView)
      const gone = spare.webContents.once.mock.calls.find(
        ([event]) => event === 'render-process-gone',
      )
      ;(gone![1] as () => void)()
      expect(spare.webContents.close).toHaveBeenCalledTimes(1)
      manager.openSheetsTab()
      expect(createSheetsView).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays off under GENOFFICE_NO_SPARE_VIEW', () => {
    vi.stubEnv('GENOFFICE_NO_SPARE_VIEW', '1')
    vi.useFakeTimers()
    try {
      homeLoaded()
      vi.advanceTimersByTime(5000)
      expect(createSheetsView).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      vi.unstubAllEnvs()
    }
  })
})

describe('activation', () => {
  it('shows only the activated tab view and lays it out below the tab strip', () => {
    const docsId = manager.openDocsTab()
    const docsView = lastCreatedView(createDocsView)
    manager.openSheetsTab()
    const sheetsView = lastCreatedView(createSheetsView)

    manager.activateTab(docsId)
    expect(docsView.setVisible).toHaveBeenLastCalledWith(true)
    expect(sheetsView.setVisible).toHaveBeenLastCalledWith(false)
    // the home tree stays visible beside the view: bounds start at its width
    expect(docsView.setBounds).toHaveBeenLastCalledWith({
      x: TREE_SIDEBAR_WIDTH,
      y: TAB_STRIP_HEIGHT,
      width: WINDOW_WIDTH - TREE_SIDEBAR_WIDTH,
      height: WINDOW_HEIGHT - TAB_STRIP_HEIGHT,
    })
    expect(manager.list().find((t) => t.id === docsId)?.active).toBe(true)
  })

  it('hands keyboard focus to the activated view so typing works right after open/switch', () => {
    const docsId = manager.openDocsTab()
    const docsView = lastCreatedView(createDocsView)
    expect(docsView.webContents.focus).toHaveBeenCalled()

    docsView.webContents.focus.mockClear()
    manager.activateTab('home')
    expect(shellWindow.webContents.focus).toHaveBeenCalled()
    manager.activateTab(docsId)
    expect(docsView.webContents.focus).toHaveBeenCalledTimes(1)
  })

  it('does not steal OS focus for a background open (window unfocused)', () => {
    shellWindow.isFocused.mockReturnValue(false)
    manager.openDocsTab()
    const docsView = lastCreatedView(createDocsView)
    expect(docsView.webContents.focus).not.toHaveBeenCalled()

    // the window `focus` handler runs it once the user comes back
    shellWindow.isFocused.mockReturnValue(true)
    manager.focusActiveView()
    expect(docsView.webContents.focus).toHaveBeenCalledTimes(1)
  })

  it('ignores activation of unknown tab ids', () => {
    onChanged.mockClear()
    manager.activateTab('nope')
    expect(onChanged).not.toHaveBeenCalled()
    expect(manager.list()[0].active).toBe(true)
  })

  it('routes the active webContents to the matching module', () => {
    manager.openSheetsTab()
    const sheetsView = lastCreatedView(createSheetsView)
    expect(setActiveSheetsWebContents).toHaveBeenLastCalledWith(sheetsView.webContents)

    manager.openSlidesTab()
    const slidesView = lastCreatedView(createSlidesView)
    expect(setActiveSlidesWebContents).toHaveBeenLastCalledWith(slidesView.webContents)
  })

  it('lets the active view cover the tab strip during HTML fullscreen', () => {
    manager.openSlidesTab()
    const view = lastCreatedView(createSlidesView)
    view.webContents.listeners.get('enter-html-full-screen')!()
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    })
    view.webContents.listeners.get('leave-html-full-screen')!()
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: TREE_SIDEBAR_WIDTH,
      y: TAB_STRIP_HEIGHT,
      width: WINDOW_WIDTH - TREE_SIDEBAR_WIDTH,
      height: WINDOW_HEIGHT - TAB_STRIP_HEIGHT,
    })
  })
})

describe('home tree inset', () => {
  it('insets document views by the sidebar width by default (tree visible)', () => {
    manager.openDocsTab()
    expect(lastCreatedView(createDocsView).setBounds).toHaveBeenLastCalledWith({
      x: TREE_SIDEBAR_WIDTH,
      y: TAB_STRIP_HEIGHT,
      width: WINDOW_WIDTH - TREE_SIDEBAR_WIDTH,
      height: WINDOW_HEIGHT - TAB_STRIP_HEIGHT,
    })
  })

  it('setTreeInset(false) gives the view the full content width', () => {
    manager.openDocsTab()
    manager.setTreeInset(false)
    expect(lastCreatedView(createDocsView).setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: TAB_STRIP_HEIGHT,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT - TAB_STRIP_HEIGHT,
    })
  })

  it('setTreeInset re-insets and skips redundant same-value updates', () => {
    manager.openDocsTab()
    const view = lastCreatedView(createDocsView)
    manager.setTreeInset(false)
    view.setBounds.mockClear()

    manager.setTreeInset(false)
    expect(view.setBounds).not.toHaveBeenCalled()

    manager.setTreeInset(true)
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: TREE_SIDEBAR_WIDTH,
      y: TAB_STRIP_HEIGHT,
      width: WINDOW_WIDTH - TREE_SIDEBAR_WIDTH,
      height: WINDOW_HEIGHT - TAB_STRIP_HEIGHT,
    })
  })

  it('fullscreen bleed still covers the whole window while the tree is visible', () => {
    manager.openSlidesTab()
    const view = lastCreatedView(createSlidesView)
    view.webContents.listeners.get('enter-html-full-screen')!()
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    })
  })
})

describe('shell modal overlay (settings)', () => {
  it('hides the active editor view while open, restores and re-fits on close', () => {
    manager.openDocsTab()
    const view = lastCreatedView(createDocsView)
    view.setVisible.mockClear()
    view.setBounds.mockClear()

    manager.setShellModalOpen(true)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    expect(view.setBounds).not.toHaveBeenCalled()

    manager.setShellModalOpen(false)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    expect(view.setBounds).toHaveBeenCalledTimes(1)
  })

  it('keeps newly activated views hidden while the modal stays open', () => {
    const docsId = manager.openDocsTab()
    manager.openSheetsTab()
    manager.setShellModalOpen(true)

    manager.activateTab(docsId)
    expect(lastCreatedView(createDocsView).setVisible).toHaveBeenLastCalledWith(false)
  })

  it('is a no-op when only the home tab (no view) is active', () => {
    expect(() => {
      manager.setShellModalOpen(true)
      manager.setShellModalOpen(false)
    }).not.toThrow()
  })
})

describe('window resize layout', () => {
  function resizeHandler(): () => void {
    const call = shellWindow.on.mock.calls.find((c) => c[0] === 'resize')
    expect(call).toBeDefined()
    return call![1] as () => void
  }

  it('re-lays out after resize bounds settle (Linux/X11 stale getContentBounds)', async () => {
    // On X11, `resize` fires before the WM applies maximize bounds, so the first
    // layout still sees the pre-maximize size. The deferred layout must pick up
    // the real size on the next turn (see issue #15).
    manager.openSheetsTab()
    const view = lastCreatedView(createSheetsView)
    view.setBounds.mockClear()

    let width = WINDOW_WIDTH
    let height = WINDOW_HEIGHT
    shellWindow.getContentBounds = () => ({ x: 0, y: 0, width, height })

    resizeHandler()()
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: TREE_SIDEBAR_WIDTH,
      y: TAB_STRIP_HEIGHT,
      width: WINDOW_WIDTH - TREE_SIDEBAR_WIDTH,
      height: WINDOW_HEIGHT - TAB_STRIP_HEIGHT,
    })

    // Bounds update after the synchronous layout, as on X11 maximize.
    width = 1920
    height = 1080
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: TREE_SIDEBAR_WIDTH,
      y: TAB_STRIP_HEIGHT,
      width: 1920 - TREE_SIDEBAR_WIDTH,
      height: 1080 - TAB_STRIP_HEIGHT,
    })
    expect(view.setBounds).toHaveBeenCalledTimes(2)
  })

  it('skips deferred layout after the shell window is destroyed', async () => {
    manager.openSheetsTab()
    const view = lastCreatedView(createSheetsView)
    view.setBounds.mockClear()

    resizeHandler()()
    expect(view.setBounds).toHaveBeenCalledTimes(1)

    shellWindow.isDestroyed.mockReturnValue(true)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(view.setBounds).toHaveBeenCalledTimes(1)
  })
})

describe('closing tabs', () => {
  it('never closes the Home tab', async () => {
    await manager.closeTab('home')
    expect(manager.list()).toHaveLength(1)

    manager.openHomeTab()
    manager.closeActiveTab()
    await Promise.resolve()
    expect(manager.list()).toHaveLength(1)
  })

  it('removes a clean tab and falls back to the previous tab', async () => {
    manager.openSheetsTab()
    const sheetsView = lastCreatedView(createSheetsView)
    const slidesId = manager.openSlidesTab()

    await manager.closeTab(slidesId)
    const tabs = manager.list()
    expect(tabs.map((t) => t.id)).toEqual(['home', 't1'])
    expect(tabs[1].active).toBe(true)
    expect(sheetsView.setVisible).toHaveBeenLastCalledWith(true)
  })

  it('keeps the current tab active when closing a background tab', async () => {
    const sheetsId = manager.openSheetsTab()
    const slidesId = manager.openSlidesTab()
    await manager.closeTab(sheetsId)
    expect(manager.list().find((t) => t.id === slidesId)?.active).toBe(true)
  })

  it('detaches and destroys non-docs views on close', async () => {
    const id = manager.openSheetsTab()
    const view = lastCreatedView(createSheetsView)
    await manager.closeTab(id)
    expect(shellWindow.contentView.removeChildView).toHaveBeenCalledWith(view)
    expect(view.webContents.close).toHaveBeenCalledTimes(1)
  })

  it('detaches docs views without destroying the webContents (freeze workaround)', async () => {
    const id = manager.openDocsTab()
    const view = lastCreatedView(createDocsView)
    await manager.closeTab(id)
    expect(shellWindow.contentView.removeChildView).toHaveBeenCalledWith(view)
    expect(view.webContents.close).not.toHaveBeenCalled()
    // the orphaned renderer must be told to go inert (recovery-copy resurrection guard)
    expect(teardownDocsRenderer).toHaveBeenCalledWith(view.webContents)
  })

  it('closes a clean docs tab after the async dirty query says clean', async () => {
    const id = manager.openDocsTab()
    await manager.closeTab(id)
    expect(docsQueryDirty).toHaveBeenCalledTimes(1)
    expect(requestDocsClose).not.toHaveBeenCalled()
    expect(manager.list()).toHaveLength(1)
  })

  it('keeps a dirty docs tab open when the user cancels the close guard', async () => {
    docsQueryDirty.mockImplementation(() => Promise.resolve(true))
    requestDocsClose.mockImplementation(() => Promise.resolve(false))
    const id = manager.openDocsTab()
    await manager.closeTab(id)
    expect(requestDocsClose).toHaveBeenCalledTimes(1)
    expect(manager.list().map((t) => t.id)).toEqual(['home', id])
  })

  it('activates a dirty background tab before showing its close guard', async () => {
    sheetsPendingEditCount.mockImplementation(() => 1)
    requestSheetsClose.mockImplementation(() => Promise.resolve(false))
    const sheetsId = manager.openSheetsTab()
    manager.openSlidesTab()

    await manager.closeTab(sheetsId)
    expect(requestSheetsClose).toHaveBeenCalledTimes(1)
    // the guarded tab was brought into view for the prompt
    expect(manager.list().find((t) => t.id === sheetsId)?.active).toBe(true)
  })

  it('closes a dirty sheets tab when the guard resolves true', async () => {
    sheetsPendingEditCount.mockImplementation(() => 1)
    requestSheetsClose.mockImplementation(() => Promise.resolve(true))
    const id = manager.openSheetsTab()
    await manager.closeTab(id)
    expect(manager.list()).toHaveLength(1)
  })

  it('does not stack close guards while one prompt is pending', async () => {
    sheetsPendingEditCount.mockImplementation(() => 1)
    let resolveGuard!: (ok: boolean) => void
    requestSheetsClose.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveGuard = resolve
        }),
    )
    const id = manager.openSheetsTab()
    const first = manager.closeTab(id)
    const second = manager.closeTab(id)
    resolveGuard(true)
    await Promise.all([first, second])
    expect(requestSheetsClose).toHaveBeenCalledTimes(1)
    expect(manager.list()).toHaveLength(1)
  })
})

describe('file path bookkeeping', () => {
  it('updates the tab title when a module opens a file in an existing tab', () => {
    manager.openDocsTab()
    const view = lastCreatedView(createDocsView)
    manager.setTabFileFor(view.webContents.id, '/tmp/final.docx')
    expect(manager.list()[1].title).toBe('final.docx')
    expect(manager.findDocsTabByPath('/tmp/final.docx')).toBe('t1')
  })

  it('ignores setTabFileFor for unknown webContents', () => {
    onChanged.mockClear()
    manager.setTabFileFor(999, '/tmp/x.docx')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('renames matching tabs and reports the affected views', () => {
    manager.openDocsTab('/tmp/old.docx')
    const view = lastCreatedView(createDocsView)
    const affected = manager.renameTabFile('/tmp/old.docx', '/tmp/new.docx')
    expect(affected).toEqual([{ kind: 'docs', webContents: view.webContents }])
    expect(manager.list()[1].title).toBe('new.docx')
    expect(manager.findDocsTabByPath('/tmp/new.docx')).toBe('t1')
    expect(manager.findDocsTabByPath('/tmp/old.docx')).toBeUndefined()
  })

  it('returns no affected views when nothing matches a rename', () => {
    onChanged.mockClear()
    expect(manager.renameTabFile('/tmp/none.docx', '/tmp/new.docx')).toEqual([])
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('finds tabs by kind and path', () => {
    manager.openSheetsTab('/tmp/a.xlsx')
    manager.openSlidesTab('/tmp/b.pptx')
    manager.openPdfTab('/tmp/c.pdf')
    expect(manager.findSheetsTab()).toBe('t1')
    expect(manager.findSheetsTabByPath('/tmp/a.xlsx')).toBe('t1')
    expect(manager.findSlidesTabByPath('/tmp/b.pptx')).toBe('t2')
    expect(manager.findPdfTabByPath('/tmp/c.pdf')).toBe('t3')
    expect(manager.findPdfTabByPath('/tmp/missing.pdf')).toBeUndefined()
  })

  it('finds every document family by a canonicalized path alias', () => {
    const docsId = manager.openDocsTab('/real/file')
    const sheetsId = manager.openSheetsTab('/real/file')
    const slidesId = manager.openSlidesTab('/real/file')
    const pdfId = manager.openPdfTab('/real/file')
    // markdown/html view factories need electron protocol mocks the shell
    // suite does not provide, so seed their tab records directly: the
    // finders only read kind/view/filePath.
    const seedTab = (kind: string, filePath: string) => {
      const tabs = (
        manager as unknown as {
          tabs: Array<{ id: string; kind: string; view: unknown; filePath: string }>
        }
      ).tabs
      const id = `seed-${kind}`
      tabs.push({ id, kind, view: {}, filePath })
      return id
    }
    const markdownId = seedTab('markdown', '/real/file')
    const htmlId = seedTab('html', '/real/file')

    expect(manager.findDocsTabByPath('/canonical/file')).toBe(docsId)
    expect(manager.findSheetsTabByPath('/REAL/FILE')).toBe(sheetsId)
    expect(manager.findSlidesTabByPath('/canonical/file')).toBe(slidesId)
    expect(manager.findPdfTabByPath('/REAL/FILE')).toBe(pdfId)
    expect(manager.findMarkdownTabByPath('/canonical/file')).toBe(markdownId)
    expect(manager.findHtmlTabByPath('/REAL/FILE')).toBe(htmlId)
    expect(manager.findDocsTabByPath('/missing')).toBeUndefined()
    expect(manager.findDocsTabByPath()).toBeUndefined()
  })

  it('reloads an existing pdf tab so a re-export rereads the file from disk', () => {
    const id = manager.openPdfTab('/tmp/c.pdf')
    const view = lastCreatedView(createPdfView)
    manager.reloadTab(id)
    expect(clearPdfDirty).toHaveBeenCalledWith(view.webContents.id)
    expect(view.webContents.reload).toHaveBeenCalledTimes(1)
  })

  it('reports the active pdf tab with its id (so callers can re-activate it)', () => {
    const pdfId = manager.openPdfTab('/tmp/c.pdf')
    const active = manager.activePdfTab()
    expect(active?.id).toBe(pdfId)
    expect(active?.filePath).toBe('/tmp/c.pdf')
    manager.openDocsTab()
    expect(manager.activePdfTab()).toBeUndefined()
  })
})

describe('dirty-tab queries (shell close guard)', () => {
  it('lists only tabs whose module reports unsaved changes', () => {
    const dirtySheetsId = manager.openSheetsTab()
    const dirtyView = lastCreatedView(createSheetsView)
    manager.openSheetsTab()
    sheetsPendingEditCount.mockImplementation((id: number) =>
      id === dirtyView.webContents.id ? 3 : 0,
    )

    const dirty = manager.dirtySheetsTabs()
    expect(dirty).toEqual([{ id: dirtySheetsId, webContents: dirtyView.webContents }])
  })

  it('lists dirty pdf and slides tabs', () => {
    const pdfId = manager.openPdfTab('/tmp/c.pdf')
    const slidesId = manager.openSlidesTab()
    expect(manager.dirtyPdfTabs()).toEqual([])
    expect(manager.dirtySlidesTabs()).toEqual([])
    pdfIsDirty.mockImplementation(() => true)
    slidesIsDirty.mockImplementation(() => true)
    expect(manager.dirtyPdfTabs().map((t) => t.id)).toEqual([pdfId])
    expect(manager.dirtySlidesTabs().map((t) => t.id)).toEqual([slidesId])
  })

  it('lists every live docs tab for the async dirtiness sweep', () => {
    manager.openDocsTab()
    manager.openSheetsTab()
    manager.openDocsTab('/tmp/a.docx')
    expect(manager.docsTabs().map((t) => t.id)).toEqual(['t1', 't3'])
  })
})

describe('§12 orphan-view hardening', () => {
  function contentBounds() {
    return {
      x: TREE_SIDEBAR_WIDTH,
      y: TAB_STRIP_HEIGHT,
      width: WINDOW_WIDTH - TREE_SIDEBAR_WIDTH,
      height: WINDOW_HEIGHT - TAB_STRIP_HEIGHT,
    }
  }

  it('layout() recovers from a stale activeId whose tab record was lost', () => {
    manager.openDocsTab()
    manager.openSheetsTab()
    manager.openHomeTab()
    // simulate the record being lost under the manager (§12 repro shape)
    ;(manager as unknown as { activeId: string }).activeId = 'ghost'

    manager.layout()
    expect(manager.list().find((t) => t.active)?.kind).toBe('home')
    // every mounted view was re-fitted instead of being skipped forever
    for (const view of shellWindow.contentView.children) {
      expect(view.setBounds).toHaveBeenLastCalledWith(contentBounds())
    }
  })

  it('home-active layout re-fits hidden registered views without touching their visibility', () => {
    const docsId = manager.openDocsTab()
    const view = lastCreatedView(createDocsView)
    manager.openHomeTab()
    view.setBounds.mockClear()
    view.setVisible.mockClear()

    manager.layout()
    expect(view.setBounds).toHaveBeenLastCalledWith(contentBounds())
    expect(view.setVisible).not.toHaveBeenCalled()
    expect(manager.list().find((t) => t.id === docsId)?.active).toBe(false)
  })

  it('a view mounted without a tab record (orphan) is re-fitted and hidden', () => {
    manager.openHomeTab()
    const orphan = makeFakeView()
    orphan.setVisible.mockClear()
    shellWindow.contentView.addChildView(orphan as never)

    manager.layout()
    expect(orphan.setBounds).toHaveBeenLastCalledWith(contentBounds())
    expect(orphan.setVisible).toHaveBeenLastCalledWith(false)
  })

  it('an editor-active layout only re-fits the active view (orphans left alone)', () => {
    manager.openDocsTab()
    const activeView = lastCreatedView(createDocsView)
    const orphan = makeFakeView()
    shellWindow.contentView.addChildView(orphan as never)
    orphan.setBounds.mockClear()

    manager.layout()
    expect(activeView.setBounds).toHaveBeenLastCalledWith(contentBounds())
    expect(orphan.setBounds).not.toHaveBeenCalled()
  })

  it('webContents destroyed under a background tab drops its record and notifies', () => {
    manager.openSheetsTab()
    const sheetsView = lastCreatedView(createSheetsView)
    const slidesId = manager.openSlidesTab()
    onChanged.mockClear()

    sheetsView.webContents.listeners.get('destroyed')!()
    const tabs = manager.list()
    expect(tabs.map((t) => t.id)).toEqual(['home', slidesId])
    expect(tabs.find((t) => t.id === slidesId)?.active).toBe(true)
    expect(onChanged).toHaveBeenCalled()
    expect(shellWindow.contentView.children).not.toContain(sheetsView)
  })

  it('webContents destroyed under the active tab falls back to the previous tab', () => {
    const sheetsId = manager.openSheetsTab()
    manager.openSlidesTab()
    const slidesView = lastCreatedView(createSlidesView)
    // the dead view owned the fullscreen/bleed state — both must clear
    slidesView.webContents.listeners.get('enter-html-full-screen')!()

    slidesView.webContents.listeners.get('destroyed')!()
    const tabs = manager.list()
    expect(tabs.map((t) => t.id)).toEqual(['home', sheetsId])
    expect(tabs.find((t) => t.id === sheetsId)?.active).toBe(true)
  })

  it('destroyed firing after closeTab already removed the record is a no-op', async () => {
    const id = manager.openSheetsTab()
    const view = lastCreatedView(createSheetsView)
    await manager.closeTab(id)
    onChanged.mockClear()

    view.webContents.listeners.get('destroyed')!()
    expect(manager.list()).toHaveLength(1)
    expect(onChanged).not.toHaveBeenCalled()
  })
})

describe('Home right-pane docking (P1 契约)', () => {
  const DOCK_RECT = { x: 500, y: 40, width: 300, height: 500 }

  function viewOf(factory: ReturnType<typeof vi.fn>): FakeView {
    return factory.mock.results.at(-1)!.value as FakeView
  }

  it('docks a registered tab that stays hidden until the renderer mirrors a rect', () => {
    manager.setDockRect(DOCK_RECT)
    const id = manager.dockEditorTab('docs')
    const view = viewOf(createDocsView)
    expect(id).toBe('t1')
    // docking keeps Home active: the pane paints beside the conversation
    expect(manager.list().find((t) => t.id === 'home')?.active).toBe(true)
    expect(manager.list().find((t) => t.id === id)?.docked).toBe(true)
    expect(view.setBounds).toHaveBeenLastCalledWith(DOCK_RECT)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
  })

  it('keeps the dock view hidden while no rect has arrived (pre-boot guard)', () => {
    manager.dockEditorTab('docs')
    const view = viewOf(createDocsView)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
  })

  it('dock views only paint while Home is the active tab', () => {
    manager.setDockRect(DOCK_RECT)
    manager.dockEditorTab('docs')
    const dockView = viewOf(createDocsView)

    const sheetsId = manager.openSheetsTab()
    const sheetsView = viewOf(createSheetsView)
    expect(manager.list().find((t) => t.id === sheetsId)?.active).toBe(true)
    expect(dockView.setVisible).toHaveBeenLastCalledWith(false)
    expect(sheetsView.setVisible).toHaveBeenLastCalledWith(true)

    manager.openHomeTab()
    expect(dockView.setVisible).toHaveBeenLastCalledWith(true)
    expect(sheetsView.setVisible).toHaveBeenLastCalledWith(false)
  })

  it('activating a docked tab in the strip pops it out to a full tab', () => {
    manager.setDockRect(DOCK_RECT)
    const dockId = manager.dockEditorTab('docs')
    const dockView = viewOf(createDocsView)

    manager.activateTab(dockId)
    expect(manager.list().find((t) => t.id === dockId)?.docked).toBeUndefined()
    expect(manager.list().find((t) => t.id === dockId)?.active).toBe(true)
    expect(dockView.setVisible).toHaveBeenLastCalledWith(true)
    expect(dockView.setBounds).toHaveBeenLastCalledWith({
      x: TREE_SIDEBAR_WIDTH,
      y: TAB_STRIP_HEIGHT,
      width: WINDOW_WIDTH - TREE_SIDEBAR_WIDTH,
      height: WINDOW_HEIGHT - TAB_STRIP_HEIGHT,
    })
  })

  it('undockTab is the same pop-out, and the pane falls back to the neighbor dock', () => {
    manager.setDockRect(DOCK_RECT)
    const first = manager.dockEditorTab('docs')
    const second = manager.dockEditorTab('sheets', { file: '/tmp/b.xlsx' })
    const secondView = viewOf(createSheetsView)

    manager.undockTab(first)
    expect(manager.list().find((t) => t.id === first)?.docked).toBeUndefined()
    expect(manager.dockedTabs().map((t) => t.id)).toEqual([second])
    // the popped tab fills the window now; back on Home the remaining dock
    // takes over the pane
    manager.openHomeTab()
    expect(secondView.setVisible).toHaveBeenLastCalledWith(true)
  })

  it('activateDockedTab switches which dock fills the pane', () => {
    manager.setDockRect(DOCK_RECT)
    const a = manager.dockEditorTab('docs')
    const b = manager.dockEditorTab('sheets', { file: '/tmp/b.xlsx' })
    const aView = viewOf(createDocsView)
    const bView = viewOf(createSheetsView)

    manager.activateDockedTab(a)
    expect(aView.setVisible).toHaveBeenLastCalledWith(true)
    expect(bView.setVisible).toHaveBeenLastCalledWith(false)
    expect(manager.dockedTabs().find((t) => t.id === a)?.active).toBe(true)
    expect(manager.dockedTabs().find((t) => t.id === b)?.active).toBe(false)
  })

  it('re-docking the same file reuses the already-docked tab', () => {
    manager.setDockRect(DOCK_RECT)
    const first = manager.dockEditorTab('sheets', { file: '/tmp/a.xlsx' })
    const again = manager.dockEditorTab('sheets', { file: '/tmp/a.xlsx' })
    expect(again).toBe(first)
    expect(createSheetsView).toHaveBeenCalledTimes(1)
  })

  it('a fresh seeded document never reuses a blank dock', () => {
    manager.setDockRect(DOCK_RECT)
    manager.dockEditorTab('docs', { newBlank: true, aiContent: { title: 'T', html: '<p>x</p>' } })
    const second = manager.dockEditorTab('docs', {
      newBlank: true,
      aiContent: { title: 'T2', html: '<p>y</p>' },
    })
    expect(second).not.toBe('t1')
    expect(createDocsView).toHaveBeenCalledTimes(2)
    expect(queueDocsAiContent).toHaveBeenCalledTimes(2)
  })

  it('docks default to a hidden AI panel (?panel=0); an explicit false opts out', () => {
    manager.dockEditorTab('docs', { newBlank: true })
    expect(createDocsView).toHaveBeenLastCalledWith(undefined, { hidePanel: true })
    manager.dockEditorTab('docs', { newBlank: true, hidePanel: false })
    expect(createDocsView).toHaveBeenLastCalledWith(undefined, { hidePanel: false })
  })

  it('closing the active dock falls back to the neighbor while Home stays active', async () => {
    manager.setDockRect(DOCK_RECT)
    const a = manager.dockEditorTab('docs')
    manager.dockEditorTab('sheets', { file: '/tmp/b.xlsx' })
    const bView = viewOf(createSheetsView)

    await manager.closeTab(a)
    expect(manager.list().map((t) => t.id)).toEqual(['home', 't2'])
    expect(manager.list().find((t) => t.active)?.id).toBe('home')
    expect(bView.setVisible).toHaveBeenLastCalledWith(true)
  })

  it('enforces the signed LRU cap: over 3 docks, the oldest is really closed', async () => {
    manager.setDockRect(DOCK_RECT)
    const ids = [
      manager.dockEditorTab('docs'),
      manager.dockEditorTab('sheets', { file: '/tmp/b.xlsx' }),
      manager.dockEditorTab('slides', { file: '/tmp/c.pptx' }),
      manager.dockEditorTab('markdown', { file: '/tmp/d.md' }),
    ]
    await Promise.resolve()
    expect(manager.dockedTabs().map((t) => t.id)).toEqual(ids.slice(1))
    expect(manager.list().map((t) => t.id)).toEqual(['home', ...ids.slice(1)])
  })

  it('a shell modal hides the dock view too, and closing it restores the pane', () => {
    manager.setDockRect(DOCK_RECT)
    manager.dockEditorTab('docs')
    const view = viewOf(createDocsView)

    manager.setShellModalOpen(true)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    manager.setShellModalOpen(false)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    expect(view.setBounds).toHaveBeenLastCalledWith(DOCK_RECT)
  })

  it('a docked editor entering HTML fullscreen pops out first', () => {
    manager.setDockRect(DOCK_RECT)
    const id = manager.dockEditorTab('slides')
    const view = viewOf(createSlidesView)

    view.webContents.listeners.get('enter-html-full-screen')!()
    expect(manager.list().find((t) => t.id === id)?.docked).toBeUndefined()
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    })
  })

  it('activateDocumentTab focuses a docked tab without leaving Home', () => {
    manager.setDockRect(DOCK_RECT)
    const a = manager.dockEditorTab('docs')
    const b = manager.dockEditorTab('sheets', { file: '/tmp/b.xlsx' })
    const bView = viewOf(createSheetsView)

    manager.activateDocumentTab(b)
    expect(manager.list().find((t) => t.id === 'home')?.active).toBe(true)
    expect(manager.dockedTabs().find((t) => t.id === b)?.active).toBe(true)
    expect(manager.dockedTabs().find((t) => t.id === a)?.active).toBe(false)
    expect(bView.setVisible).toHaveBeenLastCalledWith(true)
  })

  it('activateDocumentTab hands the window to a full tab', () => {
    manager.setDockRect(DOCK_RECT)
    const dockId = manager.dockEditorTab('docs')
    manager.dockEditorTab('sheets', { file: '/tmp/b.xlsx' })
    const fullId = manager.openSheetsTab('/tmp/c.xlsx')

    manager.activateDocumentTab(fullId)
    expect(manager.list().find((t) => t.id === fullId)?.active).toBe(true)
    expect(manager.list().find((t) => t.id === dockId)?.docked).toBe(true)
  })
})
