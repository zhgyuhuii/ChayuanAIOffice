import { useEffect, useRef, useState } from 'react'
import { platformShortcuts } from '@chatoffice/i18n'
import {
  AiPanelToggle,
  Dropdown,
  DockShell,
  SHAPE_GALLERY_GROUPS,
  ShapePreview,
  useDismissablePopover,
} from '@chatoffice/ui'

import {
  CaretIcon,
  RIBBON_GLYPH_ICONS,
  RedoIcon,
  SaveAsIcon,
  SaveIcon,
  UndoIcon,
} from './ribbon-icons'
import { ConvertMenuSelect } from './ConvertMenuSelect'

import {
  compressImageForDisplay,
  InsertImageDialog,
  type InsertImageBridge,
  type WebImageItem,
} from '@chatoffice/ui'
import { ColorDropdown } from './ColorDropdown'
import { FormatCellsDialog } from './FormatCellsDialog'
import { PictureCropDialog } from './PictureCropDialog'
import { AllowEditRangesDialog } from './AllowEditRangesDialog'
import { GoToDialog } from './GoToDialog'
import { COLOR_SCHEMES, FONT_SCHEMES, THEME_PRESETS } from './themes'
import { useI18n, type StringKey } from './i18n/locale'
import { NameManagerDialog, type DefinedNameAction, type DefinedNameRow } from './NameManagerDialog'
import { categoryOptionForPattern, numberFormatCategories } from './number-format'
import { type SelectionFormat } from './selection-format'
import { fontFamilyGroups, useSystemFontFamilies } from './system-fonts'
import { shouldInterceptClearSelection } from './clear-selection-keyboard'

