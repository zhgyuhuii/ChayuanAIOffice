/**
 * Page Break Preview overlay (View tab): page boundaries drawn as float DOM
 * layers anchored to cell ranges, so they scroll and zoom with the grid.
 * Manual breaks are solid blue, automatic ones dashed; each page carries a
 * centered watermark label. Boundaries are computed from the session's page
 * setup (paper, margins, orientation, scale) against current row heights and
 * column widths — the same pt math the PDF export uses.
 */
import type { PageSetupJournalState } from './edit-journal'
import { t } from './i18n/locale'
import type { LazyWorkbookState, UniverRuntime, UniverWorksheet } from './univer-state'
import { fileToScreen } from './view-transform'

interface Disposable {
  dispose(): void
}

/// A page boundary: the break sits before this row/column index.
export interface PageBoundary {
  readonly index: number
  readonly manual: boolean
}

/// The effective print area in 0-based inclusive screen coordinates.
export interface PrintAreaBounds {
  readonly startRow: number
  readonly startColumn: number
  readonly endRow: number
  readonly endColumn: number
}

/// Printable page size in points for the session's page setup, mirroring the
/// export pipeline's paper/margin tables.
const PAPER_INCHES: Record<number, { width: number; height: number }> = {
  1: { width: 8.5, height: 11 },
  3: { width: 11, height: 17 },
  5: { width: 8.5, height: 14 },
  7: { width: 7.25, height: 10.5 },
  8: { width: 11.69, height: 16.54 },
  9: { width: 8.27, height: 11.69 },
  11: { width: 5.83, height: 8.27 },
}

const MARGIN_PRESETS = {
  normal: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75 },
  wide: { left: 1, right: 1, top: 1, bottom: 1 },
  narrow: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75 },
} as const

export function printablePagePt(pageSetup: PageSetupJournalState): {
  width: number
  height: number
} {
  const paper = PAPER_INCHES[pageSetup.paperSize ?? 9] ?? PAPER_INCHES[9]!
  const margins = MARGIN_PRESETS[pageSetup.margins ?? 'normal']
  const landscape = pageSetup.orientation === 'landscape'
  const width = (landscape ? paper.height : paper.width) - margins.left - margins.right
  const height = (landscape ? paper.width : paper.height) - margins.top - margins.bottom
  return { width: Math.max(width, 1) * 72, height: Math.max(height, 1) * 72 }
}

/// Walks one axis accumulating scaled pt sizes; a boundary lands where the
/// next row/column would overflow the printable size, or at a manual break.
/// `from` starts the walk (and the per-page budget) at a print area's first
/// line instead of the sheet origin.
export function computePageBoundaries(
  sizeOf: (index: number) => number,
  count: number,
  printableSizePt: number,
  scale: number,
  manual: readonly number[],
  from = 0,
): PageBoundary[] {
  const manualSet = new Set(manual.filter((index) => index > from && index < count))
  const boundaries: PageBoundary[] = []
  let used = 0
  for (let index = from; index < count; index += 1) {
    if (manualSet.has(index)) {
      boundaries.push({ index, manual: true })
      used = 0
    }
    const size = sizeOf(index) * 0.75 * scale
    if (used > 0 && used + size > printableSizePt) {
      if (!manualSet.has(index)) boundaries.push({ index, manual: false })
      used = 0
    }
    used += size
  }
  return boundaries
}

/// Effective print scale: explicit scale, or fit-to-width against the
/// content's total width (fit-to-height is approximated the same way the
/// export pipeline does — width only).
function effectiveScale(
  pageSetup: PageSetupJournalState,
  contentWidthPt: number,
  printableWidthPt: number,
): number {
  const fitPages = pageSetup.fitToPage === true ? (pageSetup.fitToWidth ?? 0) : 0
  if (fitPages > 0 && contentWidthPt > 0) {
    return Math.min(Math.max((printableWidthPt * fitPages) / contentWidthPt, 0.1), 1)
  }
  if (pageSetup.fitToPage !== true && pageSetup.scale !== undefined) {
    return Math.min(Math.max(pageSetup.scale / 100, 0.1), 2)
  }
  return 1
}

