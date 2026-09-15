/**
 * DocsCommandServices: every action the ribbon can trigger, grouped by domain
 * and injected by the host (App.tsx assembles each group with
 * useStableCallbacks so identities never change across renders).
 *
 * Rule: actions live here, state lives in DocsCommandState (command-state.ts).
 * Commands (packages/ribbon) receive { state, services } and never close over
 * React state themselves.
 *
 * The format/edit groups land with the home-tab commands (B2); everything here
 * maps the pre-existing flat RibbonProps callbacks onto domains.
 */
import type {
  CustomNumberingLevel,
  HeaderFooter,
  SectionSettings,
  SourceInfo,
  ThemeColors,
  ThemeFonts,
} from '@chatoffice/docx-engine'
import type { Editor } from '@tiptap/core'
import type { RibbonProps } from '../components/Ribbon'
import type { InkPenSettings, RevisionDisplayMode, ViewMode } from '../components/ribbon-tabs'
import type { InkTool } from '../editor/ink'
import type { DocsCommandState } from './command-state'
import type { FontStepper } from './font-stepper'
import type { PainterService } from './painter'
import type { PenPreferences } from './pen-preferences'

export interface DocsCommandServices {
  /** main editor access (the active editor is state.format.sub ?? editor.main()) */
  readonly editor: {
    readonly main: () => Editor | null
  }
  /** color/highlight "current pen" the split buttons apply without opening a palette */
  readonly pen: PenPreferences
  /** format painter state machine (arm / disarm / consume) */
  readonly painter: PainterService
  /** A+/A- size stepping with the 300ms coalesce + stale-apply guard */
  readonly fontStep: FontStepper
  readonly file: {
    readonly open: () => void
    readonly save: () => void
    readonly saveAs: () => void
    readonly compare: () => void
    /** 文件菜单「导出为 PDF」(exportPdfImpl via App) */
    readonly exportPdf: () => void
    /** 文件菜单「打印」(printDocImpl via App, Word 式打印对话框) */
    readonly printDoc: () => void
  }
  readonly insert: {
    readonly sectionBreak: (type: 'nextPage' | 'continuous' | 'evenPage' | 'oddPage') => void
    readonly note: (kind: 'footnote' | 'endnote') => void
    readonly field: (instr: string) => void
    /** fallback when a new list can't reuse a numId (adopt a document definition / create one) */
    readonly allocateNumId: (kind: 'bullet' | 'ordered') => string | null
    /** new list definitions with custom levels (bullet library / numbering library / multilevel list) */
    readonly createListDef: (levels: CustomNumberingLevel[]) => string | null
  }
  readonly layout: {
    /** applies to the cursor's section (multi-section aware, see App) */
    readonly setSection: (next: SectionSettings) => void
  }
  readonly design: {
    readonly setPageColor: (hex: string | null) => void
    readonly setWatermark: (text: string | null) => void
    readonly setThemeFonts: (fonts: ThemeFonts) => void
    readonly setThemeColors: (colors: ThemeColors) => void
  }
  readonly draw: {
    readonly setInkTool: (tool: InkTool) => void
    readonly setInkPen: (settings: InkPenSettings) => void
    readonly setInkHighlighter: (settings: InkPenSettings) => void
    readonly clearAll: () => void
  }
  readonly references: {
    readonly addSource: (source: SourceInfo) => void
    /** TOC page-number backfill: docHeadings in document order → real page numbers (null when not computable) */
    readonly headingPages: () => number[] | null
  }
  readonly review: {
    readonly showComments: () => void
    readonly newComment: () => void
    readonly setTrackChanges: (on: boolean) => void
    readonly setRevisionDisplay: (mode: RevisionDisplayMode) => void
    readonly acceptRevision: (all: boolean) => void
    readonly rejectRevision: (all: boolean) => void
    readonly gotoRevision: (dir: 1 | -1) => void
  }
  readonly view: {
    readonly setViewMode: (mode: ViewMode) => void
    readonly setReadMode: (v: boolean) => void
    readonly setShowMarks: (v: boolean) => void
    readonly setShowRuler: (v: boolean) => void
    readonly setShowNav: (v: boolean) => void
    readonly setShowGrid: (v: boolean) => void
    readonly setSplitView: (v: boolean) => void
    readonly setZoom: (zoom: number) => void
    /** compute zoom from the current window size (Word: page width / whole page) */
    readonly zoomFit: (mode: 'width' | 'page') => void
    readonly setDarkCanvas: (v: boolean) => void
    readonly setSpellcheck?: (v: boolean) => void
    readonly pagePreview: () => void
  }
  readonly hf: {
    readonly setHeader: (next: HeaderFooter) => void
    readonly setFooter: (next: HeaderFooter) => void
    /** different first page (w:titlePg) */
    readonly setTitlePg: (v: boolean) => void
    /** different odd & even pages (settings.xml w:evenAndOddHeaders) */
    readonly setEvenOddHf: (v: boolean) => void
  }
  readonly ai: {
    readonly toggle: () => void
    /** open the panel with a preset instruction (Word's Editor / Translate start on click) */
    readonly preset: (instruction: string) => void
  }
  /** dialog openers — the dialogs themselves stay app-side (strangler rule) */
  readonly dialogs: {
    readonly paragraph: () => void
    readonly pageNumFormat: () => void
    readonly protectDoc: () => void
  }
  /** 察元 AI tab (harvested chayuan-wps surface): assistants, docops dialogs and batch ops */
  readonly chayuan: {
    /** run a core-pack assistant (常用助手) against the current selection */
    readonly runAssistant: (id: string) => void
    /** open a docops dialog (题注/样式/脱密/表单内容…) */
    readonly openDialog: (kind: import('../docops/dialogs').DocOpsDialogKind) => void
    /** immediate batch op: tables.* / images.* / text.* / form.toggle */
    readonly runOp: (op: string) => void
    /** export every table as one xlsx / every image as files */
    readonly exportAll: (what: 'tables' | 'images') => void
    /** 表单模式 current state (ribbon toggle pressed look) */
    readonly formModeActive: () => boolean
  }
}