import type { ChartSeriesVisualState } from '../domain/chart-visual'
import type { ChangePlan } from '../domain/workbook.types'
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
  /// Field choices for the Pivot dialog, read from the selection's header row.
  readonly onGetPivotFields: () => PivotField[]
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
  readonly onApplyFormula: (formula: string) => string | null
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
    () => localStorage.getItem('ai-sheets-show-ai') !== '0',
  )
  useEffect(() => {
    localStorage.setItem('ai-sheets-show-ai', isCopilotOpen ? '1' : '0')
  }, [isCopilotOpen])
  const [showFormatCells, setShowFormatCells] = useState(false)
  const [axisSizeTarget, setAxisSizeTarget] = useState<'row' | 'col' | null>(null)
  const [showLinkDialog, setShowLinkDialog] = useState(false)
  const [showSortDialog, setShowSortDialog] = useState(false)
  const [showDedupeDialog, setShowDedupeDialog] = useState(false)
  const [showNameManager, setShowNameManager] = useState(false)
  const [showPivotDialog, setShowPivotDialog] = useState(false)
  const [pivotEditSeed, setPivotEditSeed] = useState<PivotEditSeed | null>(null)
  /** null = closed; string = open on that catalog category ('All' for the plain button) */
  const [insertFunctionCat, setInsertFunctionCat] = useState<string | null>(null)
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
    searchWeb: async (query) => {
      const r = await window.desktopApi.webImageSearch(query)
      return { images: (r.images as WebImageItem[]) ?? [] }
    },
    searchStock: async (source, query) => {
      const r = await window.desktopApi.stockImageSearch(source, query)
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
    generate: async ({ prompt }) => {
      const r = await window.desktopApi.generateImage({ prompt })
      if (!r.url) return { error: r.error ?? 'no image' }
      const media = await window.desktopApi.remoteImage(r.url)
      if (!media) return { error: 'image download failed' }
      return { images: [{ dataUrl: `data:${media.mime};base64,${media.base64}` }] }
    },
  }
  const onCommandRef = useRef(onCommand)
  const onIsCellEditingRef = useRef(onIsCellEditing)
  onCommandRef.current = onCommand
  onIsCellEditingRef.current = onIsCellEditing
  useEffect(() => {
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
      // Excel's PageUp/PageDown; Alt+ pages horizontally. Univer parks grid
      // focus on a hidden editable host, so app fields are told apart by
      // sitting OUTSIDE the grid container; in-cell editing is checked in the
      // command handler via the workbook's own editing state.
      if (
        (event.key === 'PageDown' || event.key === 'PageUp') &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.defaultPrevented
      ) {
        const target = event.target as HTMLElement | null
        const inAppField =
          !!target?.closest?.('input, textarea, [contenteditable="true"]') &&
          !target?.closest?.('[data-u-comp], .univer-app-container, [class*="univer"]')
        if (!inAppField) {
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
        className="sheet-body"
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
              aria-label="Workbook commands"
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
              <span className="ribbon-tabs-spacer" />
              <span className="workbook-status" role="status" aria-live="polite">
                {statusMessage}
              </span>
              <AiPanelToggle
                open={isCopilotOpen}
                onToggle={() => setIsCopilotOpen((open) => !open)}
                label={t('aiOpenAssistant')}
              />
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
                onCommand={(command) => {
                  if (command === 'format-cells') setShowFormatCells(true)
                  else if (command === 'row-height-open') setAxisSizeTarget('row')
                  else if (command === 'col-width-open') setAxisSizeTarget('col')
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
                  else if (command === 'ai-open-panel') setIsCopilotOpen(true)
                  else if (command === 'ai-toggle-panel') setIsCopilotOpen((v) => !v)
                  else if (command === 'picture-crop-open') setShowPictureCrop(true)
                  else if (command === 'chart-element-title') setChartTextTarget('title')
                  else if (command === 'chart-element-axis-cat') setChartTextTarget('axis-category')
                  else if (command === 'chart-element-axis-val') setChartTextTarget('axis-value')
                  else onCommand(command)
                }}
                onAiRun={(nextPrompt) => {
                  setIsCopilotOpen(true)
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
                  setIsCopilotOpen(true)
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
          onCommand={onCommand}
          onClose={() => setShowFormatCells(false)}
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
          onInsert={(dataUrl) => {
            setInsertImageOpen(false)
            onInsertPictureData(dataUrl)
          }}
          onClose={() => setInsertImageOpen(false)}
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
      {showPivotDialog && (
        <PivotDialog
          fields={onGetPivotFields()}
          sourceRange={onGetSourceRange()}
          onCreate={onCreatePivot}
          onClose={() => setShowPivotDialog(false)}
        />
      )}
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
          onClose={() => setShowGoalSeek(false)}
        />
      )}
      {insertFunctionCat !== null && (
        <InsertFunctionDialog
          targetLabel={onGetActiveCell()}
          onApply={onApplyFormula}
          initialCategory={insertFunctionCat}
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
        aria-label="Custom sort"
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
        aria-label="Remove duplicates"
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
        aria-label="Insert link"
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
}): React.JSX.Element {
  const { t } = useI18n()
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
      <div className="ribbon">
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
      <div className="ribbon">
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
      <div className="ribbon">
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
      <div className="ribbon">
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
      <div className="ribbon">
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
      <div className="ribbon">
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
      <div className="ribbon">
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
  return (
    <div className="ribbon">
      <RibbonGroup label={t('appGroupClipboard')}>
        <button
          className="ribbon-tool as-button large"
          data-tip={t('appPasteTitle')}
          onClick={() => onCommand('paste')}
        >
          <span className="tool-icon-row">
            <ToolSymbol symbol="📋" />
          </span>
          <span>
            <strong>{t('appPaste')}</strong>
          </span>
        </button>
        {largeMenu(t('appPasteSpecial'), '📑', t('appPasteSpecialTitle'), [
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
            value: 'paste-special:format',
            label: t('appPasteFormattingOnly'),
            icon: <OptSample>Aa</OptSample>,
          },
          {
            value: 'paste-special:col-width',
            label: t('appPasteColWidths'),
            icon: <OptSample>↔</OptSample>,
          },
          {
            value: 'paste-special:besides-border',
            label: t('appPasteExceptBorders'),
            icon: <BorderGlyph on="none" />,
          },
        ])}
        <div className="tool-stack">
          <button
            data-tip={t('appCutTitle')}
            aria-label={t('appCutTitle')}
            onClick={() => onCommand('cut')}
          >
            <ToolSymbol symbol="✂" />
          </button>
          <button
            data-tip={t('appCopyTitle')}
            aria-label={t('appCopyTitle')}
            onClick={() => onCommand('copy')}
          >
            <ToolSymbol symbol="⧉" />
          </button>
          <button
            data-tip={t('appFormatPainter')}
            aria-label={t('appFormatPainter')}
            onClick={() => onCommand('format-painter')}
          >
            <ToolSymbol symbol="🖌" />
          </button>
        </div>
      </RibbonGroup>
      <RibbonGroup label={t('appGroupFont')}>
        <div className="ribbon-rows">
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
              options={sizeOptions.map((size) => ({ value: String(size), label: String(size) }))}
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
            <button
              data-tip={t('appUnderline')}
              className={selectionFormat?.underline ? 'is-active' : ''}
              onClick={() => onCommand('underline')}
            >
              <u>U</u>
            </button>
            <button
              data-tip={t('appDoubleUnderline')}
              onClick={() => onCommand('underline:double')}
            >
              <u style={{ textDecorationStyle: 'double' }}>D</u>
            </button>
            <button
              data-tip={t('appStrikethrough')}
              className={selectionFormat?.strike ? 'is-active' : ''}
              onClick={() => onCommand('strike')}
            >
              <s>S</s>
            </button>
            <ColorDropdown
              label="Font color"
              data-tip={t('appFontColor')}
              display={
                <span className="swatch-letter">
                  A<i style={{ background: fontColor }} />
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
            <MenuSelect
              className="select-like compact"
              label="Borders"
              data-tip={t('appBorders')}
              display={
                <>
                  <ToolSymbol symbol="⊡" /> {t('appBorders')}
                </>
              }
              options={[
                { value: 'all', label: t('appBorderAll'), icon: <BorderGlyph on="all" /> },
                { value: 'outer', label: t('appBorderOuter'), icon: <BorderGlyph on="outer" /> },
                {
                  value: 'thick-outer',
                  label: t('appBorderThickOuter'),
                  icon: <BorderGlyph on="thick" />,
                },
                { value: 'top', label: t('appBorderTop'), icon: <BorderGlyph on="top" /> },
                { value: 'bottom', label: t('appBorderBottom'), icon: <BorderGlyph on="bottom" /> },
                { value: 'left', label: t('appBorderLeft'), icon: <BorderGlyph on="left" /> },
                { value: 'right', label: t('appBorderRight'), icon: <BorderGlyph on="right" /> },
                { value: 'none', label: t('appBorderNone'), icon: <BorderGlyph on="none" /> },
              ]}
              onPick={(value) => onCommand(`border:${value}:${borderColor}`)}
            />
            <ColorDropdown
              label="Border color"
              data-tip={t('appBorderColor')}
              display={
                <span className="swatch-letter">
                  <ToolSymbol symbol="⊡" />
                  <i style={{ background: borderColor }} />
                </span>
              }
              value={borderColor}
              onPick={(hex) => {
                if (hex) setBorderColor(hex)
              }}
            />
          </div>
        </div>
      </RibbonGroup>
      <RibbonGroup label={t('appGroupAlignment')}>
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
              <ToolSymbol symbol="↕" />
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
                { value: '45', label: t('appAngleCcw'), icon: <TextDirGlyph deg={-45} ch="ab" /> },
                { value: '-45', label: t('appAngleCw'), icon: <TextDirGlyph deg={45} ch="ab" /> },
                {
                  value: 'vertical',
                  label: t('appVerticalText'),
                  icon: <TextDirGlyph deg={90} ch="ab" />,
                },
                { value: '90', label: t('appRotateUp'), icon: <TextDirGlyph deg={180} ch="ab" /> },
                { value: '-90', label: t('appRotateDown'), icon: <TextDirGlyph deg={0} ch="ab" /> },
                { value: '0', label: t('appClearRotation'), icon: <TextDirGlyph deg={0} ch="↺" /> },
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
                { value: 'center', label: t('appMergeCenter'), icon: <MergeGlyph mode="center" /> },
                { value: 'across', label: t('appMergeAcross'), icon: <MergeGlyph mode="across" /> },
                { value: 'cells', label: t('appMergeCells'), icon: <MergeGlyph mode="cells" /> },
                { value: 'unmerge', label: t('appUnmergeCells'), icon: <MergeGlyph mode="none" /> },
              ]}
              onPick={(value) => onCommand(`merge:${value}`)}
            />
          </div>
        </div>
      </RibbonGroup>
      <RibbonGroup label={t('appGroupNumber')}>
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
              className="select-like compact"
              label="Accounting"
              data-tip={t('appCurrency')}
              display={
                <>
                  <ToolSymbol symbol="💰" /> ⌄
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
      {/* WPS 开始 tab #33-34：行和列⌄ + 工作表⌄（聚合下拉） */}
      <RibbonGroup label={t('appRowcolMenu')}>
        <MenuSelect
          className="select-like compact"
          label="Rows and Columns"
          data-tip={t('appRowcolMenu')}
          display={
            <>
              <ToolSymbol symbol="⊞" /> {t('appRowcolMenu')}
            </>
          }
          options={[
            {
              value: 'row-height-open',
              label: t('appRowcolRowHeight'),
              icon: <OptSample>↕</OptSample>,
            },
            {
              value: 'col-width-open',
              label: t('appRowcolColWidth'),
              icon: <OptSample>↔</OptSample>,
            },
            {
              value: 'rowcol:fit-row-height',
              label: t('appRowcolFitRow'),
              icon: <OptSample>↕✦</OptSample>,
            },
            {
              value: 'rowcol:fit-col-width',
              label: t('appRowcolFitCol'),
              icon: <OptSample>↔✦</OptSample>,
            },
            {
              value: 'rowcol:hide-rows',
              label: t('appRowcolHideRows'),
              icon: <OptSample>—▾</OptSample>,
            },
            {
              value: 'rowcol:unhide-rows',
              label: t('appRowcolUnhideRows'),
              icon: <OptSample>—▴</OptSample>,
            },
            {
              value: 'rowcol:hide-cols',
              label: t('appRowcolHideCols'),
              icon: <OptSample>—◂</OptSample>,
            },
            {
              value: 'rowcol:unhide-cols',
              label: t('appRowcolUnhideCols'),
              icon: <OptSample>—▸</OptSample>,
            },
          ]}
          onPick={(value) => onCommand(value)}
        />
        <MenuSelect
          className="select-like compact"
          label="Worksheet"
          data-tip={t('appSheetMenu')}
          display={
            <>
              <ToolSymbol symbol="▤" /> {t('appSheetMenu')}
            </>
          }
          options={[
            { value: 'sheetop:rename', label: t('appSheetRename'), icon: <OptSample>✎</OptSample> },
            {
              value: 'sheetop:tab-color:none',
              label: t('appSheetTabColor') + '·' + t('appTabColorNone'),
              icon: <OptSample>∅</OptSample>,
            },
            {
              value: 'sheetop:tab-color:C00000',
              label: t('appSheetTabColor') + '·1',
              icon: <ColorDot color="#C00000" />,
            },
            {
              value: 'sheetop:tab-color:FFC000',
              label: t('appSheetTabColor') + '·2',
              icon: <ColorDot color="#FFC000" />,
            },
            {
              value: 'sheetop:tab-color:FFFF00',
              label: t('appSheetTabColor') + '·3',
              icon: <ColorDot color="#FFFF00" />,
            },
            {
              value: 'sheetop:tab-color:00B050',
              label: t('appSheetTabColor') + '·4',
              icon: <ColorDot color="#00B050" />,
            },
            {
              value: 'sheetop:tab-color:0070C0',
              label: t('appSheetTabColor') + '·5',
              icon: <ColorDot color="#0070C0" />,
            },
            {
              value: 'sheetop:tab-color:7030A0',
              label: t('appSheetTabColor') + '·6',
              icon: <ColorDot color="#7030A0" />,
            },
            { value: 'sheetop:hide', label: t('appSheetHide'), icon: <OptSample>🙈</OptSample> },
            { value: 'sheetop:unhide', label: t('appSheetUnhide'), icon: <OptSample>👁</OptSample> },
          ]}
          onPick={(value) => onCommand(value)}
        />
      </RibbonGroup>
      <RibbonGroup label={t('appGroupStyles')}>
        {/* WPS 样式组布局（CT_Home.kuip RB_ConditionalFormatting）：2×2 大钮网格 */}
        <div className="style-big-grid">
          <div className="ribbon-tool large as-button" data-tip={t('appConditionalFormatting')}>
            <span className="tool-icon-row">
              <ToolSymbol symbol="▤" />
              <CaretIcon />
            </span>
            <span>
              <strong>{t('appConditionalFormatting')}</strong>
            </span>
            <CondFormatSelect
              label={t('appConditionalFormatting')}
              data-tip={t('appConditionalFormatting')}
              onCommand={onCommand}
            />
          </div>
          <div className="ribbon-tool large as-button" data-tip={t('appFormatAsTableTitle')}>
            <span className="tool-icon-row">
              <ToolSymbol symbol="▦" />
              <CaretIcon />
            </span>
            <span>
              <strong>{t('appFormatAsTable')}</strong>
            </span>
            <TableStyleGallerySelect
              label={t('appFormatAsTable')}
              data-tip={t('appFormatAsTableTitle')}
              onPick={(value) => onCommand(`format-as-table:${value}`)}
            />
          </div>
          <div className="ribbon-tool large as-button" data-tip={t('appCellStylesTitle')}>
            <span className="tool-icon-row">
              <ToolSymbol symbol="🎨" />
              <CaretIcon />
            </span>
            <span>
              <strong>{t('appCellStyles')}</strong>
            </span>
            <CellStyleSelect
              label={t('appCellStyles')}
              data-tip={t('appCellStylesTitle')}
              onPick={(value) => onCommand(`cell-style:${value}`)}
            />
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
      <RibbonGroup label={t('appGroupCells')}>
        <div className="ribbon-rows">
          <button
            className="styles-row as-button"
            data-tip={t('appFormatCells')}
            data-tip-kbd={platformShortcuts('⌘1')}
            onClick={() => onCommand('format-cells')}
          >
            <ToolSymbol symbol="🎨" />
            {t('appFormatCells')} {platformShortcuts('⌘1')}
            <CaretIcon />
          </button>
          <div className="inline-tools cell-tools">
            <button
              data-tip={t('appInsertRow')}
              aria-label={t('appInsertRow')}
              onClick={() => onCommand('insert-row-here')}
            >
              <ToolSymbol symbol="⤒" />
            </button>
            <button
              data-tip={t('appDeleteRow')}
              aria-label={t('appDeleteRow')}
              onClick={() => onCommand('delete-row-here')}
            >
              <ToolSymbol symbol="⤓" />
            </button>
            <button
              data-tip={t('appInsertCol')}
              aria-label={t('appInsertCol')}
              onClick={() => onCommand('insert-col-here')}
            >
              <ToolSymbol symbol="⇤" />
            </button>
            <button
              data-tip={t('appDeleteCol')}
              aria-label={t('appDeleteCol')}
              onClick={() => onCommand('delete-col-here')}
            >
              <ToolSymbol symbol="⇥" />
            </button>
            <MenuSelect
              className="select-like compact"
              label="Format"
              data-tip={t('appFormatMenu')}
              display={
                <>
                  <ToolSymbol symbol="⇳" /> {t('appFormatMenu')}
                </>
              }
              options={[
                { value: 'row-height-open', label: `${t('appRowHeight')}…` },
                { value: 'col-width-open', label: `${t('appColWidth')}…` },
              ]}
              onPick={(value) => onCommand(value)}
            />
          </div>
        </div>
      </RibbonGroup>
      <RibbonGroup label={t('appGroupEditing')}>
        {/* WPS 编辑组布局（CT_Home.kuip RB_Editing）：填充大钮⌄ + 求和大钮⌄ +
            排序/筛选、冻结/查找、清除 双列小钮栈 */}
        <div className="edit-big-row">
          <div className="ribbon-tool large as-button" data-tip={t('appFillMenu')}>
            <span className="tool-icon-row">
              <ToolSymbol symbol="↓" />
              <CaretIcon />
            </span>
            <span>
              <strong>{t('appFillMenu')}</strong>
            </span>
            <MenuSelect
              cover
              label="Fill"
              options={[
                { value: 'down', label: t('appFillDown'), icon: <OptSample>↓</OptSample> },
                { value: 'right', label: t('appFillRight'), icon: <OptSample>→</OptSample> },
              ]}
              onPick={(value) => onCommand(`fill-${value}`)}
            />
          </div>
          <div className="ribbon-tool large as-button" data-tip={t('appAutoSumTitle')}>
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
                { value: 'autofn:SUM', label: t('appFnSum'), icon: <OptSample>Σ</OptSample> },
                {
                  value: 'autofn:AVERAGE',
                  label: t('appFnAverage'),
                  icon: <OptSample>x̄</OptSample>,
                },
                {
                  value: 'autofn:COUNT',
                  label: t('appFnCountNumbers'),
                  icon: <OptSample>#</OptSample>,
                },
                { value: 'autofn:MAX', label: t('appFnMax'), icon: <OptSample>▲</OptSample> },
                { value: 'autofn:MIN', label: t('appFnMin'), icon: <OptSample>▼</OptSample> },
                {
                  value: 'insert-function-open',
                  label: t('appFnCatMore') + '…',
                  icon: <OptSample>fx</OptSample>,
                },
              ]}
              onPick={(value) => onCommand(value)}
            />
          </div>
        </div>
        <div className="edit-mini-grid">
          <MenuSelect
            className="select-like compact"
            label="Sort"
            data-tip={t('appSortSelectionTitle')}
            display={
              <>
                <ToolSymbol symbol="⇅" /> {t('appSort')}
              </>
            }
            options={[
              { value: 'sort:asc', label: t('appSortAToZ'), icon: <SortGlyph asc /> },
              { value: 'sort:desc', label: t('appSortZToA'), icon: <SortGlyph asc={false} /> },
              {
                value: 'sort-custom-open',
                label: t('appCustomSort'),
                icon: <OptSample>⚙</OptSample>,
              },
            ]}
            onPick={(value) => onCommand(value)}
          />
          <MenuSelect
            className="select-like compact"
            label="Filter"
            data-tip={t('appFilterToggleDetail')}
            display={
              <>
                <ToolSymbol symbol="▽" /> {t('appFilter')}
              </>
            }
            options={[
              { value: 'filter-toggle', label: t('appFilter'), icon: <OptSample>▽</OptSample> },
              { value: 'filter-clear', label: t('appClear'), icon: <OptSample>⊘</OptSample> },
              { value: 'filter-reapply', label: t('appReapply'), icon: <OptSample>↻</OptSample> },
            ]}
            onPick={(value) => onCommand(value)}
          />
          <MenuSelect
            className="select-like compact"
            label="Freeze"
            data-tip={t('appFreezeTitle')}
            display={
              <>
                <ToolSymbol symbol="❄" /> {t('appFreezePanes')}
              </>
            }
            options={[
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
            ]}
            onPick={(value) => onCommand(value)}
          />
          <MenuSelect
            className="select-like compact"
            label="Find"
            data-tip={t('appFindTitle')}
            display={
              <>
                <ToolSymbol symbol="🔍" /> {t('appFind')}
              </>
            }
            options={[
              { value: 'find', label: t('appFind'), icon: <OptSample>🔍</OptSample> },
              { value: 'replace', label: t('appReplace'), icon: <OptSample>⇄</OptSample> },
              { value: 'goto-open', label: `${t('appGoTo')} ⌘G`, icon: <OptSample>⌖</OptSample> },
            ]}
            onPick={(value) => onCommand(value)}
          />
          <MenuSelect
            className="select-like compact"
            label="Clear"
            data-tip={t('appClear')}
            display={
              <>
                <ToolSymbol symbol="⌫" /> {t('appClear')}
              </>
            }
            options={[
              { value: 'all', label: t('appClearAll'), icon: <OptSample>⌫</OptSample> },
              { value: 'formats', label: t('appClearFormats'), icon: <OptSample>Aa</OptSample> },
              {
                value: 'contents',
                label: t('appClearContents'),
                icon: <OptSample>123</OptSample>,
              },
            ]}
            onPick={(value) => onCommand(`clear-${value}`)}
          />
        </div>
      </RibbonGroup>
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

/** 边框 menu: 3×3 grid with the chosen edges painted 2.2px. */
function BorderGlyph({
  on,
}: {
  on: 'all' | 'outer' | 'thick' | 'top' | 'bottom' | 'left' | 'right' | 'none'
}) {
  const w = on === 'thick' ? 2.8 : 2.2
  const thickFrame = on === 'all' || on === 'outer' || on === 'thick'
  return (
    <OptSvg>
      <rect x="2.5" y="2.5" width="15" height="15" opacity={thickFrame ? 0 : 0.5} />
      <path
        d="M2.5 7.5 h15 M2.5 12.5 h15 M7.5 2.5 v15 M12.5 2.5 v15"
        opacity="0.45"
        strokeWidth="1"
      />
      {thickFrame && <rect x="2.5" y="2.5" width="15" height="15" strokeWidth={w} />}
      {on === 'all' && (
        <path
          d="M2.5 7.5 h15 M2.5 12.5 h15 M7.5 2.5 v15 M12.5 2.5 v15"
          strokeWidth={w}
          opacity="0.9"
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
      {mode === 'center' && <rect x="3.6" y="3.6" width="12.8" height="12.8" strokeWidth="2" />}
      {mode === 'across' && <path d="M3.6 3.6 h12.8 M3.6 16.4 h12.8" strokeWidth="2" />}
      {mode === 'cells' && (
        <>
          <rect x="3.6" y="3.6" width="12.8" height="5.6" strokeWidth="2" />
          <rect x="3.6" y="10.8" width="12.8" height="5.6" strokeWidth="2" />
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
      {mode === 'cross' && <path d="M2.5 7 h15 M7 2.5 v15" strokeWidth="2.2" />}
      {mode === 'row' && <path d="M2.5 4.7 h15" strokeWidth="2.4" />}
      {mode === 'col' && <path d="M4.7 2.5 v15" strokeWidth="2.4" />}
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
function ColorDot({ color }: { color: string }) {
  return <i className="menu-color-dot" style={{ background: color }} aria-hidden="true" />
}

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
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              role="option"
              aria-selected={value !== '' && option.value === value}
              className={value !== '' && option.value === value ? 'on' : ''}
              onClick={() => {
                setOpen(false)
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
          ))}
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

/// 代表性色板：xlsx 只存内置样式名（TableStyleMedium2 等），真实强调色由
/// Excel/WPS 打开时按主题渲染；画廊缩略图只需家族忠实的区分度（对齐 Excel
/// 自家画廊的做法）。Medium2 蓝 / Medium4 橙 / Medium7 绿 / Dark2 深蓝。
const TABLE_STYLE_PREVIEWS = [
  {
    value: 'TableStyleLight1',
    labelKey: 'appTableStyleLight1',
    header: '#FFFFFF',
    ink: '#1F1F1F',
    band: null,
    grid: '#B4B4B4',
  },
  {
    value: 'TableStyleLight9',
    labelKey: 'appTableStyleLight9',
    header: '#9DC3E6',
    ink: '#1F1F1F',
    band: null,
    grid: '#B4B4B4',
  },
  {
    value: 'TableStyleMedium2',
    labelKey: 'appTableStyleMedium2',
    header: '#4472C4',
    ink: '#FFFFFF',
    band: '#D9E1F2',
    grid: null,
  },
  {
    value: 'TableStyleMedium4',
    labelKey: 'appTableStyleMedium4',
    header: '#ED7D31',
    ink: '#FFFFFF',
    band: '#FBE5D6',
    grid: null,
  },
  {
    value: 'TableStyleMedium7',
    labelKey: 'appTableStyleMedium7',
    header: '#70AD47',
    ink: '#FFFFFF',
    band: '#E2EFDA',
    grid: null,
  },
  {
    value: 'TableStyleDark2',
    labelKey: 'appTableStyleDark2',
    header: '#2F5597',
    ink: '#FFFFFF',
    band: '#D9E1F2',
    grid: null,
  },
] as const satisfies ReadonlyArray<{
  value: string
  labelKey: StringKey
  header: string
  ink: string
  band: string | null
  grid: string | null
}>

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

/// 套用表格格式: thumbnail gallery (Excel/WPS gallery look) over the usual
/// invisible cover trigger.
function TableStyleGallerySelect({
  label,
  'data-tip': tip,
  onPick,
}: {
  readonly label: string
  readonly 'data-tip'?: string
  readonly onPick: (style: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })
  useEscapeClose(open, () => setOpen(false))
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
          <div className="rb-drop-title">{label}</div>
          <div className="style-thumb-grid">
            {TABLE_STYLE_PREVIEWS.map((p) => (
              <button
                type="button"
                key={p.value}
                role="option"
                aria-selected={false}
                className="style-thumb-cell"
                onClick={() => {
                  setOpen(false)
                  onPick(p.value)
                }}
              >
                <TableStyleThumb header={p.header} ink={p.ink} band={p.band} grid={p.grid} />
                <span>{t(p.labelKey)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/// 单元格样式: fill-swatch groups (好差中性 / 标题 / 数据与模型 / 强调),
/// mirroring Excel's grouped cell-style gallery.
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
    titleKey: 'appCellStyleGroupTitle',
    items: [
      { value: 'title', labelKey: 'appTitle', fill: '#FFFFFF', ink: '#1F1F1F' },
      { value: 'heading-1', labelKey: 'appStyleHeading1', fill: '#4472C4', ink: '#FFFFFF' },
      { value: 'heading-2', labelKey: 'appStyleHeading2', fill: '#D9E1F2', ink: '#1F1F1F' },
    ],
  },
  {
    titleKey: 'appCellStyleGroupData',
    items: [
      { value: 'input', labelKey: 'appStyleInput', fill: '#E7F1FB', ink: '#1F1F1F' },
      { value: 'output', labelKey: 'appStyleOutput', fill: '#FFFFFF', ink: '#2F5597' },
      { value: 'calculation', labelKey: 'appStyleCalculation', fill: '#E2EFDA', ink: '#375623' },
      { value: 'warning-text', labelKey: 'appStyleWarningText', fill: '#FFF2CC', ink: '#7F6000' },
    ],
  },
  {
    titleKey: 'appCellStyleGroupAccent',
    items: [
      { value: 'accent1-20', labelKey: 'appStyleAccent120', fill: '#D9E1F2', ink: '#1F1F1F' },
      { value: 'accent1-40', labelKey: 'appStyleAccent140', fill: '#B4C6E7', ink: '#1F1F1F' },
      { value: 'accent1', labelKey: 'appStyleAccent1', fill: '#4472C4', ink: '#FFFFFF' },
      { value: 'total', labelKey: 'appStyleTotal', fill: '#F2F2F2', ink: '#1F1F1F' },
    ],
  },
]

function CellStyleSelect({
  label,
  'data-tip': tip,
  onPick,
}: {
  readonly label: string
  readonly 'data-tip'?: string
  readonly onPick: (style: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })
  useEscapeClose(open, () => setOpen(false))
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
          {CELL_STYLE_GROUPS.map((group) => (
            <div key={group.titleKey}>
              <div className="rb-drop-title">{t(group.titleKey)}</div>
              <div className="cell-style-col">
                {group.items.map((item) => (
                  <button
                    type="button"
                    key={item.value}
                    role="option"
                    aria-selected={false}
                    className="cell-style-row"
                    onClick={() => {
                      setOpen(false)
                      onPick(item.value)
                    }}
                  >
                    <span className="cell-style-swatch" style={{ background: item.fill }}>
                      {item.ink ? <i style={{ color: item.ink }}>ab</i> : null}
                    </span>
                    {t(item.labelKey)}
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

/// 条件格式: WPS-style typed menu — each entry opens the Univer CF panel
/// preseeded with that rule type; 管理规则 keeps the old manage-list behavior.
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
        <div className="menu-select-drop" role="listbox" aria-label={label}>
          <button
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => pick('cf-new:3')}
          >
            {t('appCfHlRule')}
          </button>
          <button
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => pick('cf-new:4')}
          >
            {t('appCfRankRule')}
          </button>
          <button
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => pick('cf-new:5')}
          >
            {t('appCfFormulaRule')}
          </button>
          <div className="rb-menu-sep" role="separator" />
          <button
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => pick('cf-new:6')}
          >
            {t('appCfColorScale')}
          </button>
          <button
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => pick('cf-new:7')}
          >
            {t('appCfDataBar')}
          </button>
          <button
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => pick('cf-new:8')}
          >
            {t('appCfIconSet')}
          </button>
          <div className="rb-menu-sep" role="separator" />
          <button type="button" role="option" aria-selected={false} onClick={() => pick('cf-open')}>
            {t('appCfManage')}
          </button>
        </div>
      )}
    </div>
  )
}

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
  )
}

function RibbonGroup({
  label,
  children,
}: {
  readonly label: string
  readonly children: React.ReactNode
}): React.JSX.Element {
  // No visible group captions — the label stays for assistive tech.
  return (
    <section className="ribbon-group" aria-label={label}>
      <div className="ribbon-group-content">{children}</div>
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