/// The sheet's manual break set in screen coordinates: the journal's
/// replacement set when present, else the file's breaks shifted through this
/// session's structural ops. null until the sheet finishes indexing (the
/// file set is unknown before that).
export function effectivePageBreaks(
  state: LazyWorkbookState,
  sheetId: string,
): { rowBreaks: number[]; colBreaks: number[] } | null {
  const journal = state.editJournal.pageSetup.get(sheetId)
  const file = state.sheetPageBreaks.get(sheetId)
  const isAdded = state.editJournal.sheets.added.has(sheetId)
  if (journal?.rowBreaks === undefined && journal?.colBreaks === undefined && !file && !isAdded) {
    return null
  }
  const ops = state.editJournal.structuralOps.get(sheetId) ?? []
  const mapped = (axis: 'row' | 'column', ids: readonly number[]): number[] =>
    ids.map((id) => fileToScreen(ops, axis, id)).filter((id): id is number => id !== null && id > 0)
  return {
    rowBreaks: journal?.rowBreaks ?? mapped('row', file?.rowBreaks ?? []),
    colBreaks: journal?.colBreaks ?? mapped('column', file?.colBreaks ?? []),
  }
}

const MAX_PAGE_LABELS = 60
/// Float-DOM layers are not free: cap the walked extent and the number of
/// boundary lines so a million-row sheet cannot freeze the grid — the
/// preview truncates instead (Excel grays that region out too).
const MAX_EXTENT_ROWS = 20_000
const MAX_EXTENT_COLUMNS = 2_000
const MAX_BOUNDARY_LINES = 200

