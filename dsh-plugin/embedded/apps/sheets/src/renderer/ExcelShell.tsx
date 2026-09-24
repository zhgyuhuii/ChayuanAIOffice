import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { IFunctionInfo } from '@univerjs/engine-formula'
import { platformShortcuts } from '@chatoffice/i18n'
import { TabStripArrows, useTabStripOverflow } from '@chatoffice/ribbon'
import { SHAPE_GALLERY_GROUPS, ShapePreview } from '@chatoffice/ui/shape-gallery'
import {
  AiPanelToggle,
  ColorPicker,
  Dropdown,
  DockShell,
  useDismissablePopover,
  isMacStandaloneWindow,
} from '@chatoffice/ui'
import {
  CaretIcon,
  RIBBON_GLYPH_ICONS,
  RedoIcon,
  SaveAsIcon,
  SaveIcon,
  UndoIcon,
} from './ribbon-icons'
import {
  BandCollectorContext,
  GroupSlotContext,
  NodeDropButton,
  RibbonGroupLevelsContext,
  RibbonMenuButton,
  useRibbonGroupLevel,
  useRibbonGroupLevels,
  useRibbonGroupSlot,
  type BandSection,
} from './ribbon-menu'
import { ConvertMenuSelect } from './ConvertMenuSelect'

import { InsertImageDialog } from '@chatoffice/ui/InsertImageDialog'
import type { InsertImageBridge } from '@chatoffice/ui/InsertImageDialog'
import type { WebImageItem } from '@chatoffice/ui/InsertImageDialog'
import { compressImageForDisplay } from '@chatoffice/ui'
import { ColorDropdown } from './ColorDropdown'
import { FormatCellsDialog } from './FormatCellsDialog'
import { PasteSpecialDialog, type PasteSpecialVariant } from './PasteSpecialDialog'
import { InsertDeleteCellsDialog } from './InsertDeleteCellsDialog'
import { applyTabFontSize } from './ribbon-actions'
import { BatchRenameSheetDialog, MoveCopySheetDialog } from './SheetMenuDialogs'
import { PictureCropDialog } from './PictureCropDialog'
import { AllowEditRangesDialog } from './AllowEditRangesDialog'
import { GoToDialog } from './GoToDialog'
import { COLOR_SCHEMES, FONT_SCHEMES, THEME_PRESETS } from './themes'
import { useI18n, type StringKey } from './i18n/locale'
import { NameManagerDialog, type DefinedNameAction, type DefinedNameRow } from './NameManagerDialog'
import { categoryOptionForPattern, numberFormatCategories } from './number-format'
import { type SelectionFormat } from './selection-format'
import { fontFamilyGroups, useSystemFontFamilies } from './system-fonts'
import { isGridKeyTarget, shouldInterceptClearSelection } from './clear-selection-keyboard'
import { COLOR_SCALE_PRESETS, DATA_BAR_PRESETS, iconSetOf } from './cf-gallery'
import { listCustomCellStyles, listCustomTableStyles } from './custom-styles'
import { columnLabel, parseAddress } from '@chatoffice/xlsx-gateway/domain/cell-address'
import {
  CfRuleDialog,
  CondStatsDialog,
  FillInsertTextDialog,
  NewCellStyleDialog,
  NewTableStyleDialog,
  SelectionPaneDialog,
  SeriesDialog,
  FILL_DATE_PATTERNS,
  fillDateLabel,
  persistCustomCellStyle,
  persistCustomTableStyle,
  type CfRuleDialogMode,
} from './data-process-dialogs'
import type { SheetVisualRef } from './ribbon-actions'

import type { ChartSeriesVisualState } from '@chatoffice/xlsx-gateway/domain/chart-visual'
import type { ChangePlan } from '@chatoffice/xlsx-gateway/domain/workbook.types'
import type { AttachmentMeta } from '../shared/desktop-api'
import { AiChatPanel, type AiChatMessage } from './ai/AiChatPanel'
import type { AiSettingsV2 } from '@chatoffice/ai-provider'
import { AiSelectionAsk } from './ai/AiSelectionAsk'
import type { SelectionAskAnchor } from './ai/selection-ask'
import {
  PivotDialog,
  type PivotEditSeed,
  type PivotField,
  type OoXmlPivotConfig,
} from './PivotDialog'
import type { GoalSeekResult } from './goal-seek'
import { GoalSeekDialog } from './GoalSeekDialog'
import { InsertFunctionDialog } from './InsertFunctionDialog'
import { SubtotalDialog, type SubtotalConfig } from './SubtotalDialog'
import { ConsolidateDialog } from './ConsolidateDialog'
import type { RangePickHandler } from './range-pick'
import type { ConsolidateConfig } from './consolidate'
import { HeaderFooterDialog, type HeaderFooterResult } from './HeaderFooterDialog'
import type { HeaderFooterParts } from './edit-journal'

// No File tab: file commands live in the macOS
// application menu (File → Open/Save/Save As) and the toolbar icons.
const ribbonTabs = ['Home', 'Insert', 'Page Layout', 'Formulas', 'Data', 'Review', 'View'] as const

/// 'Chart Design' and 'Picture Tools' are contextual: they exist only while
/// a chart/picture is selected, and appear without stealing the active tab.
type RibbonTab = (typeof ribbonTabs)[number] | 'Chart Design' | 'Picture Tools'

// Internal values keep English ids (=== matching, state values unchanged);
// translated only for display
const TAB_LABEL: Record<RibbonTab, StringKey> = {
  Home: 'appTabHome',
  Insert: 'appTabInsert',
  'Page Layout': 'appTabPageLayout',
  Formulas: 'appTabFormulas',
  Data: 'appTabData',
  Review: 'appTabReview',
  View: 'appTabView',
  'Chart Design': 'appTabChartDesign',
  'Picture Tools': 'ribbonTabPictureTools',
}

export interface SelectedChartRibbon {
  readonly title: string
  /// Non-null when the chart's type can be rewritten (single-plot
  /// column/bar/line/area/pie/doughnut); scatter/combo/3D keep their type.
  readonly convertible: string | null
  readonly currentType: string | null
  readonly canEdit: boolean
  readonly isPie: boolean
  readonly hasAxes: boolean
  /// Whether the save pipeline can write plot-level data labels for this
  /// chart family (scatter/radar cannot).
  readonly canLabel: boolean
  readonly seriesCount: number
  readonly categoryCount: number
  /// Current series (pending edits applied) for Switch Row/Column.
  readonly series: readonly ChartSeriesVisualState[]
  readonly legend?: string | undefined
  readonly axisTitles?:
    | {
        category?: string | null | undefined
        value?: string | null | undefined
      }
    | undefined
  readonly dataLabels?: string | undefined
  readonly grouping?: string | undefined
}

/// Live echo of the selected floating picture for the contextual tab.
export interface SelectedPictureRibbon {
  readonly id: string
  /// Session images and sidecar-located file images are editable; a visual
  /// the sidecar could not pin down only moves/deletes.
  readonly editable: boolean
  /// Current anchor box in sheet-space px.
  readonly widthPx: number
  readonly heightPx: number
  readonly srcRect: { l: number; t: number; r: number; b: number } | null
  readonly lum: { bright: number; contrast: number } | null
  readonly rotation: number
  readonly flipH: boolean
  readonly flipV: boolean
  readonly lineColor: string | null
  readonly lineWidth: number | null
  readonly opacity: number
}

type ChartTextTarget = 'title' | 'axis-category' | 'axis-value'

const CHART_TEXT_LABELS: Record<ChartTextTarget, { heading: StringKey; command: string }> = {
  title: { heading: 'appChartTitleEl', command: 'chart-title' },
  'axis-category': { heading: 'appCategoryAxisTitle', command: 'chart-axis-cat' },
  'axis-value': { heading: 'appValueAxisTitle', command: 'chart-axis-val' },
}

/// mode=tab: embedded in the shell's tab strip, which owns the traffic
/// lights / caption buttons — the ribbon must not reserve space for them.
const IN_TAB = new URLSearchParams(window.location.search).get('mode') === 'tab'
/// panel=0 (docked boot, P1 契约): this editor renders beside the Home
/// conversation, which is the chat surface — the internal AI panel stays
/// closed (and its toggle hidden) until the tab pops out to a full tab
const DOCKED_BOOT = new URLSearchParams(window.location.search).get('panel') === '0'
const IS_MAC = navigator.platform.toLowerCase().includes('mac')

/// Excel's grow/shrink font walks its size ladder, not ±1.
const FONT_SIZE_LADDER = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 26, 28, 36, 48, 72]

/// Review > Translate targets, shown in their native names (never localized).
const TRANSLATE_LANGUAGES = [
  'English',
  '简体中文',
  '繁體中文',
  '日本語',
  '한국어',
  'Español',
  'Français',
  'Deutsch',
  'Português',
  'Русский',
  'العربية',
] as const

/// 选择性粘贴对话框 variant → sheet command.
const PASTE_SPECIAL_COMMANDS: Record<PasteSpecialVariant, string> = {
  all: 'paste',
  formula: 'paste-special:formula',
  value: 'paste-special:value',
  format: 'paste-special:format',
  'besides-border': 'paste-special:besides-border',
  'col-width': 'paste-special:col-width',
  transpose: 'paste-special:transpose',
  text: 'paste-special:text',
}

function stepFontSize(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    return FONT_SIZE_LADDER.find((size) => size > current) ?? FONT_SIZE_LADDER.at(-1) ?? current
  }
  return (
    [...FONT_SIZE_LADDER].reverse().find((size) => size < current) ?? FONT_SIZE_LADDER[0] ?? current
  )
}

/// Glyph icons live in ribbon-icons.tsx, drawn to the shared icon standard
/// (24×24 canvas, 1.5px strokes, round caps/joins); unmapped glyphs render
/// as text (letterforms such as $, ?, θ, ƒx are typography, not icons).
function ToolSymbol({ symbol }: { readonly symbol: string }): React.JSX.Element {
  return (
    <span className="tool-symbol" aria-hidden="true">
      {RIBBON_GLYPH_ICONS[symbol] ?? symbol}
    </span>
  )
}

interface ExcelShellProps {
  aiSettings?: AiSettingsV2 | null | undefined
  onAiSettingsRefresh?: (() => void | Promise<void>) | undefined
  readonly prompt: string
  readonly preview: ChangePlan | null
  readonly selectionFormat: SelectionFormat | null
  /// True when the workbook has any cell content (the one-click AI action
  /// buttons are greyed out on an empty sheet).
  readonly sheetHasContent: boolean
  /// true while the real LLM agent is running (composer disabled meanwhile).
  readonly aiBusy: boolean
  readonly chat: readonly AiChatMessage[]
  readonly historicChat?: readonly AiChatMessage[]
  /// Chat attachments (chips + 📎 button + drag-and-drop), same structure as the
  /// docs/slides AI panels.
  readonly attachments: readonly AttachmentMeta[]
  readonly attachNotice: string | null
  readonly onPickAttachments: () => void
  readonly onAddAttachmentPaths: (paths: readonly string[]) => void
  readonly onAddPastedImage: (data: ArrayBuffer, ext: string) => void
  readonly onRemoveAttachment: (path: string) => void
  readonly onPromptChange: (prompt: string) => void
  /** Send the composer text, or the given instruction when provided (Retry also
   *  resends that message's original attachments and passes the failed bubble's
   *  chat index so the send replaces it in place) */
  readonly onSend: (
    instruction?: string,
    attachments?: readonly AttachmentMeta[],
    retryIndex?: number,
  ) => void
  readonly onStop: () => void
  readonly onNewChat: () => void
  readonly onUndo: (steps?: number) => void
  /// A1 notation of the multi-cell selection the AI composer offers as this
  /// run's scope, or null when the resting single-cell selection carries none.
  readonly aiScopeRange: string | null
  /// Header names when that scope covers whole columns: they label the chip in
  /// place of the range, because a column is a name to the user, not a letter.
  readonly aiScopeColumns: readonly string[] | null
  /// The range above belongs to a run in flight and can no longer be dropped.
  readonly aiScopeLocked: boolean
  /// Drag endpoint and viewport bounds used to place the localized trigger.
  readonly aiSelectionAskAnchor: SelectionAskAnchor | null
  readonly onAiSelectionAskDismiss: () => void
  readonly onAiScopeDismiss: () => void
  /// Citation link in an AI answer: jumps the grid to the cited cell/range.
  readonly onAiCitation: (href: string) => void
  readonly onCommand: (command: string) => void
  /// True while Univer's in-cell editor is open (Backspace must delete
  /// characters, not clear the selection).
  readonly onIsCellEditing: () => boolean
  /// Left side of the status bar (ready / streaming / AI progress messages).
  readonly statusMessage: string
  /// 状态栏消息写入（样式对话框保存后的回执走这里）
  readonly onStatus: (message: string) => void
  /// 选择窗格：当前工作表浮动对象清单 + 定位回调
  readonly onGetVisualObjects: () => readonly SheetVisualRef[]
  readonly onLocateVisual: (item: SheetVisualRef) => void
  /// Zoom of the active sheet in percent, echoed by the status-bar slider.
  readonly zoomPercent: number
  /// True when the edit journal has unsaved changes (enables the QAT Save).
  readonly canSave: boolean
  readonly onSave: () => void
  /// Save As remains available for a clean workbook, but requires a real
  /// file-backed session (the in-memory demo workbook has nowhere to copy).
  readonly canSaveAs: boolean
  readonly onSaveAs: () => void
  /** 文件菜单「打开工作簿」(selectWorkbook → openLazyWorkbook; web 下可缺省隐藏入口) */
  readonly onOpen?: () => void
  /** 文件菜单「导出为 PDF」 */
  readonly onExportPdf?: () => void
  /** 文件菜单「导出为 CSV」 */
  readonly onExportCsv?: () => void
  /// QAT redo (workbook history, same path as the app menu's ⇧⌘Z); undo
  /// shares the AI panel's onUndo above.
  readonly onRedo: () => void
  /// Undo/redo stack occupancy: the QAT buttons grey out when there is nothing to apply.
  readonly canUndo: boolean
  readonly canRedo: boolean
  /// AutoSave toggle in the tab row (docs/slides parity).
  readonly autoSave: boolean
  readonly onAutoSaveChange: (on: boolean) => void
  /// Non-null while a floating chart is selected in the grid.
  readonly selectedChart: SelectedChartRibbon | null
  /// Non-null while a floating picture is selected in the grid.
  readonly selectedImage: SelectedPictureRibbon | null
  readonly onPictureEdit: (picture: {
    srcRect?: { l: number; t: number; r: number; b: number } | null
    lum?: { bright: number; contrast: number } | null
    rotation?: number | null
    flipH?: boolean | null
    flipV?: boolean | null
    lineColor?: string | null
    lineWidth?: number | null
    opacity?: number | null
    geom?: string | null
    shadow?: { blurPt: number; distPt: number; dirDeg: number; color: string; alpha: number } | null
  }) => void
  readonly onPictureMediaReplace: (media: {
    mediaType: 'image/png' | 'image/jpeg' | 'image/gif'
    base64: string
  }) => void
  readonly onPictureRotate: (quarter: 1 | -1) => void
  readonly onPictureReset: () => void
  readonly onPictureResize: (widthPx: number, heightPx: number) => void
  readonly onPictureDelete: () => void
  readonly onPictureAnchoring: (editAs: 'twoCell' | 'oneCell' | 'absolute') => void
  /// Full-resolution bytes of the selected picture (crop dialog preview).
  readonly onPictureGetSource: () => Promise<{ mediaType: string; base64: string } | null>
  /// 统一插入对话框落点（走 journal 插图管线）
  readonly onInsertPictureData: (dataUrl: string) => void
  /// Column choices of the active selection, read when the Sort dialog opens.
  readonly onGetSortColumns: () => { label: string; colIndex: number }[]
  /// Effective protection of the active sheet (null = unknown / demo).
  readonly onGetSheetProtection: () => boolean | null
  /// 工作表菜单：表名清单与活动表下标（移动或复制弹窗）
  readonly onGetSheetNames?: () => readonly string[]
  readonly onGetActiveSheetIndex?: () => number
  /// Effective workbook structure lock (null = no file open).
  readonly onGetWorkbookProtection: () => boolean | null
  readonly formulaBarVisible: boolean
  /// Cross-highlight ("reading mode") of the active row/column, echoed by the View checkbox.
  readonly crossHighlightVisible: boolean
  /// Allow-edit ranges of the active sheet, read when the dialog opens.
  readonly onGetProtectedRanges: () => {
    ranges: readonly { name: string; sqref: string; hasPassword: boolean }[]
    error: string | null
  }
  readonly onApplyProtectedRanges: (
    ranges: readonly { name: string; sqref: string }[],
  ) => string | null
  /// Name Manager data + actions (actions return an error message or null).
  readonly onGetDefinedNames: () => {
    names: DefinedNameRow[]
    sheets: { id: string; name: string }[]
    activeSheetId: string | null
  }
  readonly onDefinedNameAction: (action: DefinedNameAction) => string | null
  /// Subtotals use the selection; pivots pass their resolved source range.
  readonly onGetPivotFields: (sourceRange?: string) => PivotField[]
  readonly onGetSourceRange: () => string
  readonly onCreatePivot: (config: OoXmlPivotConfig) => string | null
  /// A3 editing of an existing pivot: when it returns null, App has already shown
  /// the reason and the dialog is not opened.
  readonly onGetPivotEditSeed: () => PivotEditSeed | null
  readonly onEditPivot: (config: OoXmlPivotConfig) => string | null
  readonly onRefreshPivot: () => string | null
  readonly onIsSelectionInPivot: () => boolean
  readonly onGetActiveCell: () => string
  /// Value of the selection's top-left cell, read when Format Cells opens
  /// (number-format preview).
  readonly onGetAnchorValue: () => number | string | null
  /// A1 label of the active cell, echoed live by the Name Box.
  readonly activeCellA1: string
  /// Name Box / Go To jump; returns an error message, or null on success.
  readonly onGoToReference: (ref: string) => string | null
  readonly onListDefinedNames: () => readonly { name: string; ref: string }[]
  readonly onApplyFormula: (formula: string, targetA1?: string) => string | null
  /// Function descriptions from the running formula engine (Insert Function).
  readonly onListFunctions: () => readonly IFunctionInfo[]
  /// Collapsed grid picking shared by Insert Function / Consolidate / Goal
  /// Seek / Cond Stats / Allow Edit Ranges reference fields.
  readonly onPickRange?: RangePickHandler | undefined
  /// One-shot evaluation of the assembled formula (Insert Function preview).
  readonly onPreviewFormula?: ((formula: string) => Promise<string | null>) | undefined
  readonly onCreateSubtotal: (config: SubtotalConfig) => string | null
  readonly onCreateConsolidate: (config: ConsolidateConfig) => string | null
  /// Prefill for the Consolidate reference input (current multi-cell selection).
  readonly onGetConsolidateDefault: () => string
  /// Header & Footer dialog OK; returns an error message, or null on success.
  readonly onApplyHeaderFooter: (result: HeaderFooterResult) => string | null
  /// Session page-layout settings of the active sheet, echoed by the Page
  /// Layout tab's controls (untouched fields show the app default).
  readonly pageLayout: PageLayoutEcho
  /// Manual-recalc mode echo for the Calculation Options menu.
  readonly calcManual: boolean
  /// Goal Seek solve; rejects with a user-facing Error message.
  readonly onGoalSeek: (setCell: string, toValue: number, byCell: string) => Promise<GoalSeekResult>
}

export interface PageLayoutEcho {
  readonly orientation?: 'portrait' | 'landscape' | undefined
  readonly paperSize?: number | undefined
  readonly scale?: number | undefined
  readonly fitToWidth?: number | undefined
  readonly fitToHeight?: number | undefined
  readonly margins?: 'normal' | 'wide' | 'narrow' | undefined
  readonly printGridlines?: boolean | undefined
  readonly printHeadings?: boolean | undefined
  readonly showGridlines: boolean
  readonly showHeadings: boolean
  readonly printArea?: string | null | undefined
  readonly printTitles?: string | null | undefined
  readonly header?: HeaderFooterParts | null | undefined
  readonly footer?: HeaderFooterParts | null | undefined
  /// Page Break Preview overlay on for the active sheet (View tab echo).
  readonly pageBreakPreview?: boolean | undefined
}

