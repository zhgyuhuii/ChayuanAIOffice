import { describe, expect, it } from 'vitest'

import {
  selectionRefText,
  type RangePickRange,
  type RangePickWorksheet,
} from '../src/renderer/range-pick-ref'

function range(
  startRow: number,
  startColumn: number,
  endRow: number,
  endColumn: number,
  sheetName = 'Sheet1',
): RangePickRange {
  return {
    getRange: () => ({ startRow, startColumn, endRow, endColumn }),
    getSheetName: () => sheetName,
  }
}

function sheet(
  ranges: RangePickRange[],
  opts: {
    maxRows?: number
    maxColumns?: number
    used?: [number, number, number, number]
    primary?: { row: number; column: number }
    name?: string
  } = {},
): RangePickWorksheet {
  return {
    getSheetName: () => opts.name ?? 'Sheet1',
    getMaxRows: () => opts.maxRows ?? 1000,
    getMaxColumns: () => opts.maxColumns ?? 26,
    getDataRange: () => ({
      getRange: () => {
        const [r1, c1, r2, c2] = opts.used ?? [0, 0, 29, 9]
        return { startRow: r1, startColumn: c1, endRow: r2, endColumn: c2 }
      },
    }),
    getSelection: () => ({
      getActiveRangeList: () => ranges,
      getCurrentCell: () =>
        opts.primary
          ? {
              startRow: opts.primary.row,
              startColumn: opts.primary.column,
              endRow: opts.primary.row,
              endColumn: opts.primary.column,
            }
          : null,
    }),
  }
}

const FORMULA = { formula: true, singleCell: false, startSheetName: 'Sheet1' }
const PLAIN = { formula: false, singleCell: false, startSheetName: 'Sheet1' }

describe('selectionRefText', () => {
  it('emits single-cell and rect A1 refs', () => {
    expect(selectionRefText(sheet([range(0, 0, 0, 0)]), FORMULA)).toBe('A1')
    expect(selectionRefText(sheet([range(1, 1, 4, 3)]), FORMULA)).toBe('B2:D5')
    expect(selectionRefText(null, FORMULA)).toBeNull()
    expect(selectionRefText(sheet([]), FORMULA)).toBeNull()
  })

  it('writes whole-column and whole-row picks Excel-style in formula mode', () => {
    const column = sheet([range(0, 2, 999, 4)], { maxRows: 1000, maxColumns: 26 })
    expect(selectionRefText(column, FORMULA)).toBe('C:E')
    const row = sheet([range(5, 0, 7, 25)], { maxRows: 1000, maxColumns: 26 })
    expect(selectionRefText(row, FORMULA)).toBe('6:8')
  })

  it('clamps whole column/row picks to the used range in plain mode', () => {
    const column = sheet([range(0, 2, 999, 2)], { maxRows: 1000, used: [0, 0, 29, 9] })
    expect(selectionRefText(column, PLAIN)).toBe('C1:C30')
    const row = sheet([range(0, 0, 0, 25)], { maxRows: 1000, maxColumns: 26, used: [0, 0, 29, 9] })
    expect(selectionRefText(row, PLAIN)).toBe('A1:J1')
    // data dialogs never see the full extent: an empty sheet clamps to the top cell
    const empty = sheet([range(0, 2, 999, 2)], { maxRows: 1000, used: [0, 0, 0, 0] })
    expect(selectionRefText(empty, PLAIN)).toBe('C1')
  })

  it('keeps ordinary bounded selections untouched in plain mode', () => {
    expect(selectionRefText(sheet([range(0, 0, 499, 1)], { used: [0, 0, 29, 9] }), PLAIN)).toBe(
      'A1:B500',
    )
  })

  it('joins multi selections with commas in formula mode and keeps plain single', () => {
    const multi = sheet([range(0, 0, 2, 0), range(0, 2, 2, 2)])
    expect(selectionRefText(multi, FORMULA)).toBe('A1:A3,C1:C3')
    expect(selectionRefText(multi, PLAIN)).toBe('A1:A3')
  })

  it('prefixes cross-sheet picks with a quoted-if-needed sheet name', () => {
    const cross = sheet([range(0, 0, 1, 1, 'My Sheet')])
    expect(selectionRefText(cross, FORMULA)).toBe(`'My Sheet'!A1:B2`)
    const plain = sheet([range(0, 0, 1, 1, 'Sheet2')])
    expect(selectionRefText(plain, PLAIN)).toBe('Sheet2!A1:B2')
  })

  it('single-cell mode uses the primary cell', () => {
    const pick = sheet([range(0, 0, 9, 9)], { primary: { row: 3, column: 4 } })
    expect(
      selectionRefText(pick, { formula: false, singleCell: true, startSheetName: 'Sheet1' }),
    ).toBe('E4')
    // without a primary, the range's top-left cell is the fallback
    expect(
      selectionRefText(sheet([range(2, 1, 9, 9)]), {
        formula: false,
        singleCell: true,
        startSheetName: 'Sheet1',
      }),
    ).toBe('B3')
  })

  it('caps runaway multi selections', () => {
    const many = sheet(Array.from({ length: 12 }, (_, i) => range(i, 0, i, 0)))
    expect(selectionRefText(many, FORMULA)!.split(',').length).toBe(8)
  })
})