/**
 * Strangler facade: flatten the host state/services back onto the legacy
 * RibbonProps so components/Ribbon.tsx renders unchanged until each tab's
 * schema replaces it (adapter dies with the legacy file at the end of C9).
 * All leaf values keep referential stability (shallow-stable state groups +
 * stable callbacks), so memo(RibbonInner) still skips no-op renders.
 */
export function ribbonPropsFromHost(
  state: DocsCommandState,
  services: DocsCommandServices,
): Omit<RibbonProps, 'actionsRef' | 'quickActions' | 'trailingActions' | 'editor' | 'tabRequest'> {
  return {
    formatState: state.format,
    hasDoc: state.hasDoc,
    blocks: state.doc.blocks as RibbonProps['blocks'],
    styles: state.doc.styles,
    docDefaults: state.doc.docDefaults,
    showAi: state.ai.showAi,
    section: state.doc.section,
    activeSection: state.doc.activeSection,
    pageColor: state.doc.pageColor,
    watermark: state.doc.watermark,
    themeFonts: state.doc.themeFonts,
    themeColors: state.doc.themeColors,
    inkTool: state.draw.inkTool,
    inkPen: state.draw.inkPen,
    inkHighlighter: state.draw.inkHighlighter,
    inkCount: state.draw.inkCount,
    sources: state.sources as RibbonProps['sources'],
    zoom: state.view.zoom,
    darkCanvas: state.view.darkCanvas,
    spellcheck: state.view.spellcheck,
    onSpellcheck: services.view.setSpellcheck ?? (() => {}),
    header: state.doc.header,
    footer: state.doc.footer,
    titlePg: state.doc.titlePg,
    evenOddHf: state.doc.evenOddHf,
    showMarks: state.view.showMarks,
    showRuler: state.view.showRuler,
    showNav: state.view.showNav,
    commentCount: state.review.commentCount,
    openCommentCount: state.review.openCommentCount,
    canComment: state.review.canComment,
    trackChanges: state.review.trackChanges,
    revisionDisplay: state.review.revisionDisplay,
    revisionCount: state.review.revisionCount,
    isProtected: state.review.isProtected,
    commentsAllowed: state.review.commentsAllowed,
    trackChangesForced: state.review.trackChangesForced,
    protectActive: state.review.protectActive,
    filePath: state.doc.filePath,
    viewMode: state.view.viewMode,
    readMode: state.view.readMode,
    showGrid: state.view.showGrid,
    splitView: state.view.splitView,
    onOpen: services.file.open,
    onSave: services.file.save,
    onSaveAs: services.file.saveAs,
    onExportPdf: services.file.exportPdf,
    onPrint: services.file.printDoc,
    onCompare: services.file.compare,
    onToggleAi: services.ai.toggle,
    onAiPreset: services.ai.preset,
    onParagraphDialog: services.dialogs.paragraph,
    onPageNumFormat: services.dialogs.pageNumFormat,
    onProtectDoc: services.dialogs.protectDoc,
    onSection: services.layout.setSection,
    onInsertSectionBreak: services.insert.sectionBreak,
    onInsertNote: services.insert.note,
    onInsertField: services.insert.field,
    allocateNumId: services.insert.allocateNumId,
    createListDef: services.insert.createListDef,
    onPageColor: services.design.setPageColor,
    onWatermark: services.design.setWatermark,
    onThemeFonts: services.design.setThemeFonts,
    onThemeColors: services.design.setThemeColors,
    onInkTool: services.draw.setInkTool,
    onInkPen: services.draw.setInkPen,
    onInkHighlighter: services.draw.setInkHighlighter,
    onInkClearAll: services.draw.clearAll,
    onAddSource: services.references.addSource,
    headingPages: services.references.headingPages,
    onShowComments: services.review.showComments,
    onNewComment: services.review.newComment,
    onTrackChanges: services.review.setTrackChanges,
    onRevisionDisplay: services.review.setRevisionDisplay,
    onAcceptRevision: services.review.acceptRevision,
    onRejectRevision: services.review.rejectRevision,
    onGotoRevision: services.review.gotoRevision,
    onViewMode: services.view.setViewMode,
    onReadMode: services.view.setReadMode,
    onShowMarks: services.view.setShowMarks,
    onShowRuler: services.view.setShowRuler,
    onShowNav: services.view.setShowNav,
    onShowGrid: services.view.setShowGrid,
    onSplitView: services.view.setSplitView,
    onZoom: services.view.setZoom,
    onZoomFit: services.view.zoomFit,
    onDarkCanvas: services.view.setDarkCanvas,
    onPagePreview: services.view.pagePreview,
    onHeader: services.hf.setHeader,
    onFooter: services.hf.setFooter,
    onTitlePg: services.hf.setTitlePg,
    onEvenOddHf: services.hf.setEvenOddHf,
    chayuan: services.chayuan,
  }
}