export function installPageBreakPreview(
  runtime: UniverRuntime,
  worksheet: UniverWorksheet,
  pageSetup: PageSetupJournalState,
  breaks: { rowBreaks: readonly number[]; colBreaks: readonly number[] },
  /// File-declared sheet extent in screen space: under lazy streaming
  /// getLastRow/getLastColumn only see the rows already loaded into Univer.
  extent: { rows: number; columns: number },
  idPrefix: string,
  /// Effective print area (WPS/Excel 分页预览语义): pages tile inside it and
  /// everything outside is shaded. null = the whole used range prints.
  printArea?: PrintAreaBounds | null,
): Disposable[] {
  const rows = Math.min(Math.max(worksheet.getLastRow() + 1, extent.rows, 1), MAX_EXTENT_ROWS)
  const columns = Math.min(
    Math.max(worksheet.getLastColumn() + 1, extent.columns, 1),
    MAX_EXTENT_COLUMNS,
  )
  // Multiple print areas print as separate tables in the export; the preview
  // tiles the bounding envelope (a compromise the PDF path does not share).
  const area: PrintAreaBounds | null = printArea
    ? {
        startRow: Math.min(printArea.startRow, rows - 1),
        startColumn: Math.min(printArea.startColumn, columns - 1),
        endRow: Math.min(printArea.endRow, rows - 1),
        endColumn: Math.min(printArea.endColumn, columns - 1),
      }
    : null
  const page = printablePagePt(pageSetup)
  const walkFrom = area?.startRow ?? 0
  const walkTo = area ? area.endRow + 1 : rows
  const walkFromCol = area?.startColumn ?? 0
  const walkToCol = area ? area.endColumn + 1 : columns
  let contentWidthPt = 0
  for (let column = walkFromCol; column < walkToCol; column += 1) {
    contentWidthPt += worksheet.getColumnWidth(column) * 0.75
  }
  const scale = effectiveScale(pageSetup, contentWidthPt, page.width)
  const rowBoundaries = computePageBoundaries(
    (index) => worksheet.getRowHeight(index),
    walkTo,
    page.height,
    scale,
    breaks.rowBreaks,
    walkFrom,
  ).slice(0, MAX_BOUNDARY_LINES)
  const colBoundaries = computePageBoundaries(
    (index) => worksheet.getColumnWidth(index),
    walkToCol,
    page.width,
    scale,
    breaks.colBreaks,
    walkFromCol,
  ).slice(0, MAX_BOUNDARY_LINES)

  const disposables: Disposable[] = []
  const layer = (
    key: string,
    startRow: number,
    startColumn: number,
    rowCount: number,
    columnCount: number,
    render: () => React.JSX.Element,
  ): void => {
    disposables.push(runtime.univerAPI.registerComponent(key, render))
    const floating = worksheet.addFloatDomToRange(
      worksheet.getRange(startRow, startColumn, rowCount, columnCount),
      { componentKey: key, allowTransform: false, eventPassThrough: true },
      {},
      key,
    )
    if (floating) disposables.push(floating)
  }

  layer(
    `${idPrefix}-outline`,
    walkFrom,
    walkFromCol,
    walkTo - walkFrom,
    walkToCol - walkFromCol,
    () => <div className="page-break-line page-break-outline" />,
  )
  rowBoundaries.forEach((boundary, index) => {
    layer(
      `${idPrefix}-row-${index}`,
      boundary.index,
      walkFromCol,
      1,
      walkToCol - walkFromCol,
      () => <div className={`page-break-line page-break-row${boundary.manual ? ' manual' : ''}`} />,
    )
  })
  colBoundaries.forEach((boundary, index) => {
    layer(`${idPrefix}-col-${index}`, walkFrom, boundary.index, walkTo - walkFrom, 1, () => (
      <div className={`page-break-line page-break-col${boundary.manual ? ' manual' : ''}`} />
    ))
  })

  // WPS 分页预览语义：打印区域外的内容盖灰（不打印）。四条遮罩带贴着
  // 区域包络铺（上/下整幅，左/右只占区域行段），没有区域时一条都不装。
  const shade = (key: string, band: PrintAreaBounds): void => {
    layer(
      key,
      band.startRow,
      band.startColumn,
      band.endRow - band.startRow + 1,
      band.endColumn - band.startColumn + 1,
      () => <div className="page-break-shade" />,
    )
  }
  if (area) {
    if (area.startRow > 0) {
      shade(`${idPrefix}-shade-top`, {
        startRow: 0,
        startColumn: 0,
        endRow: area.startRow - 1,
        endColumn: columns - 1,
      })
    }
    if (area.endRow < rows - 1) {
      shade(`${idPrefix}-shade-bottom`, {
        startRow: area.endRow + 1,
        startColumn: 0,
        endRow: rows - 1,
        endColumn: columns - 1,
      })
    }
    if (area.startColumn > 0) {
      shade(`${idPrefix}-shade-left`, {
        startRow: area.startRow,
        startColumn: 0,
        endRow: area.endRow,
        endColumn: area.startColumn - 1,
      })
    }
    if (area.endColumn < columns - 1) {
      shade(`${idPrefix}-shade-right`, {
        startRow: area.startRow,
        startColumn: area.endColumn + 1,
        endRow: area.endRow,
        endColumn: columns - 1,
      })
    }
  }

  // Page watermarks, numbered down-then-over like Excel's default page order.
  const rowEdges = [walkFrom, ...rowBoundaries.map((boundary) => boundary.index), walkTo]
  const colEdges = [walkFromCol, ...colBoundaries.map((boundary) => boundary.index), walkToCol]
  let pageNumber = 0
  for (
    let colPage = 0;
    colPage < colEdges.length - 1 && pageNumber < MAX_PAGE_LABELS;
    colPage += 1
  ) {
    for (
      let rowPage = 0;
      rowPage < rowEdges.length - 1 && pageNumber < MAX_PAGE_LABELS;
      rowPage += 1
    ) {
      pageNumber += 1
      const label = t('appPageWatermark', { page: pageNumber })
      layer(
        `${idPrefix}-page-${pageNumber}`,
        rowEdges[rowPage] ?? walkFrom,
        colEdges[colPage] ?? walkFromCol,
        (rowEdges[rowPage + 1] ?? walkTo) - (rowEdges[rowPage] ?? walkFrom),
        (colEdges[colPage + 1] ?? walkToCol) - (colEdges[colPage] ?? walkFromCol),
        () => <div className="page-break-watermark">{label}</div>,
      )
    }
  }
  return disposables
}

/// Normal-view print-area marker (Excel parity): one dashed boundary per
/// print area, so setting 打印区域 has visible feedback outside 分页预览.
/// The float anchors to the area's range, scrolling/zooming with the grid.
export function installPrintAreaMarker(
  runtime: UniverRuntime,
  worksheet: UniverWorksheet,
  area: PrintAreaBounds,
  idPrefix: string,
): Disposable[] {
  const disposables: Disposable[] = []
  const key = `${idPrefix}-marker`
  disposables.push(
    runtime.univerAPI.registerComponent(key, () => <div className="print-area-marker" />),
  )
  const floating = worksheet.addFloatDomToRange(
    worksheet.getRange(
      area.startRow,
      area.startColumn,
      Math.max(1, area.endRow - area.startRow + 1),
      Math.max(1, area.endColumn - area.startColumn + 1),
    ),
    { componentKey: key, allowTransform: false, eventPassThrough: true },
    {},
    key,
  )
  if (floating) disposables.push(floating)
  return disposables
}
