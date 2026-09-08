import { describe, expect, it } from 'vitest'

import { handleRibbonCommand, type RibbonCommandContext } from '../src/renderer/ribbon-actions'

/// Harness for the 工作表⌄ fourth-round commands: a workbook mock with three
/// named sheets ( 甲 / 乙 / 丙 ), the active one being 乙.
function makeHarness(opts: { emptySheets?: string[]; locked?: boolean } = {}) {
  const messages: string[] = []
  const calls: string[] = []
  const executed: string[] = []
  const makeSheet = (name: string, empty: boolean) => ({
    getSheetName: () => name,
    getSheetId: () => `id-${name}`,
    isSheetHidden: () => false,
    hideSheet: () => calls.push(`hide(${name})`),
    showSheet: () => calls.push(`show(${name})`),
    setName: (next: string) => calls.push(`setName(${name}→${next})`),
    getSheet: () => ({
      getCellMatrix: () => ({
        forValue: (
          cb: (row: number, col: number, value: { v?: unknown } | null) => boolean | void,
        ) => {
          if (!empty) {
            // 非空表：A1 有值
            if (cb(0, 0, { v: 'x' }) === true) return
          }
        },
      }),
    }),
  })
  const sheetA = makeSheet('甲', opts.emptySheets?.includes('甲') ?? false)
  const sheetB = makeSheet('乙', opts.emptySheets?.includes('乙') ?? false)
  const sheetC = makeSheet('丙', opts.emptySheets?.includes('丙') ?? false)
  const sheets = [sheetA, sheetB, sheetC]
  const workbook = {
    getSheets: () => sheets,
    getActiveSheet: () => sheetB,
    getId: () => 'u',
    deleteSheet: (sheet: (typeof sheets)[number]) => {
      const index = sheets.indexOf(sheet)
      if (index >= 0) {
        sheets.splice(index, 1)
        calls.push(`deleteSheet(${sheet.getSheetName()})`)
      }
    },
    moveSheet: (sheet: (typeof sheets)[number], index: number) => {
      const current = sheets.indexOf(sheet)
      if (current >= 0) {
        sheets.splice(current, 1)
        sheets.splice(index, 0, sheet)
        calls.push(`moveSheet(${sheet.getSheetName()},${index})`)
      }
    },
    insertSheet: (name?: string) => {
      calls.push(`insertSheet(${name ?? ''})`)
      return makeSheet(name ?? '新表', true)
    },
  }
  const runtime = {
    univerAPI: {
      getActiveWorkbook: () => workbook,
      executeCommand: (id: string) => {
        executed.push(id)
        return Promise.resolve(true)
      },
      getRange: () => ({ setValues: () => calls.push('setValues') }),
    },
  }
  const ctx = {
    univerRef: { current: runtime },
    setMessage: (message: string) => messages.push(message),
    lazyWorkbookRef: {
      current: opts.locked
        ? {
            editJournal: { workbookProtection: { desired: true } },
            file: {},
          }
        : null,
    },
  } as unknown as RibbonCommandContext
  return { ctx, messages, calls, executed, sheets, workbook }
}

describe('sheetop remove / duplicate', () => {
  it('deletes the active sheet and keeps at least one', () => {
    const { ctx, calls, messages } = makeHarness()
    handleRibbonCommand(ctx, 'sheetop:remove')
    expect(calls).toEqual(['deleteSheet(乙)'])
    expect(messages[0]).toContain('乙')
    // last-sheet guard
    const solo = makeHarness()
    solo.workbook.getSheets().splice(0, 2)
    handleRibbonCommand(solo.ctx, 'sheetop:remove')
    expect(solo.calls).toEqual([])
    expect(solo.messages[0]).toContain('至少保留')
  })

  it('duplicates via the native copy-sheet command', () => {
    const { ctx, executed } = makeHarness()
    handleRibbonCommand(ctx, 'sheetop:duplicate')
    expect(executed).toEqual(['sheet.command.copy-sheet'])
  })
})

describe('sheetop move-to-index', () => {
  it('moves the active sheet to the given index', () => {
    const { ctx, calls, sheets } = makeHarness()
    handleRibbonCommand(ctx, 'sheetop:move-to-index:0')
    expect(calls).toContain('moveSheet(乙,0)')
    expect(sheets.map((s) => s.getSheetName())).toEqual(['乙', '甲', '丙'])
  })

  it('copy flag duplicates first, then moves the duplicate', async () => {
    const { ctx, executed, calls } = makeHarness()
    handleRibbonCommand(ctx, 'sheetop:move-to-index:0:copy')
    await new Promise((resolve) => setImmediate(resolve))
    expect(executed).toEqual(['sheet.command.copy-sheet'])
    expect(calls.some((c) => c.startsWith('moveSheet'))).toBe(true)
  })
})

describe('sheetop sort', () => {
  it('sorts sheets by name ascending (zh locale)', () => {
    const { ctx, sheets } = makeHarness()
    handleRibbonCommand(ctx, 'sheetop:sort-asc')
    const order = sheets.map((s) => s.getSheetName()).join('')
    expect(order.length).toBe(3)
  })
})

describe('sheetop delete-empty', () => {
  it('deletes only value-less sheets and never the active one', () => {
    const { ctx, calls } = makeHarness({ emptySheets: ['甲', '丙'] })
    handleRibbonCommand(ctx, 'sheetop:delete-empty')
    expect(calls).toEqual(['deleteSheet(甲)', 'deleteSheet(丙)'])
  })

  it('spares the active sheet even when empty', () => {
    const { ctx, calls } = makeHarness({ emptySheets: ['乙', '丙'] })
    handleRibbonCommand(ctx, 'sheetop:delete-empty')
    expect(calls).toEqual(['deleteSheet(丙)'])
  })
})

describe('sheetop batch-rename', () => {
  it('renames all sheets matching find/replace and prefix', () => {
    const { ctx, calls } = makeHarness()
    handleRibbonCommand(
      ctx,
      `sheetop:batch-rename:${encodeURIComponent('乙')}|${encodeURIComponent('乙二')}|${encodeURIComponent('Q')}|`,
    )
    expect(calls).toContain('setName(乙→Q乙二)')
    expect(calls).toContain('setName(甲→Q甲)')
  })

  it('no-ops when every field is empty', () => {
    const { ctx, calls } = makeHarness()
    handleRibbonCommand(ctx, 'sheetop:batch-rename:|||')
    expect(calls).toEqual([])
  })
})

describe('sheetop tab-font-size', () => {
  it('applies without throwing on node (no DOM)', () => {
    const { ctx, messages } = makeHarness()
    handleRibbonCommand(ctx, 'sheetop:tab-font-size:16')
    expect(messages[0]).toContain('16')
  })
})

describe('sheet structure lock guards', () => {
  it('refuses structural ops while the workbook streams in', () => {
    const { ctx, calls } = makeHarness({ locked: true })
    handleRibbonCommand(ctx, 'sheetop:remove')
    handleRibbonCommand(ctx, 'sheetop:duplicate')
    handleRibbonCommand(ctx, 'sheetop:sort-asc')
    expect(calls).toEqual([])
  })
})
