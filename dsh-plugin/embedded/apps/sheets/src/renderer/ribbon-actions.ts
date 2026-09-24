/**
 * The ribbon command dispatcher. Extracted from App.tsx; the App component
 * passes a RibbonCommandContext built fresh per call so refs and state never
 * go stale. Page-layout, export and save flows stay in App and arrive here
 * as callbacks.
 */
import {
  BooleanNumber,
  BorderStyleTypes,
  BorderType,
  CellValueType,
  IUniverInstanceService,
  WrapStrategy,
  type ICellData,
  type IStyleData,
} from '@univerjs/core'
import { IRenderManagerService, SHEET_VIEWPORT_KEY } from '@univerjs/engine-render'
import { ISheetClipboardService, SheetSkeletonManagerService } from '@univerjs/preset-sheets-core'
import { CFNumberOperator, CFValueType } from '@univerjs/preset-sheets-conditional-formatting'
import type { IIconSetType } from '@univerjs/sheets-conditional-formatting'
import { columnLabel, formatAddress } from '@chatoffice/xlsx-gateway/domain/cell-address'
import type { WorkbookOperation } from '@chatoffice/xlsx-gateway/domain/workbook-dsl'
import type { ApplyOutcome } from '@chatoffice/xlsx-gateway/domain/workbook.types'
import { SET_ROW_IS_AUTO_HEIGHT_COMMAND } from './autofit-multi-row'
import { fullColumnSpans, fullRowSpans } from './autofit-selection'
import { nextSheetName } from './op-executor'
import { transposeChartSeries, type ChartSeriesVisualState } from '@chatoffice/xlsx-gateway/domain/chart-visual'
import { applyFlashFillTemplate, inferFlashFillTemplate } from '@chatoffice/xlsx-gateway/domain/flash-fill'
import { csvSheetById, serializeActiveSheetCsv } from './csv-export'
import { parseTsv, plainTextFromCells } from './clipboard-tsv'
import { boundingRange, renderRangeToPng } from './range-image'
import type {
  WorkbookChartEdit,
  WorkbookStyleEdit,
  WorkbookVisualObject,
} from '../shared/desktop-api'
import type { CellFormatPatch } from '@chatoffice/xlsx-gateway/domain/workbook-dsl'
import {
  CELL_STYLE_PRESETS,
  CHART_LABEL_COMMANDS,
  CHART_LEGEND_COMMANDS,
  CHART_PALETTES,
  CHART_TYPE_COMMANDS,
} from './app-constants'
import {
  handleApplyFormula,
  handleCreateNamesFromSelection,
  handleFormatAsTable,
  handleImportCsv,
  handleOutline,
  openAdvancedFilterDialog,
  type DataToolsContext,
} from './data-tools-actions'
import { dedupeRows } from './dedupe'
import { runStreamedErrorCheck } from './error-checking'
import {
  fillBlanksFromAbove,
  fillLeftMatrix,
  fillSeries123,
  fillUpMatrix,
  condStatsFormula,
  formatFillDate,
  insertTextAtPosition,
  rankColumn,
  seriesValues,
  type Matrix,
} from './fill-tools'
import { colorScaleStopsOf, cfHlStyleOf, dataBarOf, iconSetOf } from './cf-gallery'
import {
  getCustomCellStyle,
  getCustomTableStyle,
  mergeCustomCellStyles,
} from './custom-styles'
import {
  isSheetRemoved,
  journalSize,
  NO_FILL_STYLE,
  recordNeutralStyleEdit,
  recordPageSetup,
  recordSparklineAdd,
  recordStructuralOp,
  removeStructuralOp,
  recordWorkbookProtection,
  removeSparklineAdd,
} from './edit-journal'
import { applyShowFormulasView, formulaViewSheets } from './formula-view'
import { t } from './i18n/locale'
import { mergeWorkbooksIntoCurrent } from './merge-workbooks'
import {
  handleOpenSlicerPicker,
  handleOpenTimelinePicker,
  handleRefreshAllPivots,
  type PivotActionContext,
} from './pivot-actions'
import { INDENT_STEP_PX, normalizeHexColor } from './selection-format'
import { collectDependents, collectPrecedents, installTraceArrows } from './trace-arrows'
import {
  absRangeRef,
  applyFormatPatchToRange,
  characterWidthToPixels,
  attachVisualUndoToLastStep,
  getScrollAnchor,
  normalizeLinkTarget,
  topUndoElement,
  pushVisualUndo,
  revealCellBelowFreeze,
  queueSparklineInstall,
  workbookStructureLocked,
} from './univer-sync'
import {
  BORDER_COMMAND_TYPES,
  type ActiveWorkbook,
  type LazyWorkbookState,
  type UniverRuntime,
  type UniverWorksheet,
} from './univer-state'
import {
  handleInsertChart,
  handleInsertPicture,
  handleInsertPivotChart,
  handleInsertShape,
  insertPictureFromData,
  startShapeDraw,
  type VisualActionContext,
} from './visual-actions'
import type { ChartDialogKind, ChartEditData, ShapeEditChanges } from './WorkbookVisuals'

/** The App refs/state the ribbon dispatcher needs; built fresh per call. */
export interface RibbonCommandContext {
  univerRef: { readonly current: UniverRuntime | null }
  lazyWorkbookRef: { current: LazyWorkbookState | null }
  /// Imported workbooks: run workbook DSL ops through the shared executor
  /// (op-executor.ts), the same path AI proposals take.
  runOps: (
    ops: readonly WorkbookOperation[],
    successMessage?: string | null,
  ) => Promise<ApplyOutcome>
  traceArrowsRef: { current: { disposables: { dispose(): void }[]; nextId: number } }
  sparklineDisposablesRef: { current: { dispose(): void }[] }
  sparklineTimerRef: { current: ReturnType<typeof setTimeout> | null }
  chartEditRef: { readonly current: (chartPath: string, edit: ChartEditData) => void }
  shapeEditRef: { readonly current: (visualId: string, changes: ShapeEditChanges) => void }
  refreshSelectionFormatRef: { readonly current: () => void }
  selectedVisual: WorkbookVisualObject | null
  selectedChart: {
    readonly isPie: boolean
    readonly canLabel: boolean
    readonly seriesCount: number
    readonly categoryCount: number
    /// Current series (pending edits applied) for Switch Row/Column.
    readonly series: readonly ChartSeriesVisualState[]
  } | null
  setMessage: (message: string) => void
  setChartDialog: (dialog: { kind: ChartDialogKind; editKey: string }) => void
  setSymbolDialogOpen: (open: boolean) => void
  setScreenshotDialogOpen: (open: boolean) => void
  setIconsDialogOpen: (open: boolean) => void
  setEquationDialogOpen: (open: boolean) => void
  openRecommendedCharts: () => void
  setChartDesignerOpen: (open: boolean) => void
  setPendingEdits: (count: number) => void
  visualContext: () => VisualActionContext
  dataToolsContext: () => DataToolsContext
  pivotContext: () => PivotActionContext
  handlePageLayoutCommand: (rest: string) => void
  handleExportPdf: () => Promise<boolean>
}

/// Resolves interned style references and merges row/col/sheet styles —
/// raw getCellData().s can be a style-id string with no fields on it.
function selectionStyle(
  range: NonNullable<ReturnType<ActiveWorkbook['getActiveRange']>>,
): IStyleData {
  return range.getCellStyleData() ?? {}
}

/// 选区写入前的流式加载闸：部分流式导入的工作簿只装了已浏览区域，对未加载
/// 格的读改写会把看不见的数据清掉（与 remove-duplicates 同一判断）。
function requireLoadedSelection(
  ctx: RibbonCommandContext,
  worksheet: UniverWorksheet,
  range: NonNullable<ReturnType<ActiveWorkbook['getActiveRange']>>,
): boolean {
  const state = ctx.lazyWorkbookRef.current
  if (!state || state.flags.preloadComplete) return true
  if (state.editJournal.sheets.added.has(worksheet.getSheetId())) return true
  if (state.formulaMode && state.flags.preloadComplete) return true
  ctx.setMessage(t('appFillNeedsFullLoad'))
  void range
  return false
}

/// 写选区外一格（排名/条件统计落点）前的行加载闸（autofn 同款）。
function guardTargetRowLoaded(ctx: RibbonCommandContext, worksheet: { getSheetId(): string }, targetRow: number): boolean {
  const state = ctx.lazyWorkbookRef.current
  if (!state || state.flags.preloadComplete) return true
  const sheet = state.file.sheets.find((candidate) => candidate.id === worksheet.getSheetId())
  const loaded = state.loadedRanges.get(worksheet.getSheetId())
  const targetInData = sheet !== undefined && targetRow < sheet.rowCount
  const targetLoaded =
    loaded !== undefined && targetRow >= loaded.startRow && targetRow <= loaded.endRow
  if (targetInData && !targetLoaded) {
    ctx.setMessage(t('appRowBelowStreaming'))
    return false
  }
  return true
}

/// 冻结至第 N 行 M 列的统一落点：流式簿走 runOps，普通簿直接 setFreeze。
function applyFreeze(
  ctx: RibbonCommandContext,
  worksheet: UniverWorksheet,
  rows: number,
  columns: number,
  message: string,
): void {
  if (ctx.lazyWorkbookRef.current) {
    void ctx.runOps(
      [{ op: 'set_freeze', sheetId: worksheet.getSheetId(), rows, columns }],
      message,
    )
    return
  }
  worksheet.setFreeze({
    startRow: rows > 0 ? rows : -1,
    startColumn: columns > 0 ? columns : -1,
    xSplit: columns,
    ySplit: rows,
  })
  ctx.setMessage(message)
}

/// 图标集阈值：除末档（min）外按等分百分比（3 档 67/33，5 档 80/60/40/20）。
export function iconThresholds(count: number): number[] {
  return Array.from({ length: count - 1 }, (_, index) =>
    Math.round(100 - ((index + 1) * 100) / count),
  )
}

/// 当前工作表上可定位的浮动对象（图片/图表/形状，含会话新增、剔除已删），
/// 按文档顺序返回锚点起点——选择对象取最上层即末项。选择窗格对话框也用它。
export interface SheetVisualRef {
  readonly id: string
  readonly kind: string
  readonly fromRow: number
  readonly fromColumn: number
}

export function listSheetVisuals(
  ctx: RibbonCommandContext,
  worksheet: UniverWorksheet | null | undefined,
): readonly SheetVisualRef[] {
  const state = ctx.lazyWorkbookRef.current
  if (!state || !worksheet) return []
  const sheetId = worksheet.getSheetId()
  const removed = new Set<string>()
  for (const [id, edit] of state.editJournal.visualEdits) {
    if (edit.remove) removed.add(id)
  }
  const visuals = [...state.file.visuals, ...state.editJournal.visualAdds].filter(
    (visual) => visual.sheetId === sheetId && !removed.has(visual.id),
  )
  return visuals.map((visual) => ({
    id: visual.id,
    kind: visual.kind,
    fromRow: visual.anchor.fromRow,
    fromColumn: visual.anchor.fromColumn,
  }))
}

/// 两个 0 基行列矩形是否相交（cf-clear:selection 用）。
function rangesIntersect(
  a: { startRow: number; endRow: number; startColumn: number; endColumn: number },
  b: { startRow: number; endRow: number; startColumn: number; endColumn: number } | undefined,
): boolean {
  if (!b) return false
  return (
    a.startRow <= b.endRow &&
    b.startRow <= a.endRow &&
    a.startColumn <= b.endColumn &&
    b.startColumn <= a.endColumn
  )
}

/// 浅底色上的可读字色（自定义表头填充 → 白字或深字）。
function pickReadableInk(hex: string): '#FFFFFF' | '#1F1F1F' {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  if (!match) return '#FFFFFF'
  const value = Number.parseInt(match[1] ?? '000000', 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  return 0.299 * r + 0.587 * g + 0.114 * b < 150 ? '#FFFFFF' : '#1F1F1F'
}

/// 突出显示规则构建链（whenXxx → setBackground/setFontColor/setBorder）。
type CfHighlightChain = ReturnType<
  ReturnType<UniverWorksheet['newConditionalFormattingRule']>['whenCellNotEmpty']
>

type CfRuleBuilder = ReturnType<UniverWorksheet['newConditionalFormattingRule']>

function addStyledCfRule(
  worksheet: UniverWorksheet,
  _builder: CfRuleBuilder,
  styled: CfHighlightChain,
  preset: { readonly fill: string | null; readonly ink: string | null; readonly border: string | null },
  range: { startRow: number; endRow: number; startColumn: number; endColumn: number },
): void {
  if (preset.fill) styled = styled.setBackground(preset.fill)
  if (preset.ink) styled = styled.setFontColor(preset.ink)
  worksheet.addConditionalFormattingRule(styled.setRanges([range]).build())
}

/// Commands whose wire format is `name:argument:extra` (three segments).
/// Every other command treats the whole remainder after the first colon as
/// the argument, because arguments like number-format patterns
/// ("h:mm:ss AM/PM") legitimately contain colons.
const EXTRA_SEGMENT_COMMANDS = new Set(['cellprot', 'sort-custom', 'border', 'draw-border'])

/// Univer's built-in header sizes, restored when headings toggle back on.
const DEFAULT_ROW_HEADER_WIDTH = 46
const DEFAULT_COLUMN_HEADER_HEIGHT = 20

/// OOXML error literals (Formulas › Error Checking scans display values).
const ERROR_VALUE_PATTERN = /^#(DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!|SPILL!|CALC!)/
/// Row-major ordinal for "next error after the active cell" (> max columns).
const COLUMN_LIMIT = 20_000

/// ST_BorderStyle names accepted by the Format Cells line-style picker.
const BORDER_LINE_STYLE_TYPES: Record<string, BorderStyleTypes> = {
  thin: BorderStyleTypes.THIN,
  medium: BorderStyleTypes.MEDIUM,
  thick: BorderStyleTypes.THICK,
  double: BorderStyleTypes.DOUBLE,
  hair: BorderStyleTypes.HAIR,
  dashed: BorderStyleTypes.DASHED,
  dotted: BorderStyleTypes.DOTTED,
}

/// One-shot 绘图边框 arm state (WPS's pencil cursor): the next selection
/// gesture on the grid applies this border op to the selected range. The
/// pen color / line style ride in from the ribbon at arm time.
let armedDrawBorder: {
  readonly kind: 'outline' | 'grid' | 'erase'
  readonly color: string
  readonly style: BorderStyleTypes
} | null = null

/// The last in-app copy, as cached by Univer's clipboard service (public
/// copyContentCache(); rows/cols are the discrete copy coordinates).
interface InternalCopyCacheEntry {
  readonly unitId: string
  readonly subUnitId: string
  readonly range: { readonly rows: readonly number[]; readonly cols: readonly number[] }
  readonly copyType: string
}

function lastInternalCopy(
  runtime: NonNullable<RibbonCommandContext['univerRef']['current']>,
): InternalCopyCacheEntry | null {
  try {
    const clipboard = runtime.univer.__getInjector().get(ISheetClipboardService) as {
      copyContentCache(): {
        getLastCopyId(): string | null
        get(id: string): InternalCopyCacheEntry | undefined
      }
    }
    const cache = clipboard.copyContentCache()
    const id = cache.getLastCopyId()
    return (id ? cache.get(id) : undefined) ?? null
  } catch {
    return null
  }
}

/// 转置: rebuilds the last copy transposed into the active range — values,
/// formulas and composed styles come live off the copy's source sheet (the
/// cache stores only coordinates). Merged blocks flatten to their top-left
/// value; WPS additionally recreates the merge transposed, which we skip.
async function pasteTransposed(ctx: RibbonCommandContext): Promise<void> {
  const runtime = ctx.univerRef.current
  const workbook = runtime?.univerAPI.getActiveWorkbook()
  const worksheet = workbook?.getActiveSheet()
  if (!runtime || !workbook || !worksheet) return
  const cached = lastInternalCopy(runtime)
  if (!cached) {
    ctx.setMessage(t('appNeedCopyFirst'))
    return
  }
  const sourceSheet = runtime.univer
    .__getInjector()
    .get(IUniverInstanceService)
    .getUniverSheetInstance(cached.unitId)
    ?.getSheetBySheetId(cached.subUnitId)
  if (!sourceSheet) return
  const { rows, cols } = cached.range
  const matrix = sourceSheet.getMatrixWithMergedCells(
    Math.min(...rows),
    Math.min(...cols),
    Math.max(...rows),
    Math.max(...cols),
  )
  const cellMatrix: ICellData[][] = []
  for (const column of cols) {
    const rowCells: ICellData[] = []
    for (const row of rows) {
      const merged = sourceSheet.getMergedCell(row, column)
      if (merged && (merged.startRow !== row || merged.startColumn !== column)) {
        rowCells.push({})
        continue
      }
      const cell = matrix.getValue(row, column)
      const raw = sourceSheet.getCellRaw(row, column)
      const composed = sourceSheet.getComposedCellStyleByCellData(row, column, raw)
      rowCells.push({
        v: cell?.v,
        t: cell?.t,
        f: cell?.f,
        si: cell?.si,
        s: Object.keys(composed).length > 0 ? composed : undefined,
      } as ICellData)
    }
    cellMatrix.push(rowCells)
  }
  const target = workbook.getActiveRange()
  if (!target) return
  worksheet
    .getRange(target.getRow(), target.getColumn(), cellMatrix.length, cellMatrix[0]?.length ?? 0)
    .setValues(cellMatrix)
  ctx.setMessage(t('appPastedTransposed'))
}

/// 只粘贴文本: re-derives the copy's plain TSV (same conventions the OS
/// clipboard gets) and writes it back typed — numbers/booleans parse, no
/// styling at all, so "001" stays literal text and formats never travel.
async function pasteTextOnly(ctx: RibbonCommandContext): Promise<void> {
  const runtime = ctx.univerRef.current
  const workbook = runtime?.univerAPI.getActiveWorkbook()
  const worksheet = workbook?.getActiveSheet()
  if (!runtime || !workbook || !worksheet) return
  const cached = lastInternalCopy(runtime)
  if (!cached) {
    ctx.setMessage(t('appNeedCopyFirst'))
    return
  }
  const sourceSheet = runtime.univer
    .__getInjector()
    .get(IUniverInstanceService)
    .getUniverSheetInstance(cached.unitId)
    ?.getSheetBySheetId(cached.subUnitId)
  if (!sourceSheet) return
  const { rows, cols } = cached.range
  const matrix = sourceSheet.getMatrixWithMergedCells(
    Math.min(...rows),
    Math.min(...cols),
    Math.max(...rows),
    Math.max(...cols),
  )
  const parsed = parseTsv(
    plainTextFromCells(rows, cols, (row, column) => matrix.getValue(row, column) ?? null),
  )
  const cellMatrix: ICellData[][] = parsed.map((line) =>
    line.map((text) => {
      if (text === 'TRUE' || text === 'FALSE')
        return { v: text === 'TRUE', t: CellValueType.BOOLEAN }
      if (/^-?\d+(\.\d+)?$/.test(text)) {
        // 只粘贴文本 keeps "001"/"1.50" literal — only canonical numbers
        // re-type as numeric, so leading zeros and trailing precision travel.
        const numeric = Number(text)
        return String(numeric) === text
          ? { v: numeric, t: CellValueType.NUMBER }
          : { v: text, t: CellValueType.STRING }
      }
      return { v: text, t: CellValueType.STRING }
    }),
  )
  const target = workbook.getActiveRange()
  if (!target) return
  worksheet
    .getRange(target.getRow(), target.getColumn(), cellMatrix.length, cellMatrix[0]?.length ?? 0)
    .setValues(cellMatrix)
  ctx.setMessage(t('appPastedTextOnly'))
}

/// data: URL → Blob without fetch(): the renderer's CSP blocks fetch(data:),
/// and the clipboard write needs a real Blob for ClipboardItem.
function dataUrlToPngBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:image/png;base64,') || comma === -1) return null
  try {
    const bytes = Uint8Array.from(atob(dataUrl.slice(comma + 1)), (ch) => ch.charCodeAt(0))
    return new Blob([bytes], { type: 'image/png' })
  } catch {
    return null
  }
}

