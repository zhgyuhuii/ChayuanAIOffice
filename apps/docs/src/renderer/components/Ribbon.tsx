import { showToast } from './toast-bus'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChayuanTab } from './ribbon-chayuan-tab'
import type { CSSProperties, ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import type { Command } from '@tiptap/pm/state'
import type { Mark, Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable,
  mergeCells,
  selectedRect,
  setCellAttr,
  splitCell,
} from '@tiptap/pm/tables'
import type {
  Block,
  CustomNumberingLevel,
  DefaultFonts,
  DocDefaults,
  HeaderFooter,
  Run,
  SectionSettings,
  SourceInfo,
  StyleInfo,
  TableAutoFitMode,
  TableLook,
  TextboxDisplay,
  TextboxParaDisplay,
  ThemeColors,
  ThemeFonts,
} from '@chatoffice/docx-engine'
import { InsertImageDialog } from '@chatoffice/ui/InsertImageDialog'
import type { InsertImageBridge } from '@chatoffice/ui/InsertImageDialog'
import type { WebImageItem } from '@chatoffice/ui/InsertImageDialog'
import { Dropdown, compressImageForDisplay, useDismissablePopover } from '@chatoffice/ui'
import { applyCase, type CaseMode } from '../editor/case-transform'
import { setSelectionAlign } from '../editor/direction'
import { stepParagraphIndent } from '../editor/indent'
import { beginForeignPaste, defaultPasteMode, stashPastePayload } from '../editor/paste-options'
import type { InkTool } from '../editor/ink'
import type { RibbonFormatState } from './ribbon-format-state'
import { setSelectedColumnWidth } from '../editor/table-sizing'
import {
  repeatHeaderState,
  setTableAutoFit,
  setTableLookOption,
  updateSelectedTableAttrs,
} from '../editor/table-properties'
import { TabStripArrows, useTabStripOverflow } from '@chatoffice/ribbon'
import { useI18n, type StringKey } from '../i18n/locale'
import { FONT_SIZES, MULTILEVEL_LIBRARY, NOOP_CHAIN, previewLevelText } from './ribbon-tab-shared'
import { HomeTab } from './home-tab'
import { PictureFormatTab, ShapeFormatTab, TableDesignTab, TableLayoutTab } from './contextual-tabs'
import { fontFamiliesFor } from '../font-list'
import {
  DesignTab,
  DrawTab,
  imageSizeOf,
  InsertTab,
  LayoutTab,
  ReferencesTab,
  ReviewTab,
  ViewTab,
  type InkPenSettings,
  type RevisionDisplayMode,
  type ViewMode,
  insertImageFromDataUrl,
  insertVideoForDocs,
  applyParagraphStyle,
  setParaAttrs,
} from './ribbon-tabs'
import { CropDialog, CutoutDialog } from './PictureDialogs'
import { IconTableProperties } from './icons'
export interface RibbonProps {
  /** App keyboard shortcuts reuse ribbon closures through here (font-size stepping keeps its coalescing) */
  actionsRef?: React.MutableRefObject<{
    stepFontSize?: (dir: 1 | -1) => void
    nudgeFontSize?: (dir: 1 | -1) => void
  }>
  /** Quick-access area on the tab row's left (save/undo-redo/autosave), matching the WPS/Office QAT */
  quickActions?: React.ReactNode
  /** Right side of the tab row (file name, etc.) */
  trailingActions?: React.ReactNode
  editor: Editor
  /** 察元 AI host-services group (the harvested chayuan-wps tab actions) */
  chayuan?: import('../ribbon/host-services').DocsCommandServices['chayuan']
  /** shallow-stable snapshot of every editor-state read shown in the ribbon (memo invalidation key) */
  formatState: RibbonFormatState
  hasDoc: boolean
  blocks: Block[]
  /** Fallback when a new list can't reuse a numId (adopt a document definition / create one) */
  allocateNumId?: (kind: 'bullet' | 'ordered') => string | null
  /** New list definitions with custom levels (bullet library / numbering library / multilevel list) */
  createListDef?: (levels: CustomNumberingLevel[]) => string | null
  /** document character styles, from ParsedDoc.styles (type === 'character') */
  styles?: Map<string, StyleInfo>
  /** document-wide text defaults from styles.xml */
  docDefaults?: DocDefaults
  // LOCAL(2026-09-22, f5247d3..476e5023): 本地双字体设置(作用域选择+默认字体写回)由
  // home-tab 呈现,上游快照将其改为单一字体盒,不采纳——onFontSettings 链路保留
  onFontSettings?: (scope: string, patch: DefaultFonts) => Promise<void>
  /** Open the paragraph dialog (line-spacing rule / exact value entry lives there) */
  onParagraphDialog?: () => void
  onOpen: () => void
  /** 文件菜单「新建」(blank template; App 的 newFileImpl) */
  onNewFile?: () => void
  /** 文件菜单「最近文件」路径列表 (desktop.getRecentFiles; absent = 隐藏) */
  recentFiles?: string[]
  onOpenRecent?: (path: string) => void
  onSave: () => void
  onSaveAs: () => void
  /** 文件菜单「导出为 PDF」（对齐 slides 文件菜单） */
  onExportPdf?: () => void
  /** 文件菜单「打印」（Word 式打印对话框） */
  onPrint?: () => void
  showAi: boolean
  onToggleAi: () => void
  section: SectionSettings | null
  onSection: (next: SectionSettings) => void
  /** Multi-section documents: index of the cursor's section (0-based); null for single-section */
  activeSection: number | null
  onInsertSectionBreak: (type: 'nextPage' | 'continuous' | 'evenPage' | 'oddPage') => void
  pageColor: string | null
  onPageColor: (hex: string | null) => void
  /** Design → Watermark / Themes */
  watermark: string | null
  onWatermark: (text: string | null) => void
  themeFonts: ThemeFonts | null
  onThemeFonts: (fonts: ThemeFonts) => void
  themeColors: ThemeColors | null
  onThemeColors: (colors: ThemeColors) => void
  /** Draw → pen / highlighter / eraser */
  inkTool: InkTool
  onInkTool: (tool: InkTool) => void
  inkPen: InkPenSettings
  onInkPen: (settings: InkPenSettings) => void
  inkHighlighter: InkPenSettings
  onInkHighlighter: (settings: InkPenSettings) => void
  inkCount: number
  onInkClearAll: () => void
  /** References → footnotes / endnotes / citations */
  onInsertNote: (kind: 'footnote' | 'endnote') => void
  sources: SourceInfo[]
  /** footnotes/endnotes hold Zotero citation fields the bridge cannot see yet */
  zoteroNoteFields?: boolean
  onAddSource: (source: SourceInfo) => void
  /** TOC page-number backfill: docHeadings in document order → real page numbers (null when not computable) */
  headingPages?: () => number[] | null
  zoom: number
  onZoom: (zoom: number) => void
  /** compute zoom from the current window size (Word: page width / whole page) */
  onZoomFit: (mode: 'width' | 'page') => void
  darkCanvas?: boolean
  onDarkCanvas?: (v: boolean) => void
  onAiPreset: (instruction: string) => void
  /** external request (e.g. native menu Page Setup) to switch to a specific tab */
  tabRequest?: { tab: string; nonce: number } | null
  /** mobile chrome: skip the tab strip entirely (an outer MobileRibbon owns navigation) */
  bodyOnly?: boolean
  /** announce every active-tab change (incl. contextual auto-activation) so the mobile bar stays in sync */
  onActiveTabChange?: (tab: string) => void
  header: HeaderFooter | null
  onHeader: (next: HeaderFooter) => void
  onPageNumFormat: () => void
  onInsertField: (instr: string) => void
  footer: HeaderFooter | null
  onFooter: (next: HeaderFooter) => void
  /** Different first page (w:titlePg) */
  titlePg: boolean
  onTitlePg: (v: boolean) => void
  /** Different odd & even pages (settings.xml w:evenAndOddHeaders) */
  evenOddHf: boolean
  onEvenOddHf: (v: boolean) => void
  showMarks: boolean
  onShowMarks: (v: boolean) => void
  showRuler: boolean
  onShowRuler: (v: boolean) => void
  showNav: boolean
  onShowNav: (v: boolean) => void
  commentCount: number
  /** unresolved root comments (drives the AI resolve-comments action) */
  openCommentCount: number
  onShowComments: () => void
  /** Review → comments / revisions / compare / protection */
  canComment: boolean
  onNewComment: () => void
  trackChanges: boolean
  onTrackChanges: (on: boolean) => void
  /** native check-as-you-type spellcheck (red squiggle) */
  spellcheck?: boolean
  onSpellcheck: (on: boolean) => void
  revisionDisplay: RevisionDisplayMode
  onRevisionDisplay: (mode: RevisionDisplayMode) => void
  revisionCount: number
  onAcceptRevision: (all: boolean) => void
  onRejectRevision: (all: boolean) => void
  onGotoRevision: (dir: 1 | -1) => void
  isProtected: boolean
  /** comments restriction: adding comments stays allowed although the body is read-only */
  commentsAllowed: boolean
  /** trackedChanges restriction: the recorder is forced on (toggle and accept/reject disabled) */
  trackChangesForced: boolean
  /** any protection is configured (highlights the Protect Document button) */
  protectActive: boolean
  onProtectDoc: () => void
  onCompare: () => void
  /** current document path (View → New Window opens it in another window) */
  filePath: string | null
  viewMode: ViewMode
  onViewMode: (mode: ViewMode) => void
  readMode: boolean
  onReadMode: (v: boolean) => void
  showGrid: boolean
  onShowGrid: (v: boolean) => void
  splitView: boolean
  onSplitView: (v: boolean) => void
  onPagePreview: () => void
}

interface PainterState {
  marks: Array<{ type: string; attrs: Record<string, unknown> }>
  /** source paragraph's node type + formatting attrs (null when the caret is not in a paintable block) */
  block: { type: string; attrs: Record<string, unknown> } | null
}

/** Character-formatting marks the painter transfers; semantic marks (links,
 *  comments, revisions, fields) are neither picked up nor stripped from the target. */
const PAINTER_MARK_TYPES = ['bold', 'italic', 'underline', 'strike', 'docTextStyle']

/** Paragraph-formatting attrs the painter transfers. Identity/anchor attrs
 *  (docxIndex, bookmarks, comment ranges, revisions, sdtShell…) stay with the target. */
const PAINTER_PARA_KEYS = [
  'styleId',
  'align',
  'lineSpacing',
  'lineRule',
  'lineRawTwips',
  'snapToGrid',
  'indentLeft',
  'indentRight',
  'indentFirstLine',
  'spaceBefore',
  'spaceAfter',
  'pageBreakBefore',
  'bidi',
  'autoSpace',
  'shadingFill',
  'emptyRunSize',
  'borders',
  'borderLines',
  'tabStops',
]

/** Per-block-type attrs that define the block's identity as formatting (heading level, list numbering) */
const PAINTER_BLOCK_EXTRA: Record<string, string[]> = {
  docParagraph: [],
  docHeading: ['level'],
  docListItem: ['kind', 'numId', 'ilvl'],
}

// Word for Mac has no File ribbon tab: file actions live in the native menu
// bar (which we provide). Windows Word does have one, so keep it there.
const IS_MAC = navigator.platform.toLowerCase().includes('mac')
/** shell tab mode: the tab strip above owns traffic lights / caption buttons */
const IN_TAB = new URLSearchParams(window.location.search).get('mode') === 'tab'

// WPS word 对齐:设计+布局合并为「页面」tab(开始 插入 页面 绘制 引用 审阅 视图)
const TABS = (
  IS_MAC
    ? ['home', 'insert', 'page', 'draw', 'references', 'review', 'chayuan', 'view']
    : ['file', 'home', 'insert', 'page', 'draw', 'references', 'review', 'chayuan', 'view']
) as readonly string[]
const TABLE_TABS = ['tableDesign', 'tableLayout'] as const
const IMAGE_TABS = ['pictureFormat'] as const
const SHAPE_TABS = ['shapeFormat'] as const
type RibbonTab =
  | (typeof TABS)[number]
  | (typeof TABLE_TABS)[number]
  | (typeof IMAGE_TABS)[number]
  | (typeof SHAPE_TABS)[number]

export const TABLE_AUTO_FIT_OPTIONS: Array<[TableAutoFitMode, StringKey]> = [
  ['contents', 'ribbonAutoFitContents'],
  ['window', 'ribbonAutoFitWindow'],
  ['fixed', 'ribbonFixedColumnWidth'],
]

// tab values double as internal-state / external tabRequest keys; translated for display via these string keys
const TAB_LABEL_KEYS: Record<string, StringKey> = {
  file: 'ribbonTabFile',
  home: 'ribbonTabHome',
  insert: 'ribbonTabInsert',
  draw: 'ribbonTabDraw',
  page: 'ribbonTabPage',
  references: 'ribbonTabReferences',
  review: 'ribbonTabReview',
  view: 'ribbonTabView',
  chayuan: 'ribbonTabChayuanAI',
  tableDesign: 'ribbonTabTableDesign',
  tableLayout: 'ribbonTabTableLayout',
  pictureFormat: 'ribbonTabPictureFormat',
  shapeFormat: 'ribbonTabShapeFormat',
}

/** CSS px per cm at 96dpi (size inputs display in centimeters) */
const PX_PER_CM = 96 / 2.54

/** Word's picture size limits in cm (0.01"–22") */
export const PICTURE_CM_MIN = 0.03
export const PICTURE_CM_MAX = 55.87
export const clampPictureCm = (cm: number) => Math.min(PICTURE_CM_MAX, Math.max(PICTURE_CM_MIN, cm))

/** swallows every command when the document is read-only (protected / read mode) */

// Word's preset size list (also drives the grow/shrink font step buttons)

// A+/A- clicks closer together than this coalesce into one trailing apply;
// must sit above burst-click spacing (~100-200ms) yet stay short enough that
// the deferred re-layout still feels attached to the click.
const FONT_STEP_COALESCE_MS = 300

// Word 标准样式集: 正文 + 标题1-6(schema 支持的完整级别) + 文档字符样式(运行时追加)
const STYLE_GALLERY = [
  { key: 'p', labelKey: 'ribbonStyleNormal', className: 'style-normal' },
  { key: 'h1', labelKey: 'ribbonStyleHeading1', className: 'style-h1' },
  { key: 'h2', labelKey: 'ribbonStyleHeading2', className: 'style-h2' },
  { key: 'h3', labelKey: 'ribbonStyleHeading3', className: 'style-h3' },
  { key: 'h4', labelKey: 'ribbonStyleHeading4', className: 'style-h4' },
  { key: 'h5', labelKey: 'ribbonStyleHeading5', className: 'style-h5' },
  { key: 'h6', labelKey: 'ribbonStyleHeading6', className: 'style-h6' },
] as const satisfies ReadonlyArray<{ key: string; labelKey: StringKey; className: string }>

/** Fallback character styles shown when the document has no character styles.
 * Emphasis = italic + accent color, Intense Emphasis = bold + accent color;
 * applied via the plain italic/bold marks plus docTextStyle color. */
const CHAR_STYLE_PRESETS: Array<{
  styleId: string
  labelKey: StringKey
  mark: 'italic' | 'bold'
  display: (accentHex: string) => CSSProperties
}> = [
  {
    styleId: '__preset_emphasis',
    labelKey: 'ribbonStyleEmphasis',
    mark: 'italic',
    display: (accentHex) => ({ fontStyle: 'italic', color: `#${accentHex}` }),
  },
  {
    styleId: '__preset_strong',
    labelKey: 'ribbonStyleIntenseEmphasis',
    mark: 'bold',
    display: (accentHex) => ({ fontWeight: 'bold', color: `#${accentHex}` }),
  },
]

/** Theme accent used by the preset character styles when the doc theme has none */
const DEFAULT_PRESET_ACCENT = '4472C4'

function findNumIdOfKind(blocks: Block[], kind: 'bullet' | 'ordered'): string | null {
  for (const b of blocks) {
    if (b.type === 'listItem' && b.list?.kind === kind) return b.list.numId
  }
  return null
}

function RibbonInner({
  actionsRef,
  quickActions,
  chayuan,
  trailingActions,
  editor,
  formatState: fs,
  hasDoc,
  blocks,
  allocateNumId,
  createListDef,
  onParagraphDialog,
  styles,
  docDefaults,
  onFontSettings,
  onOpen,
  onNewFile,
  recentFiles,
  onOpenRecent,
  onSave,
  onSaveAs,
  onExportPdf,
  onPrint,
  showAi,
  onToggleAi,
  section,
  onSection,
  activeSection,
  onInsertSectionBreak,
  pageColor,
  onPageColor,
  watermark,
  onWatermark,
  themeFonts,
  onThemeFonts,
  themeColors,
  onThemeColors,
  inkTool,
  onInkTool,
  inkPen,
  onInkPen,
  inkHighlighter,
  onInkHighlighter,
  inkCount,
  onInkClearAll,
  onInsertNote,
  sources,
  zoteroNoteFields,
  onAddSource,
  headingPages,
  zoom,
  onZoom,
  onZoomFit,
  darkCanvas,
  onDarkCanvas,
  onAiPreset,
  tabRequest,
  bodyOnly,
  onActiveTabChange,
  header,
  onHeader,
  onPageNumFormat,
  onInsertField,
  footer,
  onFooter,
  titlePg,
  onTitlePg,
  evenOddHf,
  onEvenOddHf,
  showMarks,
  onShowMarks,
  showRuler,
  onShowRuler,
  showNav,
  onShowNav,
  commentCount,
  openCommentCount,
  onShowComments,
  canComment,
  onNewComment,
  trackChanges,
  onTrackChanges,
  spellcheck,
  onSpellcheck,
  revisionDisplay,
  onRevisionDisplay,
  revisionCount,
  onAcceptRevision,
  onRejectRevision,
  onGotoRevision,
  isProtected,
  commentsAllowed,
  trackChangesForced,
  protectActive,
  onProtectDoc,
  onCompare,
  filePath,
  viewMode,
  onViewMode,
  readMode,
  onReadMode,
  showGrid,
  onShowGrid,
  splitView,
  onSplitView,
  onPagePreview,
}: RibbonProps) {
  const { t, lang } = useI18n()
  // tab row clips instead of wrapping when narrow; wheel + edge arrows page it
  const tabStrip = useTabStripOverflow()
  const [tab, setTab] = useState<RibbonTab>('home')
  // WPS 双击标签折叠/展开功能区; 右下角图标同; 状态本地持久化
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('docs-ribbon-collapsed') === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('docs-ribbon-collapsed', collapsed ? '1' : '0')
    } catch {
      /* degraded */
    }
  }, [collapsed])
  const [dropdown, setDropdown] = useState<string | null>(null)
  // null = Automatic: the pen button clears the run colour instead of writing one
  const [penColor, setPenColor] = useState('C00000')
  const [penHighlight, setPenHighlight] = useState('yellow')
  const [painter, setPainter] = useState<PainterState | null>(null)
  const fontStepRef = useRef<{
    pending: number | null
    applied: number | null
    timer: number | null
    // editor snapshot the deferred apply validates against (stale-apply guard)
    anchor: number
    head: number
    doc: PMNode | null
  }>({ pending: null, applied: null, timer: null, anchor: -1, head: -1, doc: null })
  /** Enter pressed in a font combobox: the coming blur is an explicit commit,
   *  which applies even an unchanged value (normalizes mixed selections, r121) */
  const fontCommitRef = useRef(false)
  const lastRegularTab = useRef<(typeof TABS)[number]>('home')
  const wasInTable = useRef(false)
  const wasInImage = useRef(false)
  /** Picture Format → remove background / crop dialogs */
  const [pictureDialog, setPictureDialog] = useState<'cutout' | 'crop' | null>(null)
  const [insertImageOpen, setInsertImageOpen] = useState(false)
  const [aiReplaceOpen, setAiReplaceOpen] = useState(false)
  const [aiReplacePrompt, setAiReplacePrompt] = useState('')
  const [aiReplaceBusy, setAiReplaceBusy] = useState(false)

  /** 统一插入媒体对话框的传输桥：共享 ai:* 通道 + docs 生图 */
  const insertImageBridge: InsertImageBridge = {
    getAiSettings: () => window.desktop?.getAiSettings?.() ?? Promise.resolve(null),
    searchWeb: async (query, page, source) => {
      const r = await window.desktop?.webImageSearch(query, undefined, page, source)
      return {
        images: (r?.images as WebImageItem[]) ?? [],
        ...(r?.error ? { error: r.error } : {}),
        ...(r?.attempts ? { attempts: r.attempts } : {}),
      }
    },
    searchStock: async (source, query, page) => {
      const r = await window.desktop?.stockImageSearch(source, query, undefined, page)
      return {
        images: (r?.images as WebImageItem[]) ?? [],
        error: r?.error,
        code: r?.code,
      }
    },
    fetchImage: async (url) => {
      const r = await window.desktop?.remoteImage(url)
      return r ? { mediaType: r.mime, base64: r.base64 } : null
    },
    getStockKeys: async () => (await window.desktop?.stockKeysGet()) ?? { pexels: '', pixabay: '' },
    setStockKeys: (keys) => window.desktop?.stockKeysSet(keys) ?? Promise.resolve(),
    listMediaModels: async () => (await window.desktop?.mediaModels()) ?? { models: [] },
    generateSvg: (req) =>
      window.desktop?.generateSvg(req) ?? Promise.resolve({ error: 'svg generation unavailable' }),
    generate: async (req) => {
      const r = await window.desktop?.mediaGenerate(req)
      return r ?? { error: 'no image' }
    },
    videoSubmit: async (req) =>
      (await window.desktop?.videoSubmit(req)) ?? { error: 'video tasks unavailable' },
    videoTasks: async () => (await window.desktop?.videoTasks()) ?? { tasks: [] },
    videoCancel: async (id) => {
      await window.desktop?.videoCancel(id)
    },
    videoRetry: async (id) => (await window.desktop?.videoRetry(id)) ?? {},
    videoPreview: async (id) => (await window.desktop?.videoPreview(id)) ?? {},
    onVideoTasksChanged: (cb) => window.desktop?.onVideoTasksChanged(cb) ?? (() => {}),
  }

  /** AI 重绘替换选中图片：提示词→生成→字节替换（保留显示尺寸与裁剪参数） */
  const runAiReplace = async (): Promise<void> => {
    const prompt = aiReplacePrompt.trim()
    if (!prompt || aiReplaceBusy || !canEdit) return
    const attrs = editor.getAttributes('docProtected')
    if (attrs?.blockType !== 'image') return
    setAiReplaceBusy(true)
    try {
      const r = await window.desktop?.aiGenerateImage({ prompt })
      if (r?.url) {
        const media = await window.desktop?.remoteImage(r.url)
        if (media) {
          await applyPictureBytes(`data:${media.mime};base64,${media.base64}`)
          setAiReplaceOpen(false)
          setAiReplacePrompt('')
        }
      }
    } finally {
      setAiReplaceBusy(false)
    }
  }
  const [listDialog, setListDialog] = useState(false)
  const [tablePropertiesOpen, setTablePropertiesOpen] = useState(false)

  useEffect(() => {
    if (tabRequest && (TABS as readonly string[]).includes(tabRequest.tab)) {
      const requested = tabRequest.tab as (typeof TABS)[number]
      lastRegularTab.current = requested
      setTab(requested)
      setDropdown(null)
    }
  }, [tabRequest])

  // keep an outer mobile navigation bar in sync, contextual auto-activation included
  useEffect(() => {
    onActiveTabChange?.(tab)
  }, [tab, onActiveTabChange])

  // Unified dismissal: a press anywhere outside the open panel closes it (plus
  // window blur / shell chrome presses). The [data-rb-panel] element exists in
  // the DOM only while a dropdown is open, and its parent element is the wrap
  // that also holds the trigger button — so a press on the open dropdown's own
  // trigger counts as "inside" and falls through to the trigger's onClick
  // toggle (closing it) instead of being treated as an outside press.
  useDismissablePopover(dropdown != null, () => setDropdown(null), {
    inside: () =>
      Array.from(document.querySelectorAll('[data-rb-panel]')).flatMap((panel) => [
        panel,
        panel.parentElement,
      ]),
  })

  // leaving the Draw tab always drops back to text editing, so the drawing
  // overlay never swallows clicks while its controls are off-screen
  useEffect(() => {
    if (tab !== 'draw' && inkTool !== 'select') onInkTool('select')
  }, [tab, inkTool, onInkTool])

  // a focused textbox sub-editor receives text/paragraph formatting instead
  // of the main editor (Word: ribbon acts on the shape's text while inside it)
  const sub = fs.sub
  const ed = sub ?? editor
  // read-only (Restrict Editing / Read Mode): every edit command is fenced here,
  // button disabled states are only the visual layer on top
  const canEdit = hasDoc && fs.editable
  const chain = () => (canEdit ? ed.chain().focus() : NOOP_CHAIN)
  const inTable = fs.inTable

  useEffect(() => {
    if (inTable && !wasInTable.current) {
      wasInTable.current = true
      setDropdown(null)
      setTab('tableLayout')
    } else if (!inTable && wasInTable.current) {
      wasInTable.current = false
      setDropdown(null)
      setTab((current) =>
        TABLE_TABS.includes(current as (typeof TABLE_TABS)[number])
          ? lastRegularTab.current
          : current,
      )
    }
  }, [inTable])

  // ---- Picture Format (contextual tab when an image block is selected, same mechanism as tables) ----
  const inImage = !sub && fs.imageSelected
  const imageDataUrl = inImage ? fs.imageDataUrl : null

  useEffect(() => {
    if (inImage && !wasInImage.current) {
      wasInImage.current = true
      setDropdown(null)
      setTab('pictureFormat')
    } else if (!inImage && wasInImage.current) {
      wasInImage.current = false
      setDropdown(null)
      setPictureDialog(null)
      setTab((current) => (current === 'pictureFormat' ? lastRegularTab.current : current))
    }
  }, [inImage])

  // ---- Shape Format (contextual tab when a floating box is selected, same mechanism) ----
  // Unlike the picture tab this one survives `sub`: double-clicking into the
  // shape's text keeps the object selected in the main editor, and Word leaves
  // Shape Format standing throughout — dropping it there is what forced a trip
  // back to Home to change so much as the weight of the text just typed.
  const inShape = fs.textboxSelected
  const shapeIsLine = !!fs.shapePrst?.startsWith('line')
  const wasInShape = useRef(false)

  useEffect(() => {
    if (inShape && !wasInShape.current) {
      wasInShape.current = true
      setDropdown(null)
      setTab('shapeFormat')
    } else if (!inShape && wasInShape.current) {
      wasInShape.current = false
      setDropdown(null)
      setTab((current) => (current === 'shapeFormat' ? lastRegularTab.current : current))
    }
  }, [inShape])

  /** apply fill/outline to the selected floating box (first box of the node) */
  const setShapeStyle = (patch: { fill?: string | null; borderColor?: string | null }) => {
    if (!canEdit) return
    const attrs = editor.getAttributes('docProtected')
    const boxes = attrs?.textboxes as TextboxDisplay[] | null
    if (!Array.isArray(boxes) || boxes.length === 0) return
    const box = { ...boxes[0] }
    if ('fill' in patch) {
      if (patch.fill) box.fill = patch.fill
      else delete box.fill
    }
    if ('borderColor' in patch) {
      if (patch.borderColor) box.borderColor = patch.borderColor
      else delete box.borderColor
    }
    editor
      .chain()
      .focus()
      .updateAttributes('docProtected', { textboxes: [box, ...boxes.slice(1)] })
      .run()
  }

  /**
   * Rewrite every run and paragraph of the selected shape. Only for object mode:
   * with the shape selected there is no text selection for a mark command to act
   * on, so Word reformats the whole shape and `editRun`/`editPara` see each part
   * of it in turn. While a sub-editor holds focus the ordinary mark and alignment
   * commands already target the text, and shapeTextCommand routes there instead.
   *
   * Confined to the first box like setShapeStyle: a paragraph anchoring several
   * shapes packs them into one docProtected node, and the ribbon reads and writes
   * only that one — reformatting the rest would hit shapes it is not showing.
   *
   * The node view re-feeds its sub-editors from the new attrs, so the shape
   * repaints even while its text is being edited.
   */
  const setShapeText = (
    editRun?: (run: Run) => Run,
    editPara?: (para: TextboxParaDisplay) => TextboxParaDisplay,
  ) => {
    if (!canEdit) return
    const attrs = editor.getAttributes('docProtected')
    const boxes = attrs?.textboxes as TextboxDisplay[] | null
    if (!Array.isArray(boxes) || boxes.length === 0 || boxes[0].readOnly) return
    const box = {
      ...boxes[0],
      paras: boxes[0].paras.map((para) => {
        const withRuns = editRun ? { ...para, runs: para.runs.map(editRun) } : para
        return editPara ? editPara(withRuns) : withRuns
      }),
    }
    editor
      .chain()
      .focus()
      .updateAttributes('docProtected', { textboxes: [box, ...boxes.slice(1)] })
      .run()
  }

  /** drop a run property rather than storing an explicit "off" Word would have to write out */
  const withRunFlag = (run: Run, key: 'bold' | 'italic' | 'underline', on: boolean): Run => {
    const next = { ...run }
    if (on) next[key] = true
    else delete next[key]
    return next
  }

  /** Shape Format text buttons: the sub-editor when inside the text, the whole shape otherwise */
  const shapeTextCommand = {
    toggleMark: (name: 'bold' | 'italic' | 'underline', active: boolean) => {
      if (sub) chain().toggleMark(name).run()
      else setShapeText((run) => withRunFlag(run, name, !active))
    },
    setColor: (hex: string | null) => {
      if (sub) setTextStyle({ color: hex })
      else
        setShapeText((run) => {
          const next = { ...run }
          if (hex) next.color = hex
          else delete next.color
          return next
        })
    },
    setAlign: (align: 'left' | 'center' | 'right' | 'justify') => {
      if (sub) setSelectionAlign(ed, align)
      else setShapeText(undefined, (para) => ({ ...para, align }))
    },
  }

  const shapeTextActive = {
    bold: sub ? fs.bold : fs.shapeTextBold,
    italic: sub ? fs.italic : fs.shapeTextItalic,
    underline: sub ? fs.underline : fs.shapeTextUnderline,
    color: sub ? fs.textColor : fs.shapeTextColor,
    align: sub ? fs.align : fs.shapeTextAlign,
  }

  /**
   * Replace the selected image's bytes (shared by Replace Picture / remove background / crop).
   * Original images (docxIndex set) swap bytes in place via the imageReplace patch: the
   * drawing XML survives, so wrap/position/docxIndex — and with them the Position gallery —
   * keep working. Images not yet saved (genImage) just update their pending payload.
   * Display size keeps the current width; height adapts to the new image's aspect ratio.
   */
  /** 压缩图片: re-encodes the source bytes; all parametric aspects survive */
  const applyCompressedPicture = async (ppi: number) => {
    if (!canEdit || !imageDataUrl) return
    const attrs = editor.getAttributes('docProtected')
    if (attrs?.blockType !== 'image') return
    const w = Number(attrs.imageWidthPx) || 0
    const h = Number(attrs.imageHeightPx) || 0
    if (!w || !h) return
    try {
      const compressed = await compressImageForDisplay(imageDataUrl, w, h, ppi)
      if (compressed === imageDataUrl) return
      const m = /^data:(image\/(?:png|jpeg|gif));base64,(.*)$/s.exec(compressed)
      if (!m) return
      const isOriginal = attrs.docxIndex !== null && attrs.docxIndex !== undefined
      editor
        .chain()
        .focus()
        .updateAttributes('docProtected', {
          imageDataUrl: compressed,
          ...(isOriginal
            ? { imageReplace: { base64: m[2], mime: m[1] } }
            : { genImage: { base64: m[2], mime: m[1], widthPx: w, heightPx: h } }),
        })
        .run()
    } catch {
      /* decode failure: keep the original */
    }
  }

  /** Non-destructive crop: fractions ride imageCrop; the bytes stay original */
  const applyPictureCrop = (crop: { l: number; t: number; r: number; b: number }) => {
    if (!canEdit) return
    const attrs = editor.getAttributes('docProtected')
    if (attrs?.blockType !== 'image') return
    editor.chain().focus().updateAttributes('docProtected', { imageCrop: crop }).run()
  }

  const applyPictureBytes = async (dataUrl: string) => {
    if (!canEdit) return
    const m = /^data:(image\/(?:png|jpeg|gif));base64,(.*)$/s.exec(dataUrl)
    if (!m) return
    const attrs = editor.getAttributes('docProtected')
    if (attrs?.blockType !== 'image') return
    try {
      const natural = await imageSizeOf(dataUrl)
      const currentW = Number(attrs.imageWidthPx) || Math.min(natural.width, 620)
      const w = Math.max(1, Math.round(currentW))
      const h = Math.max(1, Math.round((currentW * natural.height) / natural.width))
      const isOriginal = attrs.docxIndex !== null && attrs.docxIndex !== undefined
      editor
        .chain()
        .focus()
        .updateAttributes('docProtected', {
          imageDataUrl: dataUrl,
          imageWidthPx: w,
          imageHeightPx: h,
          // The new bytes are the full picture (crop/cutout bake destructively) and
          // the replace pipeline strips a:srcRect on save — drop a Word-authored
          // crop/fill window or it would keep clipping the new image until reload
          imageCrop: null,
          imageFillRect: null,
          ...(isOriginal
            ? { imageReplace: { base64: m[2], mime: m[1] } }
            : { genImage: { base64: m[2], mime: m[1], widthPx: w, heightPx: h } }),
        })
        .run()
    } catch {
      /* image decode failed: keep the original untouched */
    }
  }

  const replacePicture = async () => {
    const picked = await window.desktop.pickImage()
    if (!picked) return
    await applyPictureBytes(`data:${picked.mime};base64,${picked.base64}`)
  }

  const rotatePicture = (deltaDeg: number) => {
    if (!canEdit) return
    const attrs = editor.getAttributes('docProtected')
    if (attrs?.blockType !== 'image') return
    const next = ((((Number(attrs.imageRotDeg) || 0) + deltaDeg) % 360) + 360) % 360
    editor
      .chain()
      .focus()
      .updateAttributes('docProtected', { imageRotDeg: next || null })
      .run()
  }

  const flipPicture = (axis: 'h' | 'v') => {
    if (!canEdit) return
    const attrs = editor.getAttributes('docProtected')
    if (attrs?.blockType !== 'image') return
    const key = axis === 'h' ? 'imageFlipH' : 'imageFlipV'
    editor
      .chain()
      .focus()
      .updateAttributes('docProtected', { [key]: !attrs[key] })
      .run()
  }

  /** Set the image display size proportionally (cm input; either side drives the other) */
  const setPictureSizeCm = (dim: 'w' | 'h', cm: number) => {
    if (!canEdit) return
    const attrs = editor.getAttributes('docProtected')
    const w = Number(attrs?.imageWidthPx)
    const h = Number(attrs?.imageHeightPx)
    if (attrs?.blockType !== 'image' || !w || !h || !(cm > 0)) return
    const px = clampPictureCm(cm) * PX_PER_CM
    const next =
      dim === 'w'
        ? {
            imageWidthPx: Math.max(1, Math.round(px)),
            imageHeightPx: Math.max(1, Math.round((px * h) / w)),
          }
        : {
            imageWidthPx: Math.max(1, Math.round((px * w) / h)),
            imageHeightPx: Math.max(1, Math.round(px)),
          }
    editor.chain().focus().updateAttributes('docProtected', next).run()
  }

  /** Reset to the image's natural size (shrunk to 620px when exceeding body width, matching insertion) */
  const resetPictureSize = async () => {
    if (!canEdit) return
    const attrs = editor.getAttributes('docProtected')
    const url = attrs?.imageDataUrl as string | null
    if (attrs?.blockType !== 'image' || !url) return
    try {
      const natural = await imageSizeOf(url)
      const scale = Math.min(1, 620 / natural.width)
      editor
        .chain()
        .focus()
        .updateAttributes('docProtected', {
          imageWidthPx: Math.max(1, Math.round(natural.width * scale)),
          imageHeightPx: Math.max(1, Math.round(natural.height * scale)),
        })
        .run()
    } catch {
      /* decode failed: leave as is */
    }
  }

  const runTableCommand = (command: Command) => {
    if (!canEdit) return
    editor.view.focus()
    command(editor.state, editor.view.dispatch)
  }

  // ---- Table borders / vertical alignment / row height & column width ----
  const [borderColor, setBorderColor] = useState('000000')
  const [borderSz, setBorderSz] = useState(4) // 1/8 pt:4 = 0.5pt
  const sectionContentWidthPx = section
    ? Math.max(1, (section.pageWidth - section.marginLeft - section.marginRight) / 15)
    : 624
  const maxRowHeightCm = section
    ? (Math.max(1, section.pageHeight - section.marginTop - section.marginBottom) / 1440) * 2.54
    : 23.28

  type BorderSide = { style: string; szEighths?: number; color?: string }
  /** Apply borders to selected cells: all/outer/inner compute the four sides per cell from selection geometry; none clears explicitly.
   *  top/bottom/left/right apply only to that edge of the selection. insideH/insideV
   *  write the table-level tblBorders attr (per-cell insideH/insideV has no renderer):
   *  they apply to the whole table, as their tips state. */
  const applyCellBorders = (
    mode:
      | 'all'
      | 'outer'
      | 'inner'
      | 'none'
      | 'top'
      | 'bottom'
      | 'left'
      | 'right'
      | 'insideH'
      | 'insideV',
  ) => {
    if (!canEdit || !isInTable(editor.state)) return
    editor.view.focus()
    const { state, view } = editor
    const rect = selectedRect(state)
    const solid: BorderSide = { style: 'single', szEighths: borderSz, color: borderColor }
    const none: BorderSide = { style: 'none' }
    if (mode === 'insideH' || mode === 'insideV') {
      const tablePos = rect.tableStart - 1
      const tableNode = state.doc.nodeAt(tablePos)
      if (!tableNode || tableNode.type.name !== 'docTable') return
      const prev = (tableNode.attrs.borders as Record<string, BorderSide> | null) ?? {}
      view.dispatch(
        state.tr.setNodeMarkup(tablePos, undefined, {
          ...tableNode.attrs,
          borders: { ...prev, [mode]: solid },
        }),
      )
      return
    }
    let tr = state.tr
    const seen = new Set<number>()
    for (let row = rect.top; row < rect.bottom; row++) {
      for (let col = rect.left; col < rect.right; col++) {
        const cellPos = rect.map.map[row * rect.map.width + col]
        if (seen.has(cellPos)) continue
        seen.add(cellPos)
        const pos = rect.tableStart + cellPos
        const node = state.doc.nodeAt(pos)
        if (!node) continue
        const cellRect = rect.map.findCell(cellPos)
        const edge = {
          top: cellRect.top <= rect.top,
          bottom: cellRect.bottom >= rect.bottom,
          left: cellRect.left <= rect.left,
          right: cellRect.right >= rect.right,
        }
        const next: Record<string, BorderSide> = {
          ...((node.attrs.borders as Record<string, BorderSide> | null) ?? {}),
        }
        for (const side of ['top', 'bottom', 'left', 'right'] as const) {
          if (mode === 'all') next[side] = solid
          else if (mode === 'none') next[side] = none
          else if (mode === 'outer' && edge[side]) next[side] = solid
          else if (mode === 'inner' && !edge[side]) next[side] = solid
          else if (mode === side && edge[side]) next[side] = solid
        }
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, borders: next })
      }
    }
    if (mode === 'none') {
      // table-level inside lines (Inside Horizontal/Vertical) would otherwise survive No Borders
      const tablePos = rect.tableStart - 1
      const tableNode = tr.doc.nodeAt(tablePos)
      const prev = tableNode?.attrs.borders as Record<string, BorderSide> | null | undefined
      if (tableNode?.type.name === 'docTable' && prev && (prev.insideH || prev.insideV)) {
        const { insideH: _h, insideV: _v, ...rest } = prev
        tr = tr.setNodeMarkup(tablePos, undefined, {
          ...tableNode.attrs,
          borders: Object.keys(rest).length ? rest : null,
        })
      }
    }
    view.dispatch(tr)
  }

  /** Set row height for selected rows (cm; 0/empty = clear) */
  const applyRowHeight = (cm: number | null) => {
    if (!canEdit || !isInTable(editor.state)) return
    editor.view.focus()
    const { state, view } = editor
    const rect = selectedRect(state)
    const twips = cm && cm > 0 ? Math.round((Math.min(cm, maxRowHeightCm) / 2.54) * 1440) : null
    let tr = state.tr
    rect.table.forEach((rowNode, offset, idx) => {
      if (idx < rect.top || idx >= rect.bottom) return
      tr = tr.setNodeMarkup(rect.tableStart + offset, undefined, {
        ...rowNode.attrs,
        heightTwips: twips,
      })
    })
    view.dispatch(tr)
  }

  /** Set column width for selected columns (cm): writes the matching colwidth slot of every cell in the column */
  const applyColumnWidth = (cm: number | null) => {
    if (!canEdit || !isInTable(editor.state) || !cm || cm <= 0) return
    editor.view.focus()
    const px = Math.round((cm / 2.54) * 96)
    setSelectedColumnWidth(px, sectionContentWidthPx)(editor.state, editor.view.dispatch)
  }

  /** Current cell properties (echoed in the size inputs) */
  const activeCellInfo =
    fs.cellKey === null
      ? null
      : {
          key: fs.cellKey,
          heightCm: fs.cellHeightCm,
          widthCm: fs.cellWidthCm,
          vAlign: fs.cellVAlign,
        }

  const tableAttrs = inTable ? editor.getAttributes('docTable') : {}
  const tableHeader = inTable ? repeatHeaderState(editor.state) : { enabled: false, active: false }
  const tableLook = (tableAttrs.tblLook as TableLook | null) ?? {
    firstRow: true,
    lastRow: false,
    firstColumn: true,
    lastColumn: false,
    bandedRows: true,
    bandedColumns: false,
  }
  const tableAutoFitMode: TableAutoFitMode =
    tableAttrs.tblAutoFit === 'contents' || tableAttrs.tblAutoFit === 'window'
      ? tableAttrs.tblAutoFit
      : 'fixed'
  const tableAutoFitLabel =
    TABLE_AUTO_FIT_OPTIONS.find(([mode]) => mode === tableAutoFitMode)?.[1] ??
    'ribbonFixedColumnWidth'

  const applyTableProperties = (value: TablePropertiesValue) => {
    if (!canEdit || !inTable) return
    let measuredWidthPx = Number(tableAttrs.widthPx) || 0
    if (!(measuredWidthPx > 0)) {
      try {
        const rect = selectedRect(editor.state)
        const tableDom = editor.view.nodeDOM(rect.tableStart - 1)
        if (tableDom instanceof HTMLElement) {
          const zoomEl = document.querySelector('.doc-zoom') as HTMLElement | null
          const zoom = zoomEl ? parseFloat(getComputedStyle(zoomEl).zoom || '1') || 1 : 1
          measuredWidthPx = tableDom.getBoundingClientRect().width / zoom
        }
      } catch {
        // A malformed table falls back to the section width below.
      }
    }
    measuredWidthPx = Math.max(1, Math.round(measuredWidthPx || sectionContentWidthPx))
    const positionedWidthPx =
      value.autoFit === 'window' ? Math.round(sectionContentWidthPx) : measuredWidthPx
    runTableCommand(setTableAutoFit(value.autoFit, sectionContentWidthPx))
    const twips = (cm: number) => Math.max(0, Math.round(cm * TWIPS_PER_CM))
    const signedTwips = (cm: number) => Math.round(cm * TWIPS_PER_CM)
    const floatX =
      value.wrap === 'right' && Math.abs(value.positionXCm) < 0.001
        ? value.autoFit === 'window'
          ? 0
          : Math.max(0, Math.round((sectionContentWidthPx - positionedWidthPx) * 15))
        : signedTwips(value.positionXCm)
    const keepFloatSuppressed = value.floatSuppressed && value.wrap !== 'none'
    runTableCommand(
      updateSelectedTableAttrs({
        tblFloatWidthPx: value.wrap === 'right' ? positionedWidthPx : null,
        cellMar: {
          top: twips(value.marginTopCm),
          right: twips(value.marginRightCm),
          bottom: twips(value.marginBottomCm),
          left: twips(value.marginLeftCm),
        },
        cellMarEdited: true,
        tblFloat: keepFloatSuppressed ? null : value.wrap,
        tblFloatSource: value.wrap,
        tblFloatSuppressed: keepFloatSuppressed,
        tblFloatXTwips: value.wrap === 'none' ? null : floatX,
        tblFloatYTwips: value.wrap === 'none' ? null : signedTwips(value.positionYCm),
        tblFloatHorzAnchor:
          value.wrap === 'none' ? null : (tableAttrs.tblFloatHorzAnchor ?? 'margin'),
        tblFloatVertAnchor:
          value.wrap === 'none' ? null : (tableAttrs.tblFloatVertAnchor ?? 'margin'),
        tblFloatDistance:
          value.wrap === 'none'
            ? null
            : {
                top: twips(value.distanceCm),
                right: twips(value.distanceCm),
                bottom: twips(value.distanceCm),
                left: twips(value.distanceCm),
              },
        tblFloatEdited: true,
      }),
    )
    setTablePropertiesOpen(false)
  }

  const activeCharStyleId = fs.charStyleId
  const presetAccent = themeColors?.accent1?.trim().toUpperCase() || DEFAULT_PRESET_ACCENT

  /** preview CSS from a style's resolved display (真实样式外观, not the static card CSS) */
  const previewStyleOf = (styleId: string): CSSProperties | undefined => {
    const d = styles?.get(styleId)?.display
    if (!d) return undefined
    const css: CSSProperties = {}
    if (d.font || d.fontAscii) css.fontFamily = `"${d.fontAscii ?? d.font}", sans-serif`
    if (d.sizeHalfPoints) css.fontSize = `${d.sizeHalfPoints / 2}px`
    if (d.color) css.color = `#${d.color}`
    if (d.bold) css.fontWeight = 'bold'
    if (d.italic) css.fontStyle = 'italic'
    if (d.underline) css.textDecoration = 'underline'
    // 'distribute' has no CSS equivalent; the preview falls back to justify
    if (d.align) css.textAlign = d.align === 'distribute' ? 'justify' : d.align
    return Object.keys(css).length ? css : undefined
  }

  /**
   * 非标题段落样式卡（Title/Quote/明显引用 等文档自带样式）：Word gallery
   * semantics — paragraph styles that aren't headings, aren't hidden/list-shells
   * and aren't the default (Normal is already the 正文 card). Applied as
   * docParagraph.styleId (engine writes <w:pStyle> verbatim).
   */
  const paraStyleItems: Array<{ key: string; label: string; previewStyle?: CSSProperties }> = []
  if (styles) {
    for (const [id, info] of styles) {
      if (info.type !== 'paragraph') continue
      if (info.headingLevel) continue // headings have their own cards
      if (info.isDefault) continue // Normal == 正文 card
      if (info.semiHidden || info.linkedCharShell) continue
      if (/^(ListParagraph|BalloonText|HTMLPreformatted?)$/i.test(id)) continue
      paraStyleItems.push({
        key: `pstyle:${id}`,
        label: info.name,
        previewStyle: previewStyleOf(id),
      })
    }
  }

  /**
   * Character styles shown in the gallery.
   * Use doc's own character styles (type=character) if any, otherwise show
   * the two built-in presets so the gallery is never empty.
   */
  const charStyleItems: Array<{ key: string; label: string; previewStyle: CSSProperties }> =
    (() => {
      // Collect non-Hyperlink character styles from the document
      const docItems: Array<{ key: string; label: string; previewStyle: React.CSSProperties }> = []
      if (styles) {
        for (const [id, info] of styles) {
          if (info.type !== 'character') continue
          if (id === 'Hyperlink' || id === 'FollowedHyperlink' || id === 'DefaultParagraphFont')
            continue
          // Word rule: semiHidden and linked character shells ("Heading 1 Char") stay out of the style gallery
          if (info.semiHidden || info.linkedCharShell) continue
          const css: CSSProperties = {}
          if (info.display?.bold) css.fontWeight = 'bold'
          if (info.display?.italic) css.fontStyle = 'italic'
          if (info.display?.underline) css.textDecoration = 'underline'
          if (info.display?.color) css.color = `#${info.display.color}`
          docItems.push({ key: `char:${id}`, label: info.name, previewStyle: css })
        }
      }
      if (docItems.length > 0) return docItems
      // Fallback: built-in presets
      return CHAR_STYLE_PRESETS.map((p) => ({
        key: `char:${p.styleId}`,
        label: t(p.labelKey),
        previewStyle: p.display(presetAccent),
      }))
    })()

  // Presets carry no styleId (they apply plain italic/bold + accent color), so
  // detect their active state from the format state instead of charStyleId.
  const usingPresetFallback = charStyleItems[0]?.key === `char:${CHAR_STYLE_PRESETS[0].styleId}`
  const presetActive = (mark: 'italic' | 'bold'): boolean =>
    usingPresetFallback &&
    !activeCharStyleId &&
    (mark === 'italic' ? fs.italic : fs.bold) &&
    (fs.textColor ?? '').toUpperCase() === presetAccent
  const activeStyleKey =
    fs.headingLevel !== null
      ? `h${fs.headingLevel}`
      : fs.paraStyleId
        ? `pstyle:${fs.paraStyleId}`
        : activeCharStyleId
          ? `char:${activeCharStyleId}`
          : presetActive('bold')
            ? 'char:__preset_strong'
            : presetActive('italic')
              ? 'char:__preset_emphasis'
              : 'p'

  // Style gallery overflow: cards that don't fit wrap onto a second row that
  // the fixed-height gallery clips (whole cards only, never a half-cut one),
  // and a "more styles" expander appears whenever cards are hidden. The
  // gallery is then capped right after the last visible card so the expander
  // hugs it instead of floating at the group's far edge.
  const styleGalleryRef = useRef<HTMLDivElement | null>(null)
  const [styleGalleryOverflow, setStyleGalleryOverflow] = useState(false)
  useLayoutEffect(() => {
    const el = styleGalleryRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const check = () => {
      // measure the natural (uncapped) layout at the current wrapper width
      el.style.maxWidth = ''
      const cards = Array.from(el.children) as HTMLElement[]
      const firstRow = cards.filter((c) => c.offsetTop === cards[0]?.offsetTop)
      const overflow = firstRow.length < cards.length
      if (overflow) {
        const last = firstRow[firstRow.length - 1]
        el.style.maxWidth = `${last.offsetLeft - firstRow[0].offsetLeft + last.offsetWidth}px`
      }
      setStyleGalleryOverflow(overflow)
    }
    check()
    const ro = new ResizeObserver(check)
    // observe the wrapper, not the gallery: once capped, the gallery no longer
    // resizes with the window, so it would never re-trigger the observer
    ro.observe(el.parentElement ?? el)
    return () => ro.disconnect()
    // re-check when the card set can change, and after the expander mounts or
    // unmounts (it takes row width, which can change how many cards fit)
  }, [tab, charStyleItems.length, lang, styleGalleryOverflow])

  const currentSize = fs.fontSizePt
  const [fontScope, setFontScope] = useState('selection')
  const [fontSettingsBusy, setFontSettingsBusy] = useState(false)
  // computed unconditionally (not inside the dropdown render): cheap, and the
  // render-isolation test uses fontFamiliesFor calls as its render probe
  fontFamiliesFor(lang)

  /** merge new attrs into the docTextStyle mark, preserving the rest.
   * Only the patch is passed: setMark merges per existing mark and with the caret's
   * stored mark. Rebuilding from getAttributes read-back dropped the previous call's
   * value on a collapsed cursor (stored-mark changes don't re-render). */
  const setTextStyle = (patch: Record<string, unknown>) => {
    chain().setMark('docTextStyle', patch).run()
    setDropdown(null)
  }

  // LOCAL(2026-09-22, f5247d3..476e5023): 槽位式 setFont(font/fontAscii)+作用域写回,
  // 与 home-tab 的双字体设置 UI 配套;上游 476e5023 的单字体盒(isEastAsianFontName 推断)
  // 依赖其内联 Home 标签体,本地 Home 体已组件化,不采纳其签名
  const setFont = (slot: 'font' | 'fontAscii', name: string) => {
    if (fontScope === 'selection') {
      setTextStyle({
        [slot]: name,
        ...(slot === 'font' ? { eaSlotEmpty: false, eastAsiaFont: name } : {}),
      })
    } else if (onFontSettings) {
      setDropdown(null)
      setFontSettingsBusy(true)
      void onFontSettings(fontScope, { [slot === 'font' ? 'eastAsiaFont' : 'font']: name })
        .catch((error) => showToast(String(error), 'error'))
        .finally(() => setFontSettingsBusy(false))
    }
  }

  /** apply paragraph-level attrs to every paragraph in the selection (textbox sub-editor included) */
  const setParaAttr = (attrs: Record<string, unknown>) => {
    if (canEdit) setParaAttrs(ed, attrs)
    setDropdown(null)
  }

  const applyStyle = (key: string) => {
    if (key.startsWith('char:')) {
      const styleId = key.slice(5)
      const preset = CHAR_STYLE_PRESETS.find((p) => p.styleId === styleId)
      if (preset) {
        // Presets are plain italic/bold marks + accent color; toggle off when already active
        if (activeStyleKey === key) {
          chain().unsetMark(preset.mark).setMark('docTextStyle', { color: null }).run()
        } else {
          // switching presets must drop the other's mark, otherwise both stay
          // active and the gallery highlight sticks on the wrong card
          let c = chain()
          for (const p of CHAR_STYLE_PRESETS) if (p !== preset) c = c.unsetMark(p.mark)
          c.setMark(preset.mark).setMark('docTextStyle', { color: presetAccent }).run()
        }
        return
      }
      // Toggle: if already active, remove the mark; else set it
      if (activeCharStyleId === styleId) {
        chain().unsetMark('docTextStyle').run()
      } else {
        chain().setMark('docTextStyle', { styleId }).run()
      }
      return
    }
    if (sub || !canEdit) return // textboxes have no heading styles
    applyParagraphStyle(editor, key as 'p' | 'h1' | 'h2' | 'h3')
  }

  /** Style cards, shared by the inline gallery and its overflow menu */
  const renderStyleCards = (inMenu: boolean) => {
    const apply = (key: string) => {
      applyStyle(key)
      if (inMenu) setDropdown(null)
    }
    return (
      <>
        {STYLE_GALLERY.map((s) => {
          const docId = s.key === 'p' ? undefined : s.key.replace('h', 'Heading')
          const live = docId ? previewStyleOf(docId) : undefined
          return (
            <button
              key={s.key}
              className={`style-card ${activeStyleKey === s.key ? 'active' : ''}`}
              disabled={!canEdit || !!sub}
              onClick={() => apply(s.key)}
            >
              <span className={`style-card-preview ${s.className}`} style={live}>
                {t('ribbonStylePreview')}
              </span>
              <span className="style-card-label">{t(s.labelKey)}</span>
            </button>
          )
        })}
        {paraStyleItems.map((s) => (
          <button
            key={s.key}
            className={`style-card style-card-para ${activeStyleKey === s.key ? 'active' : ''}`}
            disabled={!canEdit || !!sub}
            data-tip={s.label}
            onClick={() => apply(s.key)}
          >
            <span className="style-card-preview" style={s.previewStyle}>
              {t('ribbonStylePreview')}
            </span>
            <span className="style-card-label">{s.label}</span>
          </button>
        ))}
        {charStyleItems.map((s) => (
          <button
            key={s.key}
            className={`style-card style-card-char ${activeStyleKey === s.key ? 'active' : ''}`}
            disabled={!canEdit}
            data-tip={s.label}
            onClick={() => apply(s.key)}
          >
            <span className="style-card-preview" style={s.previewStyle}>
              Aa
            </span>
            <span className="style-card-label">{s.label}</span>
          </button>
        ))}
      </>
    )
  }

  const toggleList = (kind: 'bullet' | 'ordered') => {
    if (sub) return // textboxes have no list numbering
    if (editor.isActive('docListItem', { kind })) {
      chain().setNode('docParagraph').run()
      return
    }
    // reuse the numId of an existing same-kind instance in the body; otherwise adopt a document definition / create one (writes numbering.xml)
    const numId = findNumIdOfKind(blocks, kind) ?? allocateNumId?.(kind) ?? null
    chain().setNode('docListItem', { kind, numId, ilvl: 0 }).run()
  }

  /** the gallery "None" card: drop list formatting, back to a plain paragraph */
  const clearList = () => {
    if (sub) return
    if (editor.isActive('docListItem')) chain().setNode('docParagraph').run()
  }

  /** Custom levels picked in the gallery/dialog → create a definition and apply it to the current paragraph */
  const applyListPreset = (levels: CustomNumberingLevel[]) => {
    if (sub) return
    const numId = createListDef?.(levels) ?? null
    if (!numId) return
    const kind = levels[0]?.numFmt === 'bullet' ? 'bullet' : 'ordered'
    const ilvl = editor.isActive('docListItem')
      ? Number(editor.getAttributes('docListItem').ilvl) || 0
      : 0
    chain().setNode('docListItem', { kind, numId, ilvl }).run()
  }

  const changeIndent = (delta: 1 | -1) => {
    if (sub || !canEdit) return
    stepParagraphIndent(editor, delta)
  }

  const applyFontStep = (step: (base: number) => number) => {
    // Every applied size change re-paginates the whole document synchronously —
    // ~700ms per click on table-heavy documents — so clicking A+/A- in a burst
    // froze the UI for seconds. Apply the first click immediately (a single
    // click keeps instant feedback); clicks landing inside the coalesce window
    // only advance the pending size, and one trailing apply lays out the final
    // size. `pending` also covers fs.fontSizePt lagging the last apply within
    // the window.
    const st = fontStepRef.current
    const next = step(st.pending ?? currentSize)
    st.pending = next
    if (st.timer === null) {
      st.applied = next
      setTextStyle({ sizeHalfPoints: Math.round(next * 2) })
    } else {
      window.clearTimeout(st.timer)
    }
    // Snapshot after the (possible) leading apply: the deferred apply is only
    // valid while nothing else has touched the editor. A selection move, an
    // undo, or a size set another way each shows up as a selection or document
    // change and must invalidate the pending step instead of being overwritten.
    const target = ed
    st.anchor = target.state.selection.anchor
    st.head = target.state.selection.head
    st.doc = target.state.doc
    st.timer = window.setTimeout(() => {
      st.timer = null
      const pending = st.pending
      st.pending = null
      if (pending === null || pending === st.applied || !canEdit) return
      if (
        target.state.selection.anchor !== st.anchor ||
        target.state.selection.head !== st.head ||
        target.state.doc !== st.doc
      )
        return
      st.applied = pending
      // deliberately no focus(): a deferred apply must never pull focus back
      target
        .chain()
        .setMark('docTextStyle', { sizeHalfPoints: Math.round(pending * 2) })
        .run()
    }, FONT_STEP_COALESCE_MS)
  }

  /** A+/A- and ⇧⌘. / ⇧⌘,: walk Word's preset size list */
  const stepFontSize = (dir: 1 | -1) =>
    applyFontStep((base) => {
      const idx = FONT_SIZES.findIndex((s) => s >= base)
      if (dir === 1)
        return FONT_SIZES[
          Math.min(
            idx === -1 ? FONT_SIZES.length : idx + (FONT_SIZES[idx] === base ? 1 : 0),
            FONT_SIZES.length - 1,
          )
        ]
      return FONT_SIZES[Math.max(idx === -1 ? FONT_SIZES.length - 1 : idx - 1, 0)]
    })

  /** Word's ⌘] / ⌘[: exactly one point, within Word's 1–1638pt range */
  const nudgeFontSize = (dir: 1 | -1) =>
    applyFontStep((base) => Math.min(Math.max(Math.round(base) + dir, 1), 1638))

  useEffect(() => {
    if (!actionsRef) return
    actionsRef.current.stepFontSize = stepFontSize
    actionsRef.current.nudgeFontSize = nudgeFontSize
  })

  const toggleVertAlign = (kind: 'superscript' | 'subscript') => {
    setTextStyle({ vertAlign: fs.vertAlign === kind ? null : kind })
  }

  /** format painter: pick up formatting now, apply to the next selection */
  const togglePainter = () => {
    if (painter) {
      setPainter(null)
      return
    }
    if (!canEdit) return
    const { state } = editor
    const { $from, $head, from, to, empty } = state.selection
    // Word picks up the FIRST character's formatting of a range selection (a
    // triple-clicked paragraph whose last run is plain must still pick up the
    // leading run's look); a collapsed caret reads the marks at the caret.
    const picked: Mark[] = []
    if (empty) {
      picked.push(...$head.marks())
    } else {
      let found = false
      state.doc.nodesBetween(from, to, (node) => {
        if (found) return false
        if (node.isText) {
          found = true
          picked.push(...node.marks)
          return false
        }
        return true
      })
    }
    // Paragraph formatting is picked up per Word's ¶-mark rule: a caret pickup
    // or a cross-paragraph selection carries the block identity (heading
    // level / list numbering / styleId) — which then applies to whole target
    // paragraphs. A PARTIAL in-paragraph drag copies character formatting
    // only — but a selection covering the paragraph's ENTIRE content counts
    // as including the ¶ mark, exactly like Word's triple-click ("select whole
    // paragraph → painter" dropped line spacing/indents while a caret pickup
    // carried them — backwards to any user).
    const { $to } = state.selection
    const coversWholeParagraph =
      !empty &&
      $from.parent.isTextblock && // AllSelection's parent is the doc
      $from.sameParent($to) &&
      $from.parentOffset === 0 &&
      $to.parentOffset === $to.parent.content.size
    const includesParaMark = empty || !$from.sameParent($to) || coversWholeParagraph
    const marks = picked
      .filter((m) => PAINTER_MARK_TYPES.includes(m.type.name) && m.type.name !== 'docTextStyle')
      .map((m) => ({ type: m.type.name, attrs: { ...m.attrs } as Record<string, unknown> }))
    const tsMark = picked.find((m) => m.type.name === 'docTextStyle')
    const ts: Record<string, unknown> = { ...(tsMark?.attrs ?? {}) }
    // raw rPr pass-through belongs to the source run; stamping it on foreign
    // runs would smuggle unmodeled properties across the document
    delete ts.rawRPr
    if (!includesParaMark) {
      // Char-only brush: resolve the EFFECTIVE character formatting (direct
      // marks → character style → paragraph style → docDefaults) and record it
      // as direct formatting, so the brush reproduces what the source LOOKS
      // like even when that look comes from a style. Without this, picking up
      // plain body text (no marks at all) and brushing heading-styled text
      // changes nothing. When the block travels (¶ pickup) it carries the
      // style itself, so no resolved values are stamped there.
      const styleDisplayOf = (id: unknown) =>
        typeof id === 'string' && id ? styles?.get(id)?.display : undefined
      const charStyle = styleDisplayOf(tsMark?.attrs.styleId)
      const paraStyle = styleDisplayOf($from.parent.attrs.styleId)
      for (const t of ['bold', 'italic', 'underline', 'strike'] as const) {
        const styleFlag =
          charStyle?.[t] ??
          paraStyle?.[t] ??
          (t === 'bold' ? docDefaults?.bold : t === 'italic' ? docDefaults?.italic : undefined)
        if (styleFlag && !picked.some((m) => m.type.name === t)) marks.push({ type: t, attrs: {} })
      }
      ts.sizeHalfPoints ??=
        charStyle?.sizeHalfPoints ??
        paraStyle?.sizeHalfPoints ??
        docDefaults?.sizeHalfPoints ??
        null
      ts.color ??= charStyle?.color ?? paraStyle?.color ?? docDefaults?.color ?? null
      ts.fontAscii ??=
        charStyle?.fontAscii ?? paraStyle?.fontAscii ?? docDefaults?.asciiFont ?? null
      if (ts.font == null) {
        // an empty-EA-theme-slot backfill face is not a document font choice — don't stamp it
        if (charStyle?.font && !charStyle.eaSlotEmpty) ts.font = charStyle.font
        else if (paraStyle?.font && !paraStyle.eaSlotEmpty) ts.font = paraStyle.font
        else if (docDefaults?.eastAsiaFont && !docDefaults.eaSlotEmpty)
          ts.font = docDefaults.eastAsiaFont
      }
      ts.csFont ??= charStyle?.csFont ?? paraStyle?.csFont ?? null
      ts.charSpacingTwips ??= charStyle?.charSpacingTwips ?? paraStyle?.charSpacingTwips ?? null
    }
    if (Object.values(ts).some((v) => v != null)) marks.push({ type: 'docTextStyle', attrs: ts })
    const para = $from.parent
    let block: PainterState['block'] = null
    const extra = PAINTER_BLOCK_EXTRA[para.type.name]
    if (includesParaMark && extra) {
      const attrs: Record<string, unknown> = {}
      for (const k of [...PAINTER_PARA_KEYS, ...extra]) attrs[k] = para.attrs[k]
      block = { type: para.type.name, attrs }
    }
    setPainter({ marks, block })
  }

  useEffect(() => {
    if (!painter) return
    let selectingWithMouse = false
    let downAt: { x: number; y: number } | null = null
    let finished = false
    let keyboardTimer: ReturnType<typeof setTimeout> | null = null

    /** the sentence containing the clicked position (a painter click brushes
     *  that sentence; a drag brushes the selection) */
    const sentenceRangeAt = ($pos: ResolvedPos): { from: number; to: number } | null => {
      const para = $pos.parent
      if (!para.isTextblock) return null
      // leaf nodes (images, breaks) become one placeholder char so offsets line up
      const text = para.textBetween(0, para.content.size, undefined, '￼')
      const END = /[。．！？!?…]/
      const CLOSE = /[”』」）)》〉】'"]/
      // '.' ends a sentence unless a digit follows (1.5, 3.14 stay intact)
      const at = (k: number) =>
        END.test(text[k]) || (text[k] === '.' && !/\d/.test(text[k + 1] ?? ''))
      // A straight quote is ambiguous: it counts as a CLOSING quote only when
      // it directly follows a terminator (or another closer, `…。”"`) — so the
      // opening quote of `"Hi…` / `。 "next sentence` stays inside the brushed
      // range.
      // The CJK/paired closers are unambiguous.
      const closingAt = (k: number): boolean => {
        const ch = text[k] ?? ''
        if (!CLOSE.test(ch)) return false
        if (!/['"]/.test(ch)) return true
        return at(k - 1) || (k > 0 && closingAt(k - 1))
      }
      // A click landing in a sentence's trailing closers/spaces (`…。」▏ next`)
      // belongs to THAT sentence, not the next one: re-anchor on its terminator
      let anchor = $pos.parentOffset
      {
        let j = anchor
        while (j > 0 && (closingAt(j) || /[ \t]/.test(text[j] ?? ''))) j--
        if (j < anchor && at(j)) anchor = j
      }
      let start = anchor
      while (start > 0 && !at(start - 1)) start--
      while (start < text.length && closingAt(start)) start++
      // Word convention: the trailing space belongs to the sentence, the
      // leading one to the previous sentence
      while (start < text.length && /\s/.test(text[start])) start++
      let end = anchor
      while (end < text.length && !at(end)) end++
      if (end < text.length) end++
      while (end < text.length && closingAt(end)) end++
      while (end < text.length && /[ \t]/.test(text[end])) end++
      if (start >= end) {
        // clicked in the empty tail after the final delimiter (or an empty
        // paragraph): nothing to mark, but the paragraph format still applies
        start = end = $pos.parentOffset
      }
      const base = $pos.start()
      return { from: base + start, to: base + end }
    }

    const applyRange = (from: number, to: number, caretAfter: number | null) => {
      if (finished || !editor.isEditable) return
      finished = true
      if (keyboardTimer) clearTimeout(keyboardTimer)
      setPainter(null)
      let c = editor.chain().focus().setTextSelection({ from, to })
      if (to > from) {
        // strip only formatting marks, then re-add the picked-up ones: semantic
        // marks on the target (links, comments, revisions) survive the brush
        for (const t of PAINTER_MARK_TYPES) c = c.unsetMark(t)
        for (const m of painter.marks) c = c.setMark(m.type, m.attrs)
      }
      c = c.command(({ tr }) => {
        const block = painter.block
        if (!block) return true
        const type = editor.schema.nodes[block.type]
        if (!type) return true
        const sel = tr.selection
        const jobs: Array<{ pos: number; attrs: Record<string, unknown> }> = []
        tr.doc.nodesBetween(sel.from, sel.to, (node, pos) => {
          if (!(node.type.name in PAINTER_BLOCK_EXTRA)) return true
          // keep the target's identity attrs, overwrite every formatting attr
          // (explicit nulls in block.attrs reset what the source didn't set)
          jobs.push({ pos, attrs: { ...node.attrs, ...block.attrs } })
          return false
        })
        for (const job of jobs) tr.setNodeMarkup(job.pos, type, job.attrs)
        return true
      })
      if (caretAfter != null) c = c.setTextSelection(caretAfter)
      c.run()
    }

    const onMouseDown = (event: MouseEvent) => {
      if (!editor.view.dom.contains(event.target as globalThis.Node)) return
      selectingWithMouse = true
      downAt = { x: event.clientX, y: event.clientY }
      if (keyboardTimer) clearTimeout(keyboardTimer)
    }
    const onMouseUp = (event: MouseEvent) => {
      if (!selectingWithMouse || !downAt) return
      selectingWithMouse = false
      const press = downAt
      downAt = null
      const dist = Math.abs(event.clientX - press.x) + Math.abs(event.clientY - press.y)
      requestAnimationFrame(() => {
        if (finished || !editor.isEditable) return
        const { from, to } = editor.state.selection
        const moved = from !== initial.from || to !== initial.to
        if (from !== to && moved) {
          applyRange(from, to, null)
          return
        }
        if (dist >= 5) return
        // A plain click brushes the clicked sentence. The position comes from
        // the press coordinates, not the selection: a fast click into a blurred
        // editor can reach this frame before ProseMirror has placed the caret,
        // and reading the stale selection here used to brush the source itself.
        const hit = editor.view.posAtCoords({ left: press.x, top: press.y })
        if (!hit) return
        const sentence = sentenceRangeAt(editor.state.doc.resolve(hit.pos))
        if (sentence) applyRange(sentence.from, sentence.to, hit.pos)
      })
    }
    // The pickup selection is still live when the painter is armed; only a
    // selection that has since MOVED is a target gesture (without this, any
    // stray selectionUpdate right after arming brushes the source itself)
    const initial = { from: editor.state.selection.from, to: editor.state.selection.to }
    const onSelectionUpdate = () => {
      if (selectingWithMouse || finished) return
      if (keyboardTimer) clearTimeout(keyboardTimer)
      keyboardTimer = setTimeout(() => {
        const { from, to } = editor.state.selection
        if (from === initial.from && to === initial.to) return
        if (from !== to) applyRange(from, to, null)
      }, 180)
    }

    // Word-style paintbrush cursor over the text area while the painter is armed
    editor.view.dom.classList.add('doc-painter-cursor')
    editor.view.dom.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    editor.on('selectionUpdate', onSelectionUpdate)
    return () => {
      if (keyboardTimer) clearTimeout(keyboardTimer)
      editor.view.dom.classList.remove('doc-painter-cursor')
      editor.view.dom.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      editor.off('selectionUpdate', onSelectionUpdate)
    }
  }, [painter, editor])

  const changeCase = (mode: CaseMode) => {
    if (!canEdit) return
    applyCase(ed, mode)
    setDropdown(null)
  }

  const clipboard = async (action: 'cut' | 'copy' | 'paste') => {
    if (action !== 'copy' && !canEdit) return
    if (action === 'paste') {
      // Same pipeline as Ctrl+V: pasteHTML/pasteText run the editor's full
      // paste machinery, where readText + insertContent flattened everything
      // to plain text (r127). The synthesized event carries a real
      // clipboardData so App's handlePaste branches (empty-paragraph
      // wholesale replace, markdown conversion, image priority) behave
      // exactly as on a native paste.
      const pasteEvent = (html: string | null, text: string): ClipboardEvent => {
        const data = new DataTransfer()
        if (html) data.setData('text/html', html)
        if (text) data.setData('text/plain', text)
        return new ClipboardEvent('paste', { clipboardData: data })
      }
      try {
        for (const item of await navigator.clipboard.read()) {
          const text = item.types.includes('text/plain')
            ? await (await item.getType('text/plain')).text()
            : ''
          if (item.types.includes('text/html')) {
            const html = await (await item.getType('text/html')).text()
            if (html) {
              // arm the foreign-paste handshake exactly like a Ctrl+V — the
              // synthetic pasteHTML never fires the DOM paste handler, so
              // ribbon pastes skipped the paste mode and the r181 fill
              if (beginForeignPaste(html)) {
                stashPastePayload({ html, text, mode: defaultPasteMode() })
              }
              ed.view.pasteHTML(html, pasteEvent(html, text))
              ed.commands.focus()
              return
            }
          }
          // image priority mirrors Ctrl+V: an image wins over missing or
          // whitespace-only plain text (OS clipboards often advertise an
          // empty text/plain beside image/png)
          const imageType = item.types.find((type) => type.startsWith('image/'))
          if (imageType && !text.trim()) {
            const blob = await item.getType(imageType)
            const reader = new FileReader()
            reader.onload = () => {
              if (typeof reader.result === 'string') {
                void insertImageFromDataUrl(ed, reader.result, 'Image (pasted)')
              }
            }
            reader.readAsDataURL(blob)
            return
          }
        }
      } catch {
        /* clipboard.read unavailable/denied: plain-text fallback below */
      }
      const text = await navigator.clipboard.readText()
      if (text) {
        ed.view.pasteText(text, pasteEvent(null, text))
        ed.commands.focus()
      }
    } else {
      document.execCommand(action)
      ed.commands.focus()
    }
  }

  const markBtn = (name: string, active: boolean, title: string, label: ReactNode) => (
    <button
      className={`rb-icon ${active ? 'active' : ''}`}
      disabled={!canEdit}
      data-tip={title}
      aria-label={title}
      onClick={() => chain().toggleMark(name).run()}
    >
      {label}
    </button>
  )

  const shapeMarkBtn = (
    name: 'bold' | 'italic' | 'underline',
    active: boolean,
    title: string,
    label: ReactNode,
  ) => (
    <button
      className={`rb-icon ${active ? 'active' : ''}`}
      disabled={!canEdit}
      data-tip={title}
      aria-label={title}
      onClick={() => shapeTextCommand.toggleMark(name, active)}
    >
      {label}
    </button>
  )

  const shapeAlignBtn = (
    align: 'left' | 'center' | 'right' | 'justify',
    title: string,
    icon: ReactNode,
  ) => (
    <button
      className={`rb-icon ${shapeTextActive.align === align ? 'active' : ''}`}
      disabled={!canEdit}
      data-tip={title}
      aria-label={title}
      onClick={() => shapeTextCommand.setAlign(align)}
    >
      {icon}
    </button>
  )

  return (
    <div className={`ribbon${collapsed && !bodyOnly ? ' ribbon-collapsed' : ''}`}>
      {!bodyOnly && (
        <div
          className={`ribbon-tabs ${IN_TAB ? '' : IS_MAC ? 'ribbon-tabs-mac' : 'ribbon-tabs-win'}`}
        >
          {/* WPS macOS 同样有常驻「文件」按钮（☰ 文件），三端统一 */}
          {
            <div className="file-tab-wrap">
              <button
                className={`ribbon-tab ribbon-tab-file ${dropdown === 'file' ? 'open' : ''}`}
                onClick={() => setDropdown((v) => (v === 'file' ? null : 'file'))}
              >
                {t('ribbonTabFile')}
              </button>
              {dropdown === 'file' && (
                <div data-rb-panel="" className="file-menu">
                  <button
                    onClick={() => {
                      setDropdown(null)
                      onOpen()
                    }}
                  >
                    {t('ribbonOpen')}{' '}
                    <span className="file-menu-key">{IS_MAC ? '⌘O' : 'Ctrl+O'}</span>
                  </button>
                  {onNewFile && (
                    <button
                      onClick={() => {
                        setDropdown(null)
                        onNewFile()
                      }}
                    >
                      {t('ribbonFileNew')}
                    </button>
                  )}
                  {onOpenRecent && (recentFiles?.length ?? 0) > 0 && (
                    <>
                      <div className="file-menu-sec">{t('ribbonFileRecent')}</div>
                      {recentFiles!.slice(0, 6).map((p) => (
                        <button
                          key={p}
                          title={p}
                          onClick={() => {
                            setDropdown(null)
                            onOpenRecent(p)
                          }}
                        >
                          <span className="file-menu-recent">{p.split(/[\\/]/).pop()}</span>
                        </button>
                      ))}
                    </>
                  )}
                  <button
                    disabled={!hasDoc}
                    onClick={() => {
                      setDropdown(null)
                      onSave()
                    }}
                  >
                    {t('ribbonSave')}{' '}
                    <span className="file-menu-key">{IS_MAC ? '⌘S' : 'Ctrl+S'}</span>
                  </button>
                  <button
                    disabled={!hasDoc}
                    onClick={() => {
                      setDropdown(null)
                      onSaveAs()
                    }}
                  >
                    {t('ribbonSaveAs')}{' '}
                    <span className="file-menu-key">{IS_MAC ? '⇧⌘S' : 'Ctrl+Shift+S'}</span>
                  </button>
                  {onExportPdf && (
                    <button
                      disabled={!hasDoc}
                      onClick={() => {
                        setDropdown(null)
                        onExportPdf()
                      }}
                    >
                      {t('appExportPdf')}
                    </button>
                  )}
                  {onPrint && (
                    <button
                      disabled={!hasDoc}
                      onClick={() => {
                        setDropdown(null)
                        onPrint()
                      }}
                    >
                      {t('appPrintTitle')}{' '}
                      <span className="file-menu-key">{IS_MAC ? '⌘P' : 'Ctrl+P'}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          }
          {quickActions}
          <div className="ribbon-tabs-scroll" ref={tabStrip.viewportRef}>
            <div className="ribbon-tabs-track" ref={tabStrip.trackRef}>
              {TABS.filter((tabName) => tabName !== 'file').map((tabName) => (
                <button
                  key={tabName}
                  className={`ribbon-tab ${tab === tabName ? 'active' : ''}`}
                  onClick={() => {
                    lastRegularTab.current = tabName
                    setTab(tabName)
                    setDropdown(null)
                  }}
                  onDoubleClick={() => setCollapsed((v) => !v)}
                >
                  {t(TAB_LABEL_KEYS[tabName])}
                </button>
              ))}
              {/* contextual tabs render as plain tabs appended to the row, like current Word */}
              {inTable &&
                TABLE_TABS.map((tableTab) => (
                  <button
                    key={tableTab}
                    className={`ribbon-tab ${tab === tableTab ? 'active' : ''}`}
                    onClick={() => {
                      setTab(tableTab)
                      setDropdown(null)
                    }}
                  >
                    {t(TAB_LABEL_KEYS[tableTab])}
                  </button>
                ))}
              {inImage &&
                IMAGE_TABS.map((imageTab) => (
                  <button
                    key={imageTab}
                    className={`ribbon-tab ${tab === imageTab ? 'active' : ''}`}
                    onClick={() => {
                      setTab(imageTab)
                      setDropdown(null)
                    }}
                  >
                    {t(TAB_LABEL_KEYS[imageTab])}
                  </button>
                ))}
              {inShape &&
                SHAPE_TABS.map((shapeTab) => (
                  <button
                    key={shapeTab}
                    className={`ribbon-tab ${tab === shapeTab ? 'active' : ''}`}
                    onClick={() => {
                      setTab(shapeTab)
                      setDropdown(null)
                    }}
                  >
                    {t(TAB_LABEL_KEYS[shapeTab])}
                  </button>
                ))}
            </div>
            <TabStripArrows
              overflow={tabStrip}
              leadLabel={t('ribbonTabScrollLeft')}
              tailLabel={t('ribbonTabScrollRight')}
            />
          </div>
          {trailingActions}
        </div>
      )}

      {/* WPS 功能区右下角展开/折叠图标 */}
      {!bodyOnly && (
        <button
          type="button"
          className="ribbon-collapse-btn"
          aria-label={collapsed ? t('ribbonExpandTip') : t('ribbonCollapseTip')}
          data-tip={collapsed ? t('ribbonExpandTip') : t('ribbonCollapseTip')}
          onClick={() => setCollapsed((v) => !v)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d={collapsed ? 'M5.5 14.75 12 8.25l6.5 6.5' : 'M5.5 9.25 12 15.75l6.5-6.5'}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}

      <div className="ribbon-body" style={collapsed && !bodyOnly ? { display: 'none' } : undefined}>
        {tab === 'shapeFormat' && inShape ? (
          <ShapeFormatTab
            fs={fs}
            canEdit={canEdit}
            dropdown={dropdown}
            setDropdown={setDropdown}
            shapeIsLine={shapeIsLine}
            setShapeStyle={setShapeStyle}
            shapeTextCommand={shapeTextCommand}
            shapeTextActive={shapeTextActive}
            shapeMarkBtn={shapeMarkBtn}
            shapeAlignBtn={shapeAlignBtn}
          />
        ) : tab === 'pictureFormat' && inImage ? (
          <PictureFormatTab
            fs={fs}
            editor={editor}
            canEdit={canEdit}
            chain={chain}
            setPictureDialog={setPictureDialog}
            flipPicture={flipPicture}
            rotatePicture={rotatePicture}
            replacePicture={replacePicture}
            resetPictureSize={resetPictureSize}
            setPictureSizeCm={setPictureSizeCm}
            compressPicture={applyCompressedPicture}
            aiReplace={{
              open: aiReplaceOpen,
              busy: aiReplaceBusy,
              prompt: aiReplacePrompt,
              onPrompt: setAiReplacePrompt,
              onToggle: () => setAiReplaceOpen((v) => !v),
              onRun: () => void runAiReplace(),
            }}
          />
        ) : tab === 'tableDesign' ? (
          <TableDesignTab
            chain={chain}
            runTableCommand={runTableCommand}
            tableAttrs={tableAttrs}
            styles={styles}
            applyCellBorders={applyCellBorders}
            setTableLookOption={setTableLookOption}
            applyColumnWidth={applyColumnWidth}
            applyRowHeight={applyRowHeight}
            setBorderColor={setBorderColor}
            setBorderSz={setBorderSz}
            setCellAttr={setCellAttr}
            borderColor={borderColor}
            borderSz={borderSz}
            tableLook={tableLook}
            setTablePropertiesOpen={setTablePropertiesOpen}
          />
        ) : tab === 'tableLayout' ? (
          <TableLayoutTab
            fs={fs}
            editor={editor}
            dropdown={dropdown}
            setDropdown={setDropdown}
            chain={chain}
            runTableCommand={runTableCommand}
            activeCellInfo={activeCellInfo}
            setTableLookOption={setTableLookOption}
            tableAutoFitMode={tableAutoFitMode}
            tableAutoFitLabel={tableAutoFitLabel}
            sectionContentWidthPx={sectionContentWidthPx}
            maxRowHeightCm={maxRowHeightCm}
            tableLook={tableLook}
            applyCellBorders={applyCellBorders}
            applyColumnWidth={applyColumnWidth}
            applyRowHeight={applyRowHeight}
            setCellAttr={setCellAttr}
            addColumnAfter={addColumnAfter}
            addColumnBefore={addColumnBefore}
            addRowAfter={addRowAfter}
            addRowBefore={addRowBefore}
            deleteColumn={deleteColumn}
            deleteRow={deleteRow}
            deleteTable={deleteTable}
            mergeCells={mergeCells}
            splitCell={splitCell}
            tableHeader={tableHeader}
            setTablePropertiesOpen={setTablePropertiesOpen}
          />
        ) : tab === 'home' ? (
          <HomeTab
            canEdit={canEdit}
            hasDoc={hasDoc}
            dropdown={dropdown}
            setDropdown={setDropdown}
            fs={fs}
            editor={editor}
            painter={painter}
            styleGalleryRef={styleGalleryRef}
            docDefaults={docDefaults}
            themeFonts={themeFonts}
            styles={styles}
            fontScope={fontScope}
            setFontScope={setFontScope}
            fontSettingsBusy={fontSettingsBusy}
            onFontSettings={onFontSettings}
            showMarks={showMarks}
            onShowMarks={onShowMarks}
            onParagraphDialog={onParagraphDialog}
            setListDialog={setListDialog}
            penColor={penColor}
            setPenColor={setPenColor}
            penHighlight={penHighlight}
            setPenHighlight={setPenHighlight}
            fontCommitRef={fontCommitRef}
            stepFontSize={stepFontSize}
            togglePainter={togglePainter}
            markBtn={markBtn}
            clipboard={clipboard}
            setParaAttr={setParaAttr}
            setTextStyle={setTextStyle}
            setFont={setFont}
            toggleList={toggleList}
            clearList={clearList}
            applyListPreset={applyListPreset}
            changeIndent={changeIndent}
            toggleVertAlign={toggleVertAlign}
            changeCase={changeCase}
            renderStyleCards={renderStyleCards}
          />        ) : tab === 'draw' ? (
          <DrawTab
            hasDoc={hasDoc}
            tool={inkTool}
            onTool={onInkTool}
            pen={inkPen}
            onPen={onInkPen}
            highlighter={inkHighlighter}
            onHighlighter={onInkHighlighter}
            annotationCount={inkCount}
            onClearAll={onInkClearAll}
          />
        ) : tab === 'insert' ? (
          <InsertTab
            editor={editor}
            hasDoc={canEdit}
            dropdown={dropdown}
            setDropdown={setDropdown}
            header={header}
            onHeader={onHeader}
            onPageNumFormat={onPageNumFormat}
            onInsertField={onInsertField}
            footer={footer}
            onFooter={onFooter}
            titlePg={titlePg}
            onTitlePg={onTitlePg}
            evenOddHf={evenOddHf}
            onEvenOddHf={onEvenOddHf}
            commentCount={commentCount}
            onShowComments={onShowComments}
            canComment={canComment}
            onNewComment={onNewComment}
            isProtected={isProtected}
            commentsAllowed={commentsAllowed}
            insertImageDialogOpen={() => setInsertImageOpen(true)}
          />
        ) : tab === 'page' ? (
          // WPS「页面」= 布局(页面设置|段落|排列) + 设计(页面背景|文档格式) 两组件合一
          <>
            <LayoutTab
              editor={editor}
              hasDoc={canEdit}
              dropdown={dropdown}
              setDropdown={setDropdown}
              section={section}
              onSection={onSection}
              activeSection={activeSection}
              onInsertSectionBreak={onInsertSectionBreak}
            />
            <div className="ribbon-sep" />
            <DesignTab
              editor={editor}
              hasDoc={canEdit}
              dropdown={dropdown}
              setDropdown={setDropdown}
              pageColor={pageColor}
              onPageColor={onPageColor}
              section={section}
              onSection={onSection}
              watermark={watermark}
              onWatermark={onWatermark}
              themeFonts={themeFonts}
              onThemeFonts={onThemeFonts}
              onThemeColors={onThemeColors}
            />
          </>
        ) : tab === 'references' ? (
          <ReferencesTab
            editor={editor}
            hasDoc={canEdit}
            blocks={blocks}
            dropdown={dropdown}
            setDropdown={setDropdown}
            onInsertNote={onInsertNote}
            sources={sources}
            zoteroNoteFields={zoteroNoteFields}
            onAddSource={onAddSource}
            headingPages={headingPages}
          />
        ) : tab === 'review' ? (
          <ReviewTab
            editor={editor}
            hasDoc={hasDoc}
            dropdown={dropdown}
            setDropdown={setDropdown}
            onAiPreset={onAiPreset}
            commentCount={commentCount}
            openCommentCount={openCommentCount}
            onShowComments={onShowComments}
            canComment={canComment}
            onNewComment={onNewComment}
            trackChanges={trackChanges}
            onTrackChanges={onTrackChanges}
            spellcheck={spellcheck ?? false}
            onSpellcheck={onSpellcheck}
            revisionDisplay={revisionDisplay}
            onRevisionDisplay={onRevisionDisplay}
            revisionCount={revisionCount}
            onAcceptRevision={onAcceptRevision}
            onRejectRevision={onRejectRevision}
            onGotoRevision={onGotoRevision}
            isProtected={isProtected}
            commentsAllowed={commentsAllowed}
            trackChangesForced={trackChangesForced}
            protectActive={protectActive}
            onProtectDoc={onProtectDoc}
            onCompare={onCompare}
          />
        ) : tab === 'chayuan' && chayuan ? (
          <ChayuanTab
            hasDoc={hasDoc}
            dropdown={dropdown}
            setDropdown={setDropdown}
            chayuan={chayuan}
          />
        ) : (
          <ViewTab
            hasDoc={hasDoc}
            filePath={filePath}
            zoom={zoom}
            onZoom={onZoom}
            onZoomFit={onZoomFit}
            showAi={showAi}
            onToggleAi={onToggleAi}
            darkCanvas={darkCanvas ?? false}
            onDarkCanvas={onDarkCanvas ?? (() => {})}
            showRuler={showRuler}
            onShowRuler={onShowRuler}
            showNav={showNav}
            onShowNav={onShowNav}
            viewMode={viewMode}
            onViewMode={onViewMode}
            readMode={readMode}
            onReadMode={onReadMode}
            showGrid={showGrid}
            onShowGrid={onShowGrid}
            splitView={splitView}
            onSplitView={onSplitView}
            onPagePreview={onPagePreview}
          />
        )}
      </div>

      {pictureDialog === 'cutout' && imageDataUrl && (
        <CutoutDialog
          dataUrl={imageDataUrl}
          onApply={(png) => {
            setPictureDialog(null)
            void applyPictureBytes(png)
          }}
          onCancel={() => setPictureDialog(null)}
        />
      )}
      {insertImageOpen && (
        <InsertImageDialog
          bridge={insertImageBridge}
          hostKind="docs"
          onInsert={(dataUrl, meta) => {
            setInsertImageOpen(false)
            if (meta?.kind === 'video' && meta.video) {
              void insertVideoForDocs(editor, meta.video)
              return
            }
            void insertImageFromDataUrl(editor, dataUrl)
          }}
          onClose={() => setInsertImageOpen(false)}
        />
      )}
      {pictureDialog === 'crop' && imageDataUrl && (
        <CropDialog
          dataUrl={imageDataUrl}
          initial={fs.imageCrop}
          onApply={(crop) => {
            setPictureDialog(null)
            applyPictureCrop(crop)
          }}
          onCancel={() => setPictureDialog(null)}
        />
      )}
      {listDialog && (
        <ListDefineDialog
          onApply={(levels) => {
            setListDialog(false)
            applyListPreset(levels)
          }}
          onClose={() => setListDialog(false)}
        />
      )}
      {tablePropertiesOpen && (
        <TablePropertiesDialog
          initial={tablePropertiesFromAttrs(tableAttrs)}
          onApply={applyTableProperties}
          onClose={() => setTablePropertiesOpen(false)}
        />
      )}
    </div>
  )
}

// memo + shallow-stable formatState/callback props: caret moves that change no
// displayed format skip re-rendering the whole ribbon
export const Ribbon = memo(RibbonInner)

// ---- Define New Multilevel List dialog ----

const LIST_NUM_FMTS = [
  'decimal',
  'bullet',
  'lowerLetter',
  'upperLetter',
  'lowerRoman',
  'upperRoman',
  'chineseCountingThousand',
] as const

const LIST_FMT_SAMPLES: Record<string, string> = {
  decimal: '1, 2, 3',
  bullet: '● ○ ■',
  lowerLetter: 'a, b, c',
  upperLetter: 'A, B, C',
  lowerRoman: 'i, ii, iii',
  upperRoman: 'I, II, III',
  chineseCountingThousand: '一, 二, 三',
}

const TWIPS_PER_CM = 567

type TableWrapMode = 'none' | 'left' | 'right'

interface TablePropertiesValue {
  autoFit: TableAutoFitMode
  wrap: TableWrapMode
  floatSuppressed: boolean
  positionXCm: number
  positionYCm: number
  distanceCm: number
  marginTopCm: number
  marginRightCm: number
  marginBottomCm: number
  marginLeftCm: number
}

function tablePropertiesFromAttrs(attrs: Record<string, unknown>): TablePropertiesValue {
  const cm = (value: unknown, fallback = 0) =>
    +((Number.isFinite(Number(value)) ? Number(value) : fallback) / TWIPS_PER_CM).toFixed(2)
  const margins = (attrs.cellMar as Record<string, number> | null) ?? {}
  const distance = (attrs.tblFloatDistance as Record<string, number> | null) ?? {}
  const wrap: TableWrapMode =
    attrs.tblFloat === 'left' || attrs.tblFloat === 'right'
      ? attrs.tblFloat
      : attrs.tblFloatSource === 'left' || attrs.tblFloatSource === 'right'
        ? attrs.tblFloatSource
        : 'none'
  return {
    autoFit:
      attrs.tblAutoFit === 'contents' || attrs.tblAutoFit === 'window' ? attrs.tblAutoFit : 'fixed',
    wrap,
    floatSuppressed: attrs.tblFloatSuppressed === true,
    positionXCm: cm(attrs.tblFloatXTwips),
    positionYCm: cm(attrs.tblFloatYTwips),
    distanceCm: cm(distance.right ?? distance.left ?? distance.top ?? distance.bottom, 180),
    marginTopCm: cm(margins.top),
    marginRightCm: cm(margins.right, 108),
    marginBottomCm: cm(margins.bottom),
    marginLeftCm: cm(margins.left, 108),
  }
}

function TablePropertiesDialog({
  initial,
  onApply,
  onClose,
}: {
  initial: TablePropertiesValue
  onApply: (value: TablePropertiesValue) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [value, setValue] = useState(initial)
  const update = (patch: Partial<TablePropertiesValue>) =>
    setValue((current) => ({ ...current, ...patch }))
  const numberInput = (
    key:
      | 'positionXCm'
      | 'positionYCm'
      | 'distanceCm'
      | 'marginTopCm'
      | 'marginRightCm'
      | 'marginBottomCm'
      | 'marginLeftCm',
  ) => (
    <input
      type="number"
      min={key === 'positionXCm' || key === 'positionYCm' ? -50 : 0}
      max={50}
      step={0.1}
      value={value[key]}
      onChange={(event) => update({ [key]: Number(event.target.value) || 0 })}
    />
  )
  const wrapLabel: StringKey =
    value.wrap === 'left'
      ? 'appWrapSquareLeft'
      : value.wrap === 'right'
        ? 'appWrapSquareRight'
        : 'appWrapInline'
  const autoFitLabel =
    TABLE_AUTO_FIT_OPTIONS.find(([mode]) => mode === value.autoFit)?.[1] ?? 'ribbonFixedColumnWidth'

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal gs-form table-properties-dialog">
        <div className="table-properties-header">
          <span className="table-properties-header-icon" aria-hidden="true">
            <IconTableProperties size={22} />
          </span>
          <div>
            <h2>{t('ribbonTableProperties')}</h2>
            <p className="modal-desc">
              {t(autoFitLabel)} · {t(wrapLabel)}
            </p>
          </div>
        </div>

        <section className="table-properties-card">
          <h3>{t('ribbonAutoFit')}</h3>
          <div className="table-properties-segments">
            {TABLE_AUTO_FIT_OPTIONS.map(([mode, label]) => (
              <label key={mode} className="table-properties-segment">
                <input
                  type="radio"
                  name="table-autofit"
                  checked={value.autoFit === mode}
                  onChange={() => update({ autoFit: mode })}
                />
                <span>{t(label)}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="table-properties-card">
          <h3>{t('ribbonWrapText')}</h3>
          <div className="table-properties-segments">
            {(
              [
                ['none', 'appWrapInline'],
                ['left', 'appWrapSquareLeft'],
                ['right', 'appWrapSquareRight'],
              ] as Array<[TableWrapMode, StringKey]>
            ).map(([mode, label]) => (
              <label key={mode} className="table-properties-segment">
                <input
                  type="radio"
                  name="table-wrap"
                  checked={value.wrap === mode}
                  onChange={() => update({ wrap: mode })}
                />
                <span>{t(label)}</span>
              </label>
            ))}
          </div>
          {value.wrap !== 'none' && (
            <div className="table-properties-grid">
              <label>
                {t('ribbonHorizontalPosition')}
                <span>
                  {numberInput('positionXCm')}
                  {t('ribbonCm')}
                </span>
              </label>
              <label>
                {t('ribbonVerticalPosition')}
                <span>
                  {numberInput('positionYCm')}
                  {t('ribbonCm')}
                </span>
              </label>
              <label>
                {t('ribbonDistanceFromText')}
                <span>
                  {numberInput('distanceCm')}
                  {t('ribbonCm')}
                </span>
              </label>
            </div>
          )}
        </section>

        <section className="table-properties-card table-properties-margins">
          <h3>{t('ribbonCellMargins')}</h3>
          <div className="table-properties-margin-layout">
            <div className="table-properties-grid">
              <label>
                {t('ribbonMarginTop')}
                <span>
                  {numberInput('marginTopCm')}
                  {t('ribbonCm')}
                </span>
              </label>
              <label>
                {t('ribbonMarginBottom')}
                <span>
                  {numberInput('marginBottomCm')}
                  {t('ribbonCm')}
                </span>
              </label>
              <label>
                {t('ribbonMarginLeft')}
                <span>
                  {numberInput('marginLeftCm')}
                  {t('ribbonCm')}
                </span>
              </label>
              <label>
                {t('ribbonMarginRight')}
                <span>
                  {numberInput('marginRightCm')}
                  {t('ribbonCm')}
                </span>
              </label>
            </div>
            <div className="table-margin-preview" aria-hidden="true">
              <span className="table-margin-value top">{value.marginTopCm}</span>
              <span className="table-margin-value right">{value.marginRightCm}</span>
              <span className="table-margin-value bottom">{value.marginBottomCm}</span>
              <span className="table-margin-value left">{value.marginLeftCm}</span>
              <span className="table-margin-preview-cell" />
            </div>
          </div>
        </section>

        <div className="modal-actions">
          <button onClick={onClose}>{t('ribbonCancel')}</button>
          <button className="primary" onClick={() => onApply(value)}>
            {t('ribbonOk')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ListDefineDialog({
  onApply,
  onClose,
}: {
  onApply: (levels: CustomNumberingLevel[]) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [levels, setLevels] = useState<CustomNumberingLevel[]>(MULTILEVEL_LIBRARY[0])
  const update = (i: number, patch: Partial<CustomNumberingLevel>) =>
    setLevels((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal list-define-modal">
        <h2>{t('ribbonDefineNewList')}</h2>
        <div className="list-define-head">
          <span>{t('ribbonListLevel')}</span>
          <span>{t('ribbonListNumStyle')}</span>
          <span>{t('ribbonListFormatText')}</span>
          <span>{t('ribbonListIndentCm')}</span>
          <span>{t('ribbonListPreviewCol')}</span>
        </div>
        <div className="list-define-rows">
          {levels.map((l, i) => (
            <div key={i} className="list-define-row">
              <span>{i + 1}</span>
              <Dropdown
                value={l.numFmt}
                ariaLabel={t('ribbonListNumStyle')}
                options={LIST_NUM_FMTS.map((f) => ({ value: f, label: LIST_FMT_SAMPLES[f] }))}
                onPick={(numFmt) => {
                  update(i, {
                    numFmt,
                    lvlText:
                      numFmt === 'bullet'
                        ? '•'
                        : l.lvlText.includes('%')
                          ? l.lvlText
                          : `%${i + 1}.`,
                  })
                }}
              />
              <input value={l.lvlText} onChange={(e) => update(i, { lvlText: e.target.value })} />
              <input
                type="number"
                step="0.25"
                min="0"
                value={+(l.indentLeft / TWIPS_PER_CM).toFixed(2)}
                onChange={(e) =>
                  update(i, {
                    indentLeft: Math.max(
                      0,
                      Math.round(parseFloat(e.target.value || '0') * TWIPS_PER_CM),
                    ),
                  })
                }
              />
              <span className="list-define-preview" style={{ paddingLeft: Math.min(i * 8, 48) }}>
                {previewLevelText(levels, i)}
              </span>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>{t('ribbonCancel')}</button>
          <button onClick={() => onApply(levels)}>{t('ribbonOk')}</button>
        </div>
      </div>
    </div>
  )
}
