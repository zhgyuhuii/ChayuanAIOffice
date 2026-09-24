import { describe, expect, it } from 'vitest'

import { handleRibbonCommand, type RibbonCommandContext } from '../src/renderer/ribbon-actions'

/// Harness for the 行和列⌄ third-round commands: a selection A1:B3 over a
/// sheet mock that records structural calls, plus a config object for the
/// default column width.
function makeHarness(
  overrides: {
    values?: Record<string, unknown>
    maxRows?: number
  } = {},
) {
  const messages: string[] = []
  const calls: string[] = []
  const executed: Array<{ id: string; params: unknown }> = []
  const config = { defaultColumnWidth: 88, rowCount: 100 }
  const range = {
    startRow: 0,
    endRow: 2,
    startColumn: 0,
    endColumn: 1,
    rangeType: 0,
  }
  const worksheet = {
    insertRowsBefore: (row: number, n: number) => calls.push(`insertRowsBefore(${row},${n})`),
    insertRowsAfter: (row: number, n: number) => calls.push(`insertRowsAfter(${row},${n})`),
    insertColumnsBefore: (c: number, n: number) => calls.push(`insertColumnsBefore(${c},${n})`),
    insertColumnsAfter: (c: number, n: number) => calls.push(`insertColumnsAfter(${c},${n})`),
    deleteRows: (row: number, n: number) => calls.push(`deleteRows(${row},${n})`),
    deleteColumns: (c: number, n: number) => calls.push(`deleteColumns(${c},${n})`),
    getColumnWidth: () => 88,
    setColumnWidth: () => calls.push('setColumnWidth'),
    getMaxRows: () => overrides.maxRows ?? 100,
    getSheetId: () => 's',
    getSheet: () => ({ getConfig: () => config }),
    getRange: (r: number, c: number) => ({
      getValue: () => overrides.values?.[`${r}:${c}`] ?? null,
    }),
  }
  const active = {
    getRow: () => 0,
    getColumn: () => 0,
    getHeight: () => 3,
    getWidth: () => 2,
    getRange: () => ({ startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 }),
  }
  const workbook = {
    getActiveSheet: () => worksheet,
    getActiveRange: () => active,
    getId: () => 'u',
    executeCommand: (id: string, params?: unknown) => {
      executed.push({ id, params })
      return Promise.resolve(true)
    },
  }
  const ctx = {
    univerRef: {
      current: {
        univerAPI: { getActiveWorkbook: () => workbook, executeCommand: workbook.executeCommand },
      },
    },
    setMessage: (m: string) => messages.push(m),
    lazyWorkbookRef: { current: null },
  } as unknown as RibbonCommandContext
  return { ctx, messages, calls, executed, config, range }
}

describe('rowcol count insert', () => {
  it.each([
    ['rowcol:insert-rows-above:2', 'insertRowsBefore(0,2)'],
    ['rowcol:insert-rows-below:2', 'insertRowsAfter(2,2)'],
    ['rowcol:insert-cols-left:3', 'insertColumnsBefore(0,3)'],
    ['rowcol:insert-cols-right:3', 'insertColumnsAfter(1,3)'],
  ])('%s lands on the worksheet API', (command, expected) => {
    const { ctx, calls } = makeHarness()
    handleRibbonCommand(ctx, command)
    expect(calls).toEqual([expected])
  })

  it('clamps bogus counts to 1', () => {
    const { ctx, calls } = makeHarness()
    handleRibbonCommand(ctx, 'rowcol:insert-rows-above:banana')
    expect(calls).toEqual(['insertRowsBefore(0,1)'])
  })
})

describe('rowcol delete rows/cols', () => {
  it('deletes the selected rows and columns', () => {
    const { ctx, calls } = makeHarness()
    handleRibbonCommand(ctx, 'rowcol:delete-rows')
    handleRibbonCommand(ctx, 'rowcol:delete-cols')
    expect(calls).toEqual(['deleteRows(0,3)', 'deleteColumns(0,2)'])
  })
})

describe('rowcol:delete-empty-rows', () => {
  it('removes only fully empty rows in the selection, bottom-up', () => {
    // 3 rows (0,1,2) × 2 cols; row 1 has content → only rows 2 and 0 go.
    const { ctx, calls } = makeHarness({ values: { '1:0': 'x', '1:1': 42 } })
    handleRibbonCommand(ctx, 'rowcol:delete-empty-rows')
    expect(calls).toEqual(['deleteRows(2,1)', 'deleteRows(0,1)'])
  })

  it('keeps the last row alive when every selected row is empty', () => {
    const { ctx, calls } = makeHarness({ maxRows: 3 })
    handleRibbonCommand(ctx, 'rowcol:delete-empty-rows')
    // rows 1,0 deleted; row 2 (the sheet's last) survives via the maxRows guard
    expect(calls).toEqual(['deleteRows(1,1)', 'deleteRows(0,1)'])
  })
})

describe('rowcol:standard-col-width', () => {
  it('writes the default width in pixels and repaints', () => {
    const { ctx, calls, config } = makeHarness()
    handleRibbonCommand(ctx, 'rowcol:standard-col-width:10')
    // config writes a positive pixel value derived from the char width
    expect(config.defaultColumnWidth).toBeGreaterThan(0)
    expect(config.defaultColumnWidth).not.toBe(88)
    expect(calls).toContain('setColumnWidth')
  })

  it('ignores bogus widths', () => {
    const { ctx, calls, config } = makeHarness()
    handleRibbonCommand(ctx, 'rowcol:standard-col-width:nan')
    expect(config.defaultColumnWidth).toBe(88)
    expect(calls).toEqual([])
  })
})

describe('cells: shift commands', () => {
  it('maps range shifts onto the Univer commands', () => {
    const { ctx, executed } = makeHarness()
    handleRibbonCommand(ctx, 'cells:insert-down')
    handleRibbonCommand(ctx, 'cells:insert-right')
    handleRibbonCommand(ctx, 'cells:delete-left')
    handleRibbonCommand(ctx, 'cells:delete-up')
    expect(executed.map((e) => e.id)).toEqual([
      'sheet.command.insert-range-move-down',
      'sheet.command.insert-range-move-right',
      'sheet.command.delete-range-move-left',
      'sheet.command.delete-range-move-up',
    ])
  })

  it('maps entire row/col onto the worksheet API with selection size', () => {
    const { ctx, calls } = makeHarness()
    handleRibbonCommand(ctx, 'cells:entire-row')
    handleRibbonCommand(ctx, 'cells:entire-col')
    expect(calls).toEqual(['insertRowsBefore(0,3)', 'insertColumnsBefore(0,2)'])
  })
})