/// 复制为图片: crops the live grid canvas at the selection's screen rect
/// (renderRangeToPng) and puts the PNG on the OS clipboard, so any app —
/// or this sheet itself — can paste it as a bitmap.
async function copyRangeAsPicture(ctx: RibbonCommandContext): Promise<void> {
  const runtime = ctx.univerRef.current
  const workbook = runtime?.univerAPI.getActiveWorkbook()
  const worksheet = workbook?.getActiveSheet()
  const range = workbook?.getActiveRange()
  if (!runtime || !workbook || !worksheet || !range) return
  // Drop Univer's copy marquee first so the ants don't bake into the shot.
  try {
    runtime.univer.__getInjector().get(ISheetClipboardService).removeMarkSelection()
  } catch {
    /* visual only */
  }
  const outcome = await renderRangeToPng(runtime, range.getRange())
  if (!outcome.ok) {
    ctx.setMessage(
      t(outcome.reason === 'too-large' ? 'appRangeTooLarge' : 'appPictureRenderFailed'),
    )
    return
  }
  const blob = dataUrlToPngBlob(outcome.dataUrl)
  if (!blob) {
    ctx.setMessage(t('appPictureRenderFailed'))
    return
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  } catch {
    ctx.setMessage(t('appPictureRenderFailed'))
    return
  }
  ctx.setMessage(t('appPictureCopied'))
}

/// 粘贴为图片: re-renders the last internal copy (the copy cache stores the
/// source coordinates) as a PNG and inserts it as a floating picture at the
/// active cell — WPS's paste-as-picture without an OS round trip.
async function pasteRangeAsPicture(ctx: RibbonCommandContext): Promise<void> {
  const runtime = ctx.univerRef.current
  if (!runtime) return
  const cached = lastInternalCopy(runtime)
  const bounds = cached ? boundingRange(cached.range.rows, cached.range.cols) : null
  if (!cached || !bounds) {
    ctx.setMessage(t('appNeedCopyFirst'))
    return
  }
  // 浮点图片依赖文件会话的 visual 日志（与插入图片按钮同一约束）。
  if (!ctx.lazyWorkbookRef.current) {
    ctx.setMessage(t('appPictureNeedsFile'))
    return
  }
  const outcome = await renderRangeToPng(runtime, bounds)
  if (!outcome.ok) {
    ctx.setMessage(
      t(outcome.reason === 'too-large' ? 'appRangeTooLarge' : 'appPictureRenderFailed'),
    )
    return
  }
  insertPictureFromData(ctx.visualContext(), outcome.dataUrl, 'Paste as Picture')
}

/// Arms the one-shot draw border: listeners live until the next left-button
/// gesture on the grid completes (or Escape). The rAF before reading the
/// active range lets Univer finish updating the selection on pointerup.
function armDrawBorder(
  runtime: NonNullable<RibbonCommandContext['univerRef']['current']>,
  kind: 'outline' | 'grid' | 'erase',
  color: string,
  style: BorderStyleTypes,
): void {
  // Re-arming while armed must not stack gesture listeners.
  disarmDrawBorder()
  armedDrawBorder = { kind, color, style }
  // Renderer-only plumbing below; node-side tests just observe the arming.
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const grid = document.getElementById('univer-container')
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !(event.target instanceof Node)) return
    if (!grid?.contains(event.target) || grid.classList.contains('sheet-shape-drawing')) return
    window.addEventListener(
      'pointerup',
      () => {
        requestAnimationFrame(() => {
          const armed = armedDrawBorder
          disarmDrawBorder()
          if (!armed) return
          const workbook = runtime.univerAPI.getActiveWorkbook()
          const range = workbook?.getActiveRange()
          const worksheet = workbook?.getActiveSheet()
          if (!range || !worksheet) return
          const type =
            armed.kind === 'outline'
              ? BorderType.OUTSIDE
              : armed.kind === 'grid'
                ? BorderType.ALL
                : BorderType.NONE
          range.setBorder(type, armed.style, armed.color)
        })
      },
      { capture: true, once: true },
    )
  }
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') disarmDrawBorder()
  }
  window.addEventListener('pointerdown', onPointerDown, { capture: true })
  window.addEventListener('keydown', onEscape)
  drawBorderDisposers = () => {
    window.removeEventListener('pointerdown', onPointerDown, { capture: true })
    window.removeEventListener('keydown', onEscape)
  }
}

/// 空表判定：整张表的值矩阵里没有任何非空值（保护大数据：用 CellMatrix
/// 遍历而非 range.getValues() 展平）。
function isSheetEmptyOfValues(sheet: { getSheet(): unknown }): boolean {
  let empty = true
  try {
    const matrix = (
      sheet.getSheet() as {
        getCellMatrix(): {
          forValue(
            cb: (row: number, col: number, value: { v?: unknown } | null) => boolean | void,
          ): unknown
        }
      }
    ).getCellMatrix()
    matrix.forValue((_row, _column, value) => {
      if (value && value.v != null && value.v !== '') {
        empty = false
        return true // 停止遍历
      }
      return undefined
    })
  } catch {
    return false
  }
  return empty
}

/// 创建表格目录：新建/复用「目录」表，逐行写入 序号 + 表名 + HYPERLINK 公式
/// （公式在引擎里可用；无超链接 UI 弹层时至少呈现目录全貌）。
async function buildSheetToc(ctx: RibbonCommandContext): Promise<void> {
  const runtime = ctx.univerRef.current
  const workbook = runtime?.univerAPI.getActiveWorkbook()
  if (!runtime || !workbook) return
  const TOC = t('appSheetTocName')
  const sheets = workbook.getSheets()
  let toc = sheets.find((sheet) => sheet.getSheetName() === TOC)
  if (!toc) {
    toc = workbook.insertSheet(TOC)
  } else if (workbookStructureLocked(ctx.lazyWorkbookRef.current)) {
    ctx.setMessage(t('appWorkbookStructureLocked'))
    return
  }
  const header = [[t('appSheetTocIndex'), t('appSheetTocSheet'), t('appSheetTocLink')]]
  const rows = sheets
    .filter((sheet) => sheet.getSheetName() !== TOC)
    .map((sheet, index) => {
      const name = sheet.getSheetName()
      return [
        index + 1,
        name,
        { f: `=HYPERLINK("#'${name.replace(/'/g, "''")}'!A1","${name.replace(/"/g, '""')}")` },
      ]
    })
  try {
    toc.getRange(0, 0, rows.length + 1, 3).setValues([...header, ...rows] as never)
    ctx.setMessage(t('appSheetTocBuilt', { n: rows.length }))
  } catch {
    ctx.setMessage(t('appSheetTocFailed'))
  }
}

/// 工作表标签字号：注入规则命中 Univer 内部标签条文本（幂等，一次一条）。
export function applyTabFontSize(px: number): void {
  if (typeof document === 'undefined') return // node 侧测试/SSR 无 DOM
  const id = 'sheetop-tab-font-size'
  let style = document.getElementById(id)
  if (!style) {
    style = document.createElement('style')
    style.id = id
    document.head.appendChild(style)
  }
  style.textContent = `#univer-container .univer-sheet-tab { font-size: ${px}px !important }`
}

let drawBorderDisposers: (() => void) | null = null

function disarmDrawBorder(): void {
  armedDrawBorder = null
  drawBorderDisposers?.()
  drawBorderDisposers = null
}

/** Splits a `name:argument[:extra]` ribbon style command (see above). */
export function parseStyleCommand(command: string): {
  name: string
  argument: string
  extra: string
} {
  const nameEnd = command.indexOf(':')
  if (nameEnd === -1) return { name: command, argument: '', extra: '' }
  const name = command.slice(0, nameEnd)
  const rest = command.slice(nameEnd + 1)
  if (!EXTRA_SEGMENT_COMMANDS.has(name)) return { name, argument: rest, extra: '' }
  const argumentEnd = rest.indexOf(':')
  if (argumentEnd === -1) return { name, argument: rest, extra: '' }
  return { name, argument: rest.slice(0, argumentEnd), extra: rest.slice(argumentEnd + 1) }
}

