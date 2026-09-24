import type { IRange } from '@univerjs/core'

/// Selection → reference text for the collapsed range-pick bar. Structural
/// facade types so the module stays unit-testable without a live Univer.

export interface RangePickRange {
  getRange(): IRange
  getSheetName(): string
}

export interface RangePickSelection {
  getActiveRangeList(): RangePickRange[]
  getCurrentCell(): IRange | null | void
}

export interface RangePickWorksheet {
  getSheetName(): string
  getMaxRows(): number
  getMaxColumns(): number
  getDataRange(): { getRange(): IRange }
  getSelection(): RangePickSelection | null
}

export interface RangePickOptions {
  /// Formula context: whole column/row refs (A:A / 1:1), comma-joined
  /// multi selections, sheet prefixes on cross-sheet picks.
  readonly formula: boolean
  /// Only the primary cell address (Goal Seek's set/by cells).
  readonly singleCell: boolean
  /// Sheet the pick session started on; other sheets get a name prefix.
  readonly startSheetName: string
}

/// Excel column letters, 0-based.
function colLetter(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/// `Sheet1!` / `'My Sheet'!` — quoted only when the name needs it.
function sheetPrefix(name: string): string {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) ? `${name}!` : `'${name.replace(/'/g, "''")}'!`
}

function boundedA1(range: IRange): string {
  const single = range.startRow === range.endRow && range.startColumn === range.endColumn
  const from = `${colLetter(range.startColumn)}${range.startRow + 1}`
  if (single) return from
  return `${from}:${colLetter(range.endColumn)}${range.endRow + 1}`
}

/// Cap multi-range formulas the way Excel's collapsed bar does; beyond this
/// the ref string stops being readable and typos dominate.
const MAX_PICK_RANGES = 8

export function selectionRefText(
  worksheet: RangePickWorksheet | null,
  options: RangePickOptions,
): string | null {
  const selection = worksheet?.getSelection()
  const ranges = selection?.getActiveRangeList() ?? []
  if (worksheet === null || ranges.length === 0) return null

  if (options.singleCell) {
    // Bare address: single-cell fields (Goal Seek) validate plain refs and
    // resolve against the active sheet, so no sheet prefix is wanted.
    const cell = selection?.getCurrentCell() ?? ranges[0]!.getRange()
    return `${colLetter(cell.startColumn)}${cell.startRow + 1}`
  }

  const maxRows = worksheet.getMaxRows()
  const maxColumns = worksheet.getMaxColumns()
  // Bounded refs for data dialogs: a whole-column pick would otherwise drag
  // a million empty rows into e.g. Consolidate's source list.
  const used = worksheet.getDataRange().getRange()

  const parts: string[] = []
  for (const [index, range] of ranges.entries()) {
    const bounds: IRange = (() => {
      const b = range.getRange()
      return {
        startRow: Math.min(b.startRow, b.endRow),
        endRow: Math.max(b.startRow, b.endRow),
        startColumn: Math.min(b.startColumn, b.endColumn),
        endColumn: Math.max(b.startColumn, b.endColumn),
      }
    })()
    const prefix =
      range.getSheetName() !== options.startSheetName ? sheetPrefix(range.getSheetName()) : ''
    const wholeColumn = bounds.startRow === 0 && bounds.endRow >= maxRows - 1
    const wholeRow = bounds.startColumn === 0 && bounds.endColumn >= maxColumns - 1 && !wholeColumn

    if (options.formula) {
      // Excel notation: SUM(A:A), SUM(1:1) — engine accepts both.
      if (wholeColumn) {
        parts.push(`${prefix}${colLetter(bounds.startColumn)}:${colLetter(bounds.endColumn)}`)
      } else if (wholeRow) {
        parts.push(`${prefix}${bounds.startRow + 1}:${bounds.endRow + 1}`)
      } else {
        parts.push(`${prefix}${boundedA1(bounds)}`)
      }
    } else {
      if (!options.formula && index > 0) break
      let clamped = bounds
      if (wholeColumn) {
        clamped = {
          ...clamped,
          startRow: 0,
          endRow: Math.max(0, Math.min(bounds.endRow, Math.max(used.endRow, 0))),
        }
      }
      if (wholeRow) {
        clamped = {
          ...clamped,
          startColumn: 0,
          endColumn: Math.max(0, Math.min(bounds.endColumn, Math.max(used.endColumn, 0))),
        }
      }
      parts.push(`${prefix}${boundedA1(clamped)}`)
    }
    if (parts.length >= MAX_PICK_RANGES) break
  }
  if (parts.length === 0) return null
  return parts.join(',')
}