export function ExcelShell({
  aiSettings,
  onAiSettingsRefresh,
  prompt,
  preview,
  selectionFormat,
  sheetHasContent,
  aiBusy,
  chat,
  historicChat,
  attachments,
  attachNotice,
  onPickAttachments,
  onAddAttachmentPaths,
  onAddPastedImage,
  onRemoveAttachment,
  onGetSortColumns,
  onGetSheetProtection,
  onGetSheetNames,
  onGetActiveSheetIndex,
  onGetWorkbookProtection,
  formulaBarVisible,
  crossHighlightVisible,
  onGetProtectedRanges,
  onApplyProtectedRanges,
  onGetDefinedNames,
  onDefinedNameAction,
  onGetPivotFields,
  onGetSourceRange,
  onCreatePivot,
  onGetPivotEditSeed,
  onEditPivot,
  onRefreshPivot,
  onIsSelectionInPivot,
  onGetActiveCell,
  onGetAnchorValue,
  activeCellA1,
  onGoToReference,
  onListDefinedNames,
  onApplyFormula,
  onListFunctions,
  onPickRange,
  onPreviewFormula,
  onCreateSubtotal,
  onCreateConsolidate,
  onGetConsolidateDefault,
  onApplyHeaderFooter,
  onPromptChange,
  onSend,
  onStop,
  onNewChat,
  onUndo,
  aiScopeRange,
  aiScopeColumns,
  aiScopeLocked,
  aiSelectionAskAnchor,
  onAiSelectionAskDismiss,
  onAiScopeDismiss,
  onAiCitation,
  onCommand,
  onIsCellEditing,
  statusMessage,
  onStatus,
  onGetVisualObjects,
  onLocateVisual,
  zoomPercent,
  canSave,
  onSave,
  onOpen,
  onExportPdf,
  onExportCsv,
  canSaveAs,
  onSaveAs,
  onRedo,
  canUndo,
  canRedo,
  autoSave,
  onAutoSaveChange,
  selectedChart,
  selectedImage,
  onPictureEdit,
  onPictureMediaReplace,
  onPictureRotate,
  onPictureReset,
  onPictureResize,
  onPictureDelete,
  onPictureAnchoring,
  onPictureGetSource,
  onInsertPictureData,
  pageLayout,
  calcManual,
  onGoalSeek,
}: ExcelShellProps): React.JSX.Element {
  const { t } = useI18n()
  // tab row clips instead of wrapping when narrow; wheel + edge arrows page it
  const tabStrip = useTabStripOverflow()
  const [activeTab, setActiveTab] = useState<RibbonTab>('Home')
  // WPS 双击标签折叠/展开功能区; 右下角图标同; 状态本地持久化
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sheets-ribbon-collapsed') === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('sheets-ribbon-collapsed', collapsed ? '1' : '0')
    } catch {
      /* degraded */
    }
  }, [collapsed])
  // 文件下拉（WPS ☰ 文件）: open state + outside-press dismissal
  const [fileOpen, setFileOpen] = useState(false)
  const fileMenuRef = useRef<HTMLDivElement>(null)
  useDismissablePopover(fileOpen, () => setFileOpen(false), {
    inside: () => [fileMenuRef.current],
  })
  // Persisted so a closed AI panel stays closed on next launch (docs/slides parity)
  const [isCopilotOpen, setIsCopilotOpen] = useState(
    () => !DOCKED_BOOT && localStorage.getItem('ai-sheets-show-ai') !== '0',
  )
  const dockedRef = useRef(DOCKED_BOOT)
  const [dockedEditor, setDockedEditor] = useState(DOCKED_BOOT)
  useEffect(() => {
    const off = window.desktopApi.onDockedState?.((docked) => {
      dockedRef.current = docked
      setDockedEditor(docked)
      // popped out to a full tab: the editor's own panel preference returns
      if (!docked) setIsCopilotOpen(localStorage.getItem('ai-sheets-show-ai') !== '0')
    })
    return () => off?.()
  }, [])
  /** while docked the Home conversation is the chat surface: panel-opening
   *  actions must not raise the internal panel */
  const openCopilotIfUndocked = useCallback(() => {
    if (!dockedRef.current) setIsCopilotOpen(true)
  }, [])
  useEffect(() => {
    // a docked boot must not clobber the user's persisted preference
    if (dockedRef.current) return
    localStorage.setItem('ai-sheets-show-ai', isCopilotOpen ? '1' : '0')
  }, [isCopilotOpen])
  const [showFormatCells, setShowFormatCells] = useState(false)
  // 设置单元格格式对话框的初始 tab（字体/对齐/数字组的角落启动箭头定位）
  const [formatCellsTab, setFormatCellsTab] = useState<
    'Number' | 'Alignment' | 'Font' | 'Border' | 'Fill' | 'Protection'
  >('Number')
  // 数据处理组 / 样式组富菜单的配套对话框
  const [fillInsertWhere, setFillInsertWhere] = useState<'start' | 'mid' | 'end' | null>(null)
  const [showSeries, setShowSeries] = useState(false)
  const [showCondStats, setShowCondStats] = useState(false)
  const [cfRuleMode, setCfRuleMode] = useState<CfRuleDialogMode | null>(null)
  const [newTableStyleKind, setNewTableStyleKind] = useState<'table' | 'pivot' | null>(null)
  const [showNewCellStyle, setShowNewCellStyle] = useState(false)
  const [showSelectionPane, setShowSelectionPane] = useState(false)
  const [selectionPaneItems, setSelectionPaneItems] = useState<readonly SheetVisualRef[]>([])
  const [showPasteSpecial, setShowPasteSpecial] = useState(false)
  const [axisSizeTarget, setAxisSizeTarget] = useState<'row' | 'col' | null>(null)
  // 标准列宽 / 插入删除单元格弹窗（行和列⌄ 第三轮）
  const [standardWidthOpen, setStandardWidthOpen] = useState(false)
  const [cellsDialog, setCellsDialog] = useState<'insert' | 'delete' | null>(null)
  // 工作表菜单：移动或复制 / 批量改名弹窗
  const [moveCopyOpen, setMoveCopyOpen] = useState(false)
  const [batchRenameOpen, setBatchRenameOpen] = useState(false)
  // 工作表标签字号持久化：挂载即恢复
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem('sheets-tab-font-size'))
      if (Number.isFinite(saved) && saved >= 10 && saved <= 24) applyTabFontSize(saved)
    } catch {
      /* storage disabled */
    }
  }, [])
  const [showLinkDialog, setShowLinkDialog] = useState(false)
  const [showSortDialog, setShowSortDialog] = useState(false)
  const [showDedupeDialog, setShowDedupeDialog] = useState(false)
  const [showNameManager, setShowNameManager] = useState(false)
  const [showPivotDialog, setShowPivotDialog] = useState(false)
  const [pivotEditSeed, setPivotEditSeed] = useState<PivotEditSeed | null>(null)
  /** null = closed; string = open on that catalog category ('All' for the plain button) */
  const [insertFunctionCat, setInsertFunctionCat] = useState<string | null>(null)
  const liveFunctions = useMemo(
    () => (insertFunctionCat === null ? [] : onListFunctions()),
    [insertFunctionCat],
  )
  const [showSubtotalDialog, setShowSubtotalDialog] = useState(false)
  const [showGoalSeek, setShowGoalSeek] = useState(false)
  const [showConsolidateDialog, setShowConsolidateDialog] = useState(false)
  const [showGoTo, setShowGoTo] = useState(false)
  const [showHeaderFooter, setShowHeaderFooter] = useState(false)
  const [showAllowEditRanges, setShowAllowEditRanges] = useState(false)
  /// Non-null while the Chart Design → Add Chart Element text prompt is open.
  const [chartTextTarget, setChartTextTarget] = useState<ChartTextTarget | null>(null)
  /// Picture Tools → Crop (the dialog edits srcRect fractions in place).
  const [showPictureCrop, setShowPictureCrop] = useState(false)
  /// 统一插入图片对话框（插入 tab 的图片按钮）
  const [insertImageOpen, setInsertImageOpen] = useState(false)

  const insertImageBridge: InsertImageBridge = {
    getAiSettings: () => window.desktopApi.getAiSettings(),
    searchWeb: async (query, page, source) => {
      const r = await window.desktopApi.webImageSearch(query, undefined, page, source)
      return {
        images: (r.images as WebImageItem[]) ?? [],
        ...(r.error ? { error: r.error } : {}),
        ...(r.attempts ? { attempts: r.attempts } : {}),
      }
    },
    searchStock: async (source, query, page) => {
      const r = await window.desktopApi.stockImageSearch(source, query, undefined, page)
      return {
        images: (r.images as WebImageItem[]) ?? [],
        ...(r.error ? { error: r.error } : {}),
        ...(r.code ? { code: r.code } : {}),
      }
    },
    fetchImage: async (url) => {
      const r = await window.desktopApi.remoteImage(url)
      return r ? { mediaType: r.mime, base64: r.base64 } : null
    },
    getStockKeys: () => window.desktopApi.stockKeysGet(),
    setStockKeys: (keys) => window.desktopApi.stockKeysSet(keys),
    listMediaModels: async () => (await window.desktopApi.mediaModels()) ?? { models: [] },
    generateSvg: (req) => window.desktopApi.generateSvg(req),
    generate: async (req) => {
      const r = await window.desktopApi.mediaGenerate(req)
      return r ?? { error: 'no image' }
    },
    videoSubmit: async (req) =>
      (await window.desktopApi.videoSubmit(req)) ?? { error: 'video tasks unavailable' },
    videoTasks: async () => (await window.desktopApi.videoTasks()) ?? { tasks: [] },
    videoCancel: async (id) => {
      await window.desktopApi.videoCancel(id)
    },
    videoRetry: async (id) => (await window.desktopApi.videoRetry(id)) ?? {},
    videoPreview: async (id) => (await window.desktopApi.videoPreview(id)) ?? {},
    onVideoTasksChanged: (cb) => window.desktopApi.onVideoTasksChanged(cb) ?? (() => {}),
  }
  const onCommandRef = useRef(onCommand)
  const onIsCellEditingRef = useRef(onIsCellEditing)
  onCommandRef.current = onCommand
  onIsCellEditingRef.current = onIsCellEditing
  useEffect(() => {
    // Shortcuts that write to the sheet must not fire from a text field —
    // neither app fields (AI chat, dialogs) nor Univer's own (find/replace,
    // rule panels, formula bar), which are native inputs INSIDE the Univer
    // container. isGridKeyTarget tells the grid's hidden focus host apart
    // from all of those; only Univer knows whether a cell is being edited.
    const canEditSheet = (event: KeyboardEvent): boolean =>
      !onIsCellEditingRef.current() && isGridKeyTarget(event.target)
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === '1') {
        event.preventDefault()
        setShowFormatCells(true)
      }
      // Excel's Go To shortcut (⌘G / Ctrl+G).
      if ((event.metaKey || event.ctrlKey) && event.key === 'g') {
        event.preventDefault()
        setShowGoTo(true)
      }
      // Excel's Show Formulas shortcut (⌘` / Ctrl+`).
      if ((event.metaKey || event.ctrlKey) && event.key === '`') {
        event.preventDefault()
        onCommand('toggle-show-formulas')
      }
      // Excel's strikethrough toggle (⌘5 / Ctrl+5). While a cell is being
      // edited the range-level toggle would hit the wrong target (Excel
      // strikes the selected text instead), so it only acts on the grid.
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key === '5') {
        if (canEditSheet(event)) {
          event.preventDefault()
          onCommand('strike')
        }
      }
      // Excel's AutoSum (Alt+= / ⌥⌘= is reserved by macOS, Excel-mac uses ⇧⌘T;
      // plain Alt+= covers win/linux and most mac keyboards).
      if (event.altKey && !event.metaKey && !event.ctrlKey && event.key === '=') {
        if (canEditSheet(event)) {
          event.preventDefault()
          onCommand('autofn:SUM')
        }
      }
      // Excel's insert current date / time (Ctrl+; / Ctrl+Shift+;).
      if ((event.metaKey || event.ctrlKey) && event.code === 'Semicolon') {
        if (canEditSheet(event)) {
          event.preventDefault()
          onCommand(event.shiftKey ? 'insert-now:time' : 'insert-now:date')
        }
      }
      // Excel's manual recalculation (F9 workbook, Shift+F9 active sheet).
      if (event.key === 'F9' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (!onIsCellEditingRef.current()) {
          event.preventDefault()
          onCommand(event.shiftKey ? 'calculate-sheet' : 'calculate-now')
        }
      }
      // Excel's PageUp/PageDown; Alt+ pages horizontally. In-cell editing is
      // checked in the command handler via the workbook's own editing state.
      if (
        (event.key === 'PageDown' || event.key === 'PageUp') &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.defaultPrevented
      ) {
        if (isGridKeyTarget(event.target)) {
          event.preventDefault()
          const axis = event.altKey ? 'page-col' : 'page-row'
          onCommand(`${axis}:${event.key === 'PageDown' ? 1 : -1}`)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCommand])
  // Univer's shortcut dispatcher captures keydown and binds Backspace to
  // "delete-and-start-editing" (active cell only). Register on window
  // capture *here* (child effect runs before App creates Univer) so we
  // win the race and clear the whole selection instead. Keep the listener
  // mounted once: re-binding after Univer starts would lose capture order.
  useEffect(() => {
    const onKeyDownCapture = (event: KeyboardEvent): void => {
      if (!shouldInterceptClearSelection(event, onIsCellEditingRef.current())) return
      event.preventDefault()
      event.stopImmediatePropagation()
      onCommandRef.current('clear-contents')
    }
    window.addEventListener('keydown', onKeyDownCapture, true)
    return () => window.removeEventListener('keydown', onKeyDownCapture, true)
  }, [])
  // Deselecting while on a contextual tab lands back on Home.
  useEffect(() => {
    if (!selectedChart && activeTab === 'Chart Design') setActiveTab('Home')
    if (!selectedImage && activeTab === 'Picture Tools') setActiveTab('Home')
  }, [selectedChart, selectedImage, activeTab])
  const visibleTabs: readonly RibbonTab[] = selectedImage
    ? [...ribbonTabs, 'Picture Tools']
    : selectedChart
      ? [...ribbonTabs, 'Chart Design']
      : ribbonTabs
  const saveAsTitle = `${t('appFileSaveAs')} (${platformShortcuts('⇧⌘S')})`

  return (
    <main className="app-shell">
      {/* AI panel docks around the whole editor column (ribbon included) in any
          of 4 layouts (shared DockShell) — a left/right dock runs level with the
          ribbon's top edge instead of below it */}
      <DockShell
        className={`sheet-body${isMacStandaloneWindow() ? ' mac-standalone' : ''}`}
        storageKey="aisheets.dock"
        legacyWidthKey="sheets-ai-panel-width"
        open={isCopilotOpen}
        onOpenChange={setIsCopilotOpen}
        labels={{
          panelTitle: t('aiPanelTitle'),
          layoutMenu: t('aiDockLayoutTitle'),
          dockLeft: t('aiDockLeft'),
          dockRight: t('aiDockRight'),
          dockBottom: t('aiDockBottom'),
          float: t('aiDockFloat'),
          maximize: t('aiDockMaximize'),
          restore: t('aiDockRestore'),
          collapse: t('aiCollapsePanel'),
        }}
        renderPanel={(dockChrome) => (
          <AiChatPanel
            dockChrome={dockChrome}
            settings={aiSettings}
            onRefreshSettings={onAiSettingsRefresh}
            hasContent={sheetHasContent}
            chat={chat}
            {...(historicChat !== undefined ? { historicChat } : {})}
            attachments={attachments}
            attachNotice={attachNotice}
            onPickAttachments={onPickAttachments}
            onAddAttachmentPaths={onAddAttachmentPaths}
            onAddPastedImage={onAddPastedImage}
            onRemoveAttachment={onRemoveAttachment}
            prompt={prompt}
            preview={preview}
            aiBusy={aiBusy}
            onPromptChange={onPromptChange}
            onSend={onSend}
            onStop={onStop}
            onNewChat={onNewChat}
            onUndo={onUndo}
            scopeRange={aiScopeRange}
            scopeColumns={aiScopeColumns}
            scopeLocked={aiScopeLocked}
            onScopeDismiss={onAiScopeDismiss}
            onCitation={onAiCitation}
          />
        )}
      >
        <div className="editor-col">
          <header className={`excel-header${collapsed ? ' collapsed' : ''}`}>
            <nav
              className={`ribbon-tabs ${IN_TAB ? '' : IS_MAC ? 'ribbon-tabs-mac' : 'ribbon-tabs-win'}`}
              aria-label={t('appScopeWorkbook')}
            >
              <div className="file-tab-wrap" ref={fileMenuRef}>
                <button
                  type="button"
                  className={`ribbon-tab ribbon-tab-file ${fileOpen ? 'open' : ''}`}
                  onClick={() => setFileOpen((v) => !v)}
                >
                  {t('appTabFile')}
                </button>
                {fileOpen && (
                  <div className="file-menu">
                    {onOpen && (
                      <button
                        onClick={() => {
                          setFileOpen(false)
                          onOpen()
                        }}
                      >
                        {t('appOpenWorkbookTitle')}
                      </button>
                    )}
                    <button
                      disabled={!canSave}
                      onClick={() => {
                        setFileOpen(false)
                        onSave()
                      }}
                    >
                      {t('appFileSave')}
                    </button>
                    <button
                      disabled={!canSaveAs}
                      onClick={() => {
                        setFileOpen(false)
                        onSaveAs()
                      }}
                    >
                      {t('appFileSaveAs')}
                    </button>
                    {onExportPdf && (
                      <button
                        disabled={!canSave}
                        onClick={() => {
                          setFileOpen(false)
                          onExportPdf()
                        }}
                      >
                        {t('appFileExportPdf')}
                      </button>
                    )}
                    {onExportCsv && (
                      <button
                        disabled={!canSave}
                        onClick={() => {
                          setFileOpen(false)
                          onExportCsv()
                        }}
                      >
                        {t('appFileExportCsv')}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="qa-btn"
                data-tip={t('appSaveTitle')}
                aria-label={t('appSaveTitle')}
                disabled={!canSave}
                onClick={onSave}
              >
                <SaveIcon />
              </button>
              <button
                type="button"
                className="qa-btn"
                data-tip={saveAsTitle}
                aria-label={saveAsTitle}
                disabled={!canSaveAs}
                onClick={onSaveAs}
              >
                <SaveAsIcon />
              </button>
              <button
                type="button"
                className="qa-btn"
                data-tip={t('appUndo')}
                aria-label={t('appUndo')}
                disabled={!canUndo}
                onClick={() => onUndo()}
              >
                <UndoIcon />
              </button>
              <button
                type="button"
                className="qa-btn"
                data-tip={t('appRedo')}
                aria-label={t('appRedo')}
                disabled={!canRedo}
                onClick={onRedo}
              >
                <RedoIcon />
              </button>
              <label
                className={`autosave-toggle ${autoSave ? 'on' : ''}`}
                data-tip={t('appAutoSaveTip')}
              >
                <span className="autosave-knob" />
                <span className="autosave-text">{t('appAutoSave')}</span>
                <input
                  type="checkbox"
                  checked={autoSave}
                  onChange={(e) => onAutoSaveChange(e.target.checked)}
                />
              </label>
              <span className="qa-sep" aria-hidden="true" />
              <div className="ribbon-tabs-scroll" ref={tabStrip.viewportRef}>
                <div className="ribbon-tabs-track" ref={tabStrip.trackRef}>
                  {visibleTabs.map((tab) => (
                    <button
                      className={`${tab === activeTab ? 'active' : ''} ${tab === 'Chart Design' || tab === 'Picture Tools' ? 'contextual' : ''}`}
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      onDoubleClick={() => setCollapsed((v) => !v)}
                    >
                      {t(TAB_LABEL[tab])}
                    </button>
                  ))}
                </div>
                <TabStripArrows
                  overflow={tabStrip}
                  leadLabel={t('ribbonTabScrollLeft')}
                  tailLabel={t('ribbonTabScrollRight')}
                />
              </div>
              <span className="workbook-status" role="status" aria-live="polite">
                {statusMessage}
              </span>
              {!dockedEditor && (
                <AiPanelToggle
                  open={isCopilotOpen}
                  onToggle={() => setIsCopilotOpen((open) => !open)}
                  label={t('aiOpenAssistant')}
                />
              )}
            </nav>
            {/* WPS 功能区右下角展开/折叠图标 */}
            <button
              type="button"
              className="ribbon-collapse-btn"
              aria-label={collapsed ? t('appRibbonExpandTip') : t('appRibbonCollapseTip')}
              data-tip={collapsed ? t('appRibbonExpandTip') : t('appRibbonCollapseTip')}
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

            <div style={collapsed ? { display: 'none' } : undefined}>
              <Ribbon
                activeTab={activeTab}
                selectionFormat={selectionFormat}
                sheetHasContent={sheetHasContent}
                sheetProtected={onGetSheetProtection()}
                workbookProtected={onGetWorkbookProtection()}
                formulaBarVisible={formulaBarVisible}
                crossHighlightVisible={crossHighlightVisible}
                pageLayout={pageLayout}
                selectedChart={selectedChart}
                selectedImage={selectedImage}
                onPictureEdit={onPictureEdit}
                onPictureMediaReplace={onPictureMediaReplace}
                onPictureRotate={onPictureRotate}
                onPictureReset={onPictureReset}
                onPictureResize={onPictureResize}
                onPictureDelete={onPictureDelete}
                onPictureAnchoring={onPictureAnchoring}
                onPictureGetSource={onPictureGetSource}
                onOpenInsertImage={() => setInsertImageOpen(true)}
                onListNames={() => {
                  // Names scoped to another sheet resolve to #NAME? here; only
                  // workbook-scoped and active-sheet names are usable in a formula.
                  const data = onGetDefinedNames()
                  return data.names
                    .filter(
                      (entry) =>
                        entry.scopeSheetId === null || entry.scopeSheetId === data.activeSheetId,
                    )
                    .map((entry) => entry.name)
                }}
                calcManual={calcManual}
                onRefreshPivot={onRefreshPivot}
                onIsSelectionInPivot={onIsSelectionInPivot}
                activeCell={(() => {
                  try {
                    return parseAddress(activeCellA1)
                  } catch {
                    return { row: 0, column: 0 }
                  }
                })()}
                onCommand={(command) => {
                  if (command === 'format-cells') {
                    setFormatCellsTab('Number')
                    setShowFormatCells(true)
                  } else if (command.startsWith('format-cells:')) {
                    // 字体/对齐方式/数字样式组角落的 45° 启动箭头：打开设置
                    // 单元格格式并定位对应 tab（WPS 对比清单 5）
                    const tab = command.slice('format-cells:'.length)
                    if (
                      tab === 'Number' ||
                      tab === 'Alignment' ||
                      tab === 'Font' ||
                      tab === 'Border' ||
                      tab === 'Fill' ||
                      tab === 'Protection'
                    ) {
                      setFormatCellsTab(tab)
                      setShowFormatCells(true)
                    }
                  } else if (command.startsWith('fill-insert-text-open:')) {
                    const where = command.slice('fill-insert-text-open:'.length)
                    if (where === 'start' || where === 'mid' || where === 'end') {
                      setFillInsertWhere(where)
                    }
                  } else if (command === 'series-open') setShowSeries(true)
                  else if (command === 'cond-stats-open') setShowCondStats(true)
                  else if (command.startsWith('cf-hl-dialog:')) {
                    const mode = command.slice('cf-hl-dialog:'.length)
                    if (
                      mode === 'gt' ||
                      mode === 'lt' ||
                      mode === 'eq' ||
                      mode === 'between' ||
                      mode === 'contains' ||
                      mode === 'dup'
                    ) {
                      setCfRuleMode(mode)
                    }
                  } else if (command.startsWith('cf-rank-dialog:')) {
                    const [bottom, percent] = command.slice('cf-rank-dialog:'.length).split(':')
                    setCfRuleMode(
                      bottom === '1'
                        ? percent === '1'
                          ? 'bottom-pct'
                          : 'bottom-n'
                        : percent === '1'
                          ? 'top-pct'
                          : 'top-n',
                    )
                  } else if (command === 'table-style-new-open') setNewTableStyleKind('table')
                  else if (command === 'pivot-style-new-open') setNewTableStyleKind('pivot')
                  else if (command === 'cell-style-new-open') setShowNewCellStyle(true)
                  else if (command === 'selection-pane-open') {
                    setSelectionPaneItems(onGetVisualObjects())
                    setShowSelectionPane(true)
                  } else if (command === 'ai-fill') {
                    openCopilotIfUndocked()
                    onSend(t('appAiFillPrompt'))
                  } else if (command === 'ai-cf') {
                    openCopilotIfUndocked()
                    onSend(t('appCfAiPrompt'))
                  } else if (command === 'ai-write-formula') {
                    openCopilotIfUndocked()
                    onSend(t('appWriteFormulaPrompt'))
                  } else if (command === 'paste-special-dialog') setShowPasteSpecial(true)
                  else if (command === 'row-height-open') setAxisSizeTarget('row')
                  else if (command === 'col-width-open') setAxisSizeTarget('col')
                  else if (command === 'standard-col-width-open') setStandardWidthOpen(true)
                  else if (command === 'insert-cells-dialog-open') setCellsDialog('insert')
                  else if (command === 'delete-cells-dialog-open') setCellsDialog('delete')
                  else if (command === 'move-copy-dialog-open') setMoveCopyOpen(true)
                  else if (command === 'batch-rename-dialog-open') setBatchRenameOpen(true)
                  else if (command === 'link-open') setShowLinkDialog(true)
                  else if (command === 'sort-custom-open') setShowSortDialog(true)
                  else if (command === 'remove-duplicates-open') setShowDedupeDialog(true)
                  else if (command === 'name-manager-open') setShowNameManager(true)
                  else if (command === 'pivot-open') setShowPivotDialog(true)
                  else if (command === 'pivot-edit') setPivotEditSeed(onGetPivotEditSeed())
                  else if (command === 'insert-function-open') setInsertFunctionCat('All')
                  else if (command.startsWith('insert-function-open:'))
                    setInsertFunctionCat(command.slice('insert-function-open:'.length))
                  else if (command === 'goal-seek-open') setShowGoalSeek(true)
                  else if (command === 'subtotal-open') setShowSubtotalDialog(true)
                  else if (command === 'consolidate-open') setShowConsolidateDialog(true)
                  else if (command === 'goto-open') setShowGoTo(true)
                  else if (command === 'header-footer-open') setShowHeaderFooter(true)
                  else if (command === 'allow-edit-ranges-open') setShowAllowEditRanges(true)
                  else if (command === 'ai-open-panel') openCopilotIfUndocked()
                  else if (command === 'ai-toggle-panel') {
                    if (!dockedRef.current) setIsCopilotOpen((v) => !v)
                  } else if (command === 'picture-crop-open') setShowPictureCrop(true)
                  else if (command === 'chart-element-title') setChartTextTarget('title')
                  else if (command === 'chart-element-axis-cat') setChartTextTarget('axis-category')
                  else if (command === 'chart-element-axis-val') setChartTextTarget('axis-value')
                  else onCommand(command)
                }}
                onAiRun={(nextPrompt) => {
                  openCopilotIfUndocked()
                  onSend(nextPrompt)
                }}
              />
            </div>
          </header>

          <div className="sheet-main">
            {/* Excel's formula-bar row, Name Box only for now (fx bar TBD). */}
            <div className="name-box-bar">
              <NameBox activeCellA1={activeCellA1} onGoTo={onGoToReference} />
              <button
                className="name-box-goto"
                data-tip={t('appGoToButtonTitle')}
                aria-label="Go To"
                onClick={() => setShowGoTo(true)}
              >
                ▾
              </button>
            </div>
            <section className="workbook-area">
              <div id="univer-container" className="spreadsheet" />
            </section>
            {aiSelectionAskAnchor && aiScopeRange && !aiBusy && (
              <AiSelectionAsk
                anchor={aiSelectionAskAnchor}
                range={aiScopeRange}
                onDismiss={onAiSelectionAskDismiss}
                onSend={(instruction) => {
                  openCopilotIfUndocked()
                  onSend(instruction)
                }}
              />
            )}

            {/* Status bar spans the sheet column only — the AI dock keeps the full window height (unified with docs/slides). */}
            <footer className="status-bar">
              <div className="status-left">
                <span className="status-msg">{statusMessage}</span>
              </div>
              <div className="status-right">
                <button
                  className="zoom-btn"
                  data-tip={t('appZoomOut')}
                  aria-label={t('appZoomOut')}
                  onClick={() => onCommand('zoom-out')}
                >
                  −
                </button>
                <input
                  className="zoom-slider"
                  type="range"
                  min={50}
                  max={400}
                  value={Math.min(400, Math.max(50, zoomPercent))}
                  onChange={(event) => onCommand(`zoom:${event.target.value}`)}
                />
                <button
                  className="zoom-btn"
                  data-tip={t('appZoomIn')}
                  aria-label={t('appZoomIn')}
                  onClick={() => onCommand('zoom-in')}
                >
                  +
                </button>
                <span className="zoom-value">{zoomPercent}%</span>
              </div>
            </footer>
          </div>
        </div>
      </DockShell>
      {showFormatCells && (
        <FormatCellsDialog
          selectionFormat={selectionFormat}
          anchorValue={onGetAnchorValue()}
          initialTab={formatCellsTab}
          onCommand={onCommand}
          onClose={() => setShowFormatCells(false)}
        />
      )}
      {fillInsertWhere && (
        <FillInsertTextDialog
          where={fillInsertWhere}
          onApply={(text) =>
            onCommand(`fill-insert-text:${fillInsertWhere}:${encodeURIComponent(text)}`)
          }
          onClose={() => setFillInsertWhere(null)}
        />
      )}
      {showSeries && (
        <SeriesDialog
          onApply={(dir, type, step, stop) =>
            onCommand(`fill-series:${dir}:${type}:${step}:${stop === null ? 'none' : stop}`)
          }
          onClose={() => setShowSeries(false)}
        />
      )}
      {showCondStats && (
        <CondStatsDialog
          onApply={(fn, criteriaRange, criteria, sumRange) =>
            onCommand(
              `cond-stats:${fn}:${encodeURIComponent(criteriaRange)}:${encodeURIComponent(
                criteria,
              )}:${sumRange ? encodeURIComponent(sumRange) : 'none'}`,
            )
          }
          onClose={() => setShowCondStats(false)}
          onPickRange={onPickRange}
        />
      )}
      {cfRuleMode && (
        <CfRuleDialog
          mode={cfRuleMode}
          onApplyHighlight={(op, value, value2, styleId) =>
            onCommand(
              op === 'between'
                ? `cf-hl:between:${value}:${value2}:${styleId}`
                : op === 'contains'
                  ? `cf-hl:contains:${encodeURIComponent(value)}:${styleId}`
                  : op === 'dup'
                    ? `cf-hl:dup::${styleId}`
                    : `cf-hl:${op}:${value}:${styleId}`,
            )
          }
          onApplyRank={(bottom, percent, count) =>
            onCommand(`cf-top:${bottom ? '1' : '0'}:${percent ? '1' : '0'}:${count}`)
          }
          onClose={() => setCfRuleMode(null)}
        />
      )}
      {newTableStyleKind && (
        <NewTableStyleDialog
          kind={newTableStyleKind}
          onApply={(name, headerFill, bandFill) => {
            persistCustomTableStyle(newTableStyleKind, name, headerFill, bandFill)
            onStatus(t('appTableStyleSaved', { name }))
          }}
          onClose={() => setNewTableStyleKind(null)}
        />
      )}
      {showNewCellStyle && (
        <NewCellStyleDialog
          currentPatch={
            selectionFormat
              ? {
                  ...(selectionFormat.bold !== null && selectionFormat.bold !== undefined
                    ? { bold: selectionFormat.bold }
                    : {}),
                  ...(selectionFormat.italic !== null && selectionFormat.italic !== undefined
                    ? { italic: selectionFormat.italic }
                    : {}),
                  ...(selectionFormat.underline !== null && selectionFormat.underline !== undefined
                    ? { underline: selectionFormat.underline }
                    : {}),
                  ...(selectionFormat.strike ? { strikethrough: selectionFormat.strike } : {}),
                  ...(selectionFormat.fontFamily ? { fontFamily: selectionFormat.fontFamily } : {}),
                  ...(selectionFormat.fontSize ? { fontSize: selectionFormat.fontSize } : {}),
                  ...(selectionFormat.fontColor ? { fontColor: selectionFormat.fontColor } : {}),
                  ...(selectionFormat.fillColor ? { fillColor: selectionFormat.fillColor } : {}),
                  ...(selectionFormat.numberFormat
                    ? { numberFormat: selectionFormat.numberFormat }
                    : {}),
                }
              : null
          }
          onApply={(name, patch) => {
            persistCustomCellStyle(name, patch)
            onStatus(t('appCellStyleSaved', { name }))
          }}
          onClose={() => setShowNewCellStyle(false)}
        />
      )}
      {showSelectionPane && (
        <SelectionPaneDialog
          items={selectionPaneItems}
          onLocate={(item) => {
            onLocateVisual(item)
            onStatus(t('appObjectLocated', { n: 1 }))
          }}
          onClose={() => setShowSelectionPane(false)}
        />
      )}
      {showPasteSpecial && (
        <PasteSpecialDialog
          onApply={(variant: PasteSpecialVariant) => {
            setShowPasteSpecial(false)
            onCommand(PASTE_SPECIAL_COMMANDS[variant])
          }}
          onClose={() => setShowPasteSpecial(false)}
        />
      )}
      {showPictureCrop && selectedImage && (
        <PictureCropDialog
          getSource={onPictureGetSource}
          srcRect={selectedImage.srcRect}
          onApply={(srcRect) => {
            onPictureEdit({ srcRect })
            setShowPictureCrop(false)
          }}
          onClose={() => setShowPictureCrop(false)}
        />
      )}
      {insertImageOpen && (
        <InsertImageDialog
          bridge={insertImageBridge}
          hostKind="sheets"
          onInsert={(dataUrl, meta) => {
            setInsertImageOpen(false)
            // sheets cannot embed video — the dialog blocks it; ignore defensively
            if (meta?.kind === 'video') return
            onInsertPictureData(dataUrl)
          }}
          onClose={() => setInsertImageOpen(false)}
        />
      )}
      {standardWidthOpen && (
        <StandardColWidthDialog onCommand={onCommand} onClose={() => setStandardWidthOpen(false)} />
      )}
      {cellsDialog && (
        <InsertDeleteCellsDialog
          mode={cellsDialog}
          onCommand={onCommand}
          onClose={() => setCellsDialog(null)}
        />
      )}
      {moveCopyOpen && (
        <MoveCopySheetDialog
          sheets={onGetSheetNames?.() ?? []}
          activeIndex={onGetActiveSheetIndex?.() ?? 0}
          onApply={(targetIndex, copy) => {
            setMoveCopyOpen(false)
            onCommand(`sheetop:move-to-index:${targetIndex}${copy ? ':copy' : ''}`)
          }}
          onClose={() => setMoveCopyOpen(false)}
        />
      )}
      {batchRenameOpen && (
        <BatchRenameSheetDialog
          onApply={(find, replace, prefix, suffix) => {
            setBatchRenameOpen(false)
            const enc = (text: string): string => encodeURIComponent(text)
            onCommand(
              `sheetop:batch-rename:${enc(find)}|${enc(replace)}|${enc(prefix)}|${enc(suffix)}`,
            )
          }}
          onClose={() => setBatchRenameOpen(false)}
        />
      )}
      {axisSizeTarget && (
        <AxisSizeDialog
          axis={axisSizeTarget}
          onCommand={onCommand}
          onClose={() => setAxisSizeTarget(null)}
        />
      )}
      {showLinkDialog && (
        <LinkDialog
          currentTarget={selectionFormat?.link ?? null}
          onCommand={onCommand}
          onClose={() => setShowLinkDialog(false)}
        />
      )}
      {chartTextTarget && selectedChart && (
        <ChartTextDialog
          target={chartTextTarget}
          initial={
            chartTextTarget === 'title'
              ? selectedChart.title
              : ((chartTextTarget === 'axis-category'
                  ? selectedChart.axisTitles?.category
                  : selectedChart.axisTitles?.value) ?? '')
          }
          onCommand={onCommand}
          onClose={() => setChartTextTarget(null)}
        />
      )}
      {showSortDialog && (
        <SortDialog
          columns={onGetSortColumns()}
          onCommand={onCommand}
          onClose={() => setShowSortDialog(false)}
        />
      )}
      {showDedupeDialog && (
        <RemoveDuplicatesDialog onCommand={onCommand} onClose={() => setShowDedupeDialog(false)} />
      )}
      {showNameManager &&
        (() => {
          const data = onGetDefinedNames()
          return (
            <NameManagerDialog
              names={data.names}
              sheets={data.sheets}
              onAction={onDefinedNameAction}
              onClose={() => setShowNameManager(false)}
            />
          )
        })()}
      {showPivotDialog &&
        (() => {
          const sourceRange = onGetSourceRange()
          return (
            <PivotDialog
              fields={onGetPivotFields(sourceRange)}
              sourceRange={sourceRange}
              onCreate={onCreatePivot}
              onClose={() => setShowPivotDialog(false)}
            />
          )
        })()}
      {pivotEditSeed && (
        <PivotDialog
          mode="edit"
          fields={pivotEditSeed.fields}
          sourceRange={pivotEditSeed.sourceRange}
          initial={pivotEditSeed.initial}
          onCreate={onEditPivot}
          onClose={() => setPivotEditSeed(null)}
        />
      )}
      {showGoalSeek && (
        <GoalSeekDialog
          initialSetCell={onGetActiveCell()}
          onSolve={onGoalSeek}
          onPickRange={onPickRange}
          onClose={() => setShowGoalSeek(false)}
        />
      )}
      {insertFunctionCat !== null && (
        <InsertFunctionDialog
          targetLabel={onGetActiveCell()}
          functions={liveFunctions}
          onApply={onApplyFormula}
          initialCategory={insertFunctionCat}
          onPickRange={onPickRange}
          onPreviewFormula={onPreviewFormula}
          onClose={() => setInsertFunctionCat(null)}
        />
      )}
      {showSubtotalDialog && (
        <SubtotalDialog
          fields={onGetPivotFields()}
          onCreate={onCreateSubtotal}
          onClose={() => setShowSubtotalDialog(false)}
        />
      )}
      {showConsolidateDialog && (
        <ConsolidateDialog
          defaultReference={onGetConsolidateDefault()}
          targetLabel={onGetActiveCell()}
          onCreate={onCreateConsolidate}
          onPickRange={onPickRange}
          onClose={() => setShowConsolidateDialog(false)}
        />
      )}
      {showGoTo && (
        <GoToDialog
          names={onListDefinedNames()}
          onGo={onGoToReference}
          onClose={() => setShowGoTo(false)}
        />
      )}
      {showAllowEditRanges &&
        (() => {
          const snapshot = onGetProtectedRanges()
          return (
            <AllowEditRangesDialog
              ranges={snapshot.error === null ? snapshot.ranges : []}
              defaultRef={activeCellA1}
              onApply={(ranges) => snapshot.error ?? onApplyProtectedRanges(ranges)}
              onPickRange={onPickRange}
              onClose={() => setShowAllowEditRanges(false)}
            />
          )
        })()}
      {showHeaderFooter && (
        <HeaderFooterDialog
          initialHeader={pageLayout.header ?? null}
          initialFooter={pageLayout.footer ?? null}
          onApply={onApplyHeaderFooter}
          onClose={() => setShowHeaderFooter(false)}
        />
      )}
    </main>
  )
}

/// Excel's Name Box: echoes the active cell while idle; focusing it starts a
/// draft, Enter jumps to the typed address or defined name (an invalid one
/// keeps the draft and flags the input), Esc or blur cancels back to the
/// echo. The echo prop updates via the SelectionChanged refresh in App.
function NameBox({
  activeCellA1,
  onGoTo,
}: {
  readonly activeCellA1: string
  readonly onGoTo: (ref: string) => string | null
}): React.JSX.Element {
  const { t } = useI18n()
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <input
      className={`name-box${error === null ? '' : ' invalid'}`}
      aria-label="Name Box"
      data-tip={error ?? t('appNameBoxTitle')}
      placeholder="A1"
      spellCheck={false}
      value={draft ?? activeCellA1}
      onFocus={(event) => {
        setDraft(activeCellA1)
        event.target.select()
      }}
      onChange={(event) => {
        setDraft(event.target.value)
        setError(null)
      }}
      onBlur={() => {
        setDraft(null)
        setError(null)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          const failure = onGoTo(draft ?? activeCellA1)
          setError(failure)
          if (failure === null) {
            setDraft(null)
            event.currentTarget.blur()
          }
        } else if (event.key === 'Escape') {
          setDraft(null)
          setError(null)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

const NO_SORT_LEVEL = -1

function SortDialog({
  columns,
  onCommand,
  onClose,
}: {
  readonly columns: { label: string; colIndex: number }[]
  readonly onCommand: (command: string) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [hasHeader, setHasHeader] = useState(true)
  const first = columns[0]?.colIndex ?? NO_SORT_LEVEL
  const [levels, setLevels] = useState<{ colIndex: number; order: 'a' | 'd' }[]>([
    { colIndex: first, order: 'a' },
    { colIndex: NO_SORT_LEVEL, order: 'a' },
    { colIndex: NO_SORT_LEVEL, order: 'a' },
  ])
  const apply = (): void => {
    const rules = levels
      .filter((level) => level.colIndex !== NO_SORT_LEVEL)
      .map((level) => `${level.colIndex}${level.order}`)
    if (rules.length > 0) onCommand(`sort-custom:${hasHeader ? 1 : 0}:${rules.join(',')}`)
    onClose()
  }
  const setLevel = (
    index: number,
    patch: Partial<{ colIndex: number; order: 'a' | 'd' }>,
  ): void => {
    setLevels((previous) =>
      previous.map((level, at) => (at === index ? { ...level, ...patch } : level)),
    )
  }
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="format-cells-dialog sort-dialog"
        role="dialog"
        aria-label={t('appCustomSort')}
        onClick={(event) => event.stopPropagation()}
      >
        <header>{t('appSort')}</header>
        <div className="dialog-body">
          <label className="sort-header-check">
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(event) => setHasHeader(event.target.checked)}
            />
            {t('appMyDataHasHeaders')}
          </label>
          {levels.map((level, index) => (
            <div className="sort-level" key={index}>
              <span>{t(index === 0 ? 'appSortBy' : 'appThenBy')}</span>
              <Dropdown
                ariaLabel={t(index === 0 ? 'appSortBy' : 'appThenBy')}
                value={String(level.colIndex)}
                options={[
                  ...(index > 0 ? [{ value: String(NO_SORT_LEVEL), label: t('appSortNone') }] : []),
                  ...columns.map((column) => ({
                    value: String(column.colIndex),
                    label: column.label,
                  })),
                ]}
                onPick={(v) => setLevel(index, { colIndex: Number(v) })}
              />
              <Dropdown
                value={level.order}
                options={[
                  { value: 'a', label: t('appSortAsc'), icon: <SortGlyph asc /> },
                  { value: 'd', label: t('appSortDesc'), icon: <SortGlyph asc={false} /> },
                ]}
                onPick={(v) => setLevel(index, { order: v })}
              />
            </div>
          ))}
        </div>
        <footer className="dialog-actions">
          <button onClick={onClose}>{t('appCancel')}</button>
          <button
            className="primary"
            disabled={levels.every((level) => level.colIndex === NO_SORT_LEVEL)}
            onClick={apply}
          >
            {t('appOk')}
          </button>
        </footer>
      </div>
    </div>
  )
}

function RemoveDuplicatesDialog({
  onCommand,
  onClose,
}: {
  readonly onCommand: (command: string) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [hasHeader, setHasHeader] = useState(true)
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="format-cells-dialog sort-dialog"
        role="dialog"
        aria-label={t('appRemoveDuplicates')}
        onClick={(event) => event.stopPropagation()}
      >
        <header>{t('appRemoveDuplicates')}</header>
        <div className="dialog-body">
          <p className="dialog-note">{t('appRemoveDuplicatesNote')}</p>
          <label className="sort-header-check">
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(event) => setHasHeader(event.target.checked)}
            />
            {t('appMyDataHasHeaders')}
          </label>
        </div>
        <footer className="dialog-actions">
          <button onClick={onClose}>{t('appCancel')}</button>
          <button
            className="primary"
            onClick={() => {
              onCommand(`remove-duplicates:${hasHeader ? 1 : 0}`)
              onClose()
            }}
          >
            {t('appOk')}
          </button>
        </footer>
      </div>
    </div>
  )
}

/// Chart Design → Add Chart Element text prompt (title / axis titles).
/// An empty axis title removes that axis title; an empty chart title blanks it.
function ChartTextDialog({
  target,
  initial,
  onCommand,
  onClose,
}: {
  readonly target: ChartTextTarget
  readonly initial: string
  readonly onCommand: (command: string) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [value, setValue] = useState(initial)
  const { heading, command } = CHART_TEXT_LABELS[target]
  const apply = (): void => {
    onCommand(`${command}:${value.trim()}`)
    onClose()
  }
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="format-cells-dialog link-dialog"
        role="dialog"
        aria-label={t(heading)}
        onClick={(event) => event.stopPropagation()}
      >
        <header>{t(heading)}</header>
        <div className="dialog-body">
          <label>
            {t(target === 'title' ? 'appTitleText' : 'appAxisTitleText')}
            <input
              autoFocus
              type="text"
              value={value}
              maxLength={255}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') apply()
                if (event.key === 'Escape') onClose()
              }}
            />
          </label>
        </div>
        <footer className="dialog-actions">
          <button onClick={onClose}>{t('appCancel')}</button>
          <button className="primary" onClick={apply}>
            {t('appOk')}
          </button>
        </footer>
      </div>
    </div>
  )
}

/// Numeric row-height / column-width entry (Excel's Format → Row Height /
/// Column Width). Applies to the rows/columns of the current selection.
function AxisSizeDialog({
  axis,
  onCommand,
  onClose,
}: {
  readonly axis: 'row' | 'col'
  readonly onCommand: (command: string) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [value, setValue] = useState('')
  const max = axis === 'row' ? 409.5 : 255
  const parsed = Number(value.trim().replace(',', '.'))
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= max
  const apply = (): void => {
    if (!valid) return
    onCommand(`${axis === 'row' ? 'row-height' : 'col-width'}:${parsed}`)
    onClose()
  }
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="format-cells-dialog link-dialog"
        role="dialog"
        aria-label={t(axis === 'row' ? 'appRowHeight' : 'appColWidth')}
        onClick={(event) => event.stopPropagation()}
      >
        <header>{t(axis === 'row' ? 'appRowHeight' : 'appColWidth')}</header>
        <div className="dialog-body">
          <label>
            {t(axis === 'row' ? 'appRowHeightLabel' : 'appColWidthLabel')}
            <input
              autoFocus
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') apply()
                if (event.key === 'Escape') onClose()
              }}
            />
          </label>
        </div>
        <footer className="dialog-actions">
          <button onClick={onClose}>{t('appCancel')}</button>
          <button className="primary" disabled={!valid} onClick={apply}>
            {t('appOk')}
          </button>
        </footer>
      </div>
    </div>
  )
}