export function handleRibbonCommand(ctx: RibbonCommandContext, command: string): void {
  const runtime = ctx.univerRef.current
  // 图表库不需要工作簿上下文(Univer 未就绪也应能打开浏览)
  if (command === 'chart-designer-open') {
    ctx.setChartDesignerOpen(true)
    return
  }
  if (!runtime) return
  if (command === 'undo' || command === 'redo') {
    void runtime.univerAPI[command]()
    return
  }
  if (command.startsWith('error:')) {
    ctx.setMessage(command.slice('error:'.length))
    return
  }
  if (command === 'chart-select-data' || command === 'chart-format-pane') {
    const editKey = ctx.selectedVisual
      ? (ctx.selectedVisual.chartPath ?? ctx.selectedVisual.id)
      : undefined
    if (editKey) {
      ctx.setChartDialog({
        kind: command === 'chart-select-data' ? 'select-data' : 'format',
        editKey,
      })
    }
    return
  }
  // Chart Design tab commands act on the selected floating chart; file
  // charts key on their chart part path, in-memory ones on the visual id.
  if (command.startsWith('chart-') && command !== 'chart-delete') {
    const editKey = ctx.selectedVisual
      ? (ctx.selectedVisual.chartPath ?? ctx.selectedVisual.id)
      : undefined
    if (!editKey) return
    if (command.startsWith('chart-type-')) {
      const chartType = CHART_TYPE_COMMANDS.find((type) => command === `chart-type-${type}`)
      if (chartType) ctx.chartEditRef.current(editKey, { chartType })
    } else if (command.startsWith('chart-legend:')) {
      const legend = CHART_LEGEND_COMMANDS.find((pos) => command === `chart-legend:${pos}`)
      if (legend) ctx.chartEditRef.current(editKey, { legend })
    } else if (command.startsWith('chart-labels:')) {
      const labels = CHART_LABEL_COMMANDS.find((mode) => command === `chart-labels:${mode}`)
      // scatter/radar cannot save plot-level labels — fail here, not at ⌘S.
      if (labels && ctx.selectedChart?.canLabel) {
        ctx.chartEditRef.current(editKey, { dataLabels: labels })
      }
    } else if (command.startsWith('chart-grouping:')) {
      const grouping = (['clustered', 'stacked', 'percentStacked'] as const).find(
        (mode) => command === `chart-grouping:${mode}`,
      )
      if (grouping) ctx.chartEditRef.current(editKey, { grouping })
    } else if (command.startsWith('chart-colors:')) {
      const palette = CHART_PALETTES[command.slice('chart-colors:'.length)]
      if (!palette) return
      if (ctx.selectedChart?.isPie) {
        // Pie recolor varies by point, not by series.
        const count = Math.min(ctx.selectedChart.categoryCount, 64)
        if (count === 0) return
        ctx.chartEditRef.current(editKey, {
          pointColors: {
            '0': Object.fromEntries(
              Array.from({ length: count }, (_, index) => [
                String(index),
                palette[index % palette.length] ?? '#4472c4',
              ]),
            ),
          },
        })
        return
      }
      const count = Math.min(ctx.selectedChart?.seriesCount ?? 0, 24)
      if (count === 0) return
      ctx.chartEditRef.current(editKey, {
        seriesColors: Object.fromEntries(
          Array.from({ length: count }, (_, index) => [
            String(index),
            palette[index % palette.length] ?? '#4472c4',
          ]),
        ),
      })
    } else if (command.startsWith('chart-layout:')) {
      // Quick Layout presets: legend placement + data labels together,
      // labels picked per chart family (pie vs. axis charts).
      const labelsOn = ctx.selectedChart?.isPie ? ('category-percent' as const) : ('value' as const)
      const preset = {
        'chart-layout:1': { legend: 'right', dataLabels: labelsOn },
        'chart-layout:2': { legend: 'top', dataLabels: labelsOn },
        'chart-layout:3': { legend: 'bottom', dataLabels: 'none' },
        'chart-layout:4': { legend: 'none', dataLabels: labelsOn },
      }[command] as Pick<WorkbookChartEdit, 'legend' | 'dataLabels'> | undefined
      if (preset) {
        // Label-less families take the preset's legend only.
        const applied = ctx.selectedChart?.canLabel
          ? preset
          : { ...(preset.legend === undefined ? {} : { legend: preset.legend }) }
        ctx.chartEditRef.current(editKey, applied)
      }
    } else if (command.startsWith('chart-title:')) {
      ctx.chartEditRef.current(editKey, {
        title: command.slice('chart-title:'.length).slice(0, 255),
      })
    } else if (command.startsWith('chart-axis-cat:')) {
      const text = command.slice('chart-axis-cat:'.length).slice(0, 255)
      ctx.chartEditRef.current(editKey, { axisTitles: { category: text || null } })
    } else if (command.startsWith('chart-axis-val:')) {
      const text = command.slice('chart-axis-val:'.length).slice(0, 255)
      ctx.chartEditRef.current(editKey, { axisTitles: { value: text || null } })
    } else if (command === 'chart-switch-row-col') {
      const seriesSet = transposeChartSeries(ctx.selectedChart?.series ?? [], (n) =>
        t('appSeriesN', { n }),
      )
      if (seriesSet) ctx.chartEditRef.current(editKey, { seriesSet })
      else ctx.setMessage(t('appNoCategoriesToSwitch'))
    }
    return
  }
  if (command === 'chart-delete') {
    if (ctx.selectedVisual) ctx.shapeEditRef.current(ctx.selectedVisual.id, { remove: true })
    return
  }
  if (command.startsWith('cf-new:')) {
    // Conditional-formatting rich menu (WPS parity): each entry opens the Univer
    // CF panel preseeded with that rule type (panel op semantics: 3 highlight,
    // 4 rank, 5 formula, 6 color scale, 7 data bar, 8 icon set).
    const op = Number(command.slice('cf-new:'.length))
    if (Number.isInteger(op) && op >= 3 && op <= 8) {
      void runtime.univerAPI.executeCommand('sheet.operation.open.conditional.formatting.panel', {
        value: op,
      })
    }
    return
  }
  if (command.startsWith('rowcol:')) {
    // 行和列⌄（WPS 对齐 B2）：插入/删除行列走既有 case；此处收其余 8 项。
    // hide/unhide 走 Univer 命令（带 undo）；最适合行高/列宽按内容扫描估算。
    const wb = runtime.univerAPI.getActiveWorkbook()
    const ws = wb?.getActiveSheet()
    const sel = wb?.getActiveRange()
    const raw = command.slice('rowcol:'.length)
    const colon = raw.indexOf(':')
    const action = colon === -1 ? raw : raw.slice(0, colon)
    const extra = colon === -1 ? '' : raw.slice(colon + 1)
    if (!wb || !ws || !sel) {
      ctx.setMessage(t('appSelectCellFirst'))
      return
    }
    const unitId = wb.getId()
    const subUnitId = ws.getSheetId()
    const rows = { startRow: sel.getRow(), endRow: sel.getRow() + sel.getHeight() - 1 }
    const cols = { startColumn: sel.getColumn(), endColumn: sel.getColumn() + sel.getWidth() - 1 }
    const run = (id: string, params: Record<string, unknown>) => {
      void runtime.univerAPI.executeCommand(id, { unitId, subUnitId, ...params }).catch(() => {
        // canceled structural command surfaces its own message
      })
    }
    switch (action) {
      case 'insert-rows-above':
      case 'insert-rows-below':
      case 'insert-cols-left':
      case 'insert-cols-right': {
        // 数量插入（WPS 在上/下方插入行、左/右侧插入列 [N] ✓）
        const count = Math.min(500, Math.max(1, Number(extra.split(':')[0] ?? '') || 1))
        try {
          if (action === 'insert-rows-above') ws.insertRowsBefore(rows.startRow, count)
          else if (action === 'insert-rows-below') ws.insertRowsAfter(rows.endRow, count)
          else if (action === 'insert-cols-left') ws.insertColumnsBefore(cols.startColumn, count)
          else ws.insertColumnsAfter(cols.endColumn, count)
          ctx.setMessage(t('appAppliedToSelection'))
        } catch {
          /* protected sheet: its own message */
        }
        return
      }
      case 'delete-rows':
        try {
          ws.deleteRows(rows.startRow, Math.max(1, sel.getHeight()))
          ctx.setMessage(t('appAppliedToSelection'))
        } catch {
          /* protected sheet */
        }
        return
      case 'delete-cols':
        try {
          ws.deleteColumns(cols.startColumn, Math.max(1, sel.getWidth()))
          ctx.setMessage(t('appAppliedToSelection'))
        } catch {
          /* protected sheet */
        }
        return
      case 'delete-empty-rows': {
        // 选区内整行全空的行整行删除；自下而上删避免索引位移。
        // 「空」按选区列范围判（与 WPS 删除空行直感一致）。
        let removed = 0
        try {
          for (let r = rows.endRow; r >= rows.startRow; r -= 1) {
            let empty = true
            for (let c = cols.startColumn; c <= cols.endColumn; c += 1) {
              const v = ws.getRange(r, c).getValue()
              if (v != null && v !== '') {
                empty = false
                break
              }
            }
            if (empty && r < ws.getMaxRows() - 1) {
              ws.deleteRows(r, 1)
              removed += 1
            }
          }
          ctx.setMessage(t('appRowcolEmptyRowsDeleted', { n: removed }))
        } catch {
          /* protected sheet */
        }
        return
      }
      case 'standard-col-width': {
        // 标准列宽：字符 → 像素，写默认列宽并触发一次重绘
        const chars = Number(extra.split(':')[0] ?? '')
        if (!Number.isFinite(chars) || chars <= 0 || chars > 255) return
        const config = ws.getSheet().getConfig()
        config.defaultColumnWidth = characterWidthToPixels(chars)
        try {
          // no-op 宽度 mutation 让 skeleton 重建（同 toggle-headings 的重绘手法）
          ws.setColumnWidth(cols.startColumn, ws.getColumnWidth(cols.startColumn))
        } catch {
          /* protected sheet: config stays for next full rebuild */
        }
        ctx.setMessage(t('appRowcolStandardApplied', { n: Math.round(config.defaultColumnWidth) }))
        return
      }
      case 'hide-rows':
        run('sheet.command.set-rows-hidden', { ranges: [{ ...rows, rangeType: 1 }] })
        return
      case 'unhide-rows':
        run('sheet.command.set-specific-rows-visible', {
          ranges: [{ ...rows, rangeType: 3 }],
        })
        return
      case 'hide-cols':
        for (let c = cols.startColumn; c <= cols.endColumn; c += 1) {
          run('sheet.command.set-col-hidden', {
            ranges: [{ startColumn: c, endColumn: c, rangeType: 2 }],
          })
        }
        return
      case 'unhide-cols':
        run('sheet.command.set-col-visible-on-cols', {
          ranges: [{ ...cols, rangeType: 2 }],
        })
        return
      case 'fit-row-height': {
        // scan row content: height = wrapped lines × 20px + 6, clamp 20..408
        for (let r = rows.startRow; r <= rows.endRow; r += 1) {
          let maxLines = 1
          for (let c = Math.max(0, cols.startColumn - 12); c < cols.endColumn + 12; c += 1) {
            const v = ws.getRange(r, c).getValue()
            const text = v == null ? '' : String(v)
            if (text) maxLines = Math.max(maxLines, Math.ceil(text.length / 12))
          }
          const h = Math.min(408, Math.max(20, maxLines * 20 + 6))
          try {
            ws.setRowHeightsForced(r, 1, h)
          } catch {
            /* protected sheet: its own message */
          }
        }
        ctx.setMessage(t('appRowcolFitted'))
        return
      }
      case 'fit-col-width': {
        for (let c = cols.startColumn; c <= cols.endColumn; c += 1) {
          let maxChars = 0
          for (let r = Math.max(0, rows.startRow - 40); r < rows.endRow + 200; r += 1) {
            const v = ws.getRange(r, c).getValue()
            const text = v == null ? '' : String(v)
            if (text) maxChars = Math.max(maxChars, text.length)
          }
          const w = Math.min(400, Math.max(60, maxChars * 8 + 10))
          try {
            ws.setColumnWidth(c, w)
          } catch {
            /* protected sheet */
          }
        }
        ctx.setMessage(t('appRowcolFitted'))
        return
      }
      default:
        return
    }
  }
  if (command.startsWith('cells:')) {
    // 插入/删除单元格弹窗的移位选项：Range 移位走 Univer 命令，整行/整列走 facade
    const kind = command.slice('cells:'.length)
    const wb = runtime.univerAPI.getActiveWorkbook()
    const ws = wb?.getActiveSheet()
    const sel = wb?.getActiveRange()
    if (!wb || !ws || !sel) {
      ctx.setMessage(t('appSelectCellFirst'))
      return
    }
    const range = sel.getRange()
    const unitId = wb.getId()
    const subUnitId = ws.getSheetId()
    const run = (id: string, params: Record<string, unknown>) => {
      void runtime.univerAPI.executeCommand(id, { unitId, subUnitId, ...params }).catch(() => {
        /* canceled structural command surfaces its own message */
      })
    }
    try {
      if (kind === 'insert-down') run('sheet.command.insert-range-move-down', { range })
      else if (kind === 'insert-right') run('sheet.command.insert-range-move-right', { range })
      else if (kind === 'delete-left') run('sheet.command.delete-range-move-left', { range })
      else if (kind === 'delete-up') run('sheet.command.delete-range-move-up', { range })
      else if (kind === 'entire-row')
        ws.insertRowsBefore(range.startRow, Math.max(1, sel.getHeight()))
      else if (kind === 'entire-col')
        ws.insertColumnsBefore(range.startColumn, Math.max(1, sel.getWidth()))
      ctx.setMessage(t('appAppliedToSelection'))
    } catch {
      /* protected sheet: its own message */
    }
    return
  }
  if (command.startsWith('convert:')) {
    // WPS 数字组 转换⌄ (B6): batch text<->number over the selection
    const wb2 = runtime.univerAPI.getActiveWorkbook()
    const ws2 = wb2?.getActiveSheet()
    const sel2 = wb2?.getActiveRange()
    if (!wb2 || !ws2 || !sel2) {
      ctx.setMessage(t('appSelectCellFirst'))
      return
    }
    let changed = 0
    for (let r = sel2.getRow(); r < sel2.getRow() + sel2.getHeight(); r += 1) {
      for (let c = sel2.getColumn(); c < sel2.getColumn() + sel2.getWidth(); c += 1) {
        const cell = ws2.getRange(r, c)
        const v = cell.getValue()
        switch (command) {
          case 'convert:text2num':
          case 'convert:num2text':
            if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
              cell.setValue(Number(v))
              changed += 1
            } else if (typeof v === 'number' && command === 'convert:num2text') {
              cell.setValue(String(v))
              changed += 1
            }
            break
          case 'convert:text2formula': {
            // 文本转公式: a text starting with '=' becomes a live formula
            if (typeof v === 'string' && v.trimStart().startsWith('=')) {
              cell.setFormula(v)
              changed += 1
            }
            break
          }
          case 'convert:formula2text': {
            // 公式转文本: the formula string itself becomes the cell text
            const f = cell.getFormula()
            if (f) {
              cell.setValue(String(f))
              changed += 1
            }
            break
          }
          case 'convert:values-only': {
            // 仅保留数值: freeze formulas/results in place as plain values
            const f2 = cell.getFormula()
            if (f2) {
              cell.setValue(v as never)
              changed += 1
            }
            break
          }
          case 'convert:upper':
          case 'convert:lower':
          case 'convert:capitalize': {
            if (typeof v === 'string' && v) {
              const next =
                command === 'convert:upper'
                  ? v.toUpperCase()
                  : command === 'convert:lower'
                    ? v.toLowerCase()
                    : v.replace(/(^|\s)(\p{L})/gu, (mm) => mm.toUpperCase())
              if (next !== v) {
                cell.setValue(next)
                changed += 1
              }
            }
            break
          }
          case 'convert:to-en-symbols':
          case 'convert:to-cn-symbols': {
            // 中英符号互转：全角标点⇄半角标点（U+FF01..FF5E ⇄ ASCII 33..126，
            // 保留空格 U+3000 不动）。全→半 shift -65248，半→全 +65248。
            if (typeof v === 'string' && v) {
              const delta = command === 'convert:to-en-symbols' ? -65248 : 65248
              const next = [...v]
                .map((ch) => {
                  const code = ch.codePointAt(0)!
                  if (command === 'convert:to-en-symbols')
                    return code >= 0xff01 && code <= 0xff5e ? String.fromCharCode(code + delta) : ch
                  return code >= 0x21 && code <= 0x7e ? String.fromCharCode(code + delta) : ch
                })
                .join('')
              if (next !== v) {
                cell.setValue(next)
                changed += 1
              }
            }
            break
          }
          case 'convert:to-date': {
            // 转为日期（WPS 转换⌄）：文本日期 → 序列值 + yyyy/m/d 格式；
            // 已是数字则只补日期格式。1900 日期系统：serial = 天数 since 1899-12-30。
            const serialFromDate = (y: number, m: number, d: number): number =>
              Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000)
            if (typeof v === 'string' && v.trim() !== '') {
              const md = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v.trim())
              const dm = /^(\d{1,2})[-/.](\d{1,2})$/.exec(v.trim())
              const parsed = md
                ? serialFromDate(Number(md[1]), Number(md[2]), Number(md[3]))
                : dm
                  ? serialFromDate(new Date().getFullYear(), Number(dm[1]), Number(dm[2]))
                  : null
              if (parsed !== null && parsed > 0 && Number.isFinite(parsed)) {
                cell.setValue(parsed)
                cell.setNumberFormat('yyyy/m/d')
                changed += 1
              }
            } else if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
              cell.setNumberFormat('yyyy/m/d')
              changed += 1
            }
            break
          }
          case 'convert:to-cn-upper': {
            // 转为中文大写（WPS 转换⌄）：数字 → 壹贰叁…（拾佰仟万亿分组，
            // 零折叠；小数 → 点X）。仅对有限数值生效。
            const toCnUpper = (n: number): string => {
              const D = '零壹贰叁肆伍陆柒捌玖'
              const U = ['', '拾', '佰', '仟']
              const G = ['', '万', '亿', '万亿']
              let out = ''
              if (n < 0) {
                out += '负'
                n = -n
              }
              const s = String(n)
              const [intPart = '0', fracPart = ''] = s.split('.')
              let int = intPart.replace(/^0+/, '')
              if (int === '') int = '0'
              if (int === '0') {
                out += '零'
              } else {
                // 四位一组从高位处理，组内零折叠、组间补零规则与人民币大写一致
                const groups: number[] = []
                for (let i = int.length; i > 0; i -= 4) groups.unshift(Number(int.slice(Math.max(0, i - 4), i)))
                groups.forEach((g, gi) => {
                  const gs = String(g).padStart(4, '0')
                  let piece = ''
                  let zeroPending = false
                  for (let i = 0; i < 4; i += 1) {
                    const digit = Number(gs[i] ?? '0')
                    if (digit === 0) {
                      zeroPending = piece !== ''
                    } else {
                      if (zeroPending) piece += '零'
                      zeroPending = false
                      piece += (D[digit] ?? '') + (U[3 - i] ?? '')
                    }
                  }
                  if (piece === '') {
                    if (out !== '' && out !== '负' && !out.endsWith('零')) out += '零'
                  } else {
                    out += piece + G[groups.length - 1 - gi]
                  }
                })
                out = out.replace(/零+$/, '')
              }
              if (fracPart && fracPart !== '') {
                out += '点'
                for (const ch of fracPart) out += D[Number(ch)]
              }
              return out
            }
            if (typeof v === 'number' && Number.isFinite(v)) {
              const next = toCnUpper(v)
              if (next !== String(v)) {
                cell.setValue(next)
                changed += 1
              }
            }
            break
          }
          case 'convert:to-fraction': {
            // 转为分数（WPS 转换⌄）：数值单元格套 # ?/? 分数格式（0.5 → 1/2）
            if (typeof v === 'number' && Number.isFinite(v)) {
              cell.setNumberFormat('# ?/?')
              changed += 1
            }
            break
          }
        }
      }
    }
    ctx.setMessage(t('appConvertDone', { n: changed }))
    return
  }
  if (command.startsWith('sheetop:')) {
    // 工作表⌄（WPS 对齐 B3）：重命名/标签颜色/隐藏/取消隐藏。
    const wb = runtime.univerAPI.getActiveWorkbook()
    const ws = wb?.getActiveSheet()
    const raw = command.slice('sheetop:'.length)
    const colon = raw.indexOf(':')
    const action = colon === -1 ? raw : raw.slice(0, colon)
    const extra = colon === -1 ? '' : raw.slice(colon + 1)
    if (!wb || !ws) return
    switch (action) {
      case 'remove': {
        // 删除工作表（WPS 对齐）：至少保留一张表
        if (wb.getSheets().length <= 1) {
          ctx.setMessage(t('appSheetRemoveLast'))
          return
        }
        const name = ws.getSheetName()
        try {
          if (workbookStructureLocked(ctx.lazyWorkbookRef.current)) {
            ctx.setMessage(t('appWorkbookStructureLocked'))
            return
          }
          wb.deleteSheet(ws)
          ctx.setMessage(t('appSheetRemoved', { name }))
        } catch {
          /* protected workbook: its own message */
        }
        return
      }
      case 'duplicate': {
        // 创建副本：Univer 原生 copy-sheet（复制活动表并激活副本）
        try {
          if (workbookStructureLocked(ctx.lazyWorkbookRef.current)) {
            ctx.setMessage(t('appWorkbookStructureLocked'))
            return
          }
          void runtime.univerAPI.executeCommand('sheet.command.copy-sheet')
          ctx.setMessage(t('appSheetDuplicated'))
        } catch {
          ctx.setMessage(t('appSheetDupFailed'))
        }
        return
      }
      case 'move-to-index': {
        // 移动或复制工作表：move-to-index:<index>[:copy]（copy 先复制再移动）
        const [indexPart = '', copyFlag = ''] = extra.split(':')
        const index = Number(indexPart)
        if (!Number.isInteger(index)) return
        try {
          if (workbookStructureLocked(ctx.lazyWorkbookRef.current)) {
            ctx.setMessage(t('appWorkbookStructureLocked'))
            return
          }
          if (copyFlag === 'copy') {
            // 副本由 copy-sheet 创建并激活；等命令落地后移动副本本身
            void runtime.univerAPI
              .executeCommand('sheet.command.copy-sheet')
              .then(() => {
                const wb2 = runtime.univerAPI.getActiveWorkbook()
                const active2 = wb2?.getActiveSheet()
                if (wb2 && active2) wb2.moveSheet(active2, index)
              })
              .catch(() => {
                /* canceled */
              })
          } else {
            wb.moveSheet(ws, index)
          }
          ctx.setMessage(t('appSheetMoved'))
        } catch {
          ctx.setMessage(t('appSheetMoveFailed'))
        }
        return
      }
      case 'sort-asc':
      case 'sort-desc': {
        // 工作表排序：按名称重排（localeCompare，中文按拼音区）
        const desc = action === 'sort-desc'
        const sheets = [...wb.getSheets()].sort((a, b) =>
          desc
            ? b.getSheetName().localeCompare(a.getSheetName(), 'zh-Hans-CN')
            : a.getSheetName().localeCompare(b.getSheetName(), 'zh-Hans-CN'),
        )
        if (workbookStructureLocked(ctx.lazyWorkbookRef.current)) {
          ctx.setMessage(t('appWorkbookStructureLocked'))
          return
        }
        sheets.forEach((sheet, index) => wb.moveSheet(sheet, index))
        ctx.setMessage(t('appSheetSorted'))
        return
      }
      case 'toc':
        void buildSheetToc(ctx)
        return
      case 'delete-empty': {
        // 删除空白表：全空表删除；始终保留活动表与至少一张表
        const sheets = wb.getSheets()
        if (sheets.length <= 1) {
          ctx.setMessage(t('appSheetRemoveLast'))
          return
        }
        const activeId = ws.getSheetId()
        const total = sheets.length
        let removed = 0
        for (const sheet of sheets) {
          if (total - removed <= 1) break
          if (sheet.getSheetId() === activeId) continue
          if (isSheetEmptyOfValues(sheet)) {
            try {
              wb.deleteSheet(sheet)
              removed += 1
            } catch {
              /* protected workbook */
            }
          }
        }
        ctx.setMessage(t('appSheetEmptyDeleted', { n: removed }))
        return
      }
      case 'batch-rename': {
        // 批量改名：find|replace|prefix|suffix（各段 encodeURIComponent）
        const [find = '', replace = '', prefix = '', suffix = ''] = extra.split('|').map((part) => {
          try {
            return decodeURIComponent(part)
          } catch {
            return ''
          }
        })
        if (!find && !prefix && !suffix) return
        let renamed = 0
        for (const sheet of wb.getSheets()) {
          const original = sheet.getSheetName()
          let next = find ? original.split(find).join(replace) : original
          next = `${prefix}${next}${suffix}`
          if (next !== original && next.trim()) {
            try {
              sheet.setName(next.trim())
              renamed += 1
            } catch {
              /* duplicate name — skip that sheet */
            }
          }
        }
        ctx.setMessage(t('appSheetBatchRenamed', { n: renamed }))
        return
      }
      case 'split': {
        // 拆分表格：每张工作表导出为独立 xlsx 文件（默认保存目录，新 tab 打开）
        const state = ctx.lazyWorkbookRef.current
        for (const sheet of wb.getSheets()) {
          const single = csvSheetById(runtime, sheet.getSheetId())
          if (!single) continue
          const content = serializeActiveSheetCsv(single, state)
          if (content === 'too-large') continue
          void window.desktopApi
            ?.createDocument({
              type: 'xlsx',
              title: sheet.getSheetName(),
              sheetName: sheet.getSheetName(),
              content,
            })
            .catch(() => {
              /* per-sheet failure: keep splitting */
            })
        }
        ctx.setMessage(t('appSheetSplitDone'))
        return
      }
      case 'tab-font-size': {
        // 工作表标签字号：持久化 + 注入规则到 Univer 内部标签条
        const px = Number(extra) || 14
        try {
          localStorage.setItem('sheets-tab-font-size', String(px))
        } catch {
          /* storage disabled */
        }
        applyTabFontSize(px)
        ctx.setMessage(t('appSheetTabFontApplied', { n: px }))
        return
      }
      case 'hide':
        try {
          if (wb.getSheets().filter((s) => !s.isSheetHidden()).length <= 1) {
            ctx.setMessage(t('appSheetHideLast'))
            return
          }
          ws.hideSheet()
        } catch {
          /* own message */
        }
        return
      case 'unhide': {
        const hidden = wb.getSheets().filter((s) => s.isSheetHidden())
        if (hidden.length === 0) {
          ctx.setMessage(t('appSheetNoHidden'))
          return
        }
        // unhide the first hidden sheet (WPS opens a picker; single-shot keeps it simple)
        try {
          hidden[0]!.showSheet()
          ctx.setMessage(t('appSheetUnhidden', { name: hidden[0]!.getSheetName() }))
        } catch {
          /* own message */
        }
        return
      }
      case 'rename': {
        const name = window.prompt(t('appSheetRenamePrompt'), ws.getSheetName())
        if (name && name.trim() && name.trim() !== ws.getSheetName()) {
          try {
            ws.setName(name.trim())
          } catch {
            ctx.setMessage(t('appSheetRenameFailed'))
          }
        }
        return
      }
      default:
        if (action.startsWith('tab-color:')) {
          const color = action.slice('tab-color:'.length)
          try {
            ws.setTabColor(color === 'none' ? '' : `#${color}`)
          } catch {
            /* own message */
          }
        }
        return
    }
  }
  if (command === 'copy-as-picture') {
    void copyRangeAsPicture(ctx)
    return
  }
  if (command === 'paste-as-picture') {
    void pasteRangeAsPicture(ctx)
    return
  }
  if (command.startsWith('draw-border:')) {
    // `draw-border:<outline|grid|erase>:<#color>:<style-name>` — arms the
    // one-shot pencil mode (WPS 绘图边框/擦除边框); color/style come from
    // the ribbon's pen state at arm time.
    if (!runtime) return
    const parsed = parseStyleCommand(command)
    const [colorPart = '', stylePart = ''] = parsed.extra.split(':')
    const kind =
      parsed.argument === 'grid' ? 'grid' : parsed.argument === 'erase' ? 'erase' : 'outline'
    armDrawBorder(
      runtime,
      kind,
      /^#[0-9a-fA-F]{6}$/.test(colorPart) ? colorPart : '#000000',
      BORDER_LINE_STYLE_TYPES[stylePart] ?? BorderStyleTypes.THIN,
    )
    ctx.setMessage(t(parsed.argument === 'erase' ? 'appEraseBorderArmed' : 'appDrawBorderArmed'))
    return
  }
  // Read-only-safe commands work on imported workbooks too.
  const worksheet = runtime.univerAPI.getActiveWorkbook()?.getActiveSheet()
  switch (command) {
    case 'find':
      void runtime.univerAPI.executeCommand('ui.operation.open-find-dialog')
      return
    case 'select-object': {
      // 选择对象：定位当前工作表最上层的浮动对象（图片/图表/形状），滚动到
      // 其锚点并提示；真正的画布选中仍由点击完成。
      const found = listSheetVisuals(ctx, worksheet)
      const top = found[found.length - 1]
      if (!top) {
        ctx.setMessage(t('appNoObjects'))
        return
      }
      void runtime.univerAPI.executeCommand('sheet.command.scroll-to-cell', {
        range: {
          startRow: top.fromRow,
          endRow: top.fromRow,
          startColumn: top.fromColumn,
          endColumn: top.fromColumn,
        },
      })
      ctx.setMessage(t('appObjectLocated', { n: found.length }))
      return
    }
    case 'copy':
    case 'cut':
    case 'paste':
      // The sheet clipboard implementation registers on the shared UI
      // command ids; paste falls back to the internal copy cache when the
      // Clipboard API is unavailable.
      void runtime.univerAPI.executeCommand(`univer.command.${command}`)
      return
    case 'paste-special:value':
      // Excel's Paste Special: Univer ships each variant as its own sheet
      // command, so they undo exactly like a plain paste.
      void runtime.univerAPI.executeCommand('sheet.command.paste-value')
      return
    case 'paste-special:formula':
      void runtime.univerAPI.executeCommand('sheet.command.paste-formula')
      return
    case 'paste-special:format':
      void runtime.univerAPI.executeCommand('sheet.command.paste-format')
      return
    case 'paste-special:col-width':
      void runtime.univerAPI.executeCommand('sheet.command.paste-col-width')
      return
    case 'paste-special:besides-border':
      void runtime.univerAPI.executeCommand('sheet.command.paste-besides-border')
      return
    case 'paste-special:transpose':
      void pasteTransposed(ctx)
      return
    case 'paste-special:text':
      void pasteTextOnly(ctx)
      return
    case 'insert-sheet': {
      const workbook = runtime.univerAPI.getActiveWorkbook()
      if (!workbook) return
      if (ctx.lazyWorkbookRef.current) {
        const taken = workbook.getSheets().map((sheet) => sheet.getSheetName())
        void ctx.runOps([{ op: 'add_sheet', name: nextSheetName(taken) }], t('appSheetAdded'))
        return
      }
      if (workbookStructureLocked(ctx.lazyWorkbookRef.current)) {
        ctx.setMessage(t('appWorkbookStructureLocked'))
        return
      }
      try {
        workbook.insertSheet()
        ctx.setMessage(t('appSheetAdded'))
      } catch (error: unknown) {
        ctx.setMessage(error instanceof Error ? error.message : t('appSheetAddFailed'))
      }
      return
    }
    case 'format-painter':
      // One-shot painter: the next selection receives the copied format.
      // Style deltas land as set-range-values mutations, so they journal
      // and save like any ribbon style edit.
      void runtime.univerAPI.executeCommand('sheet.command.set-once-format-painter')
      ctx.setMessage(t('appFormatCopied'))
      return
    case 'cf-open':
      // value 2 = the manage-rules list; other values preseed a new rule.
      void runtime.univerAPI.executeCommand('sheet.operation.open.conditional.formatting.panel', {
        value: 2,
      })
      return
    case 'dv-open':
      // Same trap as the CF panel: a missing params object silently no-ops.
      void runtime.univerAPI.executeCommand('data-validation.operation.open-validation-panel', {})
      return
    case 'sheet-protect': {
      const state = ctx.lazyWorkbookRef.current
      if (!state) {
        ctx.setMessage(t('appProtectionNeedsFile'))
        return
      }
      const sheetId = worksheet?.getSheetId()
      if (!sheetId || isSheetRemoved(state.editJournal, sheetId)) return
      const original = state.sheetProtections.get(sheetId)?.protected ?? false
      const current = state.editJournal.sheetProtection.get(sheetId) ?? original
      void ctx.runOps(
        [{ op: 'protect_sheet', sheetId, protected: !current }],
        !current ? t('appProtectionWillWrite') : t('appProtectionWillRemove'),
      )
      return
    }
    case 'workbook-protect': {
      const state = ctx.lazyWorkbookRef.current
      if (!state) {
        ctx.setMessage(t('appProtectionNeedsFile'))
        return
      }
      const file = state.file.workbookProtection
      const original = file?.lockStructure ?? false
      const current = state.editJournal.workbookProtection.desired ?? original
      // Locking would be as irreversible as unlocking is impossible: the
      // gateway refuses to touch a password-bearing element either way.
      if (file?.hasPassword) {
        ctx.setMessage(t('appWorkbookProtectedWithPassword'))
        return
      }
      recordWorkbookProtection(state.editJournal, !current, original)
      ctx.setPendingEdits(journalSize(state.editJournal))
      ctx.setMessage(
        !current ? t('appWorkbookProtectionWillWrite') : t('appWorkbookProtectionWillRemove'),
      )
      return
    }
    case 'outline-group:rows':
    case 'outline-group:cols':
    case 'outline-ungroup:rows':
    case 'outline-ungroup:cols':
    case 'outline-hide-detail:rows':
    case 'outline-hide-detail:cols':
    case 'outline-show-detail:rows':
    case 'outline-show-detail:cols': {
      const [action, axis] = command.slice('outline-'.length).split(':')
      handleOutline(
        ctx.dataToolsContext(),
        action as 'group' | 'ungroup' | 'hide-detail' | 'show-detail',
        axis as 'rows' | 'cols',
      )
      return
    }
    case 'fill-down':
    case 'fill-right':
      void runtime.univerAPI.executeCommand(
        command === 'fill-down' ? 'sheet.command.copy-down' : 'sheet.command.copy-right',
      )
      return
    case 'clear-contents':
      void runtime.univerAPI.executeCommand('sheet.command.clear-selection-content')
      return
    case 'clear-formats':
      void runtime.univerAPI.executeCommand('sheet.command.clear-selection-format')
      return
    case 'clear-all':
      void runtime.univerAPI.executeCommand('sheet.command.clear-selection-all')
      return
    case 'decimal-inc':
    case 'decimal-dec':
      // Univer's decimal commands read the displayed value's decimals for
      // General; SetNumfmt mutations journal like any format edit.
      void runtime.univerAPI.executeCommand(
        command === 'decimal-inc'
          ? 'sheet.command.numfmt.add.decimal.command'
          : 'sheet.command.numfmt.subtract.decimal.command',
      )
      return
    case 'filter-toggle':
      void runtime.univerAPI.executeCommand('sheet.command.smart-toggle-filter')
      return
    case 'autofit-row-height':
    case 'autofit-col-width': {
      if (!worksheet) return
      const selections = (worksheet.getSelection()?.getActiveRangeList() ?? []).map((range) =>
        range.getRange(),
      )
      if (selections.length === 0) return
      const ranges =
        command === 'autofit-row-height'
          ? fullRowSpans(selections, worksheet.getMaxColumns())
          : fullColumnSpans(selections, worksheet.getMaxRows())
      void runtime.univerAPI.executeCommand(
        command === 'autofit-row-height'
          ? SET_ROW_IS_AUTO_HEIGHT_COMMAND
          : 'sheet.command.set-col-auto-width',
        { ranges },
      )
      return
    }
    case 'refresh-all': {
      const error = handleRefreshAllPivots(ctx.pivotContext())
      if (error) ctx.setMessage(error)
      return
    }
    case 'error-checking': {
      const workbook = runtime.univerAPI.getActiveWorkbook()
      if (!workbook || !worksheet) return
      const lazyState = ctx.lazyWorkbookRef.current
      if (lazyState && !lazyState.flags.preloadComplete) {
        // Streamed: the cell matrix only holds loaded regions, so page the
        // whole underlying file instead (same approach as Ctrl+F). The jump
        // loads the hit's range before scrolling to it.
        void runStreamedErrorCheck({
          runtime,
          lazyWorkbookRef: ctx.lazyWorkbookRef,
          setMessage: ctx.setMessage,
          refreshSelectionEcho: () => ctx.refreshSelectionFormatRef.current(),
        })
        return
      }
      const errors: { row: number; column: number; value: string }[] = []
      worksheet
        .getSheet()
        .getCellMatrix()
        .forValue((row, column, cell) => {
          const value = cell?.v
          if (typeof value === 'string' && ERROR_VALUE_PATTERN.test(value)) {
            errors.push({ row, column, value })
          }
          return undefined
        })
      if (errors.length === 0) {
        ctx.setMessage(t('appNoErrorsFound'))
        return
      }
      // Step to the first error after the active cell, wrapping around, so
      // repeated clicks cycle through all of them.
      const active = workbook.getActiveRange()
      const afterActive = active ? active.getRow() * COLUMN_LIMIT + active.getColumn() : -1
      const next =
        errors.find((error) => error.row * COLUMN_LIMIT + error.column > afterActive) ?? errors[0]
      if (!next) return
      worksheet.getRange(next.row, next.column, 1, 1).activate()
      // Programmatic selection emits no SelectionChanged; refresh the echo.
      ctx.refreshSelectionFormatRef.current()
      void runtime.univerAPI.executeCommand('sheet.command.scroll-to-cell', {
        range: {
          startRow: next.row,
          endRow: next.row,
          startColumn: next.column,
          endColumn: next.column,
        },
      })
      ctx.setMessage(
        t('appErrorsFound', {
          count: errors.length,
          cell: formatAddress(next.row, next.column),
          value: next.value,
        }),
      )
      return
    }
    case 'filter-reapply':
      void runtime.univerAPI.executeCommand('sheet.command.re-calc-filter')
      return
    case 'filter-clear':
      void runtime.univerAPI.executeCommand('sheet.command.clear-filter-criteria')
      return
    case 'filter-advanced':
      if (!worksheet) return
      if (!worksheet.getFilter()) {
        // No auto-filter yet: create one over the smart selection first
        // (the filter-toggle equivalent), then open on the fresh range.
        void runtime.univerAPI
          .executeCommand('sheet.command.smart-toggle-filter')
          .then(() => openAdvancedFilterDialog(ctx.dataToolsContext()))
        return
      }
      openAdvancedFilterDialog(ctx.dataToolsContext())
      return
    case 'insert-symbol':
      ctx.setSymbolDialogOpen(true)
      return
    case 'insert-screenshot':
      ctx.setScreenshotDialogOpen(true)
      return
    case 'recommended-charts-open':
      ctx.openRecommendedCharts()
      return
    case 'insert-icons':
      ctx.setIconsDialogOpen(true)
      return
    case 'insert-equation':
      ctx.setEquationDialogOpen(true)
      return
    case 'import-csv':
      handleImportCsv(ctx.dataToolsContext())
      return
    case 'insert-checkbox': {
      // The DV command gate in App cancels this (with its own message) while
      // the sheet's file rules are still streaming in.
      const active = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
      if (!active) {
        ctx.setMessage(t('appSelectCellFirst'))
        return
      }
      active.setDataValidation(runtime.univerAPI.newDataValidation().requireCheckbox().build())
      return
    }
    case 'note-open':
      // Opens the note editor popup at the primary selected cell; the
      // journal snapshots the sheet's notes and ⌘S writes legacy comments.
      void runtime.univerAPI.executeCommand('sheet.operation.add-note-popup')
      return
    case 'note-delete': {
      const active = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
      if (ctx.lazyWorkbookRef.current && worksheet && active) {
        void ctx.runOps(
          [
            {
              op: 'set_note',
              sheetId: worksheet.getSheetId(),
              address: formatAddress(active.getRow(), active.getColumn()),
              text: null,
            },
          ],
          null,
        )
        return
      }
      void runtime.univerAPI.executeCommand('sheet.command.delete-note')
      return
    }
    case 'note-prev':
    case 'note-next': {
      const workbook = runtime.univerAPI.getActiveWorkbook()
      const sheet = workbook?.getActiveSheet()
      const active = workbook?.getActiveRange()
      if (!sheet || !active) return
      const notes = [...sheet.getNotes()].sort((a, b) => a.row - b.row || a.col - b.col)
      if (notes.length === 0) {
        ctx.setMessage(t('appNoNotesOnSheet'))
        return
      }
      const row = active.getRow()
      const column = active.getColumn()
      // Reading order with wrap-around, like Excel's Previous/Next Comment.
      const target =
        command === 'note-next'
          ? (notes.find((note) => note.row > row || (note.row === row && note.col > column)) ??
            notes[0])
          : ([...notes]
              .reverse()
              .find((note) => note.row < row || (note.row === row && note.col < column)) ??
            notes[notes.length - 1])
      if (!target) return
      sheet.getRange(target.row, target.col, 1, 1).activate()
      void revealCellBelowFreeze(sheet, target.row, target.col)
      void runtime.univerAPI.executeCommand('sheet.operation.add-note-popup')
      return
    }
    case 'note-show-toggle':
      // Pins/unpins the popup of the note at the selection (no-op elsewhere).
      void runtime.univerAPI.executeCommand('sheet.command.toggle-note-popup')
      return
    case 'zoom-in':
    case 'zoom-out':
    case 'zoom-reset': {
      if (!worksheet) return
      const next =
        command === 'zoom-reset'
          ? 1
          : Math.min(4, Math.max(0.5, worksheet.getZoom() + (command === 'zoom-in' ? 0.1 : -0.1)))
      worksheet.zoom(Number(next.toFixed(2)))
      ctx.setMessage(t('appZoom', { percent: Math.round(next * 100) }))
      return
    }
    case 'zoom-to-selection': {
      const workbook = runtime.univerAPI.getActiveWorkbook()
      const selection = workbook?.getActiveRange()?.getRange()
      if (!workbook || !worksheet || !selection) {
        ctx.setMessage(t('appSelectCellFirst'))
        return
      }
      const render = runtime.univer
        .__getInjector()
        .get(IRenderManagerService)
        .getRenderById(workbook.getId())
      const skeleton = render?.with(SheetSkeletonManagerService).getCurrentSkeleton()
      if (!render || !skeleton) return
      const rows = skeleton.rowHeightAccumulation
      const columns = skeleton.columnWidthAccumulation
      // Accumulation arrays are unscaled; entry i is the bottom/right edge of
      // line i, so the selection's extent is end-edge minus start-1-edge.
      const top = selection.startRow > 0 ? (rows[selection.startRow - 1] ?? 0) : 0
      const bottom = rows[Math.min(selection.endRow, rows.length - 1)] ?? 0
      const left = selection.startColumn > 0 ? (columns[selection.startColumn - 1] ?? 0) : 0
      const right = columns[Math.min(selection.endColumn, columns.length - 1)] ?? 0
      const viewWidth = render.engine.width - skeleton.rowHeaderWidthAndMarginLeft
      const viewHeight = render.engine.height - skeleton.columnHeaderHeightAndMarginTop
      if (right <= left || bottom <= top || viewWidth <= 0 || viewHeight <= 0) return
      const ratio = Math.min(
        4,
        Math.max(0.5, Math.min(viewWidth / (right - left), viewHeight / (bottom - top))),
      )
      // Scroll only after the zoom lands: the scroll target clamps against
      // the viewport extents, and at the old ratio a selection near the grid
      // edge clamps short and ends up off-screen.
      void runtime.univerAPI
        .executeCommand('sheet.command.set-zoom-ratio', {
          unitId: workbook.getId(),
          subUnitId: worksheet.getSheetId(),
          zoomRatio: Number(ratio.toFixed(2)),
        })
        .then(() =>
          runtime.univerAPI.executeCommand('sheet.command.scroll-to-cell', {
            range: selection,
            forceTop: true,
            forceLeft: true,
          }),
        )
      ctx.setMessage(t('appZoom', { percent: Math.round(ratio * 100) }))
      return
    }
    case 'toggle-headings': {
      const workbook = runtime.univerAPI.getActiveWorkbook()
      if (!workbook || !worksheet) return
      const sheetId = worksheet.getSheetId()
      const config = worksheet.getSheet().getConfig()
      const nextHidden = config.rowHeader.hidden !== BooleanNumber.TRUE
      // The skeleton reads these on every rebuild (sheet switches, reloads);
      // the two size commands below repaint the current view.
      config.rowHeader.hidden = nextHidden ? BooleanNumber.TRUE : BooleanNumber.FALSE
      config.columnHeader.hidden = nextHidden ? BooleanNumber.TRUE : BooleanNumber.FALSE
      const unitId = workbook.getId()
      // Univer's set-row-header-width infers the horizontal shift from the
      // corner viewport's width with a `|| 46` fallback; after hiding, that
      // reads 46 either way (stale value, or the fallback swallowing 0), so
      // re-showing computes a zero shift and leaves the grid under the
      // row-header strip. Record the expected viewport lefts and correct
      // after the commands — a no-op whenever Univer shifts correctly.
      const render = runtime.univer.__getInjector().get(IRenderManagerService).getRenderById(unitId)
      const scene = render?.scene
      const skeleton = render?.with(SheetSkeletonManagerService).getCurrentSkeleton()
      const viewMain = scene?.getViewport(SHEET_VIEWPORT_KEY.VIEW_MAIN)
      const viewColumnRight = scene?.getViewport(SHEET_VIEWPORT_KEY.VIEW_COLUMN_RIGHT)
      const nextWidth = nextHidden ? 0 : DEFAULT_ROW_HEADER_WIDTH
      const shift = skeleton ? nextWidth - skeleton.rowHeaderWidth : 0
      const mainLeft = (viewMain?.left ?? 0) + shift
      const columnRightLeft = (viewColumnRight?.left ?? 0) + shift
      void Promise.all([
        runtime.univerAPI.executeCommand('sheet.command.set-row-header-width', {
          unitId,
          subUnitId: sheetId,
          size: nextWidth,
        }),
        runtime.univerAPI.executeCommand('sheet.command.set-col-header-height', {
          unitId,
          subUnitId: sheetId,
          size: nextHidden ? 0 : DEFAULT_COLUMN_HEADER_HEIGHT,
        }),
      ]).then(() => {
        if (!viewMain || viewMain.left === mainLeft) return
        viewMain.left = mainLeft
        viewColumnRight?.setViewportSize({ left: columnRightLeft })
        scene?.makeDirty(true)
      })
      const state = ctx.lazyWorkbookRef.current
      if (state && !isSheetRemoved(state.editJournal, sheetId)) {
        recordPageSetup(state.editJournal, sheetId, { showHeadings: !nextHidden })
        ctx.setPendingEdits(journalSize(state.editJournal))
      }
      ctx.setMessage(t(nextHidden ? 'appHeadingsHidden' : 'appHeadingsShown'))
      return
    }
    case 'freeze-top-row':
      if (!worksheet) return
      if (ctx.lazyWorkbookRef.current) {
        void ctx.runOps(
          [{ op: 'set_freeze', sheetId: worksheet.getSheetId(), rows: 1, columns: 0 }],
          t('appTopRowFrozen'),
        )
        return
      }
      // Freeze/gridline changes journal from their mutations (App listener),
      // so Univer's undo/redo keeps the journal in step.
      worksheet.setFreeze({ startRow: 1, startColumn: -1, xSplit: 0, ySplit: 1 })
      ctx.setMessage(t('appTopRowFrozen'))
      return
    case 'freeze-first-col':
      if (!worksheet) return
      if (ctx.lazyWorkbookRef.current) {
        void ctx.runOps(
          [{ op: 'set_freeze', sheetId: worksheet.getSheetId(), rows: 0, columns: 1 }],
          t('appFirstColFrozen'),
        )
        return
      }
      worksheet.setFreeze({ startRow: -1, startColumn: 1, xSplit: 1, ySplit: 0 })
      ctx.setMessage(t('appFirstColFrozen'))
      return
    case 'replace':
      // Replacing over a partially streamed workbook would silently skip
      // unloaded regions; fully-loaded ones are safe.
      if (ctx.lazyWorkbookRef.current && !ctx.lazyWorkbookRef.current.flags.preloadComplete) {
        ctx.setMessage(t('appReplaceNeedsFullLoad'))
        return
      }
      void runtime.univerAPI.executeCommand('ui.operation.open-replace-dialog')
      return
    case 'toggle-gridlines': {
      if (!worksheet) return
      const nextHidden = !worksheet.hasHiddenGridLines()
      worksheet.setHiddenGridlines(nextHidden)
      // The display toggle persists as sheetView@showGridLines on save.
      // The message also forces the render that refreshes the ribbon
      // checkbox (journalSize may not change here).
      const state = ctx.lazyWorkbookRef.current
      const sheetId = worksheet.getSheetId()
      if (state && !isSheetRemoved(state.editJournal, sheetId)) {
        ctx.setMessage(nextHidden ? t('appGridlinesHiddenSave') : t('appGridlinesShownSave'))
      } else {
        ctx.setMessage(nextHidden ? t('appGridlinesHidden') : t('appGridlinesShown'))
      }
      return
    }
    case 'toggle-show-formulas': {
      // Formula view is per-sheet state (sheetView/@showFormulas): remember it
      // for sheet switches and persist it on save.
      const sheetId = worksheet?.getSheetId()
      if (!sheetId) return
      const state = ctx.lazyWorkbookRef.current
      const sheets = formulaViewSheets(state)
      const next = !sheets.has(sheetId)
      if (next) sheets.add(sheetId)
      else sheets.delete(sheetId)
      applyShowFormulasView(runtime, state, sheetId)
      if (state && !isSheetRemoved(state.editJournal, sheetId)) {
        recordPageSetup(state.editJournal, sheetId, { showFormulas: next })
        ctx.setPendingEdits(journalSize(state.editJournal))
      }
      ctx.setMessage(next ? t('appShowingFormulas') : t('appShowingValues'))
      return
    }
    case 'trace-precedents':
    case 'trace-dependents': {
      const workbook = runtime.univerAPI.getActiveWorkbook()
      const active = workbook?.getActiveRange()
      if (!workbook || !worksheet || !active) {
        ctx.setMessage(t('appSelectCellFirst'))
        return
      }
      const row = active.getRow()
      const column = active.getColumn()
      const idPrefix = `trace-${ctx.traceArrowsRef.current.nextId}`
      ctx.traceArrowsRef.current.nextId += 1
      if (command === 'trace-precedents') {
        const formula = worksheet.getRange(row, column).getFormula()
        if (!formula) {
          ctx.setMessage(t('appTraceNoFormula'))
          return
        }
        const result = collectPrecedents(formula, worksheet.getSheetName(), {
          lastRow: worksheet.getLastRow(),
          lastColumn: worksheet.getLastColumn(),
          maxRows: worksheet.getMaxRows(),
          maxColumns: worksheet.getMaxColumns(),
        })
        if (result.areas.length === 0 && result.offSheet === 0) {
          ctx.setMessage(t('appTraceNoRefs'))
          return
        }
        ctx.traceArrowsRef.current.disposables.push(
          ...installTraceArrows(
            runtime,
            worksheet,
            result.areas.map((area) => ({
              from: { row: area.startRow, column: area.startColumn },
              to: { row, column },
            })),
            result.areas,
            idPrefix,
          ),
        )
        ctx.setMessage(
          t('appTracedPrecedents', { count: result.areas.length }) +
            (result.offSheet > 0
              ? ` ${t('appTraceOffSheetRefs', { count: result.offSheet })}`
              : ''),
        )
        return
      }
      const result = collectDependents(workbook.getSnapshot(), worksheet.getSheetName(), {
        row,
        column,
      })
      const loadedNote =
        ctx.lazyWorkbookRef.current && !ctx.lazyWorkbookRef.current.flags.preloadComplete
          ? t('appLoadedRegionOnly')
          : ''
      if (result.cells.length === 0 && result.offSheet === 0) {
        ctx.setMessage(t('appTraceNoDependents', { note: loadedNote }))
        return
      }
      ctx.traceArrowsRef.current.disposables.push(
        ...installTraceArrows(
          runtime,
          worksheet,
          result.cells.map((cell) => ({ from: { row, column }, to: cell })),
          [],
          idPrefix,
        ),
      )
      ctx.setMessage(
        t('appTracedDependents', { count: result.cells.length, note: loadedNote }) +
          (result.offSheet > 0 ? ` ${t('appTraceOffSheetDeps', { count: result.offSheet })}` : ''),
      )
      return
    }
    case 'remove-arrows': {
      const traced = ctx.traceArrowsRef.current.disposables
      ctx.traceArrowsRef.current.disposables = []
      for (const disposable of traced) {
        try {
          disposable.dispose()
        } catch {
          // The float layer already died with a closed workbook.
        }
      }
      ctx.setMessage(traced.length > 0 ? t('appTraceArrowsRemoved') : t('appNoTraceArrows'))
      return
    }
    case 'workbook-statistics': {
      const workbook = runtime.univerAPI.getActiveWorkbook()
      if (!workbook) return
      const snapshot = workbook.getSnapshot()
      let cells = 0
      let formulas = 0
      for (const sheet of Object.values(snapshot.sheets)) {
        for (const row of Object.values(sheet.cellData ?? {})) {
          for (const cell of Object.values(row ?? {}) as (ICellData | null | undefined)[]) {
            if (!cell) continue
            if (cell.v !== undefined && cell.v !== null && cell.v !== '') cells += 1
            if (typeof cell.f === 'string' && cell.f.length > 0) formulas += 1
          }
        }
      }
      const sheetCount = Object.keys(snapshot.sheets).length
      const loadedNote =
        ctx.lazyWorkbookRef.current && !ctx.lazyWorkbookRef.current.flags.preloadComplete
          ? t('appLoadedRegionOnly')
          : ''
      ctx.setMessage(
        t('appWorkbookStats', {
          sheets: sheetCount,
          cells: cells.toLocaleString(),
          formulas: formulas.toLocaleString(),
          note: loadedNote,
        }),
      )
      return
    }
    case 'freeze-here': {
      const active = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
      if (worksheet && active && ctx.lazyWorkbookRef.current) {
        void ctx.runOps(
          [
            {
              op: 'set_freeze',
              sheetId: worksheet.getSheetId(),
              rows: active.getRow(),
              columns: active.getColumn(),
            },
          ],
          t('appFrozenAtSelection'),
        )
        return
      }
      if (worksheet && active) {
        const rows = active.getRow()
        const columns = active.getColumn()
        worksheet.setFreeze({
          startRow: rows > 0 ? rows : -1,
          startColumn: columns > 0 ? columns : -1,
          xSplit: columns,
          ySplit: rows,
        })
        ctx.setMessage(t('appFrozenAtSelection'))
      }
      return
    }
    case 'unfreeze':
      if (!worksheet) return
      if (ctx.lazyWorkbookRef.current) {
        void ctx.runOps(
          [{ op: 'set_freeze', sheetId: worksheet.getSheetId(), rows: 0, columns: 0 }],
          null,
        )
        return
      }
      worksheet.cancelFreeze()
      return
    case 'fill-up':
    case 'fill-left': {
      // Univer 只有 copy-down/copy-right；向上/向左镜像同款语义——以方向远端
      // 行/列为源整体复制（向上=末行，向左=最右列）。
      if (!worksheet) return
      const fillRange = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
      if (!fillRange || !requireLoadedSelection(ctx, worksheet, fillRange)) return
      const values = fillRange.getValues() as unknown as Matrix
      const filled = command === 'fill-up' ? fillUpMatrix(values) : fillLeftMatrix(values)
      fillRange.setValues(filled as unknown as ICellData[][])
      ctx.setMessage(t('appAppliedToSelection'))
      return
    }
    case 'fill-123': {
      // 录入123序列：选区内按列（先向下再右移）填 1..N。
      if (!worksheet) return
      const range123 = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
      if (!range123 || !requireLoadedSelection(ctx, worksheet, range123)) return
      const matrix = fillSeries123(range123.getHeight(), range123.getWidth())
      range123.setValues(matrix as unknown as ICellData[][])
      ctx.setMessage(t('appAppliedToSelection'))
      return
    }
    case 'fill-rank': {
      // 计算并录入排名：每列数值在列内的名次（RANK.EQ 语义）写入选区右侧
      // 相邻列。写选区外一格，遵循 autofn 同款流式加载闸。
      if (!worksheet) return
      const rankRange = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
      if (!rankRange || !worksheet || !guardTargetRowLoaded(ctx, worksheet, rankRange.getRow())) {
        return
      }
      const targetColumn = rankRange.getColumn() + rankRange.getWidth()
      if (targetColumn >= worksheet.getMaxColumns()) {
        ctx.setMessage(t('appSparklineNoSpace'))
        return
      }
      const rows = rankRange.getValues() as unknown as Matrix
      // getValues 是行主序；每列单独做一次 RANK.EQ
      const ranks = Array.from({ length: rankRange.getWidth() }, (_, column) =>
        rankColumn(rows.map((row) => row[column] ?? null)),
      )
      const startRow = rankRange.getRow()
      // 非数值列不参与排名（rank 为 0），目标格清空
      const rankMatrix = Array.from({ length: rankRange.getHeight() }, (_, rowOffset) =>
        Array.from({ length: rankRange.getWidth() }, (_, columnOffset) => {
          const rank = ranks[columnOffset]?.[rowOffset] ?? 0
          return rank > 0 ? rank : null
        }),
      )
      worksheet
        .getRange(startRow, targetColumn, rankRange.getHeight(), rankRange.getWidth())
        .setValues(rankMatrix as unknown as ICellData[][])
      ctx.setMessage(t('appFillRankDone', { n: rankRange.getWidth() }))
      return
    }
    case 'fill-blanks': {
      // 填充空白单元格：选区内空格取同列上方最近的非空值。
      if (!worksheet) return
      const blankRange = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
      if (!blankRange || !requireLoadedSelection(ctx, worksheet, blankRange)) return
      const filledBlanks = fillBlanksFromAbove(blankRange.getValues() as unknown as Matrix)
      blankRange.setValues(filledBlanks as unknown as ICellData[][])
      ctx.setMessage(t('appFillBlanksDone'))
      return
    }
    case 'fill-to-sheets': {
      // 至同组工作表：把选区值原位写到簿内其余每张表（本应用没有工作表
      // 分组，等价于全组选择）；仅回写值，不改目标表格式。
      if (!worksheet) return
      const workbookToSheets = runtime.univerAPI.getActiveWorkbook()
      const sourceRange = workbookToSheets?.getActiveRange()
      if (!workbookToSheets || !sourceRange || !requireLoadedSelection(ctx, worksheet, sourceRange)) {
        return
      }
      const matrix = sourceRange.getValues() as unknown as Matrix
      const sheetId = worksheet.getSheetId()
      let touched = 0
      for (const sheet of workbookToSheets.getSheets()) {
        if (sheet.getSheetId() === sheetId) continue
        sheet
          .getRange(sourceRange.getRow(), sourceRange.getColumn(), sourceRange.getHeight(), sourceRange.getWidth())
          .setValues(matrix as unknown as ICellData[][])
        touched += 1
      }
      ctx.setMessage(
        touched === 0 ? t('appSheetNoHidden') : t('appFillToSheetsDone', { n: touched }),
      )
      return
    }
    case 'insert-row-here':
    case 'delete-row-here':
    case 'insert-col-here':
    case 'delete-col-here': {
      const active = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
      if (!worksheet || !active) {
        ctx.setMessage(t('appSelectCellFirst'))
        return
      }
      if (ctx.lazyWorkbookRef.current) {
        const sheetId = worksheet.getSheetId()
        const row = active.getRow() + 1
        const column = columnLabel(active.getColumn())
        const op: WorkbookOperation =
          command === 'insert-row-here'
            ? { op: 'insert_rows', sheetId, row, count: 1 }
            : command === 'delete-row-here'
              ? { op: 'delete_rows', sheetId, row, count: 1 }
              : command === 'insert-col-here'
                ? { op: 'insert_cols', sheetId, column, count: 1 }
                : { op: 'delete_cols', sheetId, column, count: 1 }
        void ctx.runOps([op], null)
        return
      }
      try {
        // BeforeCommandExecute gating decides whether the workbook allows it.
        if (command === 'insert-row-here') worksheet.insertRowsBefore(active.getRow(), 1)
        else if (command === 'delete-row-here') worksheet.deleteRows(active.getRow(), 1)
        else if (command === 'insert-col-here') worksheet.insertColumnsBefore(active.getColumn(), 1)
        else worksheet.deleteColumns(active.getColumn(), 1)
      } catch {
        // A canceled structural command already surfaced its own message.
      }
      return
    }
    default:
      break
  }
  if (command.startsWith('format-as-table:')) {
    handleFormatAsTable(ctx.dataToolsContext(), command.slice('format-as-table:'.length))
    return
  }
  if (command.startsWith('format-as-table-custom:')) {
    // 自定义表格样式（新建表格样式对话框产物）：以直接格式把表头填充 +
    // 镶边行落到选区——保存管线尚不支持写自定义 dxfs 命名样式。
    const style = getCustomTableStyle(command.slice('format-as-table-custom:'.length))
    const customRange = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
    if (!style || !customRange || !worksheet) {
      ctx.setMessage(t('appSelectRangeFirst'))
      return
    }
    const startRow = customRange.getRow()
    const startColumn = customRange.getColumn()
    for (let offset = 0; offset < customRange.getHeight(); offset += 1) {
      const patch: CellFormatPatch =
        offset === 0
          ? { fillColor: style.headerFill, fontColor: pickReadableInk(style.headerFill), bold: true }
          : style.bandFill && offset % 2 === 1
            ? { fillColor: style.bandFill }
            : {}
      if (Object.keys(patch).length === 0) continue
      applyFormatPatchToRange(
        worksheet.getRange(startRow + offset, startColumn, 1, customRange.getWidth()),
        patch,
      )
    }
    ctx.setMessage(t('appTableStyleApplied', { name: style.name }))
    return
  }
  if (command.startsWith('fill-insert-text:')) {
    // 批量插入文本到单元格：`fill-insert-text:<start|mid|end>:<encodeURIComponent(text)>`
    if (!worksheet) return
    const [where, encoded = ''] = command.slice('fill-insert-text:'.length).split(':')
    const text = decodeURIComponent(encoded)
    const insertRange = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
    if (!insertRange || !requireLoadedSelection(ctx, worksheet, insertRange)) return
    if (where !== 'start' && where !== 'mid' && where !== 'end') return
    const matrix = (insertRange.getValues() as unknown as Matrix).map((row) =>
      row.map((value) => insertTextAtPosition(value, text, where)),
    )
    insertRange.setValues(matrix as unknown as ICellData[][])
    ctx.setMessage(t('appFillInsertDone', { n: insertRange.getHeight() * insertRange.getWidth() }))
    return
  }
  if (command.startsWith('fill-date:')) {
    // 录入当前日期：模式串原样透传（yyyy年m月d日 / yyyy-m-d / yyyymmdd…）。
    if (!worksheet) return
    const pattern = command.slice('fill-date:'.length)
    if (!pattern) return
    const dateRange = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
    if (!dateRange || !requireLoadedSelection(ctx, worksheet, dateRange)) return
    const text = formatFillDate(new Date(), pattern)
    const matrix = Array.from({ length: dateRange.getHeight() }, () =>
      Array.from({ length: dateRange.getWidth() }, () => text),
    )
    dateRange.setValues(matrix as unknown as ICellData[][])
    ctx.setMessage(t('appAppliedToSelection'))
    return
  }
  if (command.startsWith('fill-series:')) {
    // 序列对话框落点：`fill-series:<down|right>:<linear|growth>:<step>[:<stop>]`
    const [dir, type, stepText = '', stopText = ''] = command.slice('fill-series:'.length).split(':')
    const step = Number(stepText)
    if (!Number.isFinite(step) || step === 0) return
    const stop = stopText === '' || stopText === 'none' ? null : Number(stopText)
    if (stop !== null && !Number.isFinite(stop)) return
    if (!worksheet) return
    const seriesRange = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
    if (!seriesRange || !requireLoadedSelection(ctx, worksheet, seriesRange)) return
    const grid = seriesRange.getValues() as unknown as Matrix
    const start = typeof grid[0]?.[0] === 'number' && Number.isFinite(grid[0][0]) ? (grid[0][0] as number) : 1
    const matrix = seriesValues({
      height: seriesRange.getHeight(),
      width: seriesRange.getWidth(),
      down: dir !== 'right',
      growth: type === 'growth',
      step,
      stop,
      start,
    })
    seriesRange.setValues(matrix as unknown as ICellData[][])
    ctx.setMessage(t('appSeriesDone'))
    return
  }
  if (command.startsWith('cond-stats:')) {
    // 条件统计对话框落点：`cond-stats:<fn>:<enc(critRange)>:<enc(criteria)>[:<enc(sumRange)>]`
    if (!worksheet) return
    const [fn, critRange = '', criteria = '', sumRange = ''] = command
      .slice('cond-stats:'.length)
      .split(':')
      .map((part, index) => (index === 0 ? part : decodeURIComponent(part)))
    if (fn !== 'sum' && fn !== 'average' && fn !== 'count') return
    if (!critRange || !criteria || (fn !== 'count' && !sumRange)) {
      ctx.setMessage(t('appCondStatsBadRange'))
      return
    }
    const formula = condStatsFormula({ fn, criteriaRange: critRange, criteria, sumRange })
    const statsRange = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
    if (!statsRange || !worksheet) return
    // autofn 同款落点：纵向选区 → 下方一格；横向单行 → 右侧一格；单格 → 本格
    const isHorizontal = statsRange.getHeight() === 1 && statsRange.getWidth() >= 2
    const isSingle = statsRange.getHeight() === 1 && statsRange.getWidth() === 1
    const target = isSingle
      ? { row: statsRange.getRow(), column: statsRange.getColumn() }
      : isHorizontal
        ? { row: statsRange.getRow(), column: statsRange.getColumn() + statsRange.getWidth() }
        : { row: statsRange.getRow() + statsRange.getHeight(), column: statsRange.getColumn() }
    if (!guardTargetRowLoaded(ctx, worksheet, target.row)) return
    worksheet.getRange(target.row, target.column).setFormula(formula)
    ctx.setMessage(t('appCondStatsDone'))
    return
  }
  if (command.startsWith('cf-hl:')) {
    // 突出显示单元格规则落点（对话框）：greaterThan / lessThan / equal /
    // between / contains / duplicate + 格式预设 id。
    if (!worksheet) return
    const payload = command.slice('cf-hl:'.length)
    const styleId = payload.slice(payload.lastIndexOf(':') + 1)
    const spec = payload.slice(0, payload.length - styleId.length - 1)
    const [op, ...operands] = spec.split(':')
    const preset = cfHlStyleOf(styleId)
    if (!preset) return
    const ruleRange = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
    if (!ruleRange) {
      ctx.setMessage(t('appSelectRangeFirst'))
      return
    }
    const builder = worksheet.newConditionalFormattingRule()
    let styled: CfHighlightChain
    if (op === 'between') {
      const [low, high] = operands
      styled = builder.whenNumberBetween(Number(low), Number(high))
    } else if (op === 'contains') {
      styled = builder.whenTextContains(decodeURIComponent(operands[0] ?? ''))
    } else if (op === 'duplicate') {
      styled = builder.setDuplicateValues()
    } else {
      const value = Number(operands[0])
      if (!Number.isFinite(value)) return
      styled =
        op === 'gt'
          ? builder.whenNumberGreaterThan(value)
          : op === 'lt'
            ? builder.whenNumberLessThan(value)
            : builder.whenNumberEqualTo(value)
    }
    addStyledCfRule(worksheet, builder, styled, preset, ruleRange.getRange())
    ctx.setMessage(t('appCfApplied'))
    return
  }
  if (command.startsWith('cf-top:')) {
    // 项目选取规则落点：`cf-top:<bottom 0|1>:<percent 0|1>:<n>`
    if (!worksheet) return
    const [bottomText = '', percentText = '', countText = ''] = command.slice('cf-top:'.length).split(':')
    const count = Number(countText)
    if (!Number.isInteger(count) || count < 1) return
    const ruleRange = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
    if (!ruleRange) {
      ctx.setMessage(t('appSelectRangeFirst'))
      return
    }
    const rule = worksheet
      .newConditionalFormattingRule()
      .setRank({
        isBottom: bottomText === '1',
        isPercent: percentText === '1',
        value: count,
      })
      .setBackground('#FFC7CE')
      .setFontColor('#9C0006')
      .setRanges([ruleRange.getRange()])
      .build()
    worksheet.addConditionalFormattingRule(rule)
    ctx.setMessage(t('appCfApplied'))
    return
  }
  if (command.startsWith('cf-average:')) {
    // 高于/低于平均值（直接应用，浅红预设）
    if (!worksheet) return
    const above = command.slice('cf-average:'.length) === 'above'
    const ruleRange = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
    if (!ruleRange) {
      ctx.setMessage(t('appSelectRangeFirst'))
      return
    }
    const rule = worksheet
      .newConditionalFormattingRule()
      .setAverage(above ? CFNumberOperator.greaterThan : CFNumberOperator.lessThan)
      .setBackground('#FFC7CE')
      .setFontColor('#9C0006')
      .setRanges([ruleRange.getRange()])
      .build()
    worksheet.addConditionalFormattingRule(rule)
    ctx.setMessage(t('appCfApplied'))
    return
  }
  if (command.startsWith('cf-databar:')) {
    if (!worksheet) return
    const bar = dataBarOf(command.slice('cf-databar:'.length))
    const ruleRange = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
    if (!bar || !ruleRange) {
      ctx.setMessage(t('appSelectRangeFirst'))
      return
    }
    const rule = worksheet
      .newConditionalFormattingRule()
      .setDataBar({
        min: { type: CFValueType.min },
        max: { type: CFValueType.max },
        positiveColor: bar.color,
        nativeColor: '#FF555A',
        isShowValue: true,
      })
      .setRanges([ruleRange.getRange()])
      .build()
    worksheet.addConditionalFormattingRule(rule)
    ctx.setMessage(t('appCfApplied'))
    return
  }
  if (command.startsWith('cf-colorscale:')) {
    if (!worksheet) return
    const stops = colorScaleStopsOf(command.slice('cf-colorscale:'.length))
    const ruleRange = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
    if (!stops || !ruleRange) {
      ctx.setMessage(t('appSelectRangeFirst'))
      return
    }
    const scale = [stops[0], stops[1], stops[2]]
      .filter((color): color is string => color !== null)
      .map((color, index, list) => ({
        index,
        color,
        value:
          index === 0
            ? { type: CFValueType.min }
            : index === list.length - 1
              ? { type: CFValueType.max }
              : { type: CFValueType.percentile, value: 50 },
      }))
    const rule = worksheet
      .newConditionalFormattingRule()
      .setColorScale(scale)
      .setRanges([ruleRange.getRange()])
      .build()
    worksheet.addConditionalFormattingRule(rule)
    ctx.setMessage(t('appCfApplied'))
    return
  }
  if (command.startsWith('cf-iconset:')) {
    if (!worksheet) return
    const preset = iconSetOf(command.slice('cf-iconset:'.length))
    const ruleRange = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
    if (!preset || !ruleRange) {
      ctx.setMessage(t('appSelectRangeFirst'))
      return
    }
    // Excel 语义：共 count 档，除最后一档取 min 外，其余 greaterThanOrEqual
    // + 等分百分比（3 档 67/33）
    const thresholds = iconThresholds(preset.count)
    const rule = worksheet
      .newConditionalFormattingRule()
      .setIconSet({
        iconConfigs: Array.from({ length: preset.count }, (_, index) => ({
          iconType: preset.iconType as IIconSetType,
          iconId: String(index),
          operator: CFNumberOperator.greaterThanOrEqual,
          value:
            index === preset.count - 1
              ? { type: CFValueType.min }
              : { type: CFValueType.percent, value: thresholds[index] ?? 0 },
        })),
        isShowValue: true,
      })
      .setRanges([ruleRange.getRange()])
      .build()
    worksheet.addConditionalFormattingRule(rule)
    ctx.setMessage(t('appCfApplied'))
    return
  }
  if (command.startsWith('cf-clear:')) {
    // 清除规则：selection = 与选区相交的规则；sheet = 全部规则
    if (!worksheet) return
    const scope = command.slice('cf-clear:'.length)
    const clearRange = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
    if (scope === 'selection' && !clearRange) {
      ctx.setMessage(t('appSelectRangeFirst'))
      return
    }
    const selection = clearRange?.getRange()
    let removed = 0
    for (const rule of worksheet.getConditionalFormattingRules()) {
      if (!rule.cfId) continue
      if (scope !== 'sheet' && selection && !rangesIntersect(selection, rule.ranges[0])) continue
      worksheet.deleteConditionalFormattingRule(rule.cfId)
      removed += 1
    }
    ctx.setMessage(t('appCfCleared', { n: removed }))
    return
  }
  if (
    command.startsWith('freeze-rows:') ||
    command.startsWith('freeze-cols:') ||
    command.startsWith('freeze-rows-cols:')
  ) {
    // 冻结至第 N 行 / 第 M 列 / 第 N 行 M 列（WPS 动态标签菜单落点）
    if (!worksheet) return
    const parts = command.split(':').slice(1)
    const rows = command.startsWith('freeze-cols:') ? 0 : Number(parts[0])
    const columns =
      command.startsWith('freeze-rows:') ? 0 : Number(parts[command.startsWith('freeze-rows-cols:') ? 1 : 0])
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 0 || columns < 0) return
    applyFreeze(ctx, worksheet, rows, columns, t('appFreezeApplied'))
    return
  }
  if (command === 'freeze-header') {
    // 冻结表头：选区/工作表上有表格对象 → 冻到表头之下；否则冻首行
    if (!worksheet) return
    const state = ctx.lazyWorkbookRef.current
    const sheetId = worksheet.getSheetId()
    const journalTable = state?.editJournal.tableAdds.find((table) => table.sheetId === sheetId)
    const fileSheet = state?.file.sheets.find((sheet) => sheet.id === sheetId)
    const fileTable = fileSheet?.tables?.[0]
    const rows = journalTable
      ? journalTable.area.startRow + 1
      : fileTable
        ? fileTable.range.startRow + Math.max(1, fileTable.headerRowCount)
        : 1
    applyFreeze(ctx, worksheet, rows, 0, t('appFreezeApplied'))
    return
  }
  if (command === 'merge-cell-styles') {
    // 合并样式：按名称归并重名自定义单元格样式
    const merged = mergeCustomCellStyles()
    ctx.setMessage(t('appCellStyleMerged', { n: merged }))
    return
  }
  if (command.startsWith('use-in-formula:')) {
    // Unlike Excel, this commits immediately instead of opening the editor,
    // so a non-empty cell (say, the header a Create-from-Selection left
    // selected) would silently lose its formula or value — refuse instead.
    const workbook = runtime.univerAPI.getActiveWorkbook()
    const active = workbook?.getActiveRange()
    if (!workbook || !worksheet || !active) {
      ctx.setMessage(t('appSelectCellFirst'))
      return
    }
    const cell = worksheet.getRange(active.getRow(), active.getColumn(), 1, 1)
    const value = cell.getValue()
    if (cell.getFormula() || (value != null && value !== '')) {
      ctx.setMessage(t('appUseInFormulaNeedsEmptyCell'))
      return
    }
    // Defined names contain no colons, so the remainder is the whole name.
    const error = handleApplyFormula(
      ctx.dataToolsContext(),
      `=${command.slice('use-in-formula:'.length)}`,
    )
    if (error) ctx.setMessage(error)
    return
  }
  if (command === 'create-names:top' || command === 'create-names:left') {
    handleCreateNamesFromSelection(
      ctx.dataToolsContext(),
      command === 'create-names:top' ? 'top' : 'left',
    )
    return
  }
  if (command.startsWith('cell-style:')) {
    const styleKey = command.slice('cell-style:'.length)
    const custom = styleKey.startsWith('custom:') ? getCustomCellStyle(styleKey.slice(7)) : null
    const presets = custom ? [custom.patch] : CELL_STYLE_PRESETS[styleKey]
    const range = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
    if (!presets || !range) {
      ctx.setMessage(t('appSelectCellsFirst'))
      return
    }
    for (const patch of presets) applyFormatPatchToRange(range, patch)
    ctx.setMessage(t('appCellStyleApplied'))
    return
  }
  if (command.startsWith('insert-chart:')) {
    void handleInsertChart(ctx.visualContext(), command.slice('insert-chart:'.length))
    return
  }
  if (command.startsWith('insert-pivot-chart:')) {
    void handleInsertPivotChart(ctx.visualContext(), command.slice('insert-pivot-chart:'.length))
    return
  }
  if (command === 'slicer-open') {
    handleOpenSlicerPicker(ctx.pivotContext())
    return
  }
  if (command === 'timeline-open') {
    handleOpenTimelinePicker(ctx.pivotContext())
    return
  }
  if (command.startsWith('insert-shape:')) {
    // Excel parity: gallery pick arms the crosshair draw mode (click = default
    // size, drag = custom, Shift = square, Esc = cancel)
    startShapeDraw(ctx.visualContext(), command.slice('insert-shape:'.length))
    return
  }
  if (command === 'insert-textbox') {
    handleInsertShape(ctx.visualContext(), 'rect', true)
    return
  }
  if (command === 'insert-picture') {
    handleInsertPicture(ctx.visualContext())
    return
  }
  if (command === 'format-as-table') {
    handleFormatAsTable(ctx.dataToolsContext(), 'TableStyleMedium2')
    return
  }
  if (command.startsWith('page-layout:')) {
    ctx.handlePageLayoutCommand(command.slice('page-layout:'.length))
    return
  }
  if (command === 'export-pdf') {
    void ctx.handleExportPdf()
    return
  }
  if (command.startsWith('row-height:') || command.startsWith('col-width:')) {
    const active = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
    if (!worksheet || !active) {
      ctx.setMessage(t('appSelectCellFirst'))
      return
    }
    const isRow = command.startsWith('row-height:')
    const value = Number(command.slice(command.indexOf(':') + 1))
    // file units: points for rows (max 409.5), character width for columns (max 255)
    if (!Number.isFinite(value) || value < 0 || value > (isRow ? 409.5 : 255)) return
    const area = active.getRange()
    if (isRow) {
      worksheet.setRowHeightsForced(
        area.startRow,
        area.endRow - area.startRow + 1,
        Math.round((value * 96) / 72),
      )
    } else {
      worksheet.setColumnWidths(
        area.startColumn,
        area.endColumn - area.startColumn + 1,
        Math.round(characterWidthToPixels(value)),
      )
    }
    return
  }
  if (command.startsWith('zoom:')) {
    const percent = Number(command.slice('zoom:'.length))
    if (worksheet && Number.isInteger(percent) && percent >= 25 && percent <= 400) {
      worksheet.zoom(percent / 100)
      ctx.setMessage(t('appZoom', { percent }))
    }
    return
  }
  // Excel's PageUp/PageDown (Alt+ = one screen left/right): move the active
  // cell by one viewport of rows/columns and scroll the view with it, keeping
  // the cell's on-screen position (alpha ledger r126).
  if (command.startsWith('page-row:') || command.startsWith('page-col:')) {
    const horizontal = command.startsWith('page-col:')
    const direction = command.endsWith(':-1') ? -1 : 1
    const workbook = runtime.univerAPI.getActiveWorkbook()
    const sheet = workbook?.getActiveSheet()
    const active = workbook?.getActiveRange()
    if (!workbook || !sheet || !active) return
    // typing in a cell: PageUp/Down belongs to the editor, not navigation
    const editing = workbook as unknown as { isCellEditing?(): boolean }
    if (editing.isCellEditing?.()) return
    let visible: {
      startRow: number
      endRow: number
      startColumn: number
      endColumn: number
    } | null = null
    try {
      visible = sheet.getVisibleRange()
    } catch {
      /* no scroll render controller yet (still booting) */
    }
    if (!visible) return
    const page = horizontal
      ? Math.max(1, visible.endColumn - visible.startColumn)
      : Math.max(1, visible.endRow - visible.startRow)
    const maxRow = sheet.getMaxRows() - 1
    const maxColumn = sheet.getMaxColumns() - 1
    const clamp = (value: number, max: number): number => Math.min(max, Math.max(0, value))
    const row = horizontal ? active.getRow() : clamp(active.getRow() + direction * page, maxRow)
    const column = horizontal
      ? clamp(active.getColumn() + direction * page, maxColumn)
      : active.getColumn()
    // Anchor from the scroll state, not visible.start*: on RTL sheets
    // getVisibleRange().startColumn is not what scrollToCell anchors, and a
    // vertical page must keep the horizontal scroll bit-exact (and vice
    // versa). Paging keeps logical direction, like the arrow keys.
    const rtl = sheet.getSheet().getConfig().rightToLeft === BooleanNumber.TRUE
    const anchor = getScrollAnchor(workbook, sheet) ?? {
      row: visible.startRow,
      column: rtl ? visible.endColumn : visible.startColumn,
    }
    // The RTL scroll state records home as a flush-right sentinel (column 0).
    // scrollToCell round-trips it absolutely (vertical pages keep it so the
    // horizontal position stays capped at exactly flush), but horizontal page
    // arithmetic needs the true visually-left column.
    const anchorColumn =
      rtl && horizontal ? Math.max(anchor.column, visible.endColumn) : anchor.column
    const viewRow = horizontal ? anchor.row : clamp(anchor.row + direction * page, maxRow)
    const viewColumn = horizontal
      ? clamp(anchorColumn + direction * page, maxColumn)
      : anchor.column
    workbook.setActiveRange(sheet.getRange(row, column))
    sheet.scrollToCell(viewRow, viewColumn)
    return
  }
  const range = runtime.univerAPI.getActiveWorkbook()?.getActiveRange()
  if (!range) {
    ctx.setMessage(t('appSelectRangeFirst'))
    return
  }
  const { name, argument, extra } = parseStyleCommand(command)
  // Excel persists select-all / full-column formatting as the columns'
  // DEFAULT format: new cells inherit it at any row, forever. Univer only
  // materializes styles onto cells within the current grid bounds, so
  // without this a reopened workbook types in the theme font again (r124),
  // and a column whose <col style=> carried a fill shows it again below the
  // grid after No Fill.
  const recordFullHeightColumnStyle = (delta: WorkbookStyleEdit, undoTopBefore: unknown): void => {
    const state = ctx.lazyWorkbookRef.current
    const sheet = runtime.univerAPI.getActiveWorkbook()?.getActiveSheet()
    const sheetId = sheet?.getSheetId()
    if (!state || !sheet || !sheetId || isSheetRemoved(state.editJournal, sheetId)) return
    if (range.getRow() !== 0 || range.getHeight() < sheet.getMaxRows()) return
    const op = {
      kind: 'set-col-style' as const,
      start: range.getColumn(),
      end: range.getColumn() + range.getWidth() - 1,
      style: delta,
    }
    recordStructuralOp(state.editJournal, sheetId, op)
    ctx.setPendingEdits(journalSize(state.editJournal))
    // ⌘Z must also retract the column default, or a save after undo would
    // still write <col style> and new cells would inherit the undone format.
    // Attached to the font command's own undo entry: one press reverts the
    // whole action, and no extra undo-carry truncation point appears (bugbot)
    attachVisualUndoToLastStep(
      runtime,
      {
        undo: () => {
          removeStructuralOp(state.editJournal, sheetId, op)
          ctx.setPendingEdits(journalSize(state.editJournal))
        },
        redo: () => {
          recordStructuralOp(state.editJournal, sheetId, op)
          ctx.setPendingEdits(journalSize(state.editJournal))
        },
      },
      undoTopBefore,
    )
  }
  try {
    const style = selectionStyle(range)
    switch (name) {
      case 'bold':
        // An explicit :on/:off argument sets absolutely (Format Cells
        // dialog); no argument keeps ribbon toggle behavior.
        range.setFontWeight(
          argument
            ? argument === 'on'
              ? 'bold'
              : null
            : style.bl === BooleanNumber.TRUE
              ? null
              : 'bold',
        )
        break
      case 'italic':
        range.setFontStyle(
          argument
            ? argument === 'on'
              ? 'italic'
              : null
            : style.it === BooleanNumber.TRUE
              ? null
              : 'italic',
        )
        break
      case 'underline': {
        if (argument === 'double') {
          // Toggle: Excel's double-underline button removes an existing
          // double underline. setValue merges the style patch range-wide.
          const current = style.ul as { s?: number; t?: number } | undefined
          const isDouble = current?.s === BooleanNumber.TRUE && current.t === 10
          range.setValue({
            s: { ul: isDouble ? null : { s: BooleanNumber.TRUE, t: 10 } },
          } as unknown as ICellData)
          break
        }
        range.setFontLine(
          argument
            ? argument === 'on'
              ? 'underline'
              : null
            : style.ul?.s === BooleanNumber.TRUE
              ? null
              : 'underline',
        )
        break
      }
      case 'strike':
        range.setFontLine(
          argument
            ? argument === 'on'
              ? 'line-through'
              : null
            : style.st?.s === BooleanNumber.TRUE
              ? null
              : 'line-through',
        )
        break
      case 'align':
        // justify/distributed set the raw style key (same mutation shape,
        // journals identically). The facade helper only accepts
        // 'left' | 'center' | 'normal' — and 'normal' (confusingly) maps to
        // RIGHT — so translate 'right' before calling it; anything else
        // would hit its throwing default branch.
        if (argument === 'justify' || argument === 'distributed') {
          range.setValue({
            s: { ht: argument === 'justify' ? 4 : 6 },
          } as unknown as ICellData)
        } else {
          range.setHorizontalAlignment(
            argument === 'right' ? 'normal' : (argument as 'left' | 'center'),
          )
        }
        break
      case 'valign':
        range.setVerticalAlignment(argument as 'top' | 'middle' | 'bottom')
        break
      case 'wrap':
        // An explicit :on/:off sets absolutely (Format Cells dialog).
        range.setWrap(argument ? argument === 'on' : style.tb !== WrapStrategy.WRAP)
        break
      case 'indent': {
        // Renders as left padding (pd) and journals through the normal
        // set-range-values channel, so it is visible and undoable.
        const steps = Number(argument)
        if (!Number.isInteger(steps) || steps < 0 || steps > 250) return
        range.setValue({
          s: { pd: steps === 0 ? null : { l: steps * INDENT_STEP_PX } },
        } as unknown as ICellData)
        break
      }
      case 'cellprot': {
        // No Univer model for cell protection — journal the neutral delta
        // directly. File-only: not rendered, not undoable.
        const state = ctx.lazyWorkbookRef.current
        if (!state) {
          ctx.setMessage(t('appSettingNeedsFile'))
          return
        }
        const sheetId = worksheet?.getSheetId()
        if (!sheetId || isSheetRemoved(state.editJournal, sheetId)) return
        if (range.getHeight() * range.getWidth() > 10_000) {
          ctx.setMessage(t('appTooManyCellsForSetting'))
          return
        }
        const delta: WorkbookStyleEdit = {}
        if (argument === 'locked-on') delta.protectionLocked = true
        else if (argument === 'locked-off') delta.protectionLocked = false
        if (extra === 'hidden-on') delta.protectionHidden = true
        else if (extra === 'hidden-off') delta.protectionHidden = false
        if (Object.keys(delta).length === 0) return
        for (let row = range.getRow(); row < range.getRow() + range.getHeight(); row += 1) {
          for (
            let column = range.getColumn();
            column < range.getColumn() + range.getWidth();
            column += 1
          ) {
            recordNeutralStyleEdit(state.editJournal, sheetId, row, column, delta)
          }
        }
        ctx.setPendingEdits(journalSize(state.editJournal))
        ctx.setMessage(t('appProtectionFlagsRecorded'))
        return
      }
      case 'merge': {
        const sheet = runtime.univerAPI.getActiveWorkbook()?.getActiveSheet()
        // Merge Across stays on Univer's command: there is no merge_across op
        // yet, and one merge_cells per row would fan a whole-column selection
        // out into a million ops.
        if (ctx.lazyWorkbookRef.current && sheet && argument !== 'across') {
          const sheetId = sheet.getSheetId()
          const top = range.getRow()
          const left = range.getColumn()
          const bottom = top + range.getHeight() - 1
          const right = left + range.getWidth() - 1
          const a1 = `${columnLabel(left)}${top + 1}:${columnLabel(right)}${bottom + 1}`
          const ops: WorkbookOperation[] =
            argument === 'unmerge'
              ? [{ op: 'unmerge_cells', sheetId, range: a1 }]
              : [{ op: 'merge_cells', sheetId, range: a1 }]
          if (argument === 'center') {
            // The merged cell renders its anchor's format; formatting only the
            // anchor also keeps whole-column merges under the range-op cap.
            ops.push({
              op: 'format_range',
              sheetId,
              range: `${columnLabel(left)}${top + 1}`,
              format: { horizontalAlign: 'center' },
            })
          }
          // return, not break: the post-switch notice must not land before
          // the async apply (or over a gate refusal)
          void ctx.runOps(ops, t('appAppliedToSelection'))
          return
        }
        if (argument === 'unmerge') {
          range.breakApart()
        } else if (argument === 'across') {
          range.mergeAcross()
        } else {
          range.merge()
          if (argument === 'center') range.setHorizontalAlignment('center')
        }
        break
      }
      case 'format':
        range.setNumberFormat(argument)
        break
      case 'font-family': {
        const undoTopBefore = topUndoElement(runtime)
        range.setFontFamily(argument)
        if (argument.length > 0 && argument.length <= 128) {
          recordFullHeightColumnStyle({ fontFamily: argument }, undoTopBefore)
        }
        break
      }
      case 'font-size': {
        const sizePt = Number(argument)
        const undoTopBefore = topUndoElement(runtime)
        range.setFontSize(sizePt)
        if (Number.isFinite(sizePt) && sizePt > 0 && sizePt <= 409) {
          recordFullHeightColumnStyle({ fontSize: sizePt }, undoTopBefore)
        }
        break
      }
      case 'fill': {
        const undoTopBefore = topUndoElement(runtime)
        if (argument === 'none') {
          // setBackground(null) reaches the mutation as bg: { rgb: null },
          // which removeNull strips to a MISSING bg — and a <col style=> fill
          // composes straight back through the cell the user just cleared.
          // Pin the clear with the empty-rgb sentinel instead. SetStyleCommand
          // (not range.setValue) so filtered-out rows stay untouched, exactly
          // like the facade helper.
          const workbook = runtime.univerAPI.getActiveWorkbook()
          if (!workbook || !worksheet) return
          runtime.univerAPI.syncExecuteCommand('sheet.command.set-style', {
            unitId: workbook.getId(),
            subUnitId: worksheet.getSheetId(),
            range: range.getRange(),
            style: { type: 'bg', value: { ...NO_FILL_STYLE } },
          })
          recordFullHeightColumnStyle({ fillColor: null }, undoTopBefore)
        } else {
          range.setBackground(argument)
          const fillColor = normalizeHexColor(argument)
          if (fillColor) recordFullHeightColumnStyle({ fillColor }, undoTopBefore)
        }
        break
      }
      case 'font-color':
        // 'auto' clears the explicit color back to the default (Excel's
        // Automatic); null is the documented reset, same as setBackground
        range.setFontColor((argument === 'auto' ? null : argument) as unknown as string)
        break
      case 'sort': {
        if (range.getHeight() < 2) {
          ctx.setMessage(t('appSortSelectRows'))
          return
        }
        // Set the outcome message first: if the streaming gate cancels the
        // sort command, its explanation lands afterwards and wins.
        ctx.setMessage(argument === 'asc' ? t('appSortedAsc') : t('appSortedDesc'))
        range.sort({ column: 0, ascending: argument === 'asc' })
        return
      }
      case 'autofn': {
        if (!worksheet) return
        // WPS 自动求和落点（B1 对齐）：
        // - 纵向选区（高≥2）→ 各列选区下方一格
        // - 横向选区（宽≥2 且高=1）→ 各行选区右侧一格
        // - 单格 → 智能识别：先向上、再向左扫描连续数值区，公式落在当前格
        const startRow = range.getRow()
        const startColumn = range.getColumn()
        const height = range.getHeight()
        const width = range.getWidth()
        const isHorizontal = height === 1 && width >= 2
        const isSingle = height === 1 && width === 1
        if (!isHorizontal && !isSingle && height < 2) {
          ctx.setMessage(t('appAutofnSelectCells', { fn: argument }))
          return
        }
        // Same protection as manual edits: never write into a row whose
        // original content has not streamed in yet (see BeforeSheetEditStart).
        const state = ctx.lazyWorkbookRef.current
        const guardRowLoaded = (targetRow: number): boolean => {
          if (!state || state.flags.preloadComplete) return true
          const sheetId = worksheet.getSheetId()
          const sheet = state.file.sheets.find((candidate) => candidate.id === sheetId)
          const loaded = state.loadedRanges.get(sheetId)
          const targetInData = sheet !== undefined && targetRow < sheet.rowCount
          const targetLoaded =
            loaded !== undefined && targetRow >= loaded.startRow && targetRow <= loaded.endRow
          return !targetInData || targetLoaded
        }
        if (isSingle) {
          // smart region: contiguous numeric run upward, else leftward
          const numeric = (r: number, c: number): boolean => {
            const v = worksheet.getRange(r, c).getValue()
            return typeof v === 'number' && Number.isFinite(v)
          }
          let top = startRow - 1
          while (top >= 0 && numeric(top, startColumn) && startRow - top <= 1024) top -= 1
          top += 1
          if (startRow - 1 >= top) {
            const letter = columnLabel(startColumn)
            worksheet
              .getRange(startRow, startColumn)
              .setFormula(`=${argument}(${letter}${top + 1}:${letter}${startRow})`)
            ctx.setMessage(t('appAutofnInserted', { fn: argument }))
            return
          }
          let left = startColumn - 1
          while (left >= 0 && numeric(startRow, left) && startColumn - left <= 1024) left -= 1
          left += 1
          if (startColumn - 1 >= left) {
            worksheet
              .getRange(startRow, startColumn)
              .setFormula(
                `=${argument}(${columnLabel(left)}${startRow + 1}:${columnLabel(startColumn - 1)}${startRow + 1})`,
              )
            ctx.setMessage(t('appAutofnInserted', { fn: argument }))
            return
          }
          ctx.setMessage(t('appAutofnSelectCells', { fn: argument }))
          return
        }
        if (isHorizontal) {
          if (!guardRowLoaded(startRow)) {
            ctx.setMessage(t('appRowBelowStreaming'))
            return
          }
          for (let row = startRow; row < startRow + height; row += 1) {
            const r = row + 1
            worksheet
              .getRange(row, startColumn + width)
              .setFormula(
                `=${argument}(${columnLabel(startColumn)}${r}:${columnLabel(startColumn + width - 1)}${r})`,
              )
          }
          ctx.setMessage(t('appAutofnInserted', { fn: argument }))
          return
        }
        const lastRow = startRow + height - 1
        if (!guardRowLoaded(lastRow + 1)) {
          ctx.setMessage(t('appRowBelowStreaming'))
          return
        }
        for (let column = startColumn; column < startColumn + width; column += 1) {
          const letter = columnLabel(column)
          worksheet
            .getRange(lastRow + 1, column)
            .setFormula(`=${argument}(${letter}${startRow + 1}:${letter}${lastRow + 1})`)
        }
        ctx.setMessage(t('appAutofnInserted', { fn: argument }))
        return
      }
      case 'merge-workbooks': {
        const runtime = ctx.univerRef.current
        if (!runtime) return
        void mergeWorkbooksIntoCurrent({
          runtime,
          lazyWorkbookRef: ctx.lazyWorkbookRef,
          setMessage: ctx.setMessage,
        })
        return
      }
      case 'insert-now': {
        // Excel's Ctrl+; / Ctrl+Shift+;: static current date / time into the
        // ACTIVE cell (not the selection origin) as a real serial with a
        // date/time format (silent, like Excel — typing-equivalent write, so
        // the streaming guards apply).
        if (!worksheet) return
        const now = new Date()
        const localAsUtc = Date.UTC(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          now.getHours(),
          now.getMinutes(),
          now.getSeconds(),
        )
        const serial = (localAsUtc - Date.UTC(1899, 11, 30)) / 86400000
        const primary = ctx.univerRef.current?.univerAPI
          .getActiveWorkbook()
          ?.getActiveSheet()
          ?.getSelection()
          ?.getCurrentCell()
        const cell = worksheet.getRange(
          primary?.actualRow ?? range.getRow(),
          primary?.actualColumn ?? range.getColumn(),
        )
        if (argument === 'time') {
          cell.setValue(serial - Math.floor(serial))
          cell.setNumberFormat('h:mm')
        } else {
          // 1904-system workbooks store serials 1462 days lower
          const dayShift = ctx.lazyWorkbookRef.current?.file.date1904 === true ? 1462 : 0
          cell.setValue(Math.floor(serial) - dayShift)
          cell.setNumberFormat('yyyy/m/d')
        }
        return
      }
      case 'sort-custom': {
        // `argument` = header flag, `extra` = "12a,3d" (colIndex + order).
        if (!worksheet) return
        if (range.getHeight() < 2) {
          ctx.setMessage(t('appSortSelectRows'))
          return
        }
        const orderRules = extra.split(',').flatMap((token) => {
          const parsed = /^([0-9]+)([ad])$/.exec(token)
          if (!parsed?.[1]) return []
          return [{ type: parsed[2] === 'd' ? 'desc' : 'asc', colIndex: Number(parsed[1]) }]
        })
        if (orderRules.length === 0) return
        ctx.setMessage(t('appSortedCustom'))
        void runtime.univerAPI.executeCommand('sheet.command.sort-range', {
          unitId: runtime.univerAPI.getActiveWorkbook()?.getId(),
          subUnitId: worksheet.getSheetId(),
          range: {
            startRow: range.getRow(),
            endRow: range.getRow() + range.getHeight() - 1,
            startColumn: range.getColumn(),
            endColumn: range.getColumn() + range.getWidth() - 1,
          },
          orderRules,
          hasTitle: argument === '1',
        })
        return
      }
      case 'remove-duplicates': {
        if (!worksheet) return
        const state = ctx.lazyWorkbookRef.current
        const sheetId = worksheet.getSheetId()
        // Same data-dependency gate as sorting: partially streamed rows
        // would dedupe against data the user never saw.
        if (
          state &&
          !state.editJournal.sheets.added.has(sheetId) &&
          (!state.formulaMode || !state.flags.preloadComplete)
        ) {
          ctx.setMessage(t('appDedupeNeedsFullLoad'))
          return
        }
        if (range.getHeight() < 2) {
          ctx.setMessage(t('appDedupeSelectRows'))
          return
        }
        const values = range.getValues().map((row) => row.map((value) => value ?? null))
        const { rows, removed } = dedupeRows(values, argument === '1')
        if (removed === 0) {
          ctx.setMessage(t('appNoDuplicates'))
          return
        }
        while (rows.length < values.length) {
          rows.push(Array.from({ length: range.getWidth() }, () => null))
        }
        const startRow = range.getRow()
        const startColumn = range.getColumn()
        // Only rewrite rows that actually change, so formulas in rows that
        // stay put survive; moved rows land as their computed values.
        for (const [offset, row] of rows.entries()) {
          const current = values[offset]
          if (current && row.every((value, index) => value === current[index])) continue
          worksheet
            .getRange(startRow + offset, startColumn, 1, range.getWidth())
            // null clears the cell (the facade type omits it, the runtime
            // treats it as a full delete — same as Clear All).
            .setValues([[...row]] as unknown as ICellData[][])
        }
        ctx.setMessage(t('appDuplicatesRemoved', { count: removed }))
        return
      }
      case 'link-set':
      case 'link-remove': {
        const state = ctx.lazyWorkbookRef.current
        if (!state || !worksheet) {
          ctx.setMessage(t('appLinksNeedFile'))
          return
        }
        const sheetId = worksheet.getSheetId()
        const address = formatAddress(range.getRow(), range.getColumn())
        let target: string | null = null
        if (name === 'link-set') {
          target = normalizeLinkTarget(decodeURIComponent(argument))
          if (target === null) {
            ctx.setMessage(t('appLinkInvalid'))
            return
          }
        }
        void ctx
          .runOps(
            [{ op: 'set_hyperlink', sheetId, address, target }],
            target === null ? t('appLinkRemoved') : t('appLinkSaved'),
          )
          .then(() => ctx.refreshSelectionFormatRef.current())
        return
      }
      case 'rotate': {
        // Wire values map to Univer's set-text-rotation: a number of
        // degrees (counterclockwise positive) or 'v' for stacked text.
        const value = argument === 'vertical' ? 'v' : Number(argument)
        if (value !== 'v' && !Number.isFinite(value)) return
        void runtime.univerAPI.executeCommand('sheet.command.set-text-rotation', { value })
        break
      }
      case 'flash-fill': {
        if (!worksheet) return
        const targetColumn = range.getColumn()
        if (targetColumn === 0) {
          ctx.setMessage(t('appFlashFillNeedsLeft'))
          return
        }
        const startRow = range.getRow()
        let endRow = startRow + range.getHeight() - 1
        if (range.getHeight() === 1) {
          // Single-cell selection: follow the column to the left downward.
          const probeRows = Math.min(1000, worksheet.getMaxRows() - startRow)
          const probe = worksheet
            .getRange(startRow, targetColumn - 1, probeRows, 1)
            .getValues() as (string | number | boolean | null | undefined)[][]
          let last = startRow
          for (const [offset, rowValues] of probe.entries()) {
            const value = rowValues[0]
            if (value === null || value === undefined || String(value) === '') break
            last = startRow + offset
          }
          endRow = last
        }
        const rowCount = endRow - startRow + 1
        if (rowCount < 2) {
          ctx.setMessage(t('appFlashFillNeedsRows'))
          return
        }
        const firstSource = Math.max(0, targetColumn - 6)
        const grid = worksheet
          .getRange(startRow, firstSource, rowCount, targetColumn - firstSource + 1)
          .getValues() as (string | number | boolean | null | undefined)[][]
        const sourceOf = (
          row: readonly (string | number | boolean | null | undefined)[],
        ): string[] => row.slice(0, -1).map((value) => String(value ?? ''))
        const examples: { source: string[]; output: string }[] = []
        for (const row of grid) {
          const target = row[row.length - 1]
          if (target !== null && target !== undefined && String(target) !== '') {
            examples.push({ source: sourceOf(row), output: String(target) })
            if (examples.length >= 3) break
          }
        }
        if (examples.length === 0) {
          ctx.setMessage(t('appFlashFillNeedsExamples'))
          return
        }
        const template = inferFlashFillTemplate(examples)
        if (!template) {
          ctx.setMessage(t('appFlashFillNoPattern'))
          return
        }
        let filled = 0
        const matrix: (string | number | boolean)[][] = grid.map((row) => {
          const current = row[row.length - 1]
          if (current !== null && current !== undefined && String(current) !== '') {
            return [current]
          }
          const source = sourceOf(row)
          if (source.every((value) => value.trim() === '')) return ['']
          filled += 1
          return [applyFlashFillTemplate(template, source)]
        })
        if (filled === 0) {
          ctx.setMessage(t('appFlashFillNothingToFill'))
          return
        }
        worksheet.getRange(startRow, targetColumn, rowCount, 1).setValues(matrix)
        ctx.setMessage(t('appFlashFillDone', { count: filled }))
        return
      }
      case 'sparkline': {
        if (!worksheet) return
        const state = ctx.lazyWorkbookRef.current
        if (!state) {
          ctx.setMessage(t('appSparklineNeedsFile'))
          return
        }
        const type =
          argument === 'column'
            ? ('column' as const)
            : argument === 'stacked'
              ? ('stacked' as const)
              : ('line' as const)
        if (range.getWidth() < 2) {
          ctx.setMessage(t('appSparklineNeedsCols'))
          return
        }
        const sheetId = worksheet.getSheetId()
        const sheetName = worksheet.getSheetName()
        const startRow = range.getRow()
        const startColumn = range.getColumn()
        const endColumn = startColumn + range.getWidth() - 1
        const targetColumn = endColumn + 1
        if (targetColumn >= worksheet.getMaxColumns()) {
          ctx.setMessage(t('appSparklineNoSpace'))
          return
        }
        const rows = Math.min(range.getHeight(), 200)
        const cells = Array.from({ length: rows }, (_, offset) => ({
          cell: `${columnLabel(targetColumn)}${startRow + offset + 1}`,
          sourceRef: absRangeRef(
            sheetName,
            `${columnLabel(startColumn)}${startRow + offset + 1}` +
              `:${columnLabel(endColumn)}${startRow + offset + 1}`,
          ),
        }))
        const entry = {
          id: `sparkline-${Date.now().toString(36)}-${state.editJournal.sparklineAdds.length + 1}`,
          sheetId,
          type,
          cells,
        }
        recordSparklineAdd(state.editJournal, entry)
        const refreshSparklinesHere = (): void => {
          ctx.setPendingEdits(journalSize(state.editJournal))
          queueSparklineInstall(
            runtime,
            ctx.lazyWorkbookRef,
            ctx.sparklineDisposablesRef,
            ctx.sparklineTimerRef,
          )
        }
        pushVisualUndo(runtime, {
          undo: () => {
            removeSparklineAdd(state.editJournal, entry.id)
            refreshSparklinesHere()
          },
          redo: () => {
            recordSparklineAdd(state.editJournal, entry)
            refreshSparklinesHere()
          },
        })
        refreshSparklinesHere()
        ctx.setMessage(t('appSparklinesInserted', { count: cells.length }))
        return
      }
      case 'text-to-columns': {
        if (!worksheet) return
        if (range.getWidth() > 1) {
          ctx.setMessage(t('appTextToColsSelectOne'))
          return
        }
        const delimiter = Number(argument)
        if (!Number.isInteger(delimiter) || delimiter <= 0) return
        ctx.setMessage(t('appSplitIntoColumns'))
        void runtime.univerAPI.executeCommand('sheet.command.split-text-to-columns', {
          range: {
            startRow: range.getRow(),
            endRow: range.getRow() + range.getHeight() - 1,
            startColumn: range.getColumn(),
            endColumn: range.getColumn(),
          },
          delimiter,
        })
        return
      }
      case 'border': {
        const type = BORDER_COMMAND_TYPES[argument]
        if (!type) return
        // `extra` is "<#color>[:<line-style>]" — the ribbon sends only the
        // color, the Format Cells dialog appends an ST_BorderStyle name
        const [colorPart = '', stylePart = ''] = extra.split(':')
        const borderStyle =
          BORDER_LINE_STYLE_TYPES[stylePart] ??
          (argument === 'thick-outer' ? BorderStyleTypes.MEDIUM : BorderStyleTypes.THIN)
        range.setBorder(
          type,
          borderStyle,
          /^#[0-9a-fA-F]{6}$/.test(colorPart) ? colorPart : '#000000',
        )
        break
      }
      default:
        return
    }
    ctx.setMessage(t('appAppliedToSelection'))
  } catch (error: unknown) {
    ctx.setMessage(error instanceof Error ? error.message : t('appCommandFailed'))
  }
}
