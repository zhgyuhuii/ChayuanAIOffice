import { realpathSync } from 'node:fs'
import { basename } from 'node:path'
import { BrowserWindow } from 'electron'
import type { Rectangle, WebContents, WebContentsView } from 'electron'

import {
  createDocsView,
  docsQueryDirty,
  markDocsNewBlank,
  queueDocsAiContent,
  requestDocsClose,
  setActiveDocsResolver,
  teardownDocsRenderer,
} from '../../../docs/src/main/docs-main'
import type { AiDocContent } from '../../../docs/src/shared/ipc'
import {
  createMarkdownView,
  markdownIsDirty,
  queueMarkdownAiContent,
  requestMarkdownClose,
} from '../../../markdown/src/main/markdown-main'
import {
  createHtmlPresentView,
  createHtmlView,
  htmlIsDirty,
  queueHtmlAiContent,
  requestHtmlClose,
} from '../../../html/src/main/html-main'
import {
  createPdfView,
  clearPdfDirty,
  pdfIsDirty,
  requestPdfClose,
} from '../../../pdf/src/main/pdf-main'
import {
  createSheetsView,
  nudgeQueuedWorkbook,
  queueWorkbookForView,
  requestSheetsClose,
  setActiveSheetsWebContents,
  setSheetsNewBlank,
  sheetsPendingEditCount,
} from '../../../sheets/src/main/sheets-main'
import {
  createSlidesView,
  requestSlidesClose,
  setActiveSlidesWebContents,
  slidesIsDirty,
} from '../../../slides/src/main/slides-main'
import type { DockEditorOptions, DockKind, DockRect, DockTabSummary } from '../shared/dock-api'
import type { DocumentTabKind, OpenDocumentTab, TabKind, TabSummary } from '../shared/tabs-api'
interface TabRecord {
  id: string
  kind: TabKind
  /** null for the Home tab — it's rendered by the shell window's own webContents */
  view: WebContentsView | null
  title: string
  filePath?: string
  /** chrome-free Present tab: no file, no editor menu or save/export targets */
  present?: boolean
  /** docked into the Home right pane: paints at the mirrored dockRect while
   *  Home is active (P1 契约, apps/shell/src/shared/dock-api.ts); clicking
   *  the tab in the strip pops it out to a full tab */
  docked?: boolean
}

/** must match the tab strip's rendered height (apps/shell/src/renderer/src/TabBar.tsx) */
const TAB_STRIP_HEIGHT = 40
/** default home sidebar width (home.css .sidebar); the renderer mirrors its
 *  live width over setTreeWidth, so this is only the pre-first-message value */
const TREE_SIDEBAR_DEFAULT = 232
const HOME_ID = 'home'

/**
 * Owns every open tab (Home + docs + sheets) inside the shell's single
 * BrowserWindow. Docs/sheets tabs are WebContentsView children of that
 * window; only the active one is visible at a time. Home has no view of its
 * own — hiding every other tab reveals the shell window's own content.
 */