/// 行和列⌄ 的标准列宽：默认列宽（字符）输入 → rowcol:standard-col-width。
function StandardColWidthDialog({
  onCommand,
  onClose,
}: {
  readonly onCommand: (command: string) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [value, setValue] = useState('8.38')
  const parsed = Number(value.trim().replace(',', '.'))
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed > 0 && parsed <= 255
  const apply = (): void => {
    if (!valid) return
    onCommand(`rowcol:standard-col-width:${parsed}`)
    onClose()
  }
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="format-cells-dialog link-dialog"
        role="dialog"
        aria-label={t('appRowcolStandardColWidth')}
        onClick={(event) => event.stopPropagation()}
      >
        <header>{t('appRowcolStandardColWidth')}</header>
        <div className="dialog-body">
          <label>
            {t('appStandardColWidthLabel')}
            <input
              autoFocus
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') apply()
                if (event.key === 'Escape') onClose()
              }}
            />
          </label>
        </div>
        <footer className="dialog-actions">
          <button onClick={onClose}>{t('appCancel')}</button>
          <button className="primary" disabled={!valid} onClick={apply}>
            {t('appOk')}
          </button>
        </footer>
      </div>
    </div>
  )
}

function LinkDialog({
  currentTarget,
  onCommand,
  onClose,
}: {
  readonly currentTarget: string | null
  readonly onCommand: (command: string) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [value, setValue] = useState(currentTarget ?? '')
  const apply = (): void => {
    if (value.trim()) onCommand(`link-set:${encodeURIComponent(value)}`)
    onClose()
  }
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="format-cells-dialog link-dialog"
        role="dialog"
        aria-label={t(currentTarget ? 'appEditLinkTitle' : 'appInsertLinkTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header>{t(currentTarget ? 'appEditLinkTitle' : 'appInsertLinkTitle')}</header>
        <div className="dialog-body">
          <label>
            {t('appLinkAddressLabel')}
            <input
              autoFocus
              type="text"
              value={value}
              placeholder={t('appLinkPlaceholder')}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') apply()
                if (event.key === 'Escape') onClose()
              }}
            />
          </label>
        </div>
        <footer className="dialog-actions">
          {currentTarget && (
            <button
              onClick={() => {
                onCommand('link-remove')
                onClose()
              }}
            >
              {t('appRemoveLink')}
            </button>
          )}
          <button onClick={onClose}>{t('appCancel')}</button>
          <button className="primary" disabled={!value.trim()} onClick={apply}>
            {t('appOk')}
          </button>
        </footer>
      </div>
    </div>
  )
}