export class TabManager {
  private readonly tabs: TabRecord[] = [
    { id: HOME_ID, kind: 'home', view: null, title: 'ChaAI Office' },
  ]
  private activeId: string = HOME_ID
  private nextId = 1
  /** tab whose page entered HTML fullscreen (e.g. slides slideshow) — its view covers the tab strip */
  private htmlFullScreenId: string | null = null
  /** webContents ids whose view must cover the tab strip without HTML fullscreen
   *  (slides show: the window snaps via simpleFullScreen and asks for the bleed
   *  over IPC, since requestFullscreen would animate the native transition) */
  private readonly bleedWcIds = new Set<number>()
  /** home tree visible beside document tabs; the shell renderer mirrors its
   *  persisted leftCollapsed flag over setTreeInset (default: visible) */
  private treeInset = true
  /** live home tree strip width (renderer mirrors drags over setTreeWidth) */
  private treeWidth = TREE_SIDEBAR_DEFAULT
  /** a shell modal (settings) has the window: the active editor view is hidden
   *  because shell DOM always paints beneath WebContentsViews */
  private shellModalOpen = false
  /** tabs mid unsaved-changes prompt, so a second close click doesn't stack dialogs */
  private readonly closingIds = new Set<string>()
  /** Home right-pane dock (P1 契约): mirrored pane rect (CSS px ≡ DIP) and
   *  which docked tab fills the pane; docked views only paint while Home is
   *  the active tab */
  private dockRect: DockRect | null = null
  private activeDockId: string | null = null
  /** Sheets renderer mounted ahead of the next open: parsing its bundle and
   *  booting Univer is the bulk of a workbook's open time, and the shell hands
   *  the path over after mount anyway. */
  private spareSheetsView: WebContentsView | null = null
  private spareSheetsTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly shellWindow: BrowserWindow,
    private readonly onChanged: () => void,
    private readonly applyMenuFor: (kind: TabKind) => void,
    /** localized placeholder title for a tab that has no file yet */
    private readonly untitledTitleFor?: (kind: TabKind) => string,
  ) {
    // Layout once synchronously for macOS/Windows (bounds are already correct),
    // then once more on the next tick. On Linux/X11, `resize` fires before the
    // window manager applies the new size, so getContentBounds() is still the
    // pre-maximize size inside the handler and a follow-up layout is required.
    // See https://github.com/genspark-ai/chatoffice/issues/15
    shellWindow.on('resize', () => {
      if (process.env.CHATOFFICE_MENU_DEBUG) console.log('[layout-debug] resize event')
      this.layout()
      setImmediate(() => this.layout())
    })
    shellWindow.webContents.once('did-finish-load', () => this.scheduleSpareSheetsView(1500))
  }

  private scheduleSpareSheetsView(delayMs: number): void {
    if (process.env.GENOFFICE_NO_SPARE_VIEW || this.spareSheetsTimer) return
    this.spareSheetsTimer = setTimeout(() => {
      this.spareSheetsTimer = null
      if (this.spareSheetsView || this.shellWindow.isDestroyed()) return
      const view = createSheetsView({ includeAiHandlers: false })
      // registering the session made the spare the menu-action target
      const active = this.tabs.find((t) => t.id === this.activeId)
      setActiveSheetsWebContents(
        active?.kind === 'sheets' && active.view ? active.view.webContents : null,
      )
      this.shellWindow.contentView.addChildView(view)
      view.setVisible(false)
      view.setBounds(this.contentBounds())
      view.webContents.once('render-process-gone', () => {
        if (this.spareSheetsView !== view) return
        this.spareSheetsView = null
        view.webContents.close()
      })
      this.spareSheetsView = view
    }, delayMs)
  }

  private takeSpareSheetsView(): WebContentsView | null {
    const view = this.spareSheetsView
    this.spareSheetsView = null
    return view && !view.webContents.isDestroyed() ? view : null
  }

  private untitled(kind: TabKind, fallback: string): string {
    return this.untitledTitleFor?.(kind) ?? fallback
  }

  private contentBounds(): Rectangle {
    const { width, height } = this.shellWindow.getContentBounds()
    if (this.htmlFullScreenId !== null && this.htmlFullScreenId === this.activeId) {
      return { x: 0, y: 0, width, height }
    }
    const active = this.tabs.find((t) => t.id === this.activeId)
    if (active?.view && this.bleedWcIds.has(active.view.webContents.id)) {
      return { x: 0, y: 0, width, height }
    }
    const x = this.treeInset ? this.treeWidth : 0
    return {
      x,
      y: TAB_STRIP_HEIGHT,
      width: Math.max(0, width - x),
      height: Math.max(0, height - TAB_STRIP_HEIGHT),
    }
  }

  /** show/hide the home tree strip beside document tabs (renderer-relayed
   *  home-layout leftCollapsed); re-fits the active view immediately */
  setTreeInset(visible: boolean): void {
    if (this.treeInset === visible) return
    this.treeInset = visible
    this.layout()
  }

  /** renderer dragged the tree splitter: track the new strip width live */
  setTreeWidth(px: number): void {
    if (!Number.isFinite(px) || px === this.treeWidth) return
    this.treeWidth = px
    this.layout()
  }

  /** shell modal (settings) lifetime: hide the covering editor view while it
   *  is up, restore + re-fit when it closes */
  setShellModalOpen(open: boolean): void {
    if (this.shellModalOpen === open) return
    this.shellModalOpen = open
    const active = this.tabs.find((t) => t.id === this.activeId)
    if (open) {
      // hide every painting view: the active full tab, and — when Home is
      // active — the dock filling the pane
      if (active?.view) active.view.setVisible(false)
      const dock = this.tabs.find((t) => t.id === this.activeDockId)
      dock?.view?.setVisible(false)
    } else {
      if (active?.view) active.view.setVisible(true)
      this.layout()
    }
  }

  /** Grow/restore a tab view over the tab strip on request (slides show fullscreen) */
  setContentBleed(wc: WebContents, on: boolean): void {
    if (on) this.bleedWcIds.add(wc.id)
    else this.bleedWcIds.delete(wc.id)
    this.layout()
  }

  /**
   * When a tab's page enters HTML fullscreen (the slides slideshow calls requestFullscreen),
   * grow its view over the tab strip so nothing of the shell chrome shows;
   * restore the normal bounds on leave.
   */
  private trackHtmlFullScreen(id: string, view: WebContentsView): void {
    view.webContents.on('enter-html-full-screen', () => {
      // a docked editor cannot bleed its fullscreen over Home — pop it out
      // to a full tab first (activateTab clears the docked flag)
      if (this.tabs.find((t) => t.id === id)?.docked) this.activateTab(id)
      this.htmlFullScreenId = id
      this.layout()
    })
    view.webContents.on('leave-html-full-screen', () => {
      if (this.htmlFullScreenId === id) this.htmlFullScreenId = null
      this.layout()
    })
  }

  /** §12 hardening: a tab whose webContents died outside closeTab (renderer
   *  teardown, crash cleanup) must leave the tab list immediately — a stale
   *  record would keep activeId pointing at a dead view and every later
   *  layout() would skip its setBounds. closeTab's own path is idempotent
   *  here: by the time its close() fires this event, the record is gone. */
  private watchViewLifetime(id: string, view: WebContentsView): void {
    const wcId = view.webContents.id
    view.webContents.once('destroyed', () => {
      const idx = this.tabs.findIndex((t) => t.id === id && t.view === view)
      if (idx < 0) return
      this.tabs.splice(idx, 1)
      if (this.htmlFullScreenId === id) this.htmlFullScreenId = null
      this.bleedWcIds.delete(wcId)
      if (this.activeDockId === id) this.activeDockId = this.dockedNeighbor(id)
      if (this.shellWindow.isDestroyed()) return
      const children = this.shellWindow.contentView.children
      if (children.includes(view)) {
        this.shellWindow.contentView.removeChildView(view)
      }
      if (this.activeId === id) {
        const fallback = this.tabs[idx - 1] ?? this.tabs[0]
        this.activateTab(fallback ? fallback.id : HOME_ID)
      } else {
        this.onChanged()
      }
    })
  }

  /** re-fit the active tab's view after a window resize */
  layout(): void {
    // Deferred resize layouts can land after the shell window was closed.
    if (this.shellWindow.isDestroyed()) return
    // §12 hardening: an activeId whose tab record is gone (closed/lost under
    // us) must never wedge the layout chain — fall back to Home so the
    // mounted-view sweep below still runs.
    if (!this.tabs.some((t) => t.id === this.activeId)) this.activeId = HOME_ID
    const active = this.tabs.find((t) => t.id === this.activeId)
    if (process.env.CHATOFFICE_MENU_DEBUG) {
      console.log(
        '[layout-debug] layout active=',
        active?.title ?? '(none)',
        'activeId=',
        String(this.activeId),
        'tabs=',
        JSON.stringify(
          this.tabs.map((x) => ({ id: x.id, kind: x.kind, label: x.title, hasView: !!x.view })),
        ),
        'content=',
        JSON.stringify(this.shellWindow.getContentBounds()),
      )
    }
    if (active?.view) {
      active.view.setBounds(this.contentBounds())
      return
    }
    // Home (or a view-less tab) is active: the docked editors own the pane.
    // Registered full-tab views are already hidden by activateTab(home) and
    // only take fresh bounds; docked views paint at the mirrored pane rect
    // (the active dock visible, the rest hidden until switched to); a child
    // that slipped past tab registration (the §12 orphan — a view whose
    // creator never pushed a TabRecord) would otherwise keep frozen bounds
    // forever AND sit over Home stealing input, so it is re-fitted and hidden.
    for (const child of this.shellWindow.contentView.children) {
      const tab = this.tabs.find((t) => t.view === child)
      if (tab?.docked) {
        if (this.dockRect) child.setBounds(this.dockRect)
        child.setVisible(tab.id === this.activeDockId && !!this.dockRect && !this.shellModalOpen)
      } else {
        child.setBounds(this.contentBounds())
        if (!tab) child.setVisible(false)
      }
    }
  }

  /** files open in any tab, for the open-documents registry */
  openFilePaths(): string[] {
    return this.tabs.flatMap((t) => (t.filePath ? [t.filePath] : []))
  }

  list(): TabSummary[] {
    return this.tabs.map((t) => ({
      id: t.id,
      kind: t.kind,
      title: t.title,
      closable: t.id !== HOME_ID,
      active: t.id === this.activeId,
      ...(t.filePath ? { filePath: t.filePath } : {}),
      ...(t.docked ? { docked: true } : {}),
    }))
  }

  /**
   * Documents an MCP agent may act on: every editor tab except Home (no file)
   * and chrome-free Present tabs (a live preview of another tab's document, so
   * acting on it would double-count that document).
   *
   * Dirtiness is resolved here per family because it is not uniform — five
   * families answer synchronously in the main process, docs has to ask its
   * renderer. Hence the async signature.
   */
  webContentsForTab(id: string): WebContents | undefined {
    return this.tabs.find((t) => t.id === id)?.view?.webContents
  }

  /** the editor tab showing this file, whichever module owns it (path compared after resolving links) */
  findTabByPath(
    path?: string,
  ): { id: string; kind: TabKind; webContents: WebContents } | undefined {
    const wanted = canonicalPath(path)
    const tab = this.tabs.find(
      (t) => t.view && t.filePath && !t.present && canonicalPath(t.filePath) === wanted,
    )
    return tab?.view ? { id: tab.id, kind: tab.kind, webContents: tab.view.webContents } : undefined
  }

  async openDocuments(): Promise<OpenDocumentTab[]> {
    const tabs = this.tabs.filter((tab) => tab.kind !== 'home' && !tab.present && tab.view)
    return Promise.all(
      tabs.map(async (tab) => ({
        id: tab.id,
        kind: tab.kind as DocumentTabKind,
        title: tab.title,
        ...(tab.filePath ? { filePath: tab.filePath } : {}),
        active: tab.id === this.activeId,
        dirty: await this.tabIsDirty(tab),
      })),
    )
  }

  /** unsaved-changes state of one tab, whichever family owns it */
  private async tabIsDirty(tab: TabRecord): Promise<boolean> {
    const wc = tab.view?.webContents
    if (!wc || wc.isDestroyed()) return false
    switch (tab.kind) {
      case 'sheets':
        return sheetsPendingEditCount(wc.id) > 0
      case 'pdf':
        return pdfIsDirty(wc.id)
      case 'markdown':
        return markdownIsDirty(wc.id)
      case 'html':
        return htmlIsDirty(wc.id)
      case 'slides':
        return slidesIsDirty(wc.id)
      case 'docs':
        return docsQueryDirty(wc)
      default:
        return false
    }
  }

  openHomeTab(): void {
    this.activateTab(HOME_ID)
  }

  // ── Home right-pane docking (P1 契约, apps/shell/src/shared/dock-api.ts) ──

  /** signed LRU cap: how many docked editor tabs may stay alive at once */
  private static readonly DOCK_TAB_CAP = 3

  /** the next docked tab to fall back to when one closes/detaches */
  private dockedNeighbor(ofId: string): string | null {
    const docked = this.tabs.filter((t) => t.docked)
    if (docked.length === 0) return null
    const idx = docked.findIndex((t) => t.id === ofId)
    if (idx < 0) return docked[0]!.id
    return (docked[idx + 1] ?? docked[idx - 1] ?? docked[0])!.id
  }

  /** renderer mirrored the dock pane's rect (CSS px ≡ DIP, same assumption as setTreeWidth) */
  setDockRect(rect: DockRect): void {
    this.dockRect = rect
    this.layout()
  }

  dockedTabs(): DockTabSummary[] {
    return this.tabs
      .filter((t) => t.docked)
      .map((t) => ({
        id: t.id,
        kind: t.kind as DockKind,
        title: t.title,
        ...(t.filePath ? { filePath: t.filePath } : {}),
        active: t.id === this.activeDockId,
      }))
  }

  /** switch which docked tab fills the pane (Home's right-pane tab strip) */
  activateDockedTab(id: string): void {
    if (!this.tabs.some((t) => t.id === id && t.docked)) return
    this.activeDockId = id
    this.onChanged()
    this.layout()
  }

  /** pop a docked tab out to a full-window tab (its AI panel returns) */
  undockTab(id: string): void {
    this.activateTab(id)
  }

  /** focus an existing document tab in its current placement: a docked tab
   *  becomes the pane's active dock (Home keeps the window); a full tab
   *  takes over the window (P1 dock routing, home-chat open_document) */
  activateDocumentTab(id: string): void {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return
    if (tab.docked) this.activateDockedTab(id)
    else this.activateTab(id)
  }

  /** dock an editor into the Home right pane. Reuses an already-docked tab
   *  holding the same file — except when the caller wants a fresh seeded
   *  document (newBlank/aiContent), which always opens its own tab. */
  dockEditorTab(kind: DockKind, options?: DockEditorOptions): string | null {
    const wantsFresh = options?.newBlank || options?.aiContent
    if (!wantsFresh) {
      const reuse = this.tabs.find(
        (t) =>
          t.docked &&
          t.kind === kind &&
          (options?.file ? t.filePath === options.file : !t.filePath),
      )
      if (reuse) {
        this.activateDockedTab(reuse.id)
        return reuse.id
      }
    }
    let view: WebContentsView | null = null
    let title = ''
    switch (kind) {
      case 'docs': {
        // docked = panel hidden by default (P1 契约); explicit false opts out
        view = createDocsView(options?.file, {
          hidePanel: options?.hidePanel !== false,
        })
        if (options?.newBlank) markDocsNewBlank(view.webContents.id)
        if (options?.aiContent) queueDocsAiContent(view.webContents.id, options.aiContent)
        title = options?.file ? basename(options.file) : this.untitled('docs', 'ChaAI Office Docs')
        break
      }
      case 'sheets': {
        // docked = internal AI panel hidden (P1 契约, docs parity)
        view = createSheetsView({ includeAiHandlers: false, hidePanel: true })
        if (options?.file) queueWorkbookForView(view.webContents, options.file)
        title = options?.file ? basename(options.file) : this.untitled('sheets', 'AI Sheets')
        break
      }
      case 'slides': {
        view = createSlidesView(options?.file, { hidePanel: true })
        title = options?.file ? basename(options.file) : this.untitled('slides', 'AI Slides')
        break
      }
      case 'pdf': {
        if (!options?.file) return null
        view = createPdfView(options.file)
        title = basename(options.file)
        break
      }
      case 'markdown': {
        view = createMarkdownView(options?.file, { hidePanel: true })
        title = options?.file ? basename(options.file) : this.untitled('markdown', 'AI Markdown')
        break
      }
      case 'html': {
        view = createHtmlView(options?.file, { hidePanel: true })
        title = options?.file ? basename(options.file) : this.untitled('html', 'AI HTML')
        break
      }
    }
    if (!view) return null
    const id = `t${this.nextId++}`
    this.shellWindow.contentView.addChildView(view)
    view.setVisible(false)
    this.trackHtmlFullScreen(id, view)
    this.watchViewLifetime(id, view)
    this.tabs.push({
      id,
      kind,
      view,
      title,
      ...(options?.file ? { filePath: options.file } : {}),
      docked: true,
    })
    this.activeDockId = id
    // signed LRU cap: over the limit, really close the oldest other dock
    // (closeTab runs the same unsaved-changes guards as the strip)
    const otherDocks = this.tabs.filter((t) => t.docked && t.id !== id).map((t) => t.id)
    const overflow = otherDocks.length - (TabManager.DOCK_TAB_CAP - 1)
    for (let i = 0; i < overflow; i++) void this.closeTab(otherDocks[i]!)
    // docking happens from Home: make sure Home owns the window so the dock
    // paints beside the conversation
    if (this.activeId !== HOME_ID) this.activateTab(HOME_ID)
    else this.layout()
    this.onChanged()
    return id
  }

  openDocsTab(
    openPath?: string,
    options?: { newBlank?: boolean; aiContent?: AiDocContent },
  ): string {
    const view = createDocsView(openPath)
    const id = `t${this.nextId++}`
    if (options?.newBlank) markDocsNewBlank(view.webContents.id)
    if (options?.aiContent) queueDocsAiContent(view.webContents.id, options.aiContent)
    this.shellWindow.contentView.addChildView(view)
    view.setVisible(false)
    this.trackHtmlFullScreen(id, view)
    this.watchViewLifetime(id, view)
    this.tabs.push({
      id,
      kind: 'docs',
      view,
      title: openPath ? basename(openPath) : this.untitled('docs', 'ChaAI Office Docs'),
      filePath: openPath,
    })
    this.activateTab(id)
    return id
  }

  openSheetsTab(
    openPath?: string,
    options?: {
      newBlank?: boolean
      newBlankSaveDir?: string
      newBlankName?: string
      restoreFrom?: string
    },
  ): string {
    if (options?.newBlank)
      setSheetsNewBlank(options?.newBlankSaveDir, options?.restoreFrom, options?.newBlankName)
    const spare = this.takeSpareSheetsView()
    const view = spare ?? createSheetsView({ includeAiHandlers: false })
    // bind the path to this tab's webContents: a multi-select Open creates
    // several sheets tabs in one loop, so a single global path would be
    // overwritten before the earlier tabs consume it
    if (openPath) {
      queueWorkbookForView(view.webContents, openPath)
      if (spare) nudgeQueuedWorkbook(view.webContents)
    }
    const id = `t${this.nextId++}`
    if (!spare) {
      this.shellWindow.contentView.addChildView(view)
      view.setVisible(false)
    }
    this.trackHtmlFullScreen(id, view)
    this.watchViewLifetime(id, view)
    this.scheduleSpareSheetsView(3000)
    this.tabs.push({
      id,
      kind: 'sheets',
      view,
      title: openPath ? basename(openPath) : this.untitled('sheets', 'AI Sheets'),
      filePath: openPath,
    })
    this.activateTab(id)
    return id
  }

  openSlidesTab(openPath?: string): string {
    const view = createSlidesView(openPath)
    const id = `t${this.nextId++}`
    this.shellWindow.contentView.addChildView(view)
    view.setVisible(false)
    this.trackHtmlFullScreen(id, view)
    this.watchViewLifetime(id, view)
    this.tabs.push({
      id,
      kind: 'slides',
      view,
      title: openPath ? basename(openPath) : this.untitled('slides', 'AI Slides'),
      filePath: openPath,
    })
    this.activateTab(id)
    return id
  }

  /** Untitled markdown tab seeded with AI-authored content (create_document):
   * the tab stays in memory and the suggested name only prefills first save. */
  openMarkdownTabWithContent(content: string, suggestedName: string): string {
    const id = this.openMarkdownTab()
    const tab = this.tabs.find((t) => t.id === id)
    if (tab?.view) queueMarkdownAiContent(tab.view.webContents, content, suggestedName)
    return id
  }

  openPdfTab(openPath: string, options?: { untitledTitle?: string }): string {
    const view = createPdfView(openPath)
    const id = `t${this.nextId++}`
    this.shellWindow.contentView.addChildView(view)
    view.setVisible(false)
    this.trackHtmlFullScreen(id, view)
    this.watchViewLifetime(id, view)
    this.tabs.push({
      id,
      kind: 'pdf',
      view,
      title: options?.untitledTitle ?? basename(openPath),
      filePath: openPath,
    })
    this.activateTab(id)
    return id
  }

  /** docked variant of openMarkdownTabWithContent: an untitled markdown dock
   *  seeded with AI-authored content (home-chat create_document, P1 契约) */
  dockMarkdownWithContent(content: string, suggestedName: string): string | null {
    const id = this.dockEditorTab('markdown')
    if (!id) return null
    const tab = this.tabs.find((t) => t.id === id)
    if (tab?.view) queueMarkdownAiContent(tab.view.webContents, content, suggestedName)
    return id
  }

  /** Remount the tab's renderer so it re-reads its file from disk (View > Reload). */
  reloadTab(id: string): void {
    const tab = this.tabs.find((t) => t.id === id)
    const wc = tab?.view?.webContents
    if (!wc || wc.isDestroyed()) return
    if (tab.kind === 'pdf') clearPdfDirty(wc.id)
    wc.reload()
  }

  openMarkdownTab(openPath?: string): string {
    const view = createMarkdownView(openPath)
    const id = `t${this.nextId++}`
    this.shellWindow.contentView.addChildView(view)
    view.setVisible(false)
    this.trackHtmlFullScreen(id, view)
    this.watchViewLifetime(id, view)
    this.tabs.push({
      id,
      kind: 'markdown',
      view,
      title: openPath ? basename(openPath) : this.untitled('markdown', 'AI Markdown'),
      filePath: openPath,
    })
    this.activateTab(id)
    return id
  }

  openHtmlTab(openPath?: string): string {
    const view = createHtmlView(openPath)
    const id = `t${this.nextId++}`
    this.shellWindow.contentView.addChildView(view)
    view.setVisible(false)
    this.trackHtmlFullScreen(id, view)
    this.watchViewLifetime(id, view)
    this.tabs.push({
      id,
      kind: 'html',
      view,
      title: openPath ? basename(openPath) : this.untitled('html', 'AI HTML'),
      filePath: openPath,
    })
    this.activateTab(id)
    return id
  }

  /** Untitled html tab seeded with AI-authored content (create_document):
   * the tab stays in memory, the suggested name titles the tab now and only
   * prefills the first-save dialog — nothing lands on disk until then. */
  openHtmlTabWithContent(content: string, suggestedName: string): string {
    const id = this.openHtmlTab()
    const tab = this.tabs.find((t) => t.id === id)
    if (tab?.view) queueHtmlAiContent(tab.view.webContents, content, suggestedName)
    if (tab && suggestedName) tab.title = suggestedName
    return id
  }

  /** Present → New tab: a chrome-free html tab showing the owner tab's live preview */
  openHtmlPresentTab(owner: WebContents, title: string): string {
    const view = createHtmlPresentView(owner, title)
    const id = `t${this.nextId++}`
    this.shellWindow.contentView.addChildView(view)
    view.setVisible(false)
    this.trackHtmlFullScreen(id, view)
    this.watchViewLifetime(id, view)
    this.tabs.push({
      id,
      kind: 'html',
      view,
      title: title || this.untitled('html', 'AI HTML'),
      present: true,
    })
    this.activateTab(id)
    return id
  }

  activateTab(id: string): void {
    const target = this.tabs.find((t) => t.id === id)
    if (!target) return
    // activating a docked tab pops it out to a full tab (strip click = undock)
    if (target.docked) {
      target.docked = false
      if (this.activeDockId === id) this.activeDockId = this.dockedNeighbor(id)
      // the editor rendered without its internal AI panel while docked (the
      // Home conversation was the chat surface) — tell it it's a full tab
      // now so it restores its own panel preference
      target.view?.webContents.send?.('app:docked-state', false)
    }
    // while a shell modal owns the window, newly activated views stay hidden
    // too — the dialog must remain the topmost interactive surface; docked
    // views only ever paint while Home is the active tab
    for (const t of this.tabs) {
      if (!t.view) continue
      t.view.setVisible(!t.docked && t.id === id && !this.shellModalOpen)
    }
    this.activeId = id
    this.refreshActiveTargets()
    this.layout()
    // 上游 #757: 激活后显式交还键盘焦点（可见不等于聚焦，否则键入落进隐藏 view）
    this.focusActiveView()
    this.onChanged()
  }

  /** Hand keyboard focus to the active tab's view. The click that opened or
   *  switched a tab lands on the chrome webContents (tab strip, Home list),
   *  and a WebContentsView made visible does not take focus on its own — so
   *  without this, typing after every open/switch keeps going to a hidden
   *  view. Home has no view of its own; the shell window's webContents is
   *  the focus target there. Skipped while the window is unfocused
   *  (background opens must not steal OS focus); the window's `focus`
   *  handler re-runs it. */
  focusActiveView(): void {
    if (this.shellWindow.isDestroyed() || !this.shellWindow.isFocused()) return
    const target = this.tabs.find((t) => t.id === this.activeId)
    if (!target) return
    if (target.view) target.view.webContents.focus()
    else this.shellWindow.webContents.focus()
  }

  /** Re-point the process-global active-editor targets and the app menu at this
   *  window's active tab. Called on every activation and on shell-window focus:
   *  a detached editor window ("Open in New Window") claims the same globals
   *  while it is focused. */
  refreshActiveTargets(): void {
    const target = this.tabs.find((t) => t.id === this.activeId)
    if (!target) return
    setActiveDocsResolver(target.kind === 'docs' ? () => target.view!.webContents : () => null)
    if (target.kind === 'sheets' && target.view) setActiveSheetsWebContents(target.view.webContents)
    if (target.kind === 'slides' && target.view) setActiveSlidesWebContents(target.view.webContents)
    this.applyMenuFor(target.present ? 'home' : target.kind)
  }

  /** move a tab to a new index in the strip; Home is pinned at index 0 */
  reorderTab(id: string, toIndex: number): void {
    if (id === HOME_ID) return
    const fromIndex = this.tabs.findIndex((t) => t.id === id)
    if (fromIndex < 0) return
    const clamped = Math.min(Math.max(Math.trunc(toIndex), 1), this.tabs.length - 1)
    if (clamped === fromIndex) return
    const [moved] = this.tabs.splice(fromIndex, 1)
    this.tabs.splice(clamped, 0, moved)
    this.onChanged()
  }

  /** the webContents id behind a tab (shell-side saveDir queueing at dock time) */
  webContentsIdOf(id: string): number | undefined {
    const wc = this.tabs.find((t) => t.id === id)?.view?.webContents
    return wc && !wc.isDestroyed() ? wc.id : undefined
  }

  tabIdForWebContents(webContentsId: number): string | undefined {
    return this.tabs.find((t) => t.view?.webContents.id === webContentsId)?.id
  }

  /** a module opened a file inside an existing tab (⌘O / queued path) — sync title + dedupe path */
  setTabFileFor(webContentsId: number, filePath: string): void {
    const tab = this.tabs.find((t) => t.view?.webContents.id === webContentsId)
    if (!tab) return
    tab.filePath = filePath
    tab.title = basename(filePath)
    this.onChanged()
  }

  /** an untitled document named itself before its first save (html: from the first AI request) */
  setTabTitleFor(webContentsId: number, title: string): void {
    const tab = this.tabs.find((t) => t.view?.webContents.id === webContentsId)
    if (!tab || tab.filePath || tab.title === title) return
    tab.title = title
    this.onChanged()
  }

  /** a file was renamed on disk (rename from the Home list) — sync any open tab's title/path;
   *  returns the affected views so callers can notify the embedded editors */
  renameTabFile(
    oldPath: string,
    newPath: string,
  ): Array<{ kind: TabKind; webContents: WebContents }> {
    const affected: Array<{ kind: TabKind; webContents: WebContents }> = []
    for (const tab of this.tabs) {
      if (tab.filePath !== oldPath) continue
      tab.filePath = newPath
      tab.title = basename(newPath)
      if (tab.view) affected.push({ kind: tab.kind, webContents: tab.view.webContents })
    }
    if (affected.length > 0) this.onChanged()
    return affected
  }

  /** sheets tabs whose renderer reports unsaved journal edits (shell-close guard) */
  dirtySheetsTabs(): Array<{ id: string; webContents: WebContents }> {
    return this.tabs
      .filter(
        (t) => t.kind === 'sheets' && t.view && sheetsPendingEditCount(t.view.webContents.id) > 0,
      )
      .map((t) => ({ id: t.id, webContents: t.view!.webContents }))
  }

  /** pdf tabs whose renderer reports unsaved markups/form edits (shell-close guard) */
  dirtyPdfTabs(): Array<{ id: string; webContents: WebContents }> {
    return this.tabs
      .filter((t) => t.kind === 'pdf' && t.view && pdfIsDirty(t.view.webContents.id))
      .map((t) => ({ id: t.id, webContents: t.view!.webContents }))
  }

  /** markdown tabs whose renderer reports unsaved edits (shell-close guard) */
  dirtyMarkdownTabs(): Array<{ id: string; webContents: WebContents }> {
    return this.tabs
      .filter((t) => t.kind === 'markdown' && t.view && markdownIsDirty(t.view.webContents.id))
      .map((t) => ({ id: t.id, webContents: t.view!.webContents }))
  }

  /** html tabs whose renderer reports unsaved edits (shell-close guard) */
  dirtyHtmlTabs(): Array<{ id: string; webContents: WebContents }> {
    return this.tabs
      .filter((t) => t.kind === 'html' && t.view && htmlIsDirty(t.view.webContents.id))
      .map((t) => ({ id: t.id, webContents: t.view!.webContents }))
  }

  /** slides tabs whose main-process session has unsaved edits (shell-close guard) */
  dirtySlidesTabs(): Array<{ id: string; webContents: WebContents }> {
    return this.tabs
      .filter((t) => t.kind === 'slides' && t.view && slidesIsDirty(t.view.webContents.id))
      .map((t) => ({ id: t.id, webContents: t.view!.webContents }))
  }

  /** all live docs tabs — dirtiness lives renderer-side, caller queries async (shell-close guard) */
  docsTabs(): Array<{ id: string; webContents: WebContents }> {
    return this.tabs
      .filter((t) => t.kind === 'docs' && t.view)
      .map((t) => ({ id: t.id, webContents: t.view!.webContents }))
  }

  /** all live slides tabs (MCP bridge resolves its new tab's webContents through this) */
  slidesTabs(): Array<{ id: string; webContents: WebContents }> {
    return this.tabs
      .filter((t) => t.kind === 'slides' && t.view)
      .map((t) => ({ id: t.id, webContents: t.view!.webContents }))
  }

  /** all live sheets tabs (MCP bridge resolves its new tab's webContents through this) */
  sheetsTabs(): Array<{ id: string; webContents: WebContents }> {
    return this.tabs
      .filter((t) => t.kind === 'sheets' && t.view)
      .map((t) => ({ id: t.id, webContents: t.view!.webContents }))
  }

  /** closes whichever tab is currently active; no-op for Home (Cmd+W target) */
  closeActiveTab(): void {
    void this.closeTab(this.activeId)
  }

  async closeTab(id: string): Promise<void> {
    if (id === HOME_ID) return
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab || this.closingIds.has(id)) return
    let closeGuard =
      tab.view &&
      (tab.kind === 'sheets' && sheetsPendingEditCount(tab.view.webContents.id) > 0
        ? requestSheetsClose
        : tab.kind === 'pdf' && pdfIsDirty(tab.view.webContents.id)
          ? requestPdfClose
          : tab.kind === 'markdown' && markdownIsDirty(tab.view.webContents.id)
            ? requestMarkdownClose
            : tab.kind === 'html' && htmlIsDirty(tab.view.webContents.id)
              ? requestHtmlClose
              : tab.kind === 'slides' && slidesIsDirty(tab.view.webContents.id)
                ? requestSlidesClose
                : null)
    // docs dirty state lives in the renderer and needs an async query; skip the guard when clean (avoids a flash activation)
    if (!closeGuard && tab.kind === 'docs' && tab.view) {
      this.closingIds.add(id)
      try {
        if (await docsQueryDirty(tab.view.webContents)) closeGuard = requestDocsClose
      } finally {
        this.closingIds.delete(id)
      }
    }
    if (closeGuard && tab.view) {
      // Bring the tab into view so the save prompt has visible context.
      if (this.activeId !== id) this.activateTab(id)
      this.closingIds.add(id)
      try {
        if (!(await closeGuard(tab.view.webContents, this.shellWindow))) return
      } finally {
        this.closingIds.delete(id)
      }
    }
    this.removeTab(id)
  }

  /**
   * Close a tab with no save prompt. The caller must have already settled the
   * document's unsaved changes (the MCP close tool saves or discards first):
   * this is the plain removal step of `closeTab`, so a dialog never appears in
   * a flow the user did not start.
   * Returns false when there is no such tab (already closed) or one is mid-prompt.
   */
  closeTabWithoutPrompt(id: string): boolean {
    if (id === HOME_ID) return false
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab || this.closingIds.has(id)) return false
    this.removeTab(id)
    return true
  }

  /** detach + drop one tab and re-activate a neighbour (no guards, no prompts) */
  private removeTab(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id)
    if (idx < 0) return
    if (this.htmlFullScreenId === id) this.htmlFullScreenId = null
    const [removed] = this.tabs.splice(idx, 1)
    if (this.activeDockId === id) this.activeDockId = this.dockedNeighbor(id)
    if (this.activeId === id) {
      const fallback = this.tabs[idx - 1] ?? this.tabs[0]
      this.activateTab(fallback.id)
    } else {
      // closing a docked tab while Home is active: the pane switches to the
      // neighboring dock (or empties) without touching the strip's activation
      if (removed.docked) this.layout()
      this.onChanged()
    }
    if (removed.view) {
      removed.view.setVisible(false)
      this.shellWindow.contentView.removeChildView(removed.view)
      if (removed.kind === 'docs') {
        // webContents.close()/.destroy() on a closed docs tab wedges Electron's whole
        // UI thread in a native modal run loop (reproduced consistently; survives
        // close() vs destroy(), teardown ordering, deferring, and disabling
        // accessibility support — looks like an upstream WebContentsView/Chromium
        // issue, not something fixable from here). Detaching without destroying
        // avoids the freeze; the orphaned webContents is reclaimed when the app quits.
        teardownDocsRenderer(removed.view.webContents)
      } else {
        removed.view.webContents.close()
      }
    }
  }

  /** close every other closable tab except Home and the given tab */
  async closeOtherTabs(keepId: string): Promise<void> {
    const ids = this.tabs.filter((t) => t.id !== HOME_ID && t.id !== keepId).map((t) => t.id)
    for (const id of ids) await this.closeTab(id)
  }

  /** Remove a tab from the strip WITHOUT destroying its WebContentsView and
   *  hand it to the caller ("Open in New Window" — the live document, unsaved
   *  edits included, moves into a detached editor window). Null while a close
   *  prompt is pending on the tab. */
  detachTab(
    id: string,
  ): { view: WebContentsView; kind: TabKind; title: string; filePath?: string } | null {
    if (id === HOME_ID) return null
    const idx = this.tabs.findIndex((t) => t.id === id)
    const tab = idx >= 0 ? this.tabs[idx] : undefined
    if (!tab?.view || tab.present || this.closingIds.has(id)) return null
    this.tabs.splice(idx, 1)
    if (this.htmlFullScreenId === id) this.htmlFullScreenId = null
    // LOCAL(2026-09-22, f5247d3..476e5023): dock-aware detach — hand the dock to a
    // neighbor and re-layout Home's pane, mirroring removeTab.
    if (this.activeDockId === id) this.activeDockId = this.dockedNeighbor(id)
    const view = tab.view
    view.setVisible(false)
    this.shellWindow.contentView.removeChildView(view)
    if (this.activeId === id) {
      const fallback = this.tabs[idx - 1] ?? this.tabs[0]
      this.activateTab(fallback.id)
    } else {
      if (tab.docked) this.layout()
      this.onChanged()
    }
    return { view, kind: tab.kind, title: tab.title, filePath: tab.filePath }
  }

  /** close every closable tab to the left of the given tab (Home is never closed) */
  async closeLeftTabs(tabId: string): Promise<void> {
    const idx = this.tabs.findIndex((t) => t.id === tabId)
    if (idx <= 0) return
    const ids = this.tabs.slice(0, idx).filter((t) => t.id !== HOME_ID).map((t) => t.id)
    for (const id of ids) await this.closeTab(id)
  }

  /** close every closable tab to the right of the given tab */
  async closeRightTabs(tabId: string): Promise<void> {
    const idx = this.tabs.findIndex((t) => t.id === tabId)
    if (idx < 0) return
    const ids = this.tabs.slice(idx + 1).filter((t) => t.id !== HOME_ID).map((t) => t.id)
    for (const id of ids) await this.closeTab(id)
  }

  /** close every closable tab, leaving only Home (察元AIOffice) */
  async closeAllTabs(): Promise<void> {
    const ids = this.tabs.filter((t) => t.id !== HOME_ID).map((t) => t.id)
    for (const id of ids) await this.closeTab(id)
  }

  private findTabOfKindByPath(kind: TabKind, path?: string): string | undefined {
    const wanted = canonicalPath(path)
    return this.tabs.find(
      (t) =>
        t.kind === kind &&
        t.view &&
        t.filePath &&
        !t.present &&
        canonicalPath(t.filePath) === wanted,
    )?.id
  }

  findDocsTabByPath(path?: string): string | undefined {
    return this.findTabOfKindByPath('docs', path)
  }

  findSheetsTab(): string | undefined {
    return this.tabs.find((t) => t.kind === 'sheets')?.id
  }

  findSheetsTabByPath(path?: string): string | undefined {
    return this.findTabOfKindByPath('sheets', path)
  }

  findSlidesTabByPath(path?: string): string | undefined {
    return this.findTabOfKindByPath('slides', path)
  }

  findPdfTabByPath(path?: string): string | undefined {
    return this.findTabOfKindByPath('pdf', path)
  }

  findMarkdownTabByPath(path?: string): string | undefined {
    return this.findTabOfKindByPath('markdown', path)
  }

  findHtmlTabByPath(path?: string): string | undefined {
    return this.findTabOfKindByPath('html', path)
  }

  /** the active tab's html view, if the active tab is html (html menu target) */
  activeHtmlTab(): { id: string; webContents: WebContents; filePath?: string } | undefined {
    const tab = this.tabs.find((t) => t.id === this.activeId)
    return tab?.kind === 'html' && tab.view && !tab.present
      ? { id: tab.id, webContents: tab.view.webContents, filePath: tab.filePath }
      : undefined
  }

  /** the active tab's markdown view, if the active tab is markdown (markdown menu target) */
  activeMarkdownTab(): { id: string; webContents: WebContents; filePath?: string } | undefined {
    const tab = this.tabs.find((t) => t.id === this.activeId)
    return tab?.kind === 'markdown' && tab.view
      ? { id: tab.id, webContents: tab.view.webContents, filePath: tab.filePath }
      : undefined
  }

  /** the active tab's pdf view, if the active tab is a pdf (pdf menu target) */
  activePdfTab(): { id: string; webContents: WebContents; filePath?: string } | undefined {
    const tab = this.tabs.find((t) => t.id === this.activeId)
    return tab?.kind === 'pdf' && tab.view
      ? { id: tab.id, webContents: tab.view.webContents, filePath: tab.filePath }
      : undefined
  }
}

export function canonicalPath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}