/// Width/height inputs in cm (sheet px ↔ cm at 96dpi); remounted per
/// selection via key so external changes (handles, reset) reseed the fields.
function PictureSizeGroup({
  widthPx,
  heightPx,
  onResize,
}: {
  readonly widthPx: number
  readonly heightPx: number
  readonly onResize: (widthPx: number, heightPx: number) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [width, setWidth] = useState(String((widthPx / PX_PER_CM_UI).toFixed(2)))
  const [height, setHeight] = useState(String((heightPx / PX_PER_CM_UI).toFixed(2)))
  const apply = (): void => {
    const w = Number(width)
    const h = Number(height)
    if (!(w > 0) || !(h > 0)) return
    onResize(Math.round(w * PX_PER_CM_UI), Math.round(h * PX_PER_CM_UI))
  }
  return (
    <RibbonGroup label={t('appPicGroupSize')}>
      <label className="size-field" data-tip={t('appPicWidthCm')}>
        <span>{t('appPicWidthCm')}</span>
        <input
          type="number"
          min="0.2"
          step="0.1"
          value={width}
          onChange={(event) => setWidth(event.target.value)}
          onBlur={apply}
          onKeyDown={(event) => {
            if (event.key === 'Enter') apply()
          }}
        />
        <span>{t('appPicCm')}</span>
      </label>
      <label className="size-field" data-tip={t('appPicHeightCm')}>
        <span>{t('appPicHeightCm')}</span>
        <input
          type="number"
          min="0.2"
          step="0.1"
          value={height}
          onChange={(event) => setHeight(event.target.value)}
          onBlur={apply}
          onKeyDown={(event) => {
            if (event.key === 'Enter') apply()
          }}
        />
        <span>{t('appPicCm')}</span>
      </label>
    </RibbonGroup>
  )
}

const PX_PER_CM_UI = 96 / 2.54

/// 更改图片: a hidden file input behind a ribbon button; bytes flow straight
/// into the picture edit (session images swap the data URL, file images get
/// a new media part on save).
function ChangePictureButton({
  disabled,
  onPick,
}: {
  readonly disabled: boolean
  readonly onPick: (mediaType: 'image/png' | 'image/jpeg' | 'image/gif', base64: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement | null>(null)
  return (
    <>
      <RibbonButton
        large
        label={t('appPicChange')}
        detail={t('appPicChange')}
        symbol="🖼"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          const picked = (['image/png', 'image/jpeg', 'image/gif'] as const).find(
            (type) => type === file.type,
          )
          if (!picked) return
          const reader = new FileReader()
          reader.onload = () => {
            const dataUrl = String(reader.result ?? '')
            const base64 = dataUrl.split(',')[1]
            if (base64) onPick(picked, base64)
          }
          reader.readAsDataURL(file)
        }}
      />
    </>
  )
}

function Ribbon({
  activeTab,
  selectionFormat,
  sheetProtected,
  workbookProtected,
  formulaBarVisible,
  crossHighlightVisible,
  pageLayout,
  selectedChart,
  selectedImage,
  onPictureEdit,
  onPictureMediaReplace,
  onPictureRotate,
  onPictureReset,
  onPictureResize,
  onPictureDelete,
  onPictureAnchoring,
  onPictureGetSource,
  onOpenInsertImage,
  onCommand,
  onAiRun,
  onListNames,
  calcManual,
  onRefreshPivot,
  onIsSelectionInPivot,
  activeCell,
}: {
  readonly activeTab: RibbonTab
  readonly selectionFormat: SelectionFormat | null
  readonly sheetHasContent: boolean
  readonly sheetProtected: boolean | null
  readonly workbookProtected: boolean | null
  /// View > Show echo for the formula bar toggle (app-level, not per sheet).
  readonly formulaBarVisible: boolean
  readonly crossHighlightVisible: boolean
  readonly pageLayout: PageLayoutEcho
  readonly selectedChart: SelectedChartRibbon | null
  readonly selectedImage: SelectedPictureRibbon | null
  readonly onPictureEdit: (picture: {
    srcRect?: { l: number; t: number; r: number; b: number } | null
    lum?: { bright: number; contrast: number } | null
    rotation?: number | null
    flipH?: boolean | null
    flipV?: boolean | null
    lineColor?: string | null
    lineWidth?: number | null
    opacity?: number | null
    geom?: string | null
    shadow?: { blurPt: number; distPt: number; dirDeg: number; color: string; alpha: number } | null
  }) => void
  readonly onPictureMediaReplace: (media: {
    mediaType: 'image/png' | 'image/jpeg' | 'image/gif'
    base64: string
  }) => void
  readonly onPictureRotate: (quarter: 1 | -1) => void
  readonly onPictureReset: () => void
  readonly onPictureResize: (widthPx: number, heightPx: number) => void
  readonly onPictureDelete: () => void
  readonly onPictureAnchoring: (editAs: 'twoCell' | 'oneCell' | 'absolute') => void
  readonly onPictureGetSource: () => Promise<{ mediaType: string; base64: string } | null>
  readonly onOpenInsertImage: () => void
  readonly onCommand: (command: string) => void
  /** Defined names for the Use in Formula menu. */
  readonly onListNames: () => readonly string[]
  /** Manual-recalc mode echo for the Calculation Options menu. */
  readonly calcManual: boolean
  /** Open the AI panel and immediately send the given prompt */
  readonly onAiRun: (prompt: string) => void
  readonly onRefreshPivot: () => string | null
  readonly onIsSelectionInPivot: () => boolean
  /// 当前活动格（0 基行列），冻结⌄ 的动态标签（冻结至第 N 行 M 列）取自它
  readonly activeCell: { readonly row: number; readonly column: number }
}): React.JSX.Element {
  const { t } = useI18n()
  // WPS 全带降级：一个带级 stage 驱动全部组（0 平铺→1 一列两行→2 一列三行
  // →3 分组名钮平铺→4 单个分组钮），RibbonGroup 消费上下文各按档渲染
  const ribbonRef = useRef<HTMLDivElement>(null)
  const groupSlots = useRef<string[]>([])
  const claimSlot = (id: string): number => {
    const at = groupSlots.current.indexOf(id)
    if (at >= 0) return at
    groupSlots.current.push(id)
    return groupSlots.current.length - 1
  }
  const { levels: groupLevels, collapsed: bandCollapsed } = useRibbonGroupLevels(ribbonRef)
  const bandSections = useRef(new Map<string, BandSection>())
  const [, bumpBandSections] = useState(0)
  const bandCollector = useMemo(
    () => ({
      // 幂等注册：每次渲染都会重注册（node 静默刷新），但只有成员/组名
      // 真变化才触发重渲染——无条件 bump 会在 stage 4 无限循环崩掉功能区
      register: (section: BandSection): void => {
        const prev = bandSections.current.get(section.id)
        bandSections.current.set(section.id, section)
        if (!prev || prev.label !== section.label) bumpBandSections((n) => n + 1)
      },
      unregister: (id: string): void => {
        if (bandSections.current.delete(id)) bumpBandSections((n) => n + 1)
      },
    }),
    [],
  )
  const [aiReplaceOpen, setAiReplaceOpen] = useState(false)
  const [aiReplacePrompt, setAiReplacePrompt] = useState('')
  const [aiReplaceBusy, setAiReplaceBusy] = useState(false)
  const runAiReplace = async (): Promise<void> => {
    const prompt = aiReplacePrompt.trim()
    if (!prompt || aiReplaceBusy || !selectedImage?.id) return
    setAiReplaceBusy(true)
    try {
      const r = await window.desktopApi.generateImage({ prompt })
      if (r.url) {
        const media = await window.desktopApi.remoteImage(r.url)
        if (media) {
          onPictureMediaReplace({
            mediaType: media.mime as 'image/png' | 'image/jpeg' | 'image/gif',
            base64: media.base64,
          })
          setAiReplaceOpen(false)
          setAiReplacePrompt('')
        }
      }
    } finally {
      setAiReplaceBusy(false)
    }
  }
  const [fontColor, setFontColor] = useState('#C00000')
  const [fillColor, setFillColor] = useState('#FFF2CC')
  const [borderColor, setBorderColor] = useState('#000000')
  // 边框「笔」的线型（对比清单 8 绘图边框组）：thin/medium/thick/double/hair/dashed/dotted
  const [borderPenStyle, setBorderPenStyle] = useState('thin')
  const { families: systemFontFamilies, load: loadSystemFonts } = useSystemFontFamilies()
  // Large menu button: a native select stretched invisibly over the tool,
  // each option carrying its full command string.
  const largeMenu = (
    label: string,
    symbol: string,
    title: string,
    options: readonly { value: string; label: string; icon?: React.ReactNode }[],
  ): React.JSX.Element => (
    <div className="ribbon-tool large" data-tip={title}>
      <span className="tool-icon-row">
        <ToolSymbol symbol={symbol} />
        <CaretIcon />
      </span>
      <span>
        <strong>{label}</strong>
      </span>
      <MenuSelect cover label={label} options={options} onPick={onCommand} />
    </div>
  )
  if (activeTab === 'Chart Design') {
    const canConvert = Boolean(selectedChart?.convertible && selectedChart.canEdit)
    const canEditChart = Boolean(selectedChart?.canEdit)
    const labelValue = selectedChart?.isPie ? 'percent' : 'value'
    // ✓ mirrors the chart's current state (parsed from the file + pending
    // edits), so the menu reads as checked toggles.
    const activeLabels = selectedChart?.dataLabels ?? 'none'
    const activeLegend = selectedChart?.legend ?? 'none'
    const check = (on: boolean): string => (on ? ' ✓' : '')
    const elementOptions = [
      { value: 'chart-element-title', label: t('appChartElTitle'), icon: <OptSample>T</OptSample> },
      ...(selectedChart?.hasAxes
        ? [
            {
              value: 'chart-element-axis-cat',
              label: t('appChartElAxisCat') + check(Boolean(selectedChart.axisTitles?.category)),
            },
            {
              value: 'chart-element-axis-val',
              label: t('appChartElAxisVal') + check(Boolean(selectedChart.axisTitles?.value)),
            },
          ]
        : []),
      ...(selectedChart?.canLabel
        ? [
            ...(selectedChart.isPie
              ? [
                  {
                    value: 'chart-labels:category-percent',
                    label:
                      t('appChartElLabelsNamePct') + check(activeLabels === 'category-percent'),
                    icon: <OptSample>123</OptSample>,
                  },
                ]
              : []),
            {
              value: `chart-labels:${labelValue}`,
              label:
                t(selectedChart.isPie ? 'appChartElLabelsPct' : 'appChartElLabelsValues') +
                check(activeLabels === labelValue),
            },
            {
              value: 'chart-labels:none',
              label: t('appChartElLabelsNone') + check(activeLabels === 'none'),
              icon: <OptSample>123</OptSample>,
            },
          ]
        : []),
      {
        value: 'chart-legend:right',
        label: t('appChartElLegendRight') + check(activeLegend === 'right'),
        icon: <TitleRowGlyph />,
      },
      {
        value: 'chart-legend:top',
        label: t('appChartElLegendTop') + check(activeLegend === 'top'),
        icon: <TitleRowGlyph />,
      },
      {
        value: 'chart-legend:bottom',
        label: t('appChartElLegendBottom') + check(activeLegend === 'bottom'),
        icon: <TitleRowGlyph />,
      },
      {
        value: 'chart-legend:left',
        label: t('appChartElLegendLeft') + check(activeLegend === 'left'),
        icon: <TitleRowGlyph />,
      },
      {
        value: 'chart-legend:none',
        label: t('appChartElLegendNone') + check(activeLegend === 'none'),
        icon: <TitleRowGlyph />,
      },
    ]
    const layoutLabels = t(selectedChart?.isPie ? 'appLayoutLabelsNamePct' : 'appLayoutLabelsValue')
    const layoutOptions = [
      {
        value: 'chart-layout:1',
        label: t('appLayout1', { labels: layoutLabels }),
        icon: <LayoutThumb n={1} />,
      },
      {
        value: 'chart-layout:2',
        label: t('appLayout2', { labels: layoutLabels }),
        icon: <LayoutThumb n={2} />,
      },
      { value: 'chart-layout:3', label: t('appLayout3'), icon: <LayoutThumb n={3} /> },
      {
        value: 'chart-layout:4',
        label: t('appLayout4', { labels: layoutLabels }),
        icon: <LayoutThumb n={4} />,
      },
    ]
    const colorOptions = [
      {
        value: 'chart-colors:office',
        label: t('appColorsOffice'),
        icon: <OptDots colors={['4472C4', 'ED7D31', 'A5A5A5', 'FFC000']} />,
      },
      {
        value: 'chart-colors:blue',
        label: t('appColorsBlue'),
        icon: <OptDots colors={['5B9BD5', '2E75B5', '9DC3E6', 'DEEBF7']} />,
      },
      {
        value: 'chart-colors:green',
        label: t('appColorsGreen'),
        icon: <OptDots colors={['70AD47', '548235', 'A9D18E', 'E2EFDA']} />,
      },
      {
        value: 'chart-colors:warm',
        label: t('appColorsWarm'),
        icon: <OptDots colors={['C55A11', 'ED7D31', 'F4B183', 'FBE5D6']} />,
      },
      {
        value: 'chart-colors:gray',
        label: t('appColorsGray'),
        icon: <OptDots colors={['7F7F7F', 'A5A5A5', 'BFBFBF', 'D9D9D9']} />,
      },
    ]
    const canRecolor =
      canEditChart &&
      ((selectedChart?.isPie ? selectedChart.categoryCount : selectedChart?.seriesCount) ?? 0) > 0
    const stackable =
      canEditChart && ['column', 'bar', 'line', 'area'].includes(selectedChart?.currentType ?? '')
    // 'standard' is how line/area spell side-by-side in OOXML.
    const activeGrouping =
      selectedChart?.grouping === 'stacked' || selectedChart?.grouping === 'percentStacked'
        ? selectedChart.grouping
        : 'clustered'
    const groupingOptions = [
      {
        value: 'chart-grouping:clustered',
        label: t('appGroupingClustered') + check(activeGrouping === 'clustered'),
      },
      {
        value: 'chart-grouping:stacked',
        label: t('appGroupingStacked') + check(activeGrouping === 'stacked'),
      },
      {
        value: 'chart-grouping:percentStacked',
        label: t('appGroupingPercent') + check(activeGrouping === 'percentStacked'),
      },
    ]
    return (
      <div className="ribbon" data-ribbon-body="">
        <RibbonGroup label={t('appGroupChartLayouts')}>
          {canEditChart ? (
            largeMenu(t('appAddChartElement'), '📊', t('appAddChartElementTitle'), elementOptions)
          ) : (
            <RibbonButton
              large
              menu
              label={t('appAddChartElement')}
              detail={t('appSelectEditableChart')}
              symbol="📊"
              disabled
              onClick={() => {}}
            />
          )}
          {canEditChart ? (
            largeMenu(t('appQuickLayout'), '▦', t('appQuickLayoutTitle'), layoutOptions)
          ) : (
            <RibbonButton
              large
              menu
              label={t('appQuickLayout')}
              detail={t('appSelectEditableChart')}
              symbol="▦"
              disabled
              onClick={() => {}}
            />
          )}
          {canRecolor ? (
            largeMenu(
              t('appChangeColors'),
              '🎨',
              t(selectedChart?.isPie ? 'appRecolorSlices' : 'appRecolorSeries'),
              colorOptions,
            )
          ) : (
            <RibbonButton
              large
              label={t('appChangeColors')}
              detail={t('appSelectEditableChart')}
              symbol="🎨"
              disabled
              onClick={() => {}}
            />
          )}
        </RibbonGroup>
        <RibbonGroup label={t('appChangeChartType')}>
          {(
            [
              ['column', 'appChartColumn'],
              ['bar', 'appChartBar'],
              ['line', 'appChartLine'],
              ['area', 'appChartTypeArea'],
              ['pie', 'appChartPie'],
              ['doughnut', 'appChartDoughnut'],
            ] as const
          ).map(([type, labelKey]) => (
            <RibbonButton
              key={type}
              large
              label={t(labelKey)}
              detail={
                selectedChart?.currentType === type
                  ? t('appCurrentType')
                  : canConvert
                    ? t('appChangeChartType')
                    : t('appScatterKeepType')
              }
              symbol={type === 'line' || type === 'area' ? '🗠' : '📊'}
              active={selectedChart?.currentType === type}
              disabled={!canConvert}
              onClick={() => onCommand(`chart-type-${type}`)}
            />
          ))}
          {stackable
            ? largeMenu(t('appGroupingBtn'), '▤', t('appGroupingTitle'), groupingOptions)
            : null}
        </RibbonGroup>
        <RibbonGroup label={t('appGroupData')}>
          <RibbonButton
            large
            label={t('appSelectDataBtn')}
            detail={t('appSeriesNamesRanges')}
            symbol="📊"
            disabled={!canEditChart}
            onClick={() => onCommand('chart-select-data')}
          />
          <RibbonButton
            large
            label={t('appSwitchRowColumn')}
            detail={t('appSwitchRowColumnDetail')}
            symbol="⇄"
            disabled={!canEditChart || (selectedChart?.categoryCount ?? 0) === 0}
            onClick={() => onCommand('chart-switch-row-col')}
          />
          <RibbonButton
            large
            label={t('appFormatPane')}
            detail={t('appFormatPaneDetail')}
            symbol="🎨"
            disabled={!canEditChart}
            onClick={() => onCommand('chart-format-pane')}
          />
        </RibbonGroup>
        <RibbonGroup label={t('appGroupChartActions')}>
          <RibbonButton
            large
            label={t('appDeleteChart')}
            detail={selectedChart?.title ?? t('appRemoveFromSheet')}
            symbol="🗑"
            onClick={() => onCommand('chart-delete')}
          />
        </RibbonGroup>
      </div>
    )
  }

  if (activeTab === 'Picture Tools') {
    if (!selectedImage) return <div className="ribbon" />
    const lumRow = (
      label: string,
      field: 'bright' | 'contrast',
      value: number,
    ): React.JSX.Element => (
      <div className="picture-lum-row" key={field}>
        <span className="picture-lum-label">{label}</span>
        <button
          type="button"
          data-tip={t('appPicDecrease')}
          aria-label={t('appPicDecrease')}
          onClick={() => {
            const current = selectedImage.lum ?? { bright: 0, contrast: 0 }
            const next = Math.max(-100_000, Math.min(100_000, value - 10_000))
            onPictureEdit({ lum: { ...current, [field]: next } })
          }}
        >
          −
        </button>
        <span className="picture-lum-value">{Math.round(value / 1000)}%</span>
        <button
          type="button"
          data-tip={t('appPicIncrease')}
          aria-label={t('appPicIncrease')}
          onClick={() => {
            const current = selectedImage.lum ?? { bright: 0, contrast: 0 }
            const next = Math.max(-100_000, Math.min(100_000, value + 10_000))
            onPictureEdit({ lum: { ...current, [field]: next } })
          }}
        >
          +
        </button>
      </div>
    )
    return (
      <div className="ribbon">
        <RibbonGroup label={t('appPicGroupAdjust')}>
          <RibbonButton
            large
            label={t('appPicCrop')}
            detail={t('appPicCropTitle')}
            symbol="⌗"
            disabled={!selectedImage.editable}
            onClick={() => onCommand('picture-crop-open')}
          />
          <div className="ribbon-tool" data-tip={t('appPicCropToShape')}>
            <MenuSelect
              cover
              label={t('appPicCropToShape')}
              options={[
                { value: 'rect', label: t('appPicGeomRect') },
                { value: 'roundRect', label: t('appPicGeomRound') },
                { value: 'ellipse', label: t('appPicGeomEllipse') },
                { value: 'triangle', label: t('appPicGeomTriangle') },
                { value: 'diamond', label: t('appPicGeomDiamond') },
                { value: 'pentagon', label: t('appPicGeomPentagon') },
                { value: 'hexagon', label: t('appPicGeomHexagon') },
                { value: 'star5', label: t('appPicGeomStar') },
              ]}
              onPick={(value) => {
                if (!selectedImage.editable) return
                onPictureEdit({ geom: value === 'rect' ? null : value })
              }}
            />
          </div>
          <div className="check-column">
            {lumRow(t('appPicBrightness'), 'bright', selectedImage.lum?.bright ?? 0)}
            {lumRow(t('appPicContrast'), 'contrast', selectedImage.lum?.contrast ?? 0)}
            <button
              type="button"
              className="check-item"
              disabled={!selectedImage.editable}
              onClick={() => onPictureEdit({ lum: null })}
            >
              {t('appPicReset')}
            </button>
          </div>
        </RibbonGroup>
        <RibbonGroup label={t('appPicGroupBorderStyle')}>
          <ColorDropdown
            label={t('appPicBorder')}
            value={selectedImage.lineColor ?? '#000000'}
            portal
            onPick={(hex) => {
              if (!selectedImage.editable) return
              onPictureEdit({
                lineColor: hex,
                lineWidth: selectedImage.lineWidth ?? 1,
              })
            }}
          />
          <div className="ribbon-tool" data-tip={t('appPicBorderWidth')}>
            <MenuSelect
              cover
              label={t('appPicBorderWidth')}
              options={[
                { value: '0.5', label: '0.5 pt' },
                { value: '1', label: '1 pt' },
                { value: '1.5', label: '1.5 pt' },
                { value: '2', label: '2 pt' },
                { value: '3', label: '3 pt' },
              ]}
              onPick={(value) => {
                if (!selectedImage.editable) return
                onPictureEdit({
                  lineColor: selectedImage.lineColor ?? '#000000',
                  lineWidth: Number(value),
                })
              }}
            />
          </div>
        </RibbonGroup>
        <PictureSizeGroup
          key={`${selectedImage.id}-${selectedImage.widthPx}x${selectedImage.heightPx}`}
          widthPx={selectedImage.widthPx}
          heightPx={selectedImage.heightPx}
          onResize={onPictureResize}
        />
        <RibbonGroup label={t('appPicGroupArrange')}>
          <RibbonButton
            large
            label={t('appPicRotateLeft')}
            detail="↺"
            symbol="↺"
            disabled={!selectedImage.editable}
            onClick={() => onPictureRotate(-1)}
          />
          <RibbonButton
            large
            label={t('appPicRotateRight')}
            detail="↻"
            symbol="↻"
            disabled={!selectedImage.editable}
            onClick={() => onPictureRotate(1)}
          />
          <RibbonButton
            large
            label={t('appPicFlipH')}
            detail="⇋"
            symbol="⇋"
            active={selectedImage.flipH}
            disabled={!selectedImage.editable}
            onClick={() => onPictureEdit({ flipH: !selectedImage.flipH })}
          />
          <RibbonButton
            large
            label={t('appPicFlipV')}
            detail="⇅"
            symbol="⇅"
            active={selectedImage.flipV}
            disabled={!selectedImage.editable}
            onClick={() => onPictureEdit({ flipV: !selectedImage.flipV })}
          />
        </RibbonGroup>
        <RibbonGroup label={t('appPicShadow')}>
          <div className="ribbon-tool" data-tip={t('appPicShadow')}>
            <MenuSelect
              cover
              label={t('appPicShadow')}
              options={[
                { value: 'none', label: t('appPicOpacityNone') },
                { value: 'br', label: t('appPicShadowOffsetBr') },
                { value: 'tr', label: t('appPicShadowOffsetTr') },
                { value: 'soft', label: t('appPicShadowSoft') },
              ]}
              onPick={(value) => {
                if (!selectedImage.editable) return
                const presets: Record<
                  string,
                  {
                    blurPt: number
                    distPt: number
                    dirDeg: number
                    color: string
                    alpha: number
                  } | null
                > = {
                  none: null,
                  br: { blurPt: 8, distPt: 5, dirDeg: 45, color: '000000', alpha: 0.6 },
                  tr: { blurPt: 8, distPt: 5, dirDeg: 315, color: '000000', alpha: 0.6 },
                  soft: { blurPt: 12, distPt: 0, dirDeg: 0, color: '000000', alpha: 0.55 },
                }
                onPictureEdit({ shadow: presets[value] ?? null })
              }}
            />
          </div>
        </RibbonGroup>
        <RibbonGroup label={t('appPicAnchor')}>
          <div className="ribbon-tool" data-tip={t('appPicAnchor')}>
            <MenuSelect
              cover
              label={t('appPicAnchor')}
              options={[
                { value: 'twoCell', label: t('appPicAnchorMoveSize') },
                { value: 'oneCell', label: t('appPicAnchorMoveOnly') },
                { value: 'absolute', label: t('appPicAnchorAbsolute') },
              ]}
              onPick={(value) => onPictureAnchoring(value as 'twoCell' | 'oneCell' | 'absolute')}
            />
          </div>
        </RibbonGroup>
        <RibbonGroup label={t('appPicGroupPicture')}>
          <div className="ribbon-tool" data-tip={t('appPicAiReplace')}>
            <button
              className={`rb-big${aiReplaceOpen ? ' active' : ''}`}
              disabled={!selectedImage.editable}
              data-tip={t('appPicAiReplaceTip')}
              onClick={() => setAiReplaceOpen((v) => !v)}
            >
              <span className="rb-big-icon">✨</span>
              <span>{t('appPicAiReplace')}</span>
            </button>
            {aiReplaceOpen && (
              <div className="rb-ai-replace">
                <textarea
                  rows={2}
                  placeholder={t('appPicAiReplacePrompt')}
                  value={aiReplacePrompt}
                  onChange={(e) => setAiReplacePrompt(e.target.value)}
                />
                <button
                  disabled={aiReplaceBusy || !aiReplacePrompt.trim()}
                  onClick={() => void runAiReplace()}
                >
                  {aiReplaceBusy ? '…' : t('appPicAiReplaceRun')}
                </button>
              </div>
            )}
          </div>
          <div className="ribbon-tool" data-tip={t('appPicCompress')}>
            <MenuSelect
              cover
              label={t('appPicCompress')}
              options={[
                { value: '220', label: t('appPicCompressPrint') },
                { value: '150', label: t('appPicCompressWeb') },
                { value: '96', label: t('appPicCompressEmail') },
              ]}
              onPick={(value) => {
                if (!selectedImage.editable) return
                void (async () => {
                  const src = await onPictureGetSource()
                  if (!src) return
                  const compressed = await compressImageForDisplay(
                    `data:${src.mediaType};base64,${src.base64}`,
                    selectedImage.widthPx,
                    selectedImage.heightPx,
                    Number(value),
                  )
                  const head = compressed.split(',')[0] ?? ''
                  const base64 = compressed.split(',')[1]
                  const mime = /data:([^;]+)/.exec(head)?.[1]
                  if (!mime || !base64) return
                  if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/gif') return
                  onPictureMediaReplace({ mediaType: mime, base64 })
                })()
              }}
            />
          </div>
          <ChangePictureButton
            disabled={!selectedImage.editable}
            onPick={(mediaType, base64) => onPictureMediaReplace({ mediaType, base64 })}
          />
          <div className="ribbon-tool" data-tip={t('appPicOpacity')}>
            <MenuSelect
              cover
              label={t('appPicOpacity')}
              options={[
                { value: '1', label: t('appPicOpacityNone') },
                { value: '0.75', label: '75%' },
                { value: '0.5', label: '50%' },
                { value: '0.25', label: '25%' },
              ]}
              onPick={(value) => {
                if (!selectedImage.editable) return
                const opacity = Number(value)
                onPictureEdit({ opacity: opacity >= 1 ? null : opacity })
              }}
            />
          </div>
          <RibbonButton
            large
            label={t('appPicResetPicture')}
            detail={t('appPicReset')}
            symbol="⟲"
            disabled={!selectedImage.editable}
            onClick={onPictureReset}
          />
          <RibbonButton
            large
            label={t('appPicDelete')}
            detail="✕"
            symbol="🗑"
            onClick={onPictureDelete}
          />
        </RibbonGroup>
      </div>
    )
  }

  if (activeTab === 'Insert') {
    return (
      <div className="ribbon" data-ribbon-body="">
        <RibbonGroup label={t('appGroupTables')}>
          <RibbonButton
            large
            label={t('appPivotTable')}
            detail={t('appFromSelection')}
            symbol="⊞"
            onClick={() => onCommand('pivot-open')}
          />
          <RibbonButton
            large
            label={t('appEditPivotTable')}
            detail={t('appChangeFields')}
            symbol="⊞"
            onClick={() => onCommand('pivot-edit')}
          />
          <RibbonButton
            large
            label={t('appTableBtn')}
            detail={t('appRealExcelTable')}
            symbol="▦"
            onClick={() => onCommand('format-as-table')}
          />
        </RibbonGroup>
        <RibbonGroup label={t('appGroupIllustrations')}>
          <RibbonButton
            large
            label={t('appPictures')}
            detail={t('appPictureTypes')}
            symbol="🖼"
            onClick={onOpenInsertImage}
          />
          <RibbonButton
            large
            label={t('appCharts')}
            detail={t('appChartLibraryTip')}
            symbol="📊"
            onClick={() => onCommand('chart-designer-open')}
          />
          <div className="row-stack">
            <span className="styles-row" data-tip={t('appInsertShapeTitle')}>
              <ToolSymbol symbol="◇" />
              {t('appShapes')}
              <CaretIcon />
              <ShapeGallerySelect
                label="Shapes"
                onPick={(prst) => onCommand(`insert-shape:${prst}`)}
              />
            </span>
            <button
              className="styles-row as-button"
              data-tip={t('appIcons')}
              onClick={() => onCommand('insert-icons')}
            >
              <ToolSymbol symbol="✧" />
              {t('appIcons')}
            </button>
            <button
              className="styles-row as-button"
              data-tip={t('appScreenshot')}
              onClick={() => onCommand('insert-screenshot')}
            >
              <ToolSymbol symbol="⧉" />
              {t('appScreenshot')}
            </button>
          </div>
        </RibbonGroup>
        <RibbonGroup label={t('appGroupCheckbox')}>
          <RibbonButton
            large
            label={t('appGroupCheckbox')}
            detail={t('appAtSelection')}
            symbol="☑"
            onClick={() => onCommand('insert-checkbox')}
          />
        </RibbonGroup>
        <RibbonGroup label={t('appGroupCharts')}>
          <RibbonButton
            large
            label={t('appRecommendedCharts')}
            detail={t('appFromSelection')}
            symbol="📊"
            onClick={() => onCommand('recommended-charts-open')}
          />
          <div className="chart-grid">
            <button
              data-tip={t('appChartGridTitle', { type: t('appChartColumn') })}
              aria-label={t('appChartGridTitle', { type: t('appChartColumn') })}
              onClick={() => onCommand('insert-chart:column')}
            >
              <ChartThumb kind="column" />
            </button>
            <button
              data-tip={t('appChartGridTitle', { type: t('appChartBar') })}
              aria-label={t('appChartGridTitle', { type: t('appChartBar') })}
              onClick={() => onCommand('insert-chart:bar')}
            >
              <ChartThumb kind="bar" />
            </button>
            <button
              data-tip={t('appChartGridTitle', { type: t('appChartLine') })}
              aria-label={t('appChartGridTitle', { type: t('appChartLine') })}
              onClick={() => onCommand('insert-chart:line')}
            >
              <ChartThumb kind="line" />
            </button>
            <button
              data-tip={t('appChartGridTitle', { type: t('appChartTypeArea') })}
              aria-label={t('appChartGridTitle', { type: t('appChartTypeArea') })}
              onClick={() => onCommand('insert-chart:area')}
            >
              <ChartThumb kind="area" />
            </button>
            <button
              data-tip={t('appChartGridTitle', { type: t('appChartPie') })}
              aria-label={t('appChartGridTitle', { type: t('appChartPie') })}
              onClick={() => onCommand('insert-chart:pie')}
            >
              <ChartThumb kind="pie" />
            </button>
            <button
              data-tip={t('appChartGridTitle', { type: t('appChartScatter') })}
              aria-label={t('appChartGridTitle', { type: t('appChartScatter') })}
              onClick={() => onCommand('insert-chart:scatter')}
            >
              <ChartThumb kind="scatter" />
            </button>
            <button
              data-tip={t('appChartGridTitle', { type: t('appChartRadar') })}
              aria-label={t('appChartGridTitle', { type: t('appChartRadar') })}
              onClick={() => onCommand('insert-chart:radar')}
            >
              <ChartThumb kind="radar" />
            </button>
            <button
              data-tip={t('appChartGridTitle', { type: t('appChartDoughnut') })}
              aria-label={t('appChartGridTitle', { type: t('appChartDoughnut') })}
              onClick={() => onCommand('insert-chart:doughnut')}
            >
              <ChartThumb kind="doughnut" />
            </button>
            <button
              data-tip={t('appChartGridTitle', { type: t('appChartCombo') })}
              aria-label={t('appChartGridTitle', { type: t('appChartCombo') })}
              onClick={() => onCommand('insert-chart:combo')}
            >
              <ChartThumb kind="combo" />
            </button>
          </div>
          {largeMenu(
            t('appPivotChart'),
            '🗠',
            onIsSelectionInPivot() ? t('appPivotChartHintIn') : t('appPivotChartHintOut'),
            [
              {
                value: 'insert-pivot-chart:column',
                label: t('appChartColumn'),
                icon: <ChartThumb kind="column" size={18} />,
              },
              {
                value: 'insert-pivot-chart:bar',
                label: t('appChartBar'),
                icon: <ChartThumb kind="bar" size={18} />,
              },
              {
                value: 'insert-pivot-chart:line',
                label: t('appChartLine'),
                icon: <ChartThumb kind="line" size={18} />,
              },
              {
                value: 'insert-pivot-chart:pie',
                label: t('appChartPie'),
                icon: <ChartThumb kind="pie" size={18} />,
              },
              {
                value: 'insert-pivot-chart:doughnut',
                label: t('appChartDoughnut'),
                icon: <ChartThumb kind="doughnut" size={18} />,
              },
              {
                value: 'insert-pivot-chart:radar',
                label: t('appChartRadar'),
                icon: <ChartThumb kind="radar" size={18} />,
              },
            ],
          )}
        </RibbonGroup>
        <RibbonGroup label={t('appGroupSparklines')}>
          {largeMenu(t('appGroupSparklines'), '〜', t('appSparklinesTitle'), [
            { value: 'sparkline:line', label: t('appSparkLine'), icon: <SparkGlyph mode="line" /> },
            {
              value: 'sparkline:column',
              label: t('appSparkColumn'),
              icon: <SparkGlyph mode="column" />,
            },
            {
              value: 'sparkline:stacked',
              label: t('appSparkWinLoss'),
              icon: <SparkGlyph mode="loss" />,
            },
          ])}
        </RibbonGroup>
        <RibbonGroup label={t('appGroupFilters')}>
          <div className="row-stack">
            <button
              className="styles-row as-button"
              data-tip={onIsSelectionInPivot() ? t('appSlicerHintIn') : t('appSlicerHintOut')}
              onClick={() => onCommand('slicer-open')}
            >
              <ToolSymbol symbol="▥" />
              {t('appSlicer')}
            </button>
            <button
              className="styles-row as-button"
              data-tip={onIsSelectionInPivot() ? t('appTimelineHintIn') : t('appTimelineHintOut')}
              onClick={() => onCommand('timeline-open')}
            >
              <ToolSymbol symbol="🕒" />
              {t('appTimeline')}
            </button>
          </div>
        </RibbonGroup>
        <RibbonGroup label={t('appGroupLinks')}>
          <RibbonButton
            large
            label={t('appLink')}
            detail={t('appAtSelection')}
            symbol="🔗"
            onClick={() => onCommand('link-open')}
          />
        </RibbonGroup>
        <RibbonGroup label={t('appGroupComments')}>
          <RibbonButton
            large
            label={t('appNewComment')}
            detail={t('appAtSelection')}
            symbol="🗨"
            onClick={() => onCommand('note-open')}
          />
        </RibbonGroup>
        <RibbonGroup label={t('appGroupText')}>
          <RibbonButton
            large
            label={t('appTextBox')}
            detail={t('appAtSelection')}
            symbol="A"
            onClick={() => onCommand('insert-textbox')}
          />
          <RibbonButton
            large
            label={t('appHeaderFooter')}
            detail={t('appPrintedPages')}
            symbol="🗎"
            onClick={() => onCommand('header-footer-open')}
          />
        </RibbonGroup>
        <RibbonGroup label={t('appGroupSymbols')}>
          <div className="row-stack">
            <button
              className="styles-row as-button"
              data-tip={t('appEquation')}
              onClick={() => onCommand('insert-equation')}
            >
              <ToolSymbol symbol="π" />
              {t('appEquation')}
            </button>
            <button
              className="styles-row as-button"
              data-tip={t('appSymbol')}
              onClick={() => onCommand('insert-symbol')}
            >
              <ToolSymbol symbol="Ω" />
              {t('appSymbol')}
            </button>
          </div>
        </RibbonGroup>
      </div>
    )
  }

  if (activeTab === 'Page Layout') {
    const fitOptions = (axis: 'width' | 'height') => {
      const current = String(
        (axis === 'width' ? pageLayout.fitToWidth : pageLayout.fitToHeight) ?? 0,
      )
      const options = [
        { value: '0', label: t('appFitAutomaticOption'), icon: <FitGlyph /> },
        ...[1, 2, 3, 4, 5].map((pages) => ({
          value: String(pages),
          label: t(pages === 1 ? 'appFitPage1' : 'appFitPagesN', { count: pages }),
          icon: <OptSample>{pages}页</OptSample>,
        })),
      ]
      return (
        <MenuSelect
          className="select-like compact"
          label={`Fit to ${axis}`}
          data-tip={axis === 'width' ? t('appWidth') : t('appHeight')}
          value={current}
          display={options.find((option) => option.value === current)?.label ?? current}
          options={options}
          onPick={(value) => onCommand(`page-layout:fit-${axis}:${value}`)}
        />
      )
    }
    const marginLabels = {
      normal: t('appMarginNormal'),
      wide: t('appMarginWide'),
      narrow: t('appMarginNarrow'),
    } as const
    return (
      <div className="ribbon" data-ribbon-body="">
        <RibbonGroup label={t('appGroupThemes')}>
          {largeMenu(
            t('appGroupThemes'),
            '🎨',
            t('appThemesTitle'),
            THEME_PRESETS.map((preset) => ({
              value: `page-layout:theme:${preset.id}`,
              label: preset.name,
              icon: <ThemeDots colors={preset.colors.values} font={preset.fonts.minor} />,
            })),
          )}
          <div className="row-stack">
            <span className="styles-row" data-tip={t('appThemeColorsTitle')}>
              <ToolSymbol symbol="▤" />
              {t('appColors')}
              <CaretIcon />
              <MenuSelect
                cover
                label={t('appColors')}
                options={COLOR_SCHEMES.map((scheme) => ({
                  value: `page-layout:theme-colors:${scheme.id}`,
                  label: scheme.name,
                  icon: <ThemeDots colors={scheme.values} />,
                }))}
                onPick={onCommand}
              />
            </span>
            <span className="styles-row" data-tip={t('appThemeFontsTitle')}>
              <ToolSymbol symbol="A" />
              {t('appFonts')}
              <CaretIcon />
              <MenuSelect
                cover
                label={t('appFonts')}
                options={FONT_SCHEMES.map((scheme) => ({
                  value: `page-layout:theme-fonts:${scheme.id}`,
                  label: scheme.name,
                  icon: <OptSample>Aa</OptSample>,
                }))}
                onPick={onCommand}
              />
            </span>
          </div>
        </RibbonGroup>
        <RibbonGroup label={t('appGroupPageSetup')}>
          {largeMenu(
            t('appMargins'),
            '⿴',
            t('appMarginsTitle', {
              value: pageLayout.margins ? marginLabels[pageLayout.margins] : t('appAsSavedInFile'),
            }),
            [
              {
                value: 'page-layout:margins:normal',
                label: t('appMarginNormal'),
                icon: <MarginGlyph preset="normal" />,
              },
              {
                value: 'page-layout:margins:wide',
                label: t('appMarginWide'),
                icon: <MarginGlyph preset="wide" />,
              },
              {
                value: 'page-layout:margins:narrow',
                label: t('appMarginNarrow'),
                icon: <MarginGlyph preset="narrow" />,
              },
            ],
          )}
          {largeMenu(
            t('appOrientationLabel'),
            '⤢',
            t('appOrientationTitle', {
              value: pageLayout.orientation
                ? t(pageLayout.orientation === 'portrait' ? 'appPortrait' : 'appLandscape')
                : t('appAsSavedInFile'),
            }),
            [
              {
                value: 'page-layout:orientation:portrait',
                label: t('appPortrait'),
                icon: <OrientationGlyph landscape={false} />,
              },
              {
                value: 'page-layout:orientation:landscape',
                label: t('appLandscape'),
                icon: <OrientationGlyph landscape />,
              },
            ],
          )}
          {largeMenu(t('appSizeLabel'), '▭', t('appPaperSizeTitle'), [
            { value: 'page-layout:paper:1', label: 'Letter', icon: <PaperGlyph w={8.5} h={11} /> },
            { value: 'page-layout:paper:5', label: 'Legal', icon: <PaperGlyph w={8.5} h={14} /> },
            { value: 'page-layout:paper:3', label: 'Tabloid', icon: <PaperGlyph w={11} h={17} /> },
            {
              value: 'page-layout:paper:7',
              label: 'Executive',
              icon: <PaperGlyph w={7.25} h={10.5} />,
            },
            { value: 'page-layout:paper:8', label: 'A3', icon: <PaperGlyph w={11.7} h={16.5} /> },
            { value: 'page-layout:paper:9', label: 'A4', icon: <PaperGlyph w={8.3} h={11.7} /> },
            { value: 'page-layout:paper:11', label: 'A5', icon: <PaperGlyph w={5.8} h={8.3} /> },
          ])}
          {largeMenu(
            t('appPrintArea'),
            '⬚',
            pageLayout.printArea
              ? t('appPrintAreaTitle', { area: pageLayout.printArea })
              : t('appPrintAreaFromSelection'),
            [
              {
                value: 'page-layout:print-area:set',
                label: t('appSetPrintArea'),
                icon: <PrintAreaGlyph />,
              },
              {
                value: 'page-layout:print-area:clear',
                label: t('appClearPrintArea'),
                icon: <OptSample>✕</OptSample>,
              },
            ],
          )}
          {largeMenu(t('appBreaks'), '┆', t('appBreaksTitle'), [
            {
              value: 'page-layout:breaks:insert',
              label: t('appInsertPageBreak'),
              icon: <PageBreakGlyph />,
            },
            {
              value: 'page-layout:breaks:remove',
              label: t('appRemovePageBreak'),
              icon: <PageBreakGlyph />,
            },
            {
              value: 'page-layout:breaks:reset',
              label: t('appResetAllPageBreaks'),
              icon: <PageBreakGlyph />,
            },
          ])}
          {largeMenu(
            t('appPrintTitlesLabel'),
            '▤',
            pageLayout.printTitles
              ? t('appPrintTitlesTitle', { rows: pageLayout.printTitles })
              : t('appPrintTitlesHint'),
            [
              {
                value: 'page-layout:print-titles:first-row',
                label: t('appRepeatRow1'),
                icon: <TitleRowGlyph />,
              },
              {
                value: 'page-layout:print-titles:selection',
                label: t('appRepeatSelectedRows'),
                icon: <TitleRowGlyph />,
              },
              {
                value: 'page-layout:print-titles:clear',
                label: t('appClearPrintTitles'),
                icon: <OptSample>✕</OptSample>,
              },
            ],
          )}
        </RibbonGroup>
        <RibbonGroup label={t('appGroupScaleToFit')}>
          <div className="row-stack">
            <label className="styles-row" data-tip={t('appWidth')}>
              <ToolSymbol symbol="↔" />
              {t('appWidth')}:{fitOptions('width')}
            </label>
            <label className="styles-row" data-tip={t('appHeight')}>
              <ToolSymbol symbol="↕" />
              {t('appHeight')}:{fitOptions('height')}
            </label>
          </div>
        </RibbonGroup>
        <RibbonGroup label={t('appGroupSheetOptions')}>
          <div className="check-column">
            <span className="check-head">{t('appGridlines')}</span>
            <button
              className="check-item"
              data-tip={t('appGridlines')}
              onClick={() => onCommand('toggle-gridlines')}
            >
              <i className="check-box">{pageLayout.showGridlines ? '✓' : ''}</i>
              {t('appViewCheck')}
            </button>
            <button
              className="check-item"
              data-tip={t('appPrintGridlinesTitle')}
              onClick={() =>
                onCommand(`page-layout:print-gridlines:${pageLayout.printGridlines ? '0' : '1'}`)
              }
            >
              <i className="check-box">{pageLayout.printGridlines ? '✓' : ''}</i>
              {t('appPrintCheck')}
            </button>
          </div>
          <div className="check-column">
            <span className="check-head">{t('appHeadings')}</span>
            <button
              className="check-item"
              data-tip={t('appHeadings')}
              onClick={() => onCommand('toggle-headings')}
            >
              <i className="check-box">{pageLayout.showHeadings ? '✓' : ''}</i>
              {t('appViewCheck')}
            </button>
            <button
              className="check-item"
              data-tip={t('appPrintHeadingsTitle')}
              onClick={() =>
                onCommand(`page-layout:print-headings:${pageLayout.printHeadings ? '0' : '1'}`)
              }
            >
              <i className="check-box">{pageLayout.printHeadings ? '✓' : ''}</i>
              {t('appPrintCheck')}
            </button>
          </div>
        </RibbonGroup>
      </div>
    )
  }

  if (activeTab === 'Formulas') {
    const definedNames = onListNames()
    // Category buttons all open the same catalog dialog; the per-category
    // menus funnel into Insert Function.
    // Each button opens the catalog filtered to its own category; 'All'
    // for the ones the catalog has no counterpart for (Recently Used / More Functions).
    const functionCategory = (label: string, symbol: string, category: string) => (
      <RibbonButton
        large
        menu
        label={label}
        detail={category === 'All' ? t('appBrowseCatalog') : t('appBrowseCatalogFiltered')}
        symbol={symbol}
        onClick={() => onCommand(`insert-function-open:${category}`)}
      />
    )
    return (
      <div className="ribbon" data-ribbon-body="">
        <RibbonGroup label={t('appGroupFunctionLibrary')}>
          <RibbonButton
            large
            label={t('appInsertFunction')}
            detail={t('appBrowseCatalog')}
            symbol="ƒx"
            onClick={() => onCommand('insert-function-open')}
          />
          <div className="ribbon-tool large" data-tip={t('appAutoSumTitle')}>
            <span className="tool-icon-row">
              <ToolSymbol symbol="Σ" />
              <CaretIcon />
            </span>
            <span>
              <strong>{t('appAutoSum')}</strong>
            </span>
            <MenuSelect
              cover
              label="AutoSum"
              options={[
                { value: 'SUM', label: t('appFnSum'), icon: <OptSample>Σ</OptSample> },
                { value: 'AVERAGE', label: t('appFnAverage'), icon: <OptSample>x̄</OptSample> },
                { value: 'COUNT', label: t('appFnCountNumbers'), icon: <OptSample>#</OptSample> },
                { value: 'MAX', label: t('appFnMax'), icon: <OptSample>▲</OptSample> },
                { value: 'MIN', label: t('appFnMin'), icon: <OptSample>▼</OptSample> },
              ]}
              onPick={(value) => onCommand(`autofn:${value}`)}
            />
          </div>
          {functionCategory(t('appFnCatRecentlyUsed'), '🕘', 'All')}
          {functionCategory(t('appFnCatFinancial'), '$', 'Financial')}
          {functionCategory(t('appFnCatLogical'), '?', 'Logical')}
          {functionCategory(t('appFnCatText'), 'A', 'Text')}
          {functionCategory(t('appFnCatDateTime'), '🕐', 'Date & Time')}
          {functionCategory(t('appFnCatLookup'), '🔍', 'Lookup')}
          {functionCategory(t('appFnCatMathTrig'), 'θ', 'Math')}
          {functionCategory(t('appFnCatMore'), '⋯', 'All')}
        </RibbonGroup>
        <RibbonGroup label={t('appGroupDefinedNames')}>
          <RibbonButton
            large
            label={t('appNameManager')}
            detail={t('appNameManagerDetail')}
            symbol="🏷"
            onClick={() => onCommand('name-manager-open')}
          />
          <div className="row-stack">
            <button
              className="styles-row as-button"
              data-tip={t('appDefineName')}
              onClick={() => onCommand('name-manager-open')}
            >
              <ToolSymbol symbol="🏷" />
              {t('appDefineName')}
              <CaretIcon />
            </button>
            <span className="styles-row" data-tip={t('appUseInFormulaTitle')}>
              <ToolSymbol symbol="ƒ" />
              {t('appUseInFormula')}
              <CaretIcon />
              <MenuSelect
                cover
                label={t('appUseInFormula')}
                options={
                  definedNames.length > 0
                    ? definedNames.map((name) => ({ value: `use-in-formula:${name}`, label: name }))
                    : [
                        {
                          value: 'name-manager-open',
                          label: t('appNoNamesYet'),
                          icon: <OptSample>≡</OptSample>,
                        },
                      ]
                }
                onPick={onCommand}
              />
            </span>
            <span className="styles-row" data-tip={t('appCreateFromSelectionTitle')}>
              <ToolSymbol symbol="⊞" />
              {t('appCreateFromSelection')}
              <CaretIcon />
              <MenuSelect
                cover
                label={t('appCreateFromSelection')}
                options={[
                  {
                    value: 'create-names:top',
                    label: t('appCreateNamesTopRow'),
                    icon: <TitleRowGlyph />,
                  },
                  {
                    value: 'create-names:left',
                    label: t('appCreateNamesLeftCol'),
                    icon: <RowColGlyph row={false} />,
                  },
                ]}
                onPick={onCommand}
              />
            </span>
          </div>
        </RibbonGroup>
        <RibbonGroup label={t('appGroupFormulaAuditing')}>
          <div className="row-stack">
            <button
              className="styles-row as-button"
              data-tip={t('appTracePrecedentsTitle')}
              onClick={() => onCommand('trace-precedents')}
            >
              <ToolSymbol symbol="⇢" />
              {t('appTracePrecedents')}
            </button>
            <button
              className="styles-row as-button"
              data-tip={t('appTraceDependentsTitle')}
              onClick={() => onCommand('trace-dependents')}
            >
              <ToolSymbol symbol="⇠" />
              {t('appTraceDependents')}
            </button>
            <button
              className="styles-row as-button"
              data-tip={t('appRemoveArrowsTitle')}
              onClick={() => onCommand('remove-arrows')}
            >
              <ToolSymbol symbol="⌫" />
              {t('appRemoveArrows')}
            </button>
          </div>
          <RibbonButton
            large
            label={t('appShowFormulas')}
            detail={t('appShowFormulasDetail')}
            symbol="ƒ"
            onClick={() => onCommand('toggle-show-formulas')}
          />
          <RibbonButton
            large
            label={t('appErrorChecking')}
            detail={t('appErrorCheckingDetail')}
            symbol="⚠"
            onClick={() => onCommand('error-checking')}
          />
          <RibbonButton
            large
            label={t('appWatchWindow')}
            detail={t('appWatchWindowDetail')}
            symbol="👓"
            onClick={() => onCommand('watch-window')}
          />
        </RibbonGroup>
        <RibbonGroup label={t('appGroupCalculation')}>
          {largeMenu(t('appCalculationOptions'), '🧮', t('appCalculationOptionsTitle'), [
            {
              value: 'calc-mode:auto',
              label: t('appCalcAuto') + (calcManual ? '' : ' ✓'),
              icon: <OptSample>↻</OptSample>,
            },
            {
              value: 'calc-mode:manual',
              label: t('appCalcManual') + (calcManual ? ' ✓' : ''),
              icon: <OptSample>✎</OptSample>,
            },
          ])}
          <div className="row-stack">
            <button
              className="styles-row as-button"
              data-tip={t('appCalculateNowTitle')}
              onClick={() => onCommand('calculate-now')}
            >
              <ToolSymbol symbol="⟳" />
              {t('appCalculateNow')}
            </button>
            <button
              className="styles-row as-button"
              data-tip={t('appCalculateSheetTitle')}
              onClick={() => onCommand('calculate-sheet')}
            >
              <ToolSymbol symbol="▦" />
              {t('appCalculateSheet')}
            </button>
          </div>
        </RibbonGroup>
      </div>
    )
  }

  if (activeTab === 'Data') {
    return (
      <div className="ribbon" data-ribbon-body="">
        <RibbonGroup label={t('appPivotTable')}>
          <RibbonButton
            large
            label={t('appPivotTable')}
            detail={t('appOoxmlPivot')}
            symbol="⊞"
            onClick={() => onCommand('pivot-open')}
          />
          <RibbonButton
            large
            label={t('appRefresh')}
            detail={onIsSelectionInPivot() ? t('appRefreshHintIn') : t('appRefreshHintOut')}
            symbol="⟳"
            onClick={() => {
              const err = onRefreshPivot()
              if (err) onCommand(`error:${err}`)
            }}
          />
        </RibbonGroup>
        <RibbonGroup label={t('appGroupGetData')}>
          <div className="row-stack">
            <button
              className="styles-row as-button"
              data-tip={t('appFromTextCsvTitle')}
              onClick={() => onCommand('import-csv')}
            >
              <ToolSymbol symbol="🗎" />
              {t('appFromTextCsv')}
            </button>
            <button
              className="styles-row as-button"
              data-tip={t('appMergeWorkbooksTip')}
              onClick={() => onCommand('merge-workbooks')}
            >
              <ToolSymbol symbol="⧉" />
              {t('appMergeWorkbooks')}
            </button>
            <button
              className="styles-row as-button"
              data-tip={t('appRefreshAllTitle')}
              onClick={() => onCommand('refresh-all')}
            >
              <ToolSymbol symbol="⟳" />
              {t('appRefreshAll')}
            </button>
          </div>
        </RibbonGroup>
        <RibbonGroup label={t('appGroupSortFilter')}>
          {largeMenu(t('appSort'), '⇅', t('appSortSelectionTitle'), [
            { value: 'sort:asc', label: t('appSortAToZ'), icon: <SortGlyph asc /> },
            { value: 'sort:desc', label: t('appSortZToA'), icon: <SortGlyph asc={false} /> },
            {
              value: 'sort-custom-open',
              label: t('appCustomSort'),
              icon: <OptSample>⚙</OptSample>,
            },
          ])}
          <RibbonButton
            large
            label={t('appFilter')}
            detail={t('appFilterToggleDetail')}
            symbol="▽"
            onClick={() => onCommand('filter-toggle')}
          />
          <div className="row-stack">
            <button
              className="styles-row as-button"
              data-tip={t('appClearFilterTitle')}
              onClick={() => onCommand('filter-clear')}
            >
              <ToolSymbol symbol="⊘" />
              {t('appClear')}
            </button>
            <button
              className="styles-row as-button"
              data-tip={t('appReapplyTitle')}
              onClick={() => onCommand('filter-reapply')}
            >
              <ToolSymbol symbol="↻" />
              {t('appReapply')}
            </button>
            <button
              className="styles-row as-button"
              data-tip={t('appAdvancedFilterTitle')}
              onClick={() => onCommand('filter-advanced')}
            >
              <ToolSymbol symbol="▽" />
              {t('appAdvanced')}
            </button>
          </div>
        </RibbonGroup>
        <RibbonGroup label={t('appGroupDataTools')}>
          {largeMenu(t('appTextToColumns'), '⇶', t('appTextToColumnsTitle'), [
            {
              value: 'text-to-columns:2',
              label: t('appSplitByComma'),
              icon: <OptSample>,</OptSample>,
            },
            {
              value: 'text-to-columns:4',
              label: t('appSplitBySemicolon'),
              icon: <OptSample>;</OptSample>,
            },
            {
              value: 'text-to-columns:8',
              label: t('appSplitBySpace'),
              icon: <OptSample>␣</OptSample>,
            },
            {
              value: 'text-to-columns:1',
              label: t('appSplitByTab'),
              icon: <OptSample>⇥</OptSample>,
            },
          ])}
          <RibbonButton
            large
            label={t('appFlashFill')}
            detail={t('appFlashFillDetail')}
            symbol="⚡"
            onClick={() => onCommand('flash-fill')}
          />
          <RibbonButton
            large
            label={t('appRemoveDuplicates')}
            detail={t('appInSelection')}
            symbol="⧉"
            onClick={() => onCommand('remove-duplicates-open')}
          />
          <RibbonButton
            large
            menu
            label={t('appDataValidation')}
            detail={t('appRulesPanel')}
            symbol="✓"
            onClick={() => onCommand('dv-open')}
          />
          <RibbonButton
            large
            label={t('appConsolidate')}
            detail={t('appCombineRanges')}
            symbol="⊕"
            onClick={() => onCommand('consolidate-open')}
          />
        </RibbonGroup>
        <RibbonGroup label={t('appGroupForecast')}>
          {largeMenu(t('appWhatIfAnalysis'), '❔', t('appWhatIfTitle'), [
            { value: 'goal-seek-open', label: t('appGoalSeek'), icon: <OptSample>?</OptSample> },
          ])}
        </RibbonGroup>
        <RibbonGroup label={t('appGroupOutline')}>
          {largeMenu(t('appOutlineGroup'), '⊟', t('appOutlineGroupTitle'), [
            {
              value: 'outline-group:rows',
              label: t('appGroupRows'),
              icon: <GroupGlyph open={false} />,
            },
            {
              value: 'outline-group:cols',
              label: t('appGroupCols'),
              icon: <GroupGlyph open={false} />,
            },
            {
              value: 'outline-hide-detail:rows',
              label: t('appHideDetailRows'),
              icon: <OptSample>−</OptSample>,
            },
            {
              value: 'outline-hide-detail:cols',
              label: t('appHideDetailCols'),
              icon: <OptSample>−</OptSample>,
            },
          ])}
          {largeMenu(t('appOutlineUngroup'), '⊞', t('appOutlineUngroupTitle'), [
            {
              value: 'outline-ungroup:rows',
              label: t('appUngroupRows'),
              icon: <GroupGlyph open />,
            },
            {
              value: 'outline-ungroup:cols',
              label: t('appUngroupCols'),
              icon: <GroupGlyph open />,
            },
            {
              value: 'outline-show-detail:rows',
              label: t('appShowDetailRows'),
              icon: <OptSample>+</OptSample>,
            },
            {
              value: 'outline-show-detail:cols',
              label: t('appShowDetailCols'),
              icon: <OptSample>+</OptSample>,
            },
          ])}
          <RibbonButton
            large
            label={t('appSubtotal')}
            detail={t('appSubtotalDetail')}
            symbol="∑"
            onClick={() => onCommand('subtotal-open')}
          />
        </RibbonGroup>
      </div>
    )
  }

  if (activeTab === 'View') {
    return (
      <div className="ribbon" data-ribbon-body="">
        <RibbonGroup label={t('appGroupWorkbookViews')}>
          <RibbonButton
            large
            label={t('appNormalView')}
            detail={t('appCurrentViewTitle')}
            symbol="▦"
            active={pageLayout.pageBreakPreview !== true}
            onClick={() => {
              if (pageLayout.pageBreakPreview === true) onCommand('toggle-page-break-preview')
            }}
          />
          <RibbonButton
            large
            label={t('appPageBreakPreview')}
            detail={t('appPageBreakPreviewTitle')}
            symbol="┆"
            active={pageLayout.pageBreakPreview === true}
            onClick={() => {
              if (pageLayout.pageBreakPreview !== true) onCommand('toggle-page-break-preview')
            }}
          />
        </RibbonGroup>
        <RibbonGroup label={t('appGroupShow')}>
          <div className="check-column">
            <button
              className="check-item"
              data-tip={t('appGridlines')}
              onClick={() => onCommand('toggle-gridlines')}
            >
              <i className="check-box">{pageLayout.showGridlines ? '✓' : ''}</i>
              {t('appGridlines')}
            </button>
            <button
              className="check-item"
              data-tip={t('appFormulaBar')}
              onClick={() => onCommand('toggle-formula-bar')}
            >
              <i className="check-box">{formulaBarVisible ? '✓' : ''}</i>
              {t('appFormulaBar')}
            </button>
            <button
              className="check-item"
              data-tip={t('appHeadings')}
              onClick={() => onCommand('toggle-headings')}
            >
              <i className="check-box">{pageLayout.showHeadings ? '✓' : ''}</i>
              {t('appHeadings')}
            </button>
            <button
              className="check-item"
              data-tip={t('appCrossHighlight')}
              onClick={() => onCommand('toggle-cross-highlight')}
            >
              <i className="check-box">{crossHighlightVisible ? '✓' : ''}</i>
              {t('appCrossHighlight')}
            </button>
          </div>
        </RibbonGroup>
        <RibbonGroup label={t('appZoomLabel')}>
          {largeMenu(t('appZoomLabel'), '🔍', t('appZoomSheetTitle'), [
            { value: 'zoom:50', label: '50%', icon: <ZoomGlyph pct={50} /> },
            { value: 'zoom:75', label: '75%', icon: <ZoomGlyph pct={75} /> },
            { value: 'zoom:100', label: '100%', icon: <ZoomGlyph pct={100} /> },
            { value: 'zoom:125', label: '125%', icon: <ZoomGlyph pct={125} /> },
            { value: 'zoom:150', label: '150%', icon: <ZoomGlyph pct={150} /> },
            { value: 'zoom:200', label: '200%', icon: <ZoomGlyph pct={200} /> },
          ])}
          <RibbonButton
            large
            label="100%"
            detail={t('appResetZoom')}
            symbol="⊙"
            onClick={() => onCommand('zoom-reset')}
          />
          <RibbonButton
            large
            label={t('appZoomToSelection')}
            detail={t('appZoomToSelectionDetail')}
            symbol="⌖"
            onClick={() => onCommand('zoom-to-selection')}
          />
        </RibbonGroup>
        <RibbonGroup label={t('appGroupWindow')}>
          {largeMenu(t('appFreezePanes'), '❄', t('appFreezeTitle'), [
            {
              value: 'freeze-here',
              label: t('appFreezeAtSelection'),
              icon: <FreezeGlyph mode="cross" />,
            },
            {
              value: 'freeze-top-row',
              label: t('appFreezeTopRow'),
              icon: <FreezeGlyph mode="row" />,
            },
            {
              value: 'freeze-first-col',
              label: t('appFreezeFirstCol'),
              icon: <FreezeGlyph mode="col" />,
            },
            { value: 'unfreeze', label: t('appUnfreeze'), icon: <FreezeGlyph mode="none" /> },
          ])}
        </RibbonGroup>
      </div>
    )
  }

  if (activeTab === 'Review') {
    return (
      <div className="ribbon" data-ribbon-body="">
        <RibbonGroup label={t('appGroupProofing')}>
          <RibbonButton
            large
            label={t('appWorkbookStatsLabel')}
            detail={t('appSheetsCellsFormulas')}
            symbol="🧮"
            onClick={() => onCommand('workbook-statistics')}
          />
        </RibbonGroup>
        <RibbonGroup label={t('appGroupLanguage')}>
          <div className="ribbon-tool large" data-tip={t('appTranslateTitle')}>
            <span className="tool-icon-row">
              <ToolSymbol symbol="文" />
              <CaretIcon />
            </span>
            <span>
              <strong>{t('appTranslate')}</strong>
            </span>
            <MenuSelect
              cover
              label={t('appTranslate')}
              options={TRANSLATE_LANGUAGES.map((language) => ({
                value: language,
                label: language,
                icon: <LangSample code={language.slice(0, 2)} />,
              }))}
              onPick={(language) => onAiRun(t('appTranslatePrompt', { language }))}
            />
          </div>
        </RibbonGroup>
        <RibbonGroup label={t('appGroupComments')}>
          <RibbonButton
            large
            label={t('appNewComment')}
            detail={t('appNewCommentDetail')}
            symbol="🗨"
            onClick={() => onCommand('note-open')}
          />
          <RibbonButton
            large
            label={t('appDeleteLabel')}
            detail={t('appNoteAtSelection')}
            symbol="🗑"
            onClick={() => onCommand('note-delete')}
          />
          <div className="row-stack">
            <button
              className="styles-row as-button"
              data-tip={t('appNotePrevTitle')}
              onClick={() => onCommand('note-prev')}
            >
              <ToolSymbol symbol="←" />
              {t('appPrevious')}
            </button>
            <button
              className="styles-row as-button"
              data-tip={t('appNoteNextTitle')}
              onClick={() => onCommand('note-next')}
            >
              <ToolSymbol symbol="→" />
              {t('appNext')}
            </button>
            <button
              className="styles-row as-button"
              data-tip={t('appShowCommentsTitle')}
              onClick={() => onCommand('note-show-toggle')}
            >
              <ToolSymbol symbol="🗨" />
              {t('appShowComments')}
            </button>
          </div>
        </RibbonGroup>
        <RibbonGroup label={t('appGroupNotes')}>
          <RibbonButton
            large
            menu
            label={t('appGroupNotes')}
            detail={t('appNotesDetail')}
            symbol="🗨"
            onClick={() => onCommand('note-open')}
          />
        </RibbonGroup>
        <RibbonGroup label={t('appGroupProtection')}>
          <RibbonButton
            large
            label={t(sheetProtected ? 'appUnprotectSheet' : 'appProtectSheet')}
            detail={t(sheetProtected === null ? 'appOpenFileFirst' : 'appNoPassword')}
            symbol={sheetProtected ? '🔓' : '🔒'}
            onClick={() => onCommand('sheet-protect')}
          />
          <RibbonButton
            large
            label={t(workbookProtected ? 'appUnprotectWorkbook' : 'appProtectWorkbook')}
            detail={t(workbookProtected === null ? 'appOpenFileFirst' : 'appProtectWorkbookTitle')}
            symbol={workbookProtected ? '🔓' : '🔐'}
            onClick={() => onCommand('workbook-protect')}
          />
          <RibbonButton
            large
            label={t('appAllowEditRanges')}
            detail={t('appAllowEditRangesTitle')}
            symbol="⬚"
            onClick={() => onCommand('allow-edit-ranges-open')}
          />
        </RibbonGroup>
      </div>
    )
  }

  const fontSizes = [9, 10, 11, 12, 14, 16, 18, 22, 26]
  const echoFamily = selectionFormat?.fontFamily ?? 'Aptos'
  const echoSize = selectionFormat?.fontSize ?? 11
  const fontGroups = fontFamilyGroups(systemFontFamilies, echoFamily)
  const familyOptions = [
    ...fontGroups.common.map((family) => ({ value: family, label: family })),
    ...fontGroups.system.map((family, index) => ({
      value: family,
      label: family,
      sep: index === 0,
    })),
  ]
  const sizeOptions = fontSizes.includes(echoSize)
    ? fontSizes
    : [...fontSizes, echoSize].sort((a, b) => a - b)
  const freezeMenuOptions: readonly MenuRowOption[] = [
    {
      value: `freeze-rows-cols:${activeCell.row + 1}:${activeCell.column + 1}`,
      label: t('appFreezeToRC', {
        rows: activeCell.row + 1,
        cols: columnLabel(activeCell.column),
      }),
      disabled: activeCell.row === 0 || activeCell.column === 0,
    },
    {
      value: `freeze-rows:${activeCell.row + 1}`,
      label: t('appFreezeToRows', { rows: activeCell.row + 1 }),
      disabled: activeCell.row === 0,
    },
    {
      value: `freeze-cols:${activeCell.column + 1}`,
      label: t('appFreezeToCols', { cols: columnLabel(activeCell.column) }),
      disabled: activeCell.column === 0,
    },
    { value: 'freeze-header', label: t('appFreezeHeader') },
    { value: 'freeze-top-row', label: t('appFreezeTopRow') },
    { value: 'freeze-first-col', label: t('appFreezeFirstCol') },
    { value: 'freeze-here', label: t('appFreezeAtSelection') },
    { value: 'unfreeze', label: t('appUnfreeze') },
  ]
  /// 数据处理组七枚菜单钮（统一 RibbonMenuButton）：WPS 逐级降级阶梯
  /// 0=平铺大钮 1=一列两行 2=一列三行 3=子簇名钮平铺 4=单分组合并面板
  const processMenus: readonly {
    readonly key: string
    readonly label: string
    readonly tip: string
    readonly symbol: string
    readonly options: readonly MenuRowOption[]
  }[] = [
    {
      key: 'fill',
      label: t('appFillMenu'),
      tip: t('appFillMenu'),
      symbol: '↓',
      options: [
        { value: 'fill-down', label: t('appFillDown'), icon: <OptSample>↓</OptSample> },
        { value: 'fill-right', label: t('appFillRight'), icon: <OptSample>→</OptSample> },
        { value: 'fill-up', label: t('appFillUp'), icon: <OptSample>↑</OptSample> },
        { value: 'fill-left', label: t('appFillLeft'), icon: <OptSample>←</OptSample> },
        { value: 'fill-123', label: t('appFill123'), icon: <OptSample>123</OptSample> },
        { value: 'fill-rank', label: t('appFillRank'), icon: <OptSample>1·2·3</OptSample> },
        { value: 'fill-blanks', label: t('appFillBlanks'), icon: <OptSample>▢⇢</OptSample> },
        {
          value: 'fill-insert-group',
          label: t('appFillInsertText'),
          children: [
            { value: 'fill-insert-text-open:start', label: t('appFillInsertStart') },
            { value: 'fill-insert-text-open:mid', label: t('appFillInsertMid') },
            { value: 'fill-insert-text-open:end', label: t('appFillInsertEnd') },
          ],
        },
        {
          value: 'fill-date-group',
          label: t('appFillDate'),
          icon: <OptSample>📅</OptSample>,
          children: FILL_DATE_PATTERNS.map((entry) => ({
            value: `fill-date:${entry.pattern}`,
            label: fillDateLabel(entry.pattern),
            sep: entry.wide,
          })),
        },
        {
          value: 'fill-to-sheets',
          label: t('appFillToSheets'),
          icon: <OptSample>⇉</OptSample>,
        },
        {
          value: 'series-open',
          label: `${t('appFillSeries')}…`,
          icon: <OptSample>⋮⋮⋮</OptSample>,
        },
        { value: 'flash-fill', label: t('appFillSmart'), icon: <OptSample>⚡</OptSample> },
        { value: 'ai-fill', label: t('appFillAi'), icon: <OptSample>✨</OptSample> },
      ],
    },
    {
      key: 'sum',
      label: t('appFnSum'),
      tip: t('appAutoSumTitle'),
      symbol: 'Σ',
      options: [
        { value: 'autofn:SUM', label: t('appFnSum'), icon: <OptSample>Σ</OptSample> },
        { value: 'autofn:AVERAGE', label: t('appFnAverage'), icon: <OptSample>x̄</OptSample> },
        {
          value: 'autofn:COUNT',
          label: t('appFnCountNumbers'),
          icon: <OptSample>#</OptSample>,
        },
        { value: 'autofn:MAX', label: t('appFnMax'), icon: <OptSample>▲</OptSample> },
        { value: 'autofn:MIN', label: t('appFnMin'), icon: <OptSample>▼</OptSample> },
        {
          value: 'cond-stats-open',
          label: `${t('appCondStats')}…`,
          icon: <OptSample>¿Σ</OptSample>,
        },
        {
          value: 'insert-function-open',
          label: `${t('appFnCatMore')}…`,
          icon: <OptSample>fx</OptSample>,
        },
        {
          value: 'ai-write-formula',
          label: t('appWriteFormula'),
          icon: <OptSample>✨fx</OptSample>,
        },
      ],
    },
    {
      key: 'sort',
      label: t('appSort'),
      tip: t('appSortSelectionTitle'),
      symbol: '⇅',
      options: [
        { value: 'sort:asc', label: t('appSortAToZ'), icon: <SortGlyph asc /> },
        { value: 'sort:desc', label: t('appSortZToA'), icon: <SortGlyph asc={false} /> },
        {
          value: 'sort-custom-open',
          label: t('appCustomSort'),
          icon: <OptSample>⚙</OptSample>,
        },
      ],
    },
    {
      key: 'filter',
      label: t('appFilter'),
      tip: t('appFilterToggleDetail'),
      symbol: '▽',
      options: [
        { value: 'filter-toggle', label: t('appFilter'), icon: <OptSample>▽</OptSample> },
        {
          value: 'filter-advanced',
          label: t('appFilterAdvanced'),
          icon: <OptSample>⚙▽</OptSample>,
        },
        { value: 'filter-reapply', label: t('appReapply'), icon: <OptSample>↻</OptSample> },
        { value: 'filter-clear', label: t('appShowAll'), icon: <OptSample>☀</OptSample> },
      ],
    },
    {
      key: 'freeze',
      label: t('appFreezePanes'),
      tip: t('appFreezeTitle'),
      symbol: '❄',
      options: freezeMenuOptions,
    },
    {
      key: 'find',
      label: t('appFind'),
      tip: t('appFindTitle'),
      symbol: '🔍',
      options: [
        {
          value: 'find',
          label: `${t('appFind')} ${platformShortcuts('⌘F')}`,
          icon: <OptSample>🔍</OptSample>,
        },
        { value: 'replace', label: t('appReplace'), icon: <OptSample>⇄</OptSample> },
        {
          value: 'goto-open',
          label: `${t('appGoTo')} ${platformShortcuts('⌘G')}`,
          icon: <OptSample>⌖</OptSample>,
        },
        {
          value: 'select-object',
          label: t('appSelectObjects'),
          icon: <OptSample>☐</OptSample>,
        },
        {
          value: 'selection-pane-open',
          label: t('appSelectionPane'),
          icon: <OptSample>☰</OptSample>,
        },
      ],
    },
    {
      key: 'clear',
      label: t('appClear'),
      tip: t('appClear'),
      symbol: '⌫',
      options: [
        { value: 'clear-all', label: t('appClearAll'), icon: <OptSample>⌫</OptSample> },
        {
          value: 'clear-formats',
          label: t('appClearFormats'),
          icon: <OptSample>Aa</OptSample>,
        },
        {
          value: 'clear-contents',
          label: t('appClearContents'),
          icon: <OptSample>123</OptSample>,
        },
      ],
    },
  ]
  return (
    <div
      // 隐文字/紧凑只属 stage 1/2：根类不得在 stage 3/4 残留，否则分组名钮
      // 的文字也被 canHideText 规则藏掉（用户实证：名钮档「没有名称」）
      className="ribbon"
      ref={ribbonRef}
    >
      {bandCollapsed && (
        <NodeDropButton label={t(TAB_LABEL[activeTab] ?? 'appGroupClipboard')}>
          {([...bandSections.current.values()] as readonly BandSection[]).map((section) => (
            <div key={section.id} className="band-section">
              <div className="band-section-label">{section.label}</div>
              {section.node}
            </div>
          ))}
        </NodeDropButton>
      )}
      <RibbonGroupLevelsContext.Provider value={groupLevels}>
        <GroupSlotContext.Provider value={{ claim: claimSlot }}>
          <BandCollectorContext.Provider value={bandCollector}>
            <RibbonGroup label={t('appGroupClipboard')}>
              {/* WPS 布局（对比清单 1-3）：格式刷升为第一枚大按钮；粘贴改为分体
            按钮（本体直接粘贴 + 下拉八项）；竖排只剩剪切和分体复制 */}
              <button
                className="ribbon-tool as-button large"
                data-tip={t('appFormatPainter')}
                onClick={() => onCommand('format-painter')}
              >
                <span className="tool-icon-row">
                  <ToolSymbol symbol="🖌" />
                </span>
                <span>
                  <strong>{t('appFormatPainter')}</strong>
                </span>
              </button>
              <SplitMenuTool
                symbol="📋"
                label={t('appPaste')}
                tip={t('appPasteTitle')}
                options={[
                  {
                    value: 'paste-special:value',
                    label: t('appPasteValuesOnly'),
                    icon: <OptSample>123</OptSample>,
                  },
                  {
                    value: 'paste-special:formula',
                    label: t('appPasteFormulasOnly'),
                    icon: <OptSample>ƒx</OptSample>,
                  },
                  {
                    value: 'paste-special:besides-border',
                    label: t('appPasteExceptBorders'),
                    icon: <BorderGlyph on="none" />,
                  },
                  {
                    value: 'paste-special:transpose',
                    label: t('appPasteTranspose'),
                    icon: <ToolSymbol symbol="transpose" />,
                  },
                  {
                    value: 'paste',
                    label: t('appPasteKeepFormat'),
                    icon: <ToolSymbol symbol="board-format" />,
                  },
                  {
                    value: 'paste-as-picture',
                    label: t('appPasteAsPicture'),
                    icon: <ToolSymbol symbol="🖼" />,
                  },
                  {
                    value: 'paste-special:text',
                    label: t('appPasteTextOnly'),
                    icon: <ToolSymbol symbol="board-text" />,
                  },
                  {
                    value: 'paste-special-dialog',
                    label: t('appPasteSpecial'),
                    icon: <OptSample>⋯</OptSample>,
                  },
                ]}
                onMain={() => onCommand('paste')}
                onPick={(command) => onCommand(command)}
              />
              <div className="tool-stack">
                <button
                  data-tip={t('appCutTitle')}
                  aria-label={t('appCutTitle')}
                  onClick={() => onCommand('cut')}
                >
                  <ToolSymbol symbol="✂" />
                </button>
                <SplitStackTool
                  symbol="⧉"
                  tip={t('appCopyTitle')}
                  options={[
                    { value: 'copy', label: t('appCopy'), icon: <ToolSymbol symbol="⧉" /> },
                    {
                      value: 'copy-as-picture',
                      label: t('appCopyAsPicture'),
                      icon: <ToolSymbol symbol="🖼" />,
                    },
                  ]}
                  onMain={() => onCommand('copy')}
                  onPick={(command) => onCommand(command)}
                />
              </div>
            </RibbonGroup>
            <RibbonGroup
              label={t('appGroupFont')}
              launcher={{
                tip: `${t('appFormatCells')} · ${t('dlgFcTabFont')}`,
                onClick: () => onCommand('format-cells:Font'),
              }}
            >
              <div className="ribbon-rows font-group-rows">
                <div className="inline-tools">
                  <EditableMenuSelect
                    className="select-like font-name"
                    label="Font family"
                    data-tip={t('appFontFamilyTip')}
                    value={echoFamily}
                    options={familyOptions}
                    onOpen={loadSystemFonts}
                    onPick={(value) => onCommand(`font-family:${value}`)}
                    commit={(text) => onCommand(`font-family:${text}`)}
                  />
                  <EditableMenuSelect
                    className="select-like font-size"
                    label="Font size"
                    data-tip={t('appFontSizeTip')}
                    value={String(echoSize)}
                    options={sizeOptions.map((size) => ({
                      value: String(size),
                      label: String(size),
                    }))}
                    onPick={(value) => onCommand(`font-size:${value}`)}
                    commit={(text) => {
                      const size = Number(text.replace(',', '.'))
                      // Excel's font-size bounds
                      if (Number.isFinite(size) && size >= 1 && size <= 409)
                        onCommand(`font-size:${size}`)
                    }}
                  />
                  <button
                    data-tip={t('appIncreaseFontSize')}
                    aria-label={t('appIncreaseFontSize')}
                    onClick={() => onCommand(`font-size:${stepFontSize(echoSize, 1)}`)}
                  >
                    <ToolSymbol symbol="A↑" />
                  </button>
                  <button
                    data-tip={t('appDecreaseFontSize')}
                    aria-label={t('appDecreaseFontSize')}
                    onClick={() => onCommand(`font-size:${stepFontSize(echoSize, -1)}`)}
                  >
                    <ToolSymbol symbol="A↓" />
                  </button>
                </div>
                <div className="inline-tools">
                  <button
                    data-tip={t('appBold')}
                    className={selectionFormat?.bold ? 'is-active' : ''}
                    onClick={() => onCommand('bold')}
                  >
                    <b>B</b>
                  </button>
                  <button
                    data-tip={t('appItalic')}
                    className={selectionFormat?.italic ? 'is-active' : ''}
                    onClick={() => onCommand('italic')}
                  >
                    <em>I</em>
                  </button>
                  {/* WPS（对比清单 5）：单/双下划线合并为一枚分体按钮，会计用
                双下划线随渲染引擎后续支持 */}
                  <SplitStackTool
                    symbol="u-line"
                    tip={t('appUnderline')}
                    active={Boolean(selectionFormat?.underline)}
                    options={[
                      {
                        value: 'underline',
                        label: t('appUnderline'),
                        icon: <ToolSymbol symbol="u-line" />,
                      },
                      {
                        value: 'underline:double',
                        label: t('appDoubleUnderline'),
                        icon: <ToolSymbol symbol="u-line-double" />,
                      },
                      {
                        value: 'underline:accounting',
                        label: t('appUnderlineAccounting'),
                        icon: <ToolSymbol symbol="u-line-accounting" />,
                        disabled: true,
                        tip: t('appFeaturePendingTip'),
                      },
                    ]}
                    onMain={() => onCommand('underline')}
                    onPick={(command) => onCommand(command)}
                  />
                  <button
                    data-tip={t('appStrikethrough')}
                    className={selectionFormat?.strike ? 'is-active' : ''}
                    onClick={() => onCommand('strike')}
                  >
                    <ToolSymbol symbol="ab-strike" />
                  </button>
                  {/* WPS（对比清单 8-9）：边框排在字体颜色前，完整两组菜单，
                线条颜色/线条样式并入 */}
                  <BorderMenu
                    penColor={borderColor}
                    penStyle={borderPenStyle}
                    onPenColor={(hex) => setBorderColor(hex)}
                    onPenStyle={setBorderPenStyle}
                    onCommand={onCommand}
                  />
                  <ColorDropdown
                    label="Font color"
                    data-tip={t('appFontColor')}
                    split
                    display={
                      <span className="swatch-letter has-caret">
                        <ToolSymbol symbol="A-color" />
                        <i style={{ background: fontColor }} />
                        <CaretIcon />
                      </span>
                    }
                    value={fontColor}
                    auto={t('appAutomaticColor')}
                    onPick={(hex) => {
                      setFontColor(hex ?? '#000000')
                      onCommand(hex ? `font-color:${hex}` : 'font-color:auto')
                    }}
                  />
                  <ColorDropdown
                    label="Fill color"
                    data-tip={t('appFillColor')}
                    split
                    display={
                      <span className="swatch-letter">
                        <ToolSymbol symbol="◧" />
                        <i style={{ background: fillColor }} />
                      </span>
                    }
                    value={fillColor}
                    auto={t('dlgFcNoFill')}
                    onPick={(hex) => {
                      if (hex) setFillColor(hex)
                      onCommand(hex ? `fill:${hex}` : 'fill:none')
                    }}
                  />
                </div>
              </div>
            </RibbonGroup>
            <RibbonGroup
              label={t('appGroupAlignment')}
              launcher={{
                tip: `${t('appFormatCells')} · ${t('dlgFcTabAlignment')}`,
                onClick: () => onCommand('format-cells:Alignment'),
              }}
            >
              <div className="ribbon-rows">
                <div className="inline-tools alignment-tools">
                  <button
                    data-tip={t('appTopAlign')}
                    aria-label={t('appTopAlign')}
                    onClick={() => onCommand('valign:top')}
                  >
                    <ToolSymbol symbol="⤒" />
                  </button>
                  <button
                    data-tip={t('appMiddleAlign')}
                    aria-label={t('appMiddleAlign')}
                    onClick={() => onCommand('valign:middle')}
                  >
                    <ToolSymbol symbol="valign-middle" />
                  </button>
                  <button
                    data-tip={t('appBottomAlign')}
                    aria-label={t('appBottomAlign')}
                    onClick={() => onCommand('valign:bottom')}
                  >
                    <ToolSymbol symbol="⤓" />
                  </button>
                  <button
                    data-tip={t('dlgFcWrapText')}
                    aria-label={t('dlgFcWrapText')}
                    className={selectionFormat?.wrap ? 'is-active' : ''}
                    onClick={() => onCommand('wrap')}
                  >
                    <ToolSymbol symbol="↩" />
                  </button>
                  <MenuSelect
                    className="select-like compact"
                    label="Orientation"
                    data-tip={t('dlgFcOrientation')}
                    display={<ToolSymbol symbol="⤴" />}
                    options={[
                      {
                        value: '45',
                        label: t('appAngleCcw'),
                        icon: <TextDirGlyph deg={-45} ch="ab" />,
                      },
                      {
                        value: '-45',
                        label: t('appAngleCw'),
                        icon: <TextDirGlyph deg={45} ch="ab" />,
                      },
                      {
                        value: 'vertical',
                        label: t('appVerticalText'),
                        icon: <TextDirGlyph deg={90} ch="ab" />,
                      },
                      {
                        value: '90',
                        label: t('appRotateUp'),
                        icon: <TextDirGlyph deg={180} ch="ab" />,
                      },
                      {
                        value: '-90',
                        label: t('appRotateDown'),
                        icon: <TextDirGlyph deg={0} ch="ab" />,
                      },
                      {
                        value: '0',
                        label: t('appClearRotation'),
                        icon: <TextDirGlyph deg={0} ch="↺" />,
                      },
                    ]}
                    onPick={(value) => onCommand(`rotate:${value}`)}
                  />
                </div>
                <div className="inline-tools alignment-tools">
                  <button
                    data-tip={t('appAlignLeft')}
                    aria-label={t('appAlignLeft')}
                    onClick={() => onCommand('align:left')}
                  >
                    <ToolSymbol symbol="≡" />
                  </button>
                  <button
                    data-tip={t('appAlignCenter')}
                    aria-label={t('appAlignCenter')}
                    onClick={() => onCommand('align:center')}
                  >
                    <ToolSymbol symbol="≣" />
                  </button>
                  <button
                    data-tip={t('appAlignRight')}
                    aria-label={t('appAlignRight')}
                    onClick={() => onCommand('align:right')}
                  >
                    <ToolSymbol symbol="☰" />
                  </button>
                  <MenuSelect
                    className="select-like compact"
                    label="Merge cells"
                    data-tip={t('appMergeCells')}
                    display={
                      <>
                        <ToolSymbol symbol="⇔" /> {t('appMerge')}
                      </>
                    }
                    options={[
                      {
                        value: 'center',
                        label: t('appMergeCenter'),
                        icon: <MergeGlyph mode="center" />,
                      },
                      {
                        value: 'across',
                        label: t('appMergeAcross'),
                        icon: <MergeGlyph mode="across" />,
                      },
                      {
                        value: 'cells',
                        label: t('appMergeCells'),
                        icon: <MergeGlyph mode="cells" />,
                      },
                      {
                        value: 'unmerge',
                        label: t('appUnmergeCells'),
                        icon: <MergeGlyph mode="none" />,
                      },
                    ]}
                    onPick={(value) => onCommand(`merge:${value}`)}
                  />
                </div>
              </div>
            </RibbonGroup>
            <RibbonGroup
              label={t('appGroupNumber')}
              launcher={{
                tip: `${t('appFormatCells')} · ${t('dlgFcTabNumber')}`,
                onClick: () => onCommand('format-cells:Number'),
              }}
            >
              {/* WPS 数字组布局（CT_Home.kuip RB_Number）：行1=格式框+转换⌄，
            行2=货币/会计⌄ % 千分位 增小数 减小数 快捷图标，紧凑无缝 */}
              <div className="ribbon-rows num-compact">
                <div className="num-row1">
                  <NumberFormatSelect
                    pattern={selectionFormat?.numberFormat ?? ''}
                    onCommand={onCommand}
                  />
                  <ConvertMenuSelect data-tip={t('appConvertMenu')} onCommand={onCommand} />
                </div>
                <div className="inline-tools num-quick">
                  <MenuSelect
                    className="select-like compact icon-only"
                    label="Accounting"
                    data-tip={t('appCurrency')}
                    display={
                      <>
                        <ToolSymbol symbol="💰" />
                      </>
                    }
                    options={[
                      {
                        value: 'format:$#,##0.00',
                        label: t('appCurrency'),
                        icon: <OptSample>$</OptSample>,
                      },
                      {
                        value: 'format:"¥"#,##0.00',
                        label: t('appRmbAccounting'),
                        icon: <OptSample>¥</OptSample>,
                      },
                    ]}
                    onPick={(value) => onCommand(value)}
                  />
                  <button
                    data-tip={t('appPercentTitle')}
                    aria-label={t('appPercentTitle')}
                    onClick={() => onCommand('format:0.00%')}
                  >
                    %
                  </button>
                  <button
                    data-tip={t('appThousands')}
                    aria-label={t('appThousands')}
                    onClick={() => onCommand('format:#,##0')}
                  >
                    ,
                  </button>
                  <button
                    data-tip={t('appIncreaseDecimal')}
                    aria-label={t('appIncreaseDecimal')}
                    onClick={() => onCommand('decimal-inc')}
                  >
                    .0+
                  </button>
                  <button
                    data-tip={t('appDecreaseDecimal')}
                    aria-label={t('appDecreaseDecimal')}
                    onClick={() => onCommand('decimal-dec')}
                  >
                    .0−
                  </button>
                </div>
              </div>
            </RibbonGroup>
            {/* WPS 开始 tab #33-34：行和列⌄（上）+ 工作表⌄（下），纵向无边框图标钮 */}
            <RibbonGroup label={t('appRowcolMenu')}>
              <div className="rowcol-stack">
                <RowcolMenu onCommand={onCommand} />
                <SheetMenu onCommand={onCommand} />
              </div>
            </RibbonGroup>
            <RibbonGroup label={t('appGroupStyles')}>
              {/* WPS 样式组布局（CT_Home.kuip RB_ConditionalFormatting）：条件格式
            大钮在左，表格样式（上）+ 单元格样式（下）纵排，数据透视表殿后 */}
              <div className="style-wps-row">
                <div
                  className="ribbon-tool large as-button"
                  data-tip={t('appConditionalFormatting')}
                >
                  <span className="tool-icon-row">
                    <ToolSymbol symbol="▤" />
                  </span>
                  <span>
                    <strong>{t('appConditionalFormatting')}</strong>
                    <CaretIcon />
                  </span>
                  <CondFormatSelect
                    label={t('appConditionalFormatting')}
                    data-tip={t('appConditionalFormatting')}
                    onCommand={onCommand}
                  />
                </div>
                <div className="style-wps-stack">
                  <div
                    className="ribbon-tool large as-button"
                    data-tip={t('appFormatAsTableTitle')}
                  >
                    <span className="tool-icon-row">
                      <ToolSymbol symbol="▦" />
                    </span>
                    <span>
                      <strong>{t('appTableStyleMenu')}</strong>
                    </span>
                    <CaretIcon />
                    <TableStyleGallerySelect
                      label={t('appTableStyleMenu')}
                      data-tip={t('appFormatAsTableTitle')}
                      onPick={(value) => onCommand(`format-as-table:${value}`)}
                      onCommand={onCommand}
                    />
                  </div>
                  <div className="ribbon-tool large as-button" data-tip={t('appCellStylesTitle')}>
                    <span className="tool-icon-row">
                      <ToolSymbol symbol="🎨" />
                    </span>
                    <span>
                      <strong>{t('appCellStyles')}</strong>
                    </span>
                    <CaretIcon />
                    <CellStyleSelect
                      label={t('appCellStyles')}
                      data-tip={t('appCellStylesTitle')}
                      onPick={(value) => onCommand(`cell-style:${value}`)}
                      onCommand={onCommand}
                    />
                  </div>
                </div>
                <button
                  className="ribbon-tool large as-button"
                  data-tip={t('appRefreshHintIn')}
                  onClick={() => onRefreshPivot()}
                >
                  <span className="tool-icon-row">
                    <ToolSymbol symbol="▩" />
                  </span>
                  <span>
                    <strong>{t('appPivotTable')}</strong>
                  </span>
                </button>
              </div>
            </RibbonGroup>
            <RibbonGroup label={t('appGroupDataProcess')}>
              {/* WPS 数据处理组（对比清单 6-11）：填充/求和/排序/筛选/冻结/查找
            六枚上下结构大钮 + 清除（保留原有清除功能，复用同款大钮） */}
              <div className="process-big-row">
                {processMenus.map((menu) => (
                  <RibbonMenuButton
                    key={menu.key}
                    variant="big"
                    label={menu.label}
                    tip={menu.tip}
                    symbol={menu.symbol}
                    options={menu.options}
                    onPick={onCommand}
                  />
                ))}
              </div>
            </RibbonGroup>
          </BandCollectorContext.Provider>
        </GroupSlotContext.Provider>
      </RibbonGroupLevelsContext.Provider>
    </div>
  )
}

/// ── WPS-style option-row icons (linear SVG thumbnails drawn to the same
/// standard as ribbon-icons.tsx; options without a natural glyph reuse
/// ToolSymbol keys so button and menu rows stay visually one family) ──

const OPT_SVG = 20
function OptSvg({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width={OPT_SVG}
      height={OPT_SVG}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** 边框 menu: 3×3 grid with the chosen edges painted 1.4 units (thin,
    matching the globally lightened icon strokes). */
function BorderGlyph({
  on,
}: {
  on: 'all' | 'outer' | 'thick' | 'top' | 'bottom' | 'left' | 'right' | 'none'
}) {
  const w = on === 'thick' ? 1.8 : 1.4
  const thickFrame = on === 'all' || on === 'outer' || on === 'thick'
  return (
    <OptSvg>
      <rect x="2.5" y="2.5" width="15" height="15" opacity={thickFrame ? 0 : 0.5} />
      <path
        d="M2.5 7.5 h15 M2.5 12.5 h15 M7.5 2.5 v15 M12.5 2.5 v15"
        opacity="0.35"
        strokeWidth="0.8"
      />
      {thickFrame && <rect x="2.5" y="2.5" width="15" height="15" strokeWidth={w} />}
      {on === 'all' && (
        <path
          d="M2.5 7.5 h15 M2.5 12.5 h15 M7.5 2.5 v15 M12.5 2.5 v15"
          strokeWidth={w}
          opacity="0.8"
        />
      )}
      {on === 'top' && <path d="M2.5 3 h15" strokeWidth={w} />}
      {on === 'bottom' && <path d="M2.5 17 h15" strokeWidth={w} />}
      {on === 'left' && <path d="M3 2.5 v15" strokeWidth={w} />}
      {on === 'right' && <path d="M17 2.5 v15" strokeWidth={w} />}
    </OptSvg>
  )
}

/** 纸张方向 menu: portrait / landscape frames. */
function OrientationGlyph({ landscape }: { landscape: boolean }) {
  return landscape ? (
    <OptSvg>
      <rect x="2.5" y="5.5" width="15" height="9" />
    </OptSvg>
  ) : (
    <OptSvg>
      <rect x="5.5" y="2.5" width="9" height="15" />
    </OptSvg>
  )
}

/** 文字方向 menu: rotated glyph on a cell frame. */
function TextDirGlyph({ deg, ch }: { deg: number; ch: string }) {
  return (
    <OptSvg>
      <rect x="2.5" y="2.5" width="15" height="15" opacity="0.45" />
      <text
        x="10"
        y="13.5"
        textAnchor="middle"
        fontSize="8.5"
        fontWeight="600"
        stroke="none"
        fill="currentColor"
        transform={deg ? `rotate(${deg} 10 10)` : undefined}
      >
        {ch}
      </text>
    </OptSvg>
  )
}

/** 合并 menu: 2×2 with the merge shape emphasized. */
function MergeGlyph({ mode }: { mode: 'center' | 'across' | 'cells' | 'none' }) {
  return (
    <OptSvg>
      <rect x="2.5" y="2.5" width="15" height="15" opacity="0.5" />
      {mode === 'center' && <rect x="3.6" y="3.6" width="12.8" height="12.8" strokeWidth="1.5" />}
      {mode === 'across' && <path d="M3.6 3.6 h12.8 M3.6 16.4 h12.8" strokeWidth="1.5" />}
      {mode === 'cells' && (
        <>
          <rect x="3.6" y="3.6" width="12.8" height="5.6" strokeWidth="1.5" />
          <rect x="3.6" y="10.8" width="12.8" height="5.6" strokeWidth="1.5" />
        </>
      )}
      {mode === 'none' && (
        <path
          d="M2.5 7 h15 M2.5 13 h15 M2.5 2.5 v15 M10 2.5 v15"
          strokeWidth="1"
          opacity="0.5"
          strokeDasharray="2 1.6"
        />
      )}
      {mode !== 'none' && (
        <path d="M2.5 7 h15 M2.5 13 h15 M2.5 2.5 v15 M10 2.5 v15" strokeWidth="1" opacity="0.5" />
      )}
    </OptSvg>
  )
}

/** 冻结窗格 menu: bold cross / top band / left band / plain. */
function FreezeGlyph({ mode }: { mode: 'cross' | 'row' | 'col' | 'none' }) {
  return (
    <OptSvg>
      <rect x="2.5" y="2.5" width="15" height="15" opacity="0.5" />
      <path d="M2.5 7 h15 M2.5 12.5 h15 M7 2.5 v15 M12.5 2.5 v15" strokeWidth="1" opacity="0.45" />
      {mode === 'cross' && <path d="M2.5 7 h15 M7 2.5 v15" strokeWidth="1.6" />}
      {mode === 'row' && <path d="M2.5 4.7 h15" strokeWidth="1.7" />}
      {mode === 'col' && <path d="M4.7 2.5 v15" strokeWidth="1.7" />}
    </OptSvg>
  )
}

/** 页边距 menu: page frame + inset margins by preset. */
function MarginGlyph({ preset }: { preset: 'normal' | 'narrow' | 'wide' }) {
  const m = preset === 'narrow' ? 1.5 : preset === 'wide' ? 6 : 3.5
  return (
    <OptSvg>
      <rect x="2.5" y="2.5" width="15" height="15" opacity="0.5" />
      <rect
        x={2.5 + m}
        y={2.5 + m}
        width={15 - m * 2}
        height={15 - m * 2}
        strokeDasharray="2 1.5"
      />
    </OptSvg>
  )
}

/** 排序 menu: arrow + level bars. */
function SortGlyph({ asc }: { asc: boolean }) {
  return (
    <OptSvg>
      <path
        d={asc ? 'M10 16.5 V4 M6.4 7.6 L10 4 l3.6 3.6' : 'M10 3.5 V16 M6.4 12.4 L10 16 l3.6 -3.6'}
      />
      <path d="M3.5 6 h4 M3.5 10 h6 M3.5 14 h4" opacity="0.55" />
    </OptSvg>
  )
}

/** 迷你图 menu: line / column / win-loss minis. */
function SparkGlyph({ mode }: { mode: 'line' | 'column' | 'loss' }) {
  return (
    <OptSvg>
      {mode === 'line' && <path d="M2.5 13 L6.5 8 L10 11 L13.5 5 L17.5 7.5" />}
      {mode === 'column' && <path d="M4 16 V9 M9 16 V4 M14 16 V7" strokeWidth="2" />}
      {mode === 'loss' && <path d="M4 9.5 v4 M9 13.5 v-7 M14 8 v4" strokeWidth="2" />}
    </OptSvg>
  )
}

/** 行高/列宽 menu: cell frame with the measured edge emphasized. */
function RowColGlyph({ row }: { row: boolean }) {
  return (
    <OptSvg>
      <rect x="2.5" y="2.5" width="15" height="15" opacity="0.5" />
      <path d="M2.5 7 h15 M2.5 13 h15 M7 2.5 v15 M12.5 2.5 v15" strokeWidth="1" opacity="0.45" />
      {row ? (
        <>
          <path d="M2.5 5 h15" strokeWidth="2" />
          <path d="M8 5 v-2.2 M12 5 v2.2" strokeWidth="1" />
        </>
      ) : (
        <>
          <path d="M5 2.5 v15" strokeWidth="2" />
          <path d="M5 8 h-2.2 M5 12 h2.2" strokeWidth="1" />
        </>
      )}
    </OptSvg>
  )
}

/** 打印标题 menu: header row highlighted. */
function TitleRowGlyph() {
  return (
    <OptSvg>
      <rect x="2.5" y="3" width="15" height="14" opacity="0.5" />
      <path
        d="M2.5 7 h15 M2.5 11 h15 M2.5 15 h15 M8 3 v14 M13.5 3 v14"
        strokeWidth="1"
        opacity="0.45"
      />
      <path d="M2.5 5 h15" strokeWidth="2.2" />
    </OptSvg>
  )
}

/** 分隔符 menu: page split at a dashed line. */
function PageBreakGlyph() {
  return (
    <OptSvg>
      <path d="M2.5 10 h15" strokeDasharray="2.6 2" strokeWidth="1.8" />
      <path d="M5 5.5 h6 M9 14.5 h6" opacity="0.55" />
    </OptSvg>
  )
}

/** 打印区域 menu: dashed selection frame. */
function PrintAreaGlyph() {
  return (
    <OptSvg>
      <rect x="3" y="3" width="14" height="14" strokeDasharray="3 2" />
      <path d="M6.5 7 h7 M6.5 10 h4.5" opacity="0.6" />
    </OptSvg>
  )
}

/** 快速布局 menu: mini chart layouts 1-4 (plot + title/legend boxes). */
function LayoutThumb({ n }: { n: 1 | 2 | 3 | 4 }) {
  return (
    <OptSvg>
      <rect x="2.5" y="2.5" width="15" height="15" opacity="0.5" />
      {n === 1 && (
        <>
          <path d="M2.5 6 h15" strokeWidth="1.8" />
          <path d="M5.5 15.5 L9 10.5 L12.5 13 L15.5 7.5" />
        </>
      )}
      {n === 2 && (
        <>
          <rect x="4" y="4" width="5.5" height="3" strokeWidth="1.6" />
          <path d="M4.5 16 L8 11.5 L11 13.5 L15 8.5" />
        </>
      )}
      {n === 3 && (
        <>
          <path d="M5.5 16 V8 M10 16 V5.5 M14.5 16 V10" strokeWidth="2" />
          <path d="M2.5 5.5 h15" strokeWidth="1.6" />
        </>
      )}
      {n === 4 && (
        <>
          <rect x="12.5" y="4" width="4" height="3" strokeWidth="1.4" />
          <path d="M5.5 16 V9 M9.5 16 V6.5" strokeWidth="2" />
        </>
      )}
    </OptSvg>
  )
}

/** 组合/取消组合 menu: bracket rows. */
function GroupGlyph({ open }: { open: boolean }) {
  const brackets = open
    ? 'M6.5 4 h-3 v12 h3 M13.5 4 h3 v12 h-3'
    : 'M3.5 4 h3 v12 h-3 M13.5 4 h3 v12 h-3'
  return (
    <OptSvg>
      <path d={brackets} />
      <path d="M8.5 7.5 h3 M8.5 10.5 h3 M8.5 13.5 h3" opacity="0.6" />
    </OptSvg>
  )
}

/** 缩放适配 menu: horizontal/vertical double arrow. */
function FitGlyph({ vertical }: { vertical?: boolean }) {
  return vertical ? (
    <OptSvg>
      <path d="M10 3 v14 M7 6 L10 3 l3 3 M7 14 L10 17 l3 -3" />
    </OptSvg>
  ) : (
    <OptSvg>
      <path d="M3 10 h14 M6 7 L3 10 l3 3 M14 7 L17 10 l-3 3" />
    </OptSvg>
  )
}

/** 纯文字样例图标（数字格式/字体方案/自动求和等：直接展示样例文本） */
export function OptSample({ children }: { children: React.ReactNode }) {
  return (
    <span className="menu-opt-sample" aria-hidden="true">
      {children}
    </span>
  )
}

/// small round color chip for tab-color menu rows
/** 配色方案行：一排色点（图表颜色/主题等菜单） */
function OptDots({ colors }: { colors: readonly string[] }) {
  return (
    <span className="menu-opt-dots" aria-hidden="true">
      {colors.map((c) => (
        <i key={c} style={{ background: `#${c}` }} />
      ))}
    </span>
  )
}

/** 主题方案行：色点串 + 字体名（WPS 主题缩略：色带 + 标题/正文字体） */
function ThemeDots({ colors, font }: { colors: readonly string[]; font?: string }) {
  return (
    <span className="menu-opt-theme" aria-hidden="true">
      <span className="menu-opt-dots">
        {colors.slice(4, 10).map((c, i) => (
          <i key={i} style={{ background: c.startsWith('#') ? c : `#${c}` }} />
        ))}
      </span>
      {font && <span className="menu-opt-font">{font}</span>}
    </span>
  )
}

/** 纸张大小行：比例正确的纸张缩略 + 名称 */
function PaperGlyph({ w, h }: { w: number; h: number }) {
  const ratio = h / w
  const bw = 10
  const bh = Math.min(16, bw * ratio)
  return (
    <span className="menu-opt-paper" aria-hidden="true">
      <svg
        width={20}
        height={20}
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        aria-hidden="true"
      >
        <rect x={10 - bw / 2} y={10 - bh / 2} width={bw} height={bh} rx="0.8" />
        <path d={`M${10 - bw / 2 + 2.5} ${10 - bh / 2 + 3.5} h${bw - 5}`} opacity="0.5" />
        <path d={`M${10 - bw / 2 + 2.5} ${10 - bh / 2 + 6.5} h${bw - 5}`} opacity="0.35" />
      </svg>
    </span>
  )
}

/** 缩放档位：放大镜 + 百分比 */
function ZoomGlyph({ pct }: { pct: number }) {
  return (
    <span className="menu-opt-sample" aria-hidden="true">
      {pct}%
    </span>
  )
}

/** 语言行：目标语言自名字样（WPS 用旗帜, 文字更中性） */
function LangSample({ code }: { code: string }) {
  return <OptSample>{code}</OptSample>
}

/** WPS-style colored chart thumbnails (插入·图表网格 + 透视图表菜单共用). */
const CHART_COLORS = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000']
function ChartThumb({ kind, size = 22 }: { kind: string; size?: number }) {
  const c = CHART_COLORS
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': true as const,
  }
  switch (kind) {
    case 'column':
      return (
        <svg {...common}>
          <rect x="3" y="12" width="4.4" height="9" rx="0.6" fill={c[0]} />
          <rect x="9.8" y="6" width="4.4" height="15" rx="0.6" fill={c[1]} />
          <rect x="16.6" y="9" width="4.4" height="12" rx="0.6" fill={c[2]} />
        </svg>
      )
    case 'bar':
      return (
        <svg {...common}>
          <rect x="3" y="3.4" width="9" height="4.4" rx="0.6" fill={c[0]} />
          <rect x="3" y="10.2" width="15" height="4.4" rx="0.6" fill={c[1]} />
          <rect x="3" y="17" width="11" height="4.4" rx="0.6" fill={c[2]} />
        </svg>
      )
    case 'line':
      return (
        <svg {...common}>
          <path
            d="M3 17.5 9 10.5 14 14 21 5.5"
            stroke={c[0]}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <circle cx="9" cy="10.5" r="1.4" fill={c[1]} />
          <circle cx="14" cy="14" r="1.4" fill={c[1]} />
          <circle cx="21" cy="5.5" r="1.4" fill={c[1]} />
        </svg>
      )
    case 'area':
      return (
        <svg {...common}>
          <path d="M3 17.5 9 10.5 14 14 21 5.5 V21 H3 Z" fill={c[0]} opacity="0.45" />
          <path
            d="M3 17.5 9 10.5 14 14 21 5.5"
            stroke={c[0]}
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'pie':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" fill={c[0]} />
          <path d="M12 12 L12 3 A9 9 0 0 1 20.8 15.5 Z" fill={c[1]} />
          <path d="M12 12 L20.8 15.5 A9 9 0 0 1 8 20.6 Z" fill={c[2]} />
        </svg>
      )
    case 'doughnut':
      return (
        <svg {...common}>
          <circle
            cx="12"
            cy="12"
            r="8.6"
            stroke={c[0]}
            strokeWidth="4.6"
            fill="none"
            strokeDasharray="54 54"
            transform="rotate(-90 12 12)"
          />
          <circle
            cx="12"
            cy="12"
            r="8.6"
            stroke={c[1]}
            strokeWidth="4.6"
            fill="none"
            strokeDasharray="27 54"
            strokeDashoffset="-54"
            transform="rotate(-90 12 12)"
          />
          <circle
            cx="12"
            cy="12"
            r="8.6"
            stroke={c[2]}
            strokeWidth="4.6"
            fill="none"
            strokeDasharray="27 54"
            strokeDashoffset="-81"
            transform="rotate(-90 12 12)"
          />
        </svg>
      )
    case 'scatter':
      return (
        <svg {...common}>
          <circle cx="5.5" cy="17.5" r="1.7" fill={c[0]} />
          <circle cx="9.5" cy="7.5" r="1.7" fill={c[1]} />
          <circle cx="13" cy="13.5" r="1.7" fill={c[0]} />
          <circle cx="17.5" cy="9" r="1.7" fill={c[2]} />
          <circle cx="20.5" cy="16.5" r="1.7" fill={c[1]} />
        </svg>
      )
    case 'radar':
      return (
        <svg {...common}>
          <path
            d="M12 3.5 19.5 9 17 19H7L4.5 9 Z"
            stroke={c[0]}
            strokeWidth="1.6"
            fill={c[0]}
            fillOpacity="0.18"
          />
          <path
            d="M12 3.5 12 19 M12 3.5 4.5 9 M12 3.5 19.5 9 M7 19 4.5 9 M17 19 19.5 9 M7 19 17 19"
            stroke={c[1]}
            strokeWidth="0.9"
          />
        </svg>
      )
    case 'combo':
      return (
        <svg {...common}>
          <rect x="3.5" y="12" width="4" height="8.5" rx="0.6" fill={c[0]} />
          <rect x="10" y="8" width="4" height="12.5" rx="0.6" fill={c[1]} />
          <rect x="16.5" y="14" width="4" height="6.5" rx="0.6" fill={c[2]} />
          <path
            d="M4 9 10.5 5.5 17.5 11 21 7.5"
            stroke={c[3]}
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      )
    default:
      return <OptSample>▮</OptSample>
  }
}

/** 数字格式类别的实例预览（WPS：¥1,230 / 2024/1/1 / 15%…） */
const NUMFMT_SAMPLES: Record<string, string> = {
  General: '1234.5',
  Number: '1,234.50',
  Currency: '¥1,234.50',
  Accounting: '¥ 1,234.50',
  'Short Date': '2024/6/1',
  'Long Date': 'Saturday, June 1, 2024',
  Time: '1:23:45 PM',
  Percentage: '15.00%',
  Fraction: '1 2/5',
  Scientific: '1.23E+03',
  Text: '1234.5',
}

/// Escape-to-close for the ribbon dropdowns; outside-press / blur / shell
/// chrome-press dismissal lives in the shared useDismissablePopover.
function useEscapeClose(open: boolean, close: () => void): void {
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
}

/// One dropdown option row. `disabled` rows stay visible (WPS parity) but
/// don't dispatch; `tip` explains why. `children` turns the row into a
/// hover submenu host (WPS 插入单元格/删除单元格/隐藏与取消隐藏 pattern).
/// Exported for ConvertMenuSelect (数字组的转换⌄ 富菜单复用同一渲染)。
export interface MenuRowOption {
  readonly value: string
  readonly label: string
  readonly icon?: React.ReactNode
  readonly disabled?: boolean
  readonly tip?: string
  readonly children?: readonly MenuRowOption[]
  /// 渲染为行上方的分组细线（录入当前日期的宽/窄格式分组）
  readonly sep?: boolean
}

/// Shared dropdown body: icon + label rows with the current-value highlight
/// (used by MenuSelect, the split paste/copy buttons and the border menu).
/// Rows carrying `children` render a hover-expanded submenu instead of
/// dispatching themselves. Submenu visibility is JS-state driven
/// (mouseenter/leave on the host row) — pure CSS :hover proved fragile, and
/// the submenu must escape the parent panel's overflow clip (it renders in a
/// portal-free absolute layer; parents along the chain stay overflow-visible).
export function MenuRows({
  options,
  value = '',
  onPick,
  onClose,
}: {
  readonly options: readonly MenuRowOption[]
  readonly value?: string
  readonly onPick: (value: string) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const [openSub, setOpenSub] = useState<string | null>(null)
  return (
    <>
      {options.map((option) =>
        option.children ? (
          <div
            key={option.value}
            className={`submenu-host${openSub === option.value ? ' submenu-open' : ''}`}
            onMouseEnter={() => setOpenSub(option.value)}
            onMouseLeave={() =>
              setOpenSub((current) => (current === option.value ? null : current))
            }
          >
            <button type="button" role="option" aria-haspopup="true" className="has-submenu">
              {option.icon != null && (
                <span className="menu-opt-icon" aria-hidden="true">
                  {option.icon}
                </span>
              )}
              <span className="menu-opt-text">{option.label}</span>
              <span className="submenu-arrow" aria-hidden="true">
                ›
              </span>
            </button>
            {openSub === option.value && (
              <div className="submenu-drop" role="menu" aria-label={option.label}>
                <MenuRows
                  options={option.children}
                  value={value}
                  onPick={onPick}
                  onClose={onClose}
                />
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            key={option.value}
            role="option"
            aria-selected={value !== '' && option.value === value}
            aria-disabled={option.disabled || undefined}
            className={`${value !== '' && option.value === value ? 'on' : ''}${
              option.sep ? ' sep-above' : ''
            }`}
            title={option.tip}
            disabled={option.disabled}
            onClick={() => {
              onClose()
              onPick(option.value)
            }}
          >
            {option.icon != null && (
              <span className="menu-opt-icon" aria-hidden="true">
                {option.icon}
              </span>
            )}
            <span className="menu-opt-text">{option.label}</span>
          </button>
        ),
      )}
    </>
  )
}

/// 子菜单里的数量插入行：在上方插入行 [3] ✓ —— input 默认 1，点对号执行。
function InsertCountRow({
  label,
  icon,
  commandPrefix,
  onCommand,
  onClose,
}: {
  readonly label: string
  readonly icon: React.ReactNode
  readonly commandPrefix: string
  readonly onCommand: (command: string) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [count, setCount] = useState('1')
  const parsed = Number(count)
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 500
  return (
    <div className="insert-count-row">
      <span className="menu-opt-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="menu-opt-text">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={count}
        aria-label={`${label} ${t('dlgRowCount')}`}
        onChange={(event) => setCount(event.target.value.replace(/[^\d]/g, ''))}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && valid) {
            onClose()
            onCommand(`${commandPrefix}:${parsed}`)
          }
        }}
      />
      <button
        type="button"
        className="insert-count-ok"
        aria-label={t('appOk')}
        disabled={!valid}
        onClick={() => {
          onClose()
          onCommand(`${commandPrefix}:${parsed}`)
        }}
      >
        ✓
      </button>
    </div>
  )
}

/// Big split tool (WPS 粘贴): the body runs the default command, the corner
/// caret opens the variant menu — one visual shell over two hit targets.
function SplitMenuTool({
  symbol,
  label,
  tip,
  options,
  onMain,
  onPick,
}: {
  readonly symbol: string
  readonly label: string
  readonly tip: string
  readonly options: readonly MenuRowOption[]
  readonly onMain: () => void
  readonly onPick: (value: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })
  useEscapeClose(open, () => setOpen(false))
  return (
    <div ref={wrapRef} className="ribbon-tool large split-menu" data-tip={tip}>
      <button
        type="button"
        className="split-main"
        aria-label={label}
        onClick={() => {
          setOpen(false)
          onMain()
        }}
      >
        <span className="tool-icon-row">
          <ToolSymbol symbol={symbol} />
        </span>
        <span>
          <strong>{label}</strong>
        </span>
      </button>
      <button
        type="button"
        className="split-caret"
        aria-label={`${label} ▾`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <CaretIcon />
      </button>
      {open && (
        <div className="menu-select-drop" role="listbox" aria-label={label}>
          <MenuRows options={options} onPick={onPick} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

/// Small split tool inside an .inline-tools row (WPS 下划线/复制): icon button
/// with a tiny corner caret for the variant menu.
function SplitStackTool({
  symbol,
  tip,
  active,
  options,
  onMain,
  onPick,
}: {
  readonly symbol: string
  readonly tip: string
  readonly active?: boolean
  readonly options: readonly MenuRowOption[]
  readonly onMain: () => void
  readonly onPick: (value: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })
  useEscapeClose(open, () => setOpen(false))
  return (
    <div ref={wrapRef} className={`split-stack${active ? ' is-active' : ''}`}>
      <button
        type="button"
        className={active ? 'is-active' : ''}
        data-tip={tip}
        aria-label={tip}
        onClick={() => {
          setOpen(false)
          onMain()
        }}
      >
        <ToolSymbol symbol={symbol} />
      </button>
      <button
        type="button"
        className="split-caret"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <CaretIcon />
      </button>
      {open && (
        <div className="menu-select-drop" role="listbox" aria-label={tip}>
          <MenuRows options={options} onPick={onPick} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

/// 线条样式行 sample: a short ruled line per ST_BorderStyle name.
function LineStyleGlyph({ style }: { readonly style: string }): React.JSX.Element {
  if (style === 'double') {
    return (
      <OptSvg>
        <path d="M4 9.75h12M4 14.25h12" strokeWidth="1.3" />
      </OptSvg>
    )
  }
  const width = style === 'thick' ? 3.4 : style === 'medium' ? 2.2 : style === 'hair' ? 0.7 : 1.2
  const dash = style === 'dashed' ? '4.5 3' : style === 'dotted' ? '0.2 3.4' : undefined
  return (
    <OptSvg>
      <path
        d="M4 10h12"
        strokeWidth={width}
        strokeDasharray={dash}
        strokeLinecap={style === 'dotted' ? 'round' : undefined}
      />
    </OptSvg>
  )
}

/// 边框富菜单（对比清单 8-9）：边框 + 绘图边框两组十五项，无滚动条；
/// 线条颜色在菜单内展开调色板，线条样式展开线型行；独立边框颜色按钮取消。
const BORDER_PEN_STYLES = ['thin', 'medium', 'thick', 'double', 'hair', 'dashed', 'dotted'] as const
/// 工作表⌄（WPS 对齐 B3 第四轮）：16 项全覆盖——插删/副本/移动或复制/重命名/
/// 保护/标签颜色(菜单内调色板)/字号(子菜单)/隐藏取消隐藏/合并/拆分/目录/
/// 排序(子菜单)/删空白表/批量改名。
function SheetMenu({
  onCommand,
}: {
  readonly onCommand: (command: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [fontSubOpen, setFontSubOpen] = useState(false)
  const [sortSubOpen, setSortSubOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })
  useEscapeClose(open, () => setOpen(false))
  const pick = (command: string): void => {
    setOpen(false)
    onCommand(command)
  }
  const row = (value: string, label: string): MenuRowOption => ({ value, label })
  const fontSizes = [12, 14, 16, 18]
  return (
    <div ref={wrapRef} className="menu-select sheet-menu">
      <button
        type="button"
        className="select-like compact rowcol-item"
        data-tip={t('appSheetMenu')}
        aria-label={t('appSheetMenu')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="menu-select-value">
          <ToolSymbol symbol="▤" /> {t('appSheetMenu')}
        </span>
        <CaretIcon />
      </button>
      {open && (
        <div
          className="menu-select-drop sheet-menu-drop"
          role="listbox"
          aria-label={t('appSheetMenu')}
        >
          <MenuRows
            options={[
              row('insert-sheet', t('appSheetInsertSheet')),
              row('sheetop:remove', t('appSheetDeleteSheet')),
              row('sheetop:duplicate', t('appSheetCreateCopy')),
              row('move-copy-dialog-open', t('appSheetMoveOrCopy')),
              row('sheetop:rename', t('appSheetRename')),
              row('sheet-protect', t('appProtectSheet')),
            ]}
            value=""
            onPick={pick}
            onClose={() => setOpen(false)}
          />
          <div className="rb-menu-sep" />
          {/* 工作表标签颜色：行 hover 在菜单底部展开调色板（同边框菜单模式） */}
          <div
            className={`submenu-host${paletteOpen ? ' submenu-open' : ''}`}
            onMouseEnter={() => setPaletteOpen(true)}
            onMouseLeave={() => setPaletteOpen(false)}
          >
            <button type="button" role="option" aria-haspopup="true" className="has-submenu">
              <span className="menu-opt-icon" aria-hidden="true">
                <i className="menu-color-dot" style={{ background: '#C00000' }} />
              </span>
              <span className="menu-opt-text">{t('appSheetTabColor')}</span>
              <span className="submenu-arrow" aria-hidden="true">
                ›
              </span>
            </button>
            {paletteOpen && (
              <div className="submenu-drop" role="menu">
                <ColorPicker
                  className="sheet-menu-palette"
                  value="#C00000"
                  strings={{
                    themeColors: t('appThemeColors'),
                    standardColors: t('appStandardColors'),
                    moreColors: t('appMoreColors'),
                  }}
                  onPick={(hex) => {
                    setPaletteOpen(false)
                    pick(
                      hex
                        ? `sheetop:tab-color:${hex.slice(1).toUpperCase()}`
                        : 'sheetop:tab-color:none',
                    )
                  }}
                />
              </div>
            )}
          </div>
          {/* 字号子菜单（JS 状态驱动，同 MenuRows 子菜单行为） */}
          <div
            className={`submenu-host${fontSubOpen ? ' submenu-open' : ''}`}
            onMouseEnter={() => setFontSubOpen(true)}
            onMouseLeave={() => setFontSubOpen(false)}
          >
            <button type="button" role="option" aria-haspopup="true" className="has-submenu">
              <span className="menu-opt-text">{t('appSheetTabFont')}</span>
              <span className="submenu-arrow" aria-hidden="true">
                ›
              </span>
            </button>
            {fontSubOpen && (
              <div className="submenu-drop" role="menu">
                {fontSizes.map((px) => (
                  <button
                    type="button"
                    key={px}
                    role="option"
                    onClick={() => pick(`sheetop:tab-font-size:${px}`)}
                  >
                    <span className="menu-opt-text">{px}px</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="rb-menu-sep" />
          <MenuRows
            options={[
              row('sheetop:hide', `${t('appSheetHide')}(H)`),
              row('sheetop:unhide', t('appSheetUnhide')),
              row('merge-workbooks', t('appSheetMerge')),
              row('sheetop:split', t('appSheetSplit')),
              row('sheetop:toc', t('appSheetTocName')),
            ]}
            value=""
            onPick={pick}
            onClose={() => setOpen(false)}
          />
          {/* 工作表排序子菜单 */}
          <div
            className={`submenu-host${sortSubOpen ? ' submenu-open' : ''}`}
            onMouseEnter={() => setSortSubOpen(true)}
            onMouseLeave={() => setSortSubOpen(false)}
          >
            <button type="button" role="option" aria-haspopup="true" className="has-submenu">
              <span className="menu-opt-text">{t('appSheetSort')}</span>
              <span className="submenu-arrow" aria-hidden="true">
                ›
              </span>
            </button>
            {sortSubOpen && (
              <div className="submenu-drop" role="menu">
                <button type="button" role="option" onClick={() => pick('sheetop:sort-asc')}>
                  <span className="menu-opt-text">{t('appSheetSortAsc')}</span>
                </button>
                <button type="button" role="option" onClick={() => pick('sheetop:sort-desc')}>
                  <span className="menu-opt-text">{t('appSheetSortDesc')}</span>
                </button>
              </div>
            )}
          </div>
          <MenuRows
            options={[
              row('sheetop:delete-empty', t('appSheetDeleteEmpty')),
              row('batch-rename-dialog-open', `${t('appSheetBatchRename')}…`),
            ]}
            value=""
            onPick={pick}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  )
}

/// 行和列⌄（WPS 对齐 B2 第三轮）：五项 + 三个悬停子菜单——插入单元格（弹窗 +
/// 数量插入行/列）、删除单元格（弹窗 + 删行/列/空行）、隐藏与取消隐藏。
function RowcolMenu({
  onCommand,
}: {
  readonly onCommand: (command: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [insertSubOpen, setInsertSubOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })
  useEscapeClose(open, () => setOpen(false))
  const row = (value: string, label: string): MenuRowOption => ({ value, label })
  return (
    <div ref={wrapRef} className="menu-select rowcol-menu">
      <button
        type="button"
        className="select-like compact rowcol-item"
        data-tip={t('appRowcolMenu')}
        aria-label={t('appRowcolMenu')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="menu-select-value">
          <ToolSymbol symbol="⊞" /> {t('appRowcolMenu')}
        </span>
        <CaretIcon />
      </button>
      {open && (
        <div
          className="menu-select-drop rowcol-drop"
          role="listbox"
          aria-label={t('appRowcolMenu')}
        >
          <MenuRows
            options={[
              { value: 'row-height-open', label: t('appRowcolRowHeight') },
              { value: 'rowcol:fit-row-height', label: t('appRowcolFitRow') },
              { value: 'col-width-open', label: t('appRowcolColWidth') },
              { value: 'rowcol:fit-col-width', label: t('appRowcolFitCol') },
              { value: 'standard-col-width-open', label: `${t('appRowcolStandardColWidth')}…` },
            ]}
            value=""
            onPick={onCommand}
            onClose={() => setOpen(false)}
          />
          <div className="rb-menu-sep" />
          {/* 插入单元格子菜单：弹窗入口 + 四条数量插入行 */}
          <div
            className={`submenu-host submenu-plain${insertSubOpen ? ' submenu-open' : ''}`}
            onMouseEnter={() => setInsertSubOpen(true)}
            onMouseLeave={() => setInsertSubOpen(false)}
          >
            <button type="button" role="option" aria-haspopup="true" className="has-submenu">
              <span className="menu-opt-text">{t('appRowcolInsertCells')}</span>
              <span className="submenu-arrow" aria-hidden="true">
                ›
              </span>
            </button>
            {insertSubOpen && (
              <div className="submenu-drop" role="menu">
                <MenuRows
                  options={[
                    { value: 'insert-cells-dialog-open', label: `${t('appRowcolInsertCells')}…` },
                  ]}
                  value=""
                  onPick={onCommand}
                  onClose={() => setOpen(false)}
                />
                <InsertCountRow
                  label={t('appRowcolInsertAbove')}
                  icon={<OptSample>↑</OptSample>}
                  commandPrefix="rowcol:insert-rows-above"
                  onCommand={onCommand}
                  onClose={() => setOpen(false)}
                />
                <InsertCountRow
                  label={t('appRowcolInsertBelow')}
                  icon={<OptSample>↓</OptSample>}
                  commandPrefix="rowcol:insert-rows-below"
                  onCommand={onCommand}
                  onClose={() => setOpen(false)}
                />
                <InsertCountRow
                  label={t('appRowcolInsertLeft')}
                  icon={<OptSample>←</OptSample>}
                  commandPrefix="rowcol:insert-cols-left"
                  onCommand={onCommand}
                  onClose={() => setOpen(false)}
                />
                <InsertCountRow
                  label={t('appRowcolInsertRight')}
                  icon={<OptSample>→</OptSample>}
                  commandPrefix="rowcol:insert-cols-right"
                  onCommand={onCommand}
                  onClose={() => setOpen(false)}
                />
              </div>
            )}
          </div>
          <MenuRows
            options={[
              {
                value: 'delete-cells-sub',
                label: t('appRowcolDeleteCells'),
                children: [
                  { value: 'delete-cells-dialog-open', label: `${t('appRowcolDeleteCells')}…` },
                  row('rowcol:delete-rows', t('appDeleteRow')),
                  row('rowcol:delete-cols', t('appDeleteCol')),
                  row('rowcol:delete-empty-rows', t('appRowcolDeleteEmptyRows')),
                ],
              },
              {
                value: 'hide-unhide-sub',
                label: t('appRowcolHideUnhide'),
                children: [
                  row('rowcol:hide-rows', t('appRowcolHideRows')),
                  row('rowcol:hide-cols', t('appRowcolHideCols')),
                  row('rowcol:unhide-rows', t('appRowcolUnhideRows')),
                  row('rowcol:unhide-cols', t('appRowcolUnhideCols')),
                ],
              },
            ]}
            value=""
            onPick={onCommand}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  )
}

function BorderMenu({
  penColor,
  penStyle,
  onPenColor,
  onPenStyle,
  onCommand,
}: {
  readonly penColor: string
  readonly penStyle: string
  readonly onPenColor: (hex: string) => void
  readonly onPenStyle: (style: string) => void
  readonly onCommand: (command: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  // 线条颜色/线条样式的菜单内展开面板（互斥，再次点击收起）
  const [penPanel, setPenPanel] = useState<'palette' | 'styles' | null>(null)
  // 触发器图标跟随最后选择（第二轮对比清单）：初值 ⊡，选中后存该边框种类
  const [lastKind, setLastKind] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })
  useEscapeClose(open, () => setOpen(false))
  const pen = (kind: string): string => `border:${kind}:${penColor}`
  const draw = (kind: string): string => `draw-border:${kind}:${penColor}:${penStyle}`
  return (
    <div ref={wrapRef} className="menu-select border-menu">
      <button
        type="button"
        className="select-like compact"
        data-tip={t('appBorders')}
        aria-label={t('appBorders')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="menu-select-value">
          {lastKind === null ? (
            <ToolSymbol symbol="⊡" />
          ) : lastKind.startsWith('draw-') ? (
            <ToolSymbol
              symbol={
                lastKind === 'draw-erase' ? 'eraser' : lastKind === 'draw-grid' ? '▦' : 'pen-nib'
              }
            />
          ) : (
            <BorderGlyph
              on={
                lastKind as 'all' | 'outer' | 'thick' | 'top' | 'bottom' | 'left' | 'right' | 'none'
              }
            />
          )}{' '}
          {t('appBorders')}
        </span>
        <CaretIcon />
      </button>
      {open && (
        <div
          className="menu-select-drop border-menu-drop"
          role="listbox"
          aria-label={t('appBorders')}
        >
          <div className="rb-drop-title">{t('appBorders')}</div>
          <MenuRows
            options={[
              { value: pen('none'), label: t('appBorderNone'), icon: <BorderGlyph on="none" /> },
              { value: pen('all'), label: t('appBorderAll'), icon: <BorderGlyph on="all" /> },
              { value: pen('outer'), label: t('appBorderOuter'), icon: <BorderGlyph on="outer" /> },
              {
                value: pen('thick-outer'),
                label: t('appBorderThickOuter'),
                icon: <BorderGlyph on="thick" />,
              },
              {
                value: pen('bottom'),
                label: t('appBorderBottom'),
                icon: <BorderGlyph on="bottom" />,
              },
              { value: pen('top'), label: t('appBorderTop'), icon: <BorderGlyph on="top" /> },
              { value: pen('left'), label: t('appBorderLeft'), icon: <BorderGlyph on="left" /> },
              { value: pen('right'), label: t('appBorderRight'), icon: <BorderGlyph on="right" /> },
              {
                value: 'format-cells:Border',
                label: t('appBorderOther'),
                icon: <ToolSymbol symbol="▦" />,
              },
              {
                value: pen('tlbr'),
                label: t('appBorderDiagonal'),
                icon: <ToolSymbol symbol="diag-cell" />,
              },
            ]}
            value=""
            onPick={(command) => {
              // 仅边框类命令回写触发器图标；其他边框(对话框)不动
              const [, kind = ''] = command.split(':')
              if (kind) setLastKind(kind === 'thick-outer' ? 'thick' : kind)
              onCommand(command)
            }}
            onClose={() => setOpen(false)}
          />
          <div className="rb-menu-sep" />
          <div className="rb-drop-title">{t('appDrawBorderGroup')}</div>
          <MenuRows
            options={[
              {
                value: draw('outline'),
                label: t('appDrawBorderRow'),
                icon: <ToolSymbol symbol="pen-nib" />,
              },
              {
                value: draw('grid'),
                label: t('appDrawBorderGrid'),
                icon: <ToolSymbol symbol="▦" />,
              },
              {
                value: draw('erase'),
                label: t('appEraseBorder'),
                icon: <ToolSymbol symbol="eraser" />,
              },
            ]}
            value=""
            onPick={(command) => {
              setLastKind(`draw-${command.split(':')[1] ?? ''}`)
              onCommand(command)
            }}
            onClose={() => setOpen(false)}
          />
          <MenuRows
            options={[
              {
                value: 'pen-color',
                label: t('appPenLineColor'),
                icon: <i className="menu-color-dot" style={{ background: penColor }} />,
              },
              {
                value: 'pen-style',
                label: t('appPenLineStyle'),
                icon: <LineStyleGlyph style={penStyle} />,
              },
            ]}
            value=""
            onPick={(value) => {
              setPenPanel((current) =>
                value === 'pen-color'
                  ? current === 'palette'
                    ? null
                    : 'palette'
                  : current === 'styles'
                    ? null
                    : 'styles',
              )
            }}
            onClose={() => {
              // 线条颜色/线条样式只展开面板，不关菜单
            }}
          />
          {penPanel === 'palette' && (
            <ColorPicker
              className="border-menu-palette"
              value={penColor}
              strings={{
                themeColors: t('appThemeColors'),
                standardColors: t('appStandardColors'),
                moreColors: t('appMoreColors'),
              }}
              onPick={(hex) => {
                if (hex) onPenColor(hex.toLowerCase())
                setPenPanel(null)
              }}
            />
          )}
          {penPanel === 'styles' && (
            <div className="pen-style-rows">
              {BORDER_PEN_STYLES.map((style) => (
                <button
                  type="button"
                  key={style}
                  role="option"
                  aria-selected={penStyle === style}
                  className={penStyle === style ? 'on' : ''}
                  onClick={() => {
                    onPenStyle(style)
                    setPenPanel(null)
                  }}
                >
                  <span className="menu-opt-icon" aria-hidden="true">
                    <LineStyleGlyph style={style} />
                  </span>
                  <span className="menu-opt-text">{t(`appPenStyle_${style}` as StringKey)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/// Custom ribbon dropdown replacing the native <select>: macOS pops the native
/// menu over the control (covering ribbon content), while this panel is
/// anchored below its trigger — same pattern as the slides ribbon's .rb-drop.
function MenuSelect({
  label,
  'data-tip': tip,
  className,
  cover = false,
  display,
  value = '',
  options,
  onPick,
}: {
  /// aria-label (mirrors the old select's aria-label)
  readonly label: string
  readonly 'data-tip'?: string
  /// trigger classes for the combobox look (e.g. 'select-like compact')
  readonly className?: string
  /// invisible trigger stretched over the host tool (old .cover-select)
  readonly cover?: boolean
  /// content shown in the trigger (combobox variants)
  readonly display?: React.ReactNode
  /// currently applied value, highlighted in the open panel ('' = none)
  readonly value?: string
  /// options rows: linear icon / thumbnail (WPS-style) + label
  readonly options: readonly { value: string; label: string; icon?: React.ReactNode }[]
  readonly onPick: (value: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  // outside press / window blur / shell chrome press — the shared hook
  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })
  useEscapeClose(open, () => setOpen(false))
  return (
    <div ref={wrapRef} className={`menu-select${cover ? ' menu-select-cover' : ''}`}>
      <button
        type="button"
        className={cover ? 'cover-select' : className}
        data-tip={tip}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {!cover && (
          <>
            <span className="menu-select-value">{display}</span>
            <CaretIcon />
          </>
        )}
      </button>
      {open && (
        <div className="menu-select-drop" role="listbox" aria-label={label}>
          <MenuRows
            options={options}
            value={value}
            onPick={onPick}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  )
}

/// Cross-app shared shape gallery (slides parity), minus Lines — the grid
/// renderer draws shapes as filled paths and cannot show stroke-only connectors.
const SHEET_SHAPE_GROUPS = SHAPE_GALLERY_GROUPS.filter(
  (g) => g.groupKey !== 'ribbonShapeGroupLines',
)

/// Shapes dropdown: grouped outline-icon grid (same look/content as docs and
/// slides); the trigger is an invisible cover like MenuSelect's `cover` mode.
function ShapeGallerySelect({
  label,
  onPick,
}: {
  readonly label: string
  readonly onPick: (prst: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  // outside press / window blur / shell chrome press — the shared hook
  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })
  useEscapeClose(open, () => setOpen(false))
  return (
    <div ref={wrapRef} className="menu-select menu-select-cover">
      <button
        type="button"
        className="cover-select"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="menu-select-drop rb-shape-gallery" role="listbox" aria-label={label}>
          {SHEET_SHAPE_GROUPS.map((group) => (
            <div key={group.groupKey}>
              <div className="rb-drop-title">{t(group.groupKey as StringKey)}</div>
              <div className="rb-shape-grid">
                {group.shapes.map((s) => (
                  <button
                    type="button"
                    key={s.prst}
                    className="rb-shape-cell"
                    data-tip={t(s.labelKey as StringKey)}
                    aria-label={t(s.labelKey as StringKey)}
                    onClick={() => {
                      setOpen(false)
                      onPick(s.prst)
                    }}
                  >
                    <ShapePreview prst={s.prst} size={18} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/// WPS 表格样式画廊（第六节 A4 第三轮）：7 色 × 3 深浅共 20 款内置
/// TableStyle（黑色列无浅色款），缩略图用 header/band 家族色区分深浅；
/// 自定义段列出「新建表格样式/数据透视表样式」对话框保存的样式。
interface TableStyleGalleryPreset {
  readonly value: string
  readonly nameKey: 'appTableStyleMediumN' | 'appTableStyleLightN' | 'appTableStyleDarkN'
  readonly variant: number
  readonly header: string
  readonly ink: string
  readonly band: string | null
  readonly grid: string | null
}

const TABLE_STYLE_GALLERY: ReadonlyArray<{
  readonly color: string
  readonly labelKey: StringKey
  readonly presets: readonly TableStyleGalleryPreset[]
}> = [
  {
    color: '#4472C4',
    labelKey: 'appTableStyleColBlue',
    presets: [
      {
        value: 'TableStyleMedium2',
        nameKey: 'appTableStyleMediumN',
        variant: 2,
        header: '#4472C4',
        ink: '#FFFFFF',
        band: '#D9E1F2',
        grid: null,
      },
      {
        value: 'TableStyleLight2',
        nameKey: 'appTableStyleLightN',
        variant: 2,
        header: '#4472C4',
        ink: '#FFFFFF',
        band: null,
        grid: '#B4C6E7',
      },
      {
        value: 'TableStyleDark2',
        nameKey: 'appTableStyleDarkN',
        variant: 2,
        header: '#2F5597',
        ink: '#FFFFFF',
        band: '#D9E1F2',
        grid: null,
      },
    ],
  },
  {
    color: '#ED7D31',
    labelKey: 'appTableStyleColOrange',
    presets: [
      {
        value: 'TableStyleMedium3',
        nameKey: 'appTableStyleMediumN',
        variant: 3,
        header: '#ED7D31',
        ink: '#FFFFFF',
        band: '#FBE5D6',
        grid: null,
      },
      {
        value: 'TableStyleLight3',
        nameKey: 'appTableStyleLightN',
        variant: 3,
        header: '#ED7D31',
        ink: '#FFFFFF',
        band: null,
        grid: '#F8CBAD',
      },
      {
        value: 'TableStyleDark3',
        nameKey: 'appTableStyleDarkN',
        variant: 3,
        header: '#C55A11',
        ink: '#FFFFFF',
        band: '#FBE5D6',
        grid: null,
      },
    ],
  },
  {
    color: '#A5A5A5',
    labelKey: 'appTableStyleColGray',
    presets: [
      {
        value: 'TableStyleMedium4',
        nameKey: 'appTableStyleMediumN',
        variant: 4,
        header: '#A5A5A5',
        ink: '#FFFFFF',
        band: '#F2F2F2',
        grid: null,
      },
      {
        value: 'TableStyleLight4',
        nameKey: 'appTableStyleLightN',
        variant: 4,
        header: '#A5A5A5',
        ink: '#FFFFFF',
        band: null,
        grid: '#D9D9D9',
      },
      {
        value: 'TableStyleDark4',
        nameKey: 'appTableStyleDarkN',
        variant: 4,
        header: '#7F7F7F',
        ink: '#FFFFFF',
        band: '#F2F2F2',
        grid: null,
      },
    ],
  },
  {
    color: '#FFC000',
    labelKey: 'appTableStyleColGold',
    presets: [
      {
        value: 'TableStyleMedium5',
        nameKey: 'appTableStyleMediumN',
        variant: 5,
        header: '#FFC000',
        ink: '#FFFFFF',
        band: '#FFF2CC',
        grid: null,
      },
      {
        value: 'TableStyleLight5',
        nameKey: 'appTableStyleLightN',
        variant: 5,
        header: '#FFC000',
        ink: '#FFFFFF',
        band: null,
        grid: '#FFE699',
      },
      {
        value: 'TableStyleDark5',
        nameKey: 'appTableStyleDarkN',
        variant: 5,
        header: '#BF9000',
        ink: '#FFFFFF',
        band: '#FFF2CC',
        grid: null,
      },
    ],
  },
  {
    color: '#5B9BD5',
    labelKey: 'appTableStyleColLightBlue',
    presets: [
      {
        value: 'TableStyleMedium6',
        nameKey: 'appTableStyleMediumN',
        variant: 6,
        header: '#5B9BD5',
        ink: '#FFFFFF',
        band: '#DEEBF7',
        grid: null,
      },
      {
        value: 'TableStyleLight6',
        nameKey: 'appTableStyleLightN',
        variant: 6,
        header: '#5B9BD5',
        ink: '#FFFFFF',
        band: null,
        grid: '#BDD7EE',
      },
      {
        value: 'TableStyleDark6',
        nameKey: 'appTableStyleDarkN',
        variant: 6,
        header: '#2E75B6',
        ink: '#FFFFFF',
        band: '#DEEBF7',
        grid: null,
      },
    ],
  },
  {
    color: '#70AD47',
    labelKey: 'appTableStyleColGreen',
    presets: [
      {
        value: 'TableStyleMedium7',
        nameKey: 'appTableStyleMediumN',
        variant: 7,
        header: '#70AD47',
        ink: '#FFFFFF',
        band: '#E2EFDA',
        grid: null,
      },
      {
        value: 'TableStyleLight7',
        nameKey: 'appTableStyleLightN',
        variant: 7,
        header: '#70AD47',
        ink: '#FFFFFF',
        band: null,
        grid: '#C5E0B4',
      },
      {
        value: 'TableStyleDark7',
        nameKey: 'appTableStyleDarkN',
        variant: 7,
        header: '#538135',
        ink: '#FFFFFF',
        band: '#E2EFDA',
        grid: null,
      },
    ],
  },
  {
    color: '#3F3F3F',
    labelKey: 'appTableStyleColBlack',
    presets: [
      {
        value: 'TableStyleMedium1',
        nameKey: 'appTableStyleMediumN',
        variant: 1,
        header: '#3F3F3F',
        ink: '#FFFFFF',
        band: '#F2F2F2',
        grid: null,
      },
      {
        value: 'TableStyleDark1',
        nameKey: 'appTableStyleDarkN',
        variant: 1,
        header: '#262626',
        ink: '#FFFFFF',
        band: '#F2F2F2',
        grid: null,
      },
    ],
  },
]

/// 4×3 mini table in the style's header/band colors (Excel gallery look).
function TableStyleThumb({
  header,
  ink,
  band,
  grid,
}: {
  readonly header: string
  readonly ink: string
  readonly band: string | null
  readonly grid: string | null
}): React.JSX.Element {
  const cell = (fill: string, row: number, col: number): React.JSX.Element => (
    <span
      key={`${row}-${col}`}
      style={{
        background: fill,
        borderTop: grid ? `1px solid ${grid}` : undefined,
      }}
    />
  )
  return (
    <span className="tbl-thumb" aria-hidden="true">
      <span className="tbl-thumb-head" style={{ background: header, color: ink }}>
        <i />
        <i />
        <i />
      </span>
      {[0, 1].map((row) => (
        <span key={row} className="tbl-thumb-row">
          {cell(band ?? '#FFFFFF', row, 0)}
          {cell(row === 1 && band ? '#FFFFFF' : (band ?? '#FFFFFF'), row, 1)}
          {cell(band ?? '#FFFFFF', row, 2)}
        </span>
      ))}
    </span>
  )
}

/// 表格样式: WPS 画廊（7 色 20 款缩略图 + 自定义 + 新建表格样式/新建数据
/// 透视表样式），trigger 仍是无形 cover。
function TableStyleGallerySelect({
  label,
  'data-tip': tip,
  onPick,
  onCommand,
}: {
  readonly label: string
  readonly 'data-tip'?: string
  readonly onPick: (style: string) => void
  readonly onCommand: (command: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [customTick, setCustomTick] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })
  useEscapeClose(open, () => setOpen(false))
  const pickStyle = (style: string): void => {
    setOpen(false)
    onPick(style)
  }
  const pickCommand = (command: string): void => {
    setOpen(false)
    setCustomTick((tick) => tick + 1)
    onCommand(command)
  }
  const customStyles = open ? listCustomTableStyles() : []
  return (
    <div ref={wrapRef} className="menu-select menu-select-cover">
      <button
        type="button"
        className="cover-select"
        aria-label={label}
        data-tip={tip}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div
          className="menu-select-drop style-gallery-drop"
          role="listbox"
          aria-label={label}
          key={customTick}
        >
          <div className="rb-drop-title">{label}</div>
          {customStyles.length > 0 && (
            <>
              <div className="rb-drop-title">{t('appTableStyleCustom')}</div>
              <div className="style-thumb-grid custom">
                {customStyles.map((style) => (
                  <button
                    type="button"
                    key={style.id}
                    role="option"
                    className="style-thumb-cell"
                    data-tip={style.name}
                    onClick={() => pickStyle(`custom:${style.id}`)}
                  >
                    <TableStyleThumb
                      header={style.headerFill}
                      ink="#FFFFFF"
                      band={style.bandFill}
                      grid={null}
                    />
                    <span>{style.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="style-thumb-grid cols7">
            {TABLE_STYLE_GALLERY.map((column) =>
              column.presets.map((preset) => (
                <button
                  type="button"
                  key={preset.value}
                  role="option"
                  className="style-thumb-cell"
                  data-tip={t(preset.nameKey, { n: preset.variant })}
                  onClick={() => pickStyle(preset.value)}
                >
                  <TableStyleThumb
                    header={preset.header}
                    ink={preset.ink}
                    band={preset.band}
                    grid={preset.grid}
                  />
                </button>
              )),
            )}
          </div>
          <div className="rb-menu-sep" role="separator" />
          <div className="style-new-menu">
            <button type="button" role="option" onClick={() => pickCommand('table-style-new-open')}>
              {t('appTableStyleNew')}
            </button>
            <button type="button" role="option" onClick={() => pickCommand('pivot-style-new-open')}>
              {t('appPivotStyleNew')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/// 单元格样式: WPS 分组色板（好/差和适中、数据和模型、标题、主题单元格式
/// 样式、数字格式）+ 自定义 + 新建单元格样式/合并样式。
const CELL_STYLE_GROUPS: ReadonlyArray<{
  titleKey: StringKey
  items: ReadonlyArray<{ value: string; labelKey: StringKey; fill: string; ink?: string }>
}> = [
  {
    titleKey: 'appCellStyleGroupVerdict',
    items: [
      { value: 'good', labelKey: 'appStyleGood', fill: '#C6EFCE', ink: '#006100' },
      { value: 'bad', labelKey: 'appStyleBad', fill: '#FFC7CE', ink: '#9C0006' },
      { value: 'neutral', labelKey: 'appStyleNeutral', fill: '#FFEB9C', ink: '#9C6500' },
    ],
  },
  {
    titleKey: 'appCellStyleGroupData',
    items: [
      { value: 'input', labelKey: 'appStyleInput', fill: '#FFCC99', ink: '#3F3F76' },
      { value: 'output', labelKey: 'appStyleOutput', fill: '#F2F2F2', ink: '#3F3F3F' },
      { value: 'calculation', labelKey: 'appStyleCalculation', fill: '#F2F2F2', ink: '#FA7D00' },
      { value: 'warning-text', labelKey: 'appStyleWarningText', fill: '#FFFFFF', ink: '#FF0000' },
    ],
  },
  {
    titleKey: 'appCellStyleGroupTitle',
    items: [
      { value: 'title', labelKey: 'appTitle', fill: '#FFFFFF', ink: '#44546A' },
      { value: 'heading-1', labelKey: 'appStyleHeading1', fill: '#4472C4', ink: '#FFFFFF' },
      { value: 'heading-2', labelKey: 'appStyleHeading2', fill: '#D9E1F2', ink: '#44546A' },
    ],
  },
  {
    titleKey: 'appCellStyleGroupTheme',
    items: [
      { value: 'accent1-20', labelKey: 'appStyleAccent120', fill: '#D9E1F2', ink: '#1F1F1F' },
      { value: 'accent1-40', labelKey: 'appStyleAccent140', fill: '#B4C6E7', ink: '#1F1F1F' },
      { value: 'accent1', labelKey: 'appStyleAccent1', fill: '#4472C4', ink: '#FFFFFF' },
      { value: 'total', labelKey: 'appStyleTotal', fill: '#44546A', ink: '#FFFFFF' },
    ],
  },
  {
    titleKey: 'appCellStyleGroupNumber',
    items: [
      { value: 'num-thousand', labelKey: 'appNumStyleThousand', fill: '#FFFFFF', ink: '#1F1F1F' },
      {
        value: 'num-thousand-red',
        labelKey: 'appNumStyleThousandRed',
        fill: '#FFFFFF',
        ink: '#9C0006',
      },
      { value: 'num-currency', labelKey: 'appNumStyleCurrency', fill: '#FFFFFF', ink: '#1F1F1F' },
      { value: 'num-percent', labelKey: 'appNumStylePercent', fill: '#FFFFFF', ink: '#1F1F1F' },
    ],
  },
]

function CellStyleSelect({
  label,
  'data-tip': tip,
  onPick,
  onCommand,
}: {
  readonly label: string
  readonly 'data-tip'?: string
  readonly onPick: (style: string) => void
  readonly onCommand: (command: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })
  useEscapeClose(open, () => setOpen(false))
  const pick = (value: string): void => {
    setOpen(false)
    onPick(value)
  }
  const pickCommand = (command: string): void => {
    setOpen(false)
    onCommand(command)
  }
  const customStyles = open ? listCustomCellStyles() : []
  return (
    <div ref={wrapRef} className="menu-select menu-select-cover">
      <button
        type="button"
        className="cover-select"
        aria-label={label}
        data-tip={tip}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="menu-select-drop style-gallery-drop" role="listbox" aria-label={label}>
          {customStyles.length > 0 && (
            <div key="custom">
              <div className="rb-drop-title">{t('appCellStyleCustom')}</div>
              <div className="cell-style-col">
                {customStyles.map((style) => (
                  <button
                    type="button"
                    key={style.id}
                    role="option"
                    className="cell-style-row"
                    onClick={() => pick(`custom:${style.id}`)}
                  >
                    <span
                      className="cell-style-swatch"
                      style={{
                        // LOCAL(适配): 快照 theme 对象色待第九轮 Univer 主题渲染，先取字符串色
                        background:
                          typeof style.patch.fillColor === 'string'
                            ? style.patch.fillColor
                            : '#FFFFFF',
                        color:
                          typeof style.patch.fontColor === 'string'
                            ? style.patch.fontColor
                            : '#1F1F1F',
                      }}
                    >
                      <i>{t('appCellStyleSwatchSample')}</i>
                    </span>
                    {style.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {CELL_STYLE_GROUPS.map((group) => (
            <div key={group.titleKey}>
              <div className="rb-drop-title">{t(group.titleKey)}</div>
              <div className="cell-style-col">
                {group.items.map((item) => (
                  <button
                    type="button"
                    key={item.value}
                    role="option"
                    className="cell-style-row"
                    onClick={() => pick(item.value)}
                  >
                    <span className="cell-style-swatch" style={{ background: item.fill }}>
                      {item.ink ? (
                        <i style={{ color: item.ink }}>{t('appCellStyleSwatchSample')}</i>
                      ) : null}
                    </span>
                    {t(item.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="rb-menu-sep" role="separator" />
          <div className="style-new-menu">
            <button type="button" role="option" onClick={() => pickCommand('cell-style-new-open')}>
              {t('appCellStyleNew')}
            </button>
            <button type="button" role="option" onClick={() => pickCommand('merge-cell-styles')}>
              {t('appCellStyleMerge')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/// ── 条件格式富菜单画廊 ─────────────────────────────────────────────
/// 数据条/色阶以色块展示，图标集以图形展示（对齐 WPS 画廊）。

function DataBarSwatch({
  color,
  solid,
}: {
  readonly color: string
  readonly solid: boolean
}): React.JSX.Element {
  const background = solid
    ? color
    : `linear-gradient(90deg, ${color} 0%, ${color} 72%, rgba(255,255,255,0.92) 72%)`
  return (
    <span className="cf-bar-swatch" aria-hidden="true">
      <i style={{ background }} />
      <u style={{ borderTopColor: '#B4B4B4' }} />
    </span>
  )
}

function ColorScaleSwatch({
  stops,
}: {
  readonly stops: readonly [string, string | null, string]
}): React.JSX.Element {
  const gradient = stops[1]
    ? `linear-gradient(90deg, ${stops[0]}, ${stops[1]}, ${stops[2]})`
    : `linear-gradient(90deg, ${stops[0]}, ${stops[2]})`
  return <i className="cf-scale-swatch" style={{ background: gradient }} aria-hidden="true" />
}

/// 图标集小样（方向/形状/标记/等级），WPS 画廊同款图形的轻量近似。
function IconSetPreview({
  id,
  count,
}: {
  readonly id: string
  readonly count: number
}): React.JSX.Element {
  const icons: React.ReactNode[] = []
  for (let index = 0; index < count; index += 1) {
    const first = index === 0
    const last = index === count - 1
    if (id === '3arrows' || id === '4arrows' || id === '5arrows' || id === '3arrows-gray') {
      const gray = id.endsWith('-gray')
      const color = gray ? '#8A8A8A' : first ? '#23B123' : last ? '#E03030' : '#E8A213'
      const shape = first ? '▲' : last ? '▼' : '▶'
      icons.push(
        <b key={index} style={{ color }}>
          {shape}
        </b>,
      )
    } else if (id === '3traffic' || id === '4traffic') {
      const color = first ? '#E03030' : last ? '#23B123' : '#E8A213'
      icons.push(<i key={index} className="cf-ico-dot" style={{ background: color }} />)
    } else if (id === '3signs') {
      const color = first ? '#E03030' : last ? '#23B123' : '#E8A213'
      const shape = first ? '✕' : last ? '✓' : '!'
      icons.push(
        <i
          key={index}
          className="cf-ico-dot"
          style={{ background: color, color: '#FFFFFF', fontStyle: 'normal' }}
        >
          {shape}
        </i>,
      )
    } else if (id === '5quarters') {
      const level = (index + 1) / count
      icons.push(
        <i
          key={index}
          className="cf-ico-dot"
          style={{
            background: `conic-gradient(#4472C4 ${level * 360}deg, #D9D9D9 0deg)`,
          }}
        />,
      )
    } else if (id === '3flags') {
      const color = first ? '#E03030' : last ? '#23B123' : '#E8A213'
      icons.push(
        <b key={index} style={{ color }}>
          ⚑
        </b>,
      )
    } else if (id === '3symbols' || id === '3symbols2') {
      const circled = id === '3symbols'
      const color = first ? '#E03030' : last ? '#23B123' : '#E8A213'
      const shape = first ? '✕' : last ? '✓' : '!'
      icons.push(
        <b key={index} style={{ color }}>
          {circled ? shape : shape}
        </b>,
      )
    } else if (id === '3stars') {
      const color = last ? '#D9D9D9' : '#E8A213'
      icons.push(
        <b key={index} style={{ color }}>
          ★
        </b>,
      )
    } else if (id === '4rating' || id === '5rating') {
      const color = last ? '#B4B4B4' : '#4472C4'
      icons.push(<i key={index} className="cf-ico-bar" style={{ background: color }} />)
    } else {
      // 5boxes
      const color = last ? '#D9D9D9' : '#ED7D31'
      icons.push(<i key={index} className="cf-ico-box" style={{ background: color }} />)
    }
  }
  return (
    <span className="cf-ico-preview" aria-hidden="true">
      {icons}
    </span>
  )
}

const CF_ICON_SET_GROUPS: ReadonlyArray<{
  readonly groupKey: StringKey
  readonly ids: readonly string[]
}> = [
  { groupKey: 'appCfIconGroupDir', ids: ['3arrows', '3arrows-gray', '4arrows', '5arrows'] },
  { groupKey: 'appCfIconGroupShape', ids: ['3traffic', '3signs', '4traffic', '5quarters'] },
  { groupKey: 'appCfIconGroupMark', ids: ['3flags', '3symbols', '3symbols2'] },
  { groupKey: 'appCfIconGroupRating', ids: ['3stars', '4rating', '5rating', '5boxes'] },
]

/// 条件格式: WPS 全量富菜单——突出显示单元格规则/项目选取规则（对话框子菜
/// 单）、数据条/色阶/图标集（色块画廊直接应用）、新建/清除/管理规则、AI。
function CondFormatSelect({
  label,
  'data-tip': tip,
  onCommand,
}: {
  readonly label: string
  readonly 'data-tip'?: string
  readonly onCommand: (command: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })
  useEscapeClose(open, () => setOpen(false))
  const pick = (command: string): void => {
    setOpen(false)
    onCommand(command)
  }
  const highlightChildren: readonly MenuRowOption[] = [
    { value: 'cf-hl-dialog:gt', label: t('appCfGreaterThan') },
    { value: 'cf-hl-dialog:lt', label: t('appCfLessThan') },
    { value: 'cf-hl-dialog:between', label: t('appCfBetween') },
    { value: 'cf-hl-dialog:eq', label: t('appCfEqual') },
    { value: 'cf-hl-dialog:contains', label: t('appCfTextContains') },
    { value: 'cf-hl-dialog:dup', label: t('appCfDuplicate') },
  ]
  const rankChildren: readonly MenuRowOption[] = [
    { value: 'cf-rank-dialog:0:0', label: t('appCfTop10') },
    { value: 'cf-rank-dialog:0:1', label: t('appCfTop10Pct') },
    { value: 'cf-rank-dialog:1:0', label: t('appCfBottom10') },
    { value: 'cf-rank-dialog:1:1', label: t('appCfBottom10Pct') },
    { value: 'cf-average:above', label: t('appCfAboveAvg') },
    { value: 'cf-average:below', label: t('appCfBelowAvg') },
  ]
  return (
    <div ref={wrapRef} className="menu-select menu-select-cover">
      <button
        type="button"
        className="cover-select"
        aria-label={label}
        data-tip={tip}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="menu-select-drop cf-menu-drop" role="listbox" aria-label={label}>
          <MenuRows
            options={[
              {
                value: 'cf-hl-group',
                label: t('appCfHlRule'),
                children: highlightChildren,
              },
              {
                value: 'cf-rank-group',
                label: t('appCfRankRule'),
                children: rankChildren,
              },
              {
                value: 'cf-databar-group',
                label: t('appCfDataBar'),
                children: [
                  {
                    value: 'cf-databar-header-grad',
                    label: t('appCfDataBarGradient'),
                    children: DATA_BAR_PRESETS.filter((preset) => !preset.solid).map((preset) => ({
                      value: `cf-databar:${preset.id}`,
                      label: '',
                      tip: preset.id,
                      icon: <DataBarSwatch color={preset.color} solid={false} />,
                    })),
                  },
                  {
                    value: 'cf-databar-header-solid',
                    label: t('appCfDataBarSolid'),
                    children: DATA_BAR_PRESETS.filter((preset) => preset.solid).map((preset) => ({
                      value: `cf-databar:${preset.id}`,
                      label: '',
                      tip: preset.id,
                      icon: <DataBarSwatch color={preset.color} solid />,
                    })),
                  },
                ],
              },
              {
                value: 'cf-colorscale-group',
                label: t('appCfColorScale'),
                children: [
                  {
                    value: 'cf-scale-header-3',
                    label: t('appCfScale3'),
                    children: COLOR_SCALE_PRESETS.filter((preset) => preset.stops[1] !== null).map(
                      (preset) => ({
                        value: `cf-colorscale:${preset.id}`,
                        label: '',
                        tip: preset.id,
                        icon: <ColorScaleSwatch stops={preset.stops} />,
                      }),
                    ),
                  },
                  {
                    value: 'cf-scale-header-2',
                    label: t('appCfScale2'),
                    children: COLOR_SCALE_PRESETS.filter((preset) => preset.stops[1] === null).map(
                      (preset) => ({
                        value: `cf-colorscale:${preset.id}`,
                        label: '',
                        tip: preset.id,
                        icon: <ColorScaleSwatch stops={preset.stops} />,
                      }),
                    ),
                  },
                ],
              },
              {
                value: 'cf-iconset-group',
                label: t('appCfIconSet'),
                children: CF_ICON_SET_GROUPS.map((group) => ({
                  value: `cf-iconset-group-${group.groupKey}`,
                  label: t(group.groupKey),
                  children: group.ids.map((id) => {
                    const preset = iconSetOf(id)
                    if (!preset) return { value: `cf-iconset:${id}`, label: id }
                    return {
                      value: `cf-iconset:${preset.id}`,
                      label: '',
                      tip: preset.id,
                      icon: <IconSetPreview id={preset.id} count={preset.count} />,
                    }
                  }),
                })),
              },
            ]}
            value=""
            onPick={pick}
            onClose={() => setOpen(false)}
          />
          <div className="rb-menu-sep" role="separator" />
          <MenuRows
            options={[{ value: 'cf-new:5', label: t('appCfNewRule') }]}
            value=""
            onPick={pick}
            onClose={() => setOpen(false)}
          />
          <div
            className="submenu-host cf-clear-host"
            onMouseEnter={(event) => event.currentTarget.classList.add('submenu-open')}
            onMouseLeave={(event) => event.currentTarget.classList.remove('submenu-open')}
          >
            <button type="button" role="option" aria-haspopup="true" className="has-submenu">
              <span className="menu-opt-text">{t('appCfClearRule')}</span>
              <span className="submenu-arrow" aria-hidden="true">
                ›
              </span>
            </button>
            <div className="submenu-drop" role="menu">
              <button type="button" role="option" onClick={() => pick('cf-clear:selection')}>
                {t('appCfClearSelection')}
              </button>
              <button type="button" role="option" onClick={() => pick('cf-clear:sheet')}>
                {t('appCfClearSheet')}
              </button>
            </div>
          </div>
          <MenuRows
            options={[
              { value: 'cf-open', label: t('appCfManage') },
              { value: 'ai-cf', label: t('appCfAi') },
            ]}
            value=""
            onPick={pick}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  )
}

/// 数据处理组大钮（图标在上文字在下 + 下拉菜单），填充/求和/排序/筛选/
/// 冻结/查找/清除共用。
/// MenuSelect variant whose trigger is a free-text input (Excel's font
/// name/size boxes): Enter or clicking away commits the typed value, Esc
/// reverts, the caret opens the preset list.
function EditableMenuSelect({
  label,
  'data-tip': tip,
  className,
  value,
  options,
  onOpen,
  onPick,
  commit,
}: {
  readonly label: string
  readonly 'data-tip'?: string
  readonly className?: string
  readonly value: string
  readonly options: readonly { value: string; label: string; sep?: boolean }[]
  /// fired on the click that opens the list (lazy option loading)
  readonly onOpen?: () => void
  readonly onPick: (value: string) => void
  /// apply typed text (caller validates; invalid input is dropped silently)
  readonly commit: (text: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [draft, setDraftState] = useState<string | null>(null)
  // mirrors draft synchronously: Enter/Esc call blur(), whose handler runs
  // before the setState above lands
  const draftRef = useRef<string | null>(null)
  const setDraft = (next: string | null): void => {
    draftRef.current = next
    setDraftState(next)
  }
  const wrapRef = useRef<HTMLDivElement>(null)
  // outside press / window blur / shell chrome press — the shared hook
  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })
  useEscapeClose(open, () => setOpen(false))
  const commitDraft = (): void => {
    const text = draftRef.current?.trim()
    if (text && text !== value) commit(text)
    setDraft(null)
  }
  return (
    <div ref={wrapRef} className="menu-select">
      <span className={`${className ?? ''} menu-select-edit`} data-tip={tip}>
        <input
          value={draft ?? value}
          aria-label={label}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur() // blur handler commits
            } else if (event.key === 'Escape') {
              setDraft(null)
              event.currentTarget.blur()
            }
          }}
          onBlur={(event) => {
            // focus moved into the dropdown → let the option click win
            if (wrapRef.current?.contains(event.relatedTarget as Node)) return
            commitDraft()
          }}
        />
        <button
          type="button"
          className="menu-select-caret"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => {
            if (!open) onOpen?.()
            setOpen(!open)
          }}
        >
          <CaretIcon />
        </button>
      </span>
      {open && (
        <div className="menu-select-drop" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={`${option.value === value ? 'on' : ''}${option.sep ? ' sep-above' : ''}`}
              onClick={() => {
                setOpen(false)
                setDraft(null)
                onPick(option.value)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// display only — option values keep the English label as the command identity
const NUMBER_FORMAT_LABEL: Record<string, StringKey> = {
  General: 'dlgFcNumGeneral',
  Number: 'dlgFcNumNumber',
  Currency: 'dlgFcNumCurrency',
  Accounting: 'appNumFmtAccounting',
  'Short Date': 'appNumFmtShortDate',
  'Long Date': 'appNumFmtLongDate',
  Time: 'dlgFcNumTime',
  Percentage: 'dlgFcNumPercent',
  Fraction: 'appNumFmtFraction',
  Scientific: 'dlgFcNumScientific',
  Text: 'dlgFcNumText',
}

function NumberFormatSelect({
  pattern,
  onCommand,
}: {
  readonly pattern: string
  readonly onCommand: (command: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const current = categoryOptionForPattern(pattern)
  const localized = (label: string): string => {
    const labelKey = NUMBER_FORMAT_LABEL[label]
    return labelKey ? t(labelKey) : label
  }
  return (
    <div className="numfmt-wrap">
      <MenuSelect
        className="select-like"
        label="Number format"
        data-tip={pattern || t('dlgFcNumGeneral')}
        value={current}
        display={localized(current)}
        options={numberFormatCategories().map((category) => ({
          value: category.label,
          label: localized(category.label),
          icon: <OptSample>{NUMFMT_SAMPLES[category.label] ?? category.label}</OptSample>,
        }))}
        onPick={(value) => {
          const category = numberFormatCategories().find((candidate) => candidate.label === value)
          if (category) onCommand(`format:${category.pattern}`)
        }}
      />
    </div>
  )
}

function RibbonGroup({
  label,
  children,
  launcher,
}: {
  readonly label: string
  readonly children: React.ReactNode
  /// 组右下角的 45° 对话框启动箭头（Excel/WPS 组角落小图标），点击打开
  /// 设置单元格格式对话框并定位到对应 tab。
  readonly launcher?: { readonly tip: string; readonly onClick: () => void }
}): React.JSX.Element | null {
  // No visible group captions — the label stays for assistive tech.
  // WPS 五阶梯（带级统一档）：0 平铺 → 1 一列两行 → 2 一列三行 →
  // 3 本组收成分组名钮（面板=原布局） → 4 注册进全带唯一分组钮
  const slot = useRibbonGroupSlot(label)
  const level = useRibbonGroupLevel(slot)
  const collector = useContext(BandCollectorContext)
  const sectionKey = useId()
  const sectionNode = <div className="band-section-body">{children}</div>
  // 无 deps 刷新 effect 不能带 unregister 清理：清理每次重跑前删条目并 bump，
  // register 紧接着以 !prev 再 bump——停靠窄视图任一组降到 level 3 即无限
  // 乒乓（Maximum update depth 洪水）。真正的注销只发生在两种时机：
  // 离开 level 3（下方幂等删，删不中不再 bump）与组件卸载（独立 cleanup）。
  useEffect(() => {
    if (!collector) return
    if (level !== 3) {
      collector.unregister(sectionKey)
      return
    }
    collector.register({ id: sectionKey, label, node: sectionNode })
  })
  useEffect(() => () => collector?.unregister(sectionKey), [collector, sectionKey])
  if (level === 3) {
    return (
      <section className="ribbon-group ribbon-group-named" aria-label={label}>
        <NodeDropButton label={label}>{children}</NodeDropButton>
      </section>
    )
  }
  return (
    <section className={`ribbon-group${level > 0 ? ` degrade-${level}` : ''}`} aria-label={label}>
      <div className="ribbon-group-content">
        {level > 0 ? <div className="degrade-grid">{children}</div> : children}
      </div>
      {launcher && level === 0 && (
        <button
          type="button"
          className="group-launcher"
          data-tip={launcher.tip}
          aria-label={launcher.tip}
          onClick={launcher.onClick}
        >
          <svg
            viewBox="0 0 12 12"
            width="10"
            height="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 4l4 4M8 5.2V8H5.2" />
          </svg>
        </button>
      )}
    </section>
  )
}

function RibbonButton({
  label,
  detail,
  symbol,
  accent = false,
  menu = false,
  compact = false,
  large = false,
  active = false,
  disabled = false,
  onClick,
}: {
  readonly label: string
  readonly detail: string
  readonly symbol: string
  readonly accent?: boolean
  readonly menu?: boolean
  /** Icon-only in narrow windows (e.g. Cut/Copy). */
  readonly compact?: boolean
  /** Icon over label, for the tall Insert-tab buttons. */
  readonly large?: boolean
  /** Pressed-state echo (e.g. highlighting the current chart type). */
  readonly active?: boolean
  readonly disabled?: boolean
  readonly onClick: () => void
}): React.JSX.Element {
  return (
    <button
      className={`ribbon-tool as-button ${accent ? 'accent' : ''} ${compact ? 'compact-icon' : ''} ${large ? 'large' : ''} ${active ? 'active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      data-tip={label}
      data-tip-detail={detail}
    >
      {large ? (
        // The dropdown caret sits beside the icon (top row, inside the
        // hover plate), not after the label
        <span className="tool-icon-row">
          <ToolSymbol symbol={symbol} />
          {menu && <CaretIcon />}
        </span>
      ) : (
        <ToolSymbol symbol={symbol} />
      )}
      <span>
        <strong>
          {label}
          {!large && menu && <CaretIcon />}
        </strong>
        <small>{detail}</small>
      </span>
    </button>
  )
}
