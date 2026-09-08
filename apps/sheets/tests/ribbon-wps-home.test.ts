import { BorderStyleTypes, BorderType, IUniverInstanceService } from '@univerjs/core'
import { ISheetClipboardService } from '@univerjs/preset-sheets-core'
import { describe, expect, it } from 'vitest'

import { parseTsv } from '../src/renderer/clipboard-tsv'
import {
  handleRibbonCommand,
  parseStyleCommand,
  type RibbonCommandContext,
} from '../src/renderer/ribbon-actions'

describe('parseTsv', () => {
  it('splits plain rows and fields', () => {
    expect(parseTsv('a\tb\tc\nd\te\tf')).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ])
  })

  it('honors quoted fields with embedded tabs, newlines and quotes', () => {
    expect(parseTsv('"a\tb"	"line1\nline2"	"he said ""hi"""')).toEqual([
      ['a\tb', 'line1\nline2', 'he said "hi"'],
    ])
  })

  it('keeps empty trailing fields', () => {
    expect(parseTsv('a\t')).toEqual([['a', '']])
  })
})

describe('draw-border arming', () => {
  function makeHarness() {
    const messages: string[] = []
    // The dispatcher guards the read-only section on an active sheet before
    // the draw-border case is reached.
    const workbook = {
      getActiveSheet: () => ({}),
      getActiveRange: () => ({ getCellStyleData: () => ({}) }),
    }
    const ctx = {
      univerRef: { current: { univerAPI: { getActiveWorkbook: () => workbook } } },
      setMessage: (message: string) => {
        messages.push(message)
      },
    } as unknown as RibbonCommandContext
    return { ctx, messages }
  }

  it('parses the four-segment command and reports the armed state', () => {
    expect(parseStyleCommand('draw-border:grid:#112233:dashed')).toEqual({
      name: 'draw-border',
      argument: 'grid',
      extra: '#112233:dashed',
    })
    const { ctx, messages } = makeHarness()
    handleRibbonCommand(ctx, 'draw-border:grid:#112233:dashed')
    expect(messages[0]).toMatch(/绘图边框已就绪/)
  })

  it('reports erase arming with its own message', () => {
    const { ctx, messages } = makeHarness()
    handleRibbonCommand(ctx, 'draw-border:erase:#000000:thin')
    expect(messages[0]).toMatch(/擦除边框已就绪/)
  })
})

describe('border diagonal (插入斜线表头)', () => {
  it('dispatches border:tlbr as a TLBR diagonal with the pen color', () => {
    const calls: Array<{ type: BorderType; style: BorderStyleTypes; color: string }> = []
    const range = {
      getCellStyleData: () => ({}),
      setBorder: (type: BorderType, style: BorderStyleTypes, color: string) => {
        calls.push({ type, style, color })
      },
    }
    const workbook = { getActiveSheet: () => undefined, getActiveRange: () => range }
    const ctx = {
      univerRef: { current: { univerAPI: { getActiveWorkbook: () => workbook } } },
      setMessage: () => {},
    } as unknown as RibbonCommandContext
    handleRibbonCommand(ctx, 'border:tlbr:#aa0000')
    expect(calls).toEqual([
      { type: BorderType.TLBR, style: BorderStyleTypes.THIN, color: '#aa0000' },
    ])
  })
})

/// Fake Univer plumbing for the paste helpers: a copy cache with one entry,
/// a source sheet serving merged/raw/composed reads, and a target range
/// capturing setValues.
function makePasteHarness(source: {
  rows: readonly number[]
  cols: readonly number[]
  cellAt: (row: number, column: number) => { v?: unknown } | null
  emptyCache?: boolean
}) {
  const messages: string[] = []
  let written: unknown = null
  let writtenShape: [number, number, number, number] | null = null
  const sourceSheet = {
    getMatrixWithMergedCells: () => ({ getValue: (r: number, c: number) => source.cellAt(r, c) }),
    getMergedCell: () => null,
    getCellRaw: () => null,
    getComposedCellStyleByCellData: () => ({}),
  }
  const worksheet = {
    getRange: (row: number, column: number, height: number, width: number) => ({
      setValues: (matrix: unknown) => {
        writtenShape = [row, column, height, width]
        written = matrix
      },
    }),
  }
  const target = { getRow: () => 5, getColumn: () => 2, getCellStyleData: () => ({}) }
  const workbook = {
    getActiveSheet: () => worksheet,
    getActiveRange: () => target,
  }
  const runtime = {
    univerAPI: { getActiveWorkbook: () => workbook },
    univer: {
      __getInjector: () => ({
        get: (token: unknown) => {
          if (token === ISheetClipboardService) {
            return {
              copyContentCache: () => ({
                getLastCopyId: () => (source.emptyCache ? null : 'copy-1'),
                get: (id: string) =>
                  !source.emptyCache && id === 'copy-1'
                    ? {
                        unitId: 'u',
                        subUnitId: 's',
                        range: { rows: source.rows, cols: source.cols },
                        copyType: 'COPY',
                      }
                    : undefined,
              }),
            }
          }
          if (token === IUniverInstanceService) {
            return { getUniverSheetInstance: () => ({ getSheetBySheetId: () => sourceSheet }) }
          }
          throw new Error('unexpected token')
        },
      }),
    },
  }
  const ctx = {
    univerRef: { current: runtime },
    setMessage: (message: string) => {
      messages.push(message)
    },
  } as unknown as RibbonCommandContext
  return {
    ctx,
    messages,
    get written() {
      return written
    },
    get writtenShape() {
      return writtenShape
    },
  }
}

describe('paste-special:transpose', () => {
  it('writes the copy cache transposed into the active range', async () => {
    // 2 rows × 3 cols copy (a..f) → 3 rows × 2 cols paste
    const harness = makePasteHarness({
      rows: [0, 1],
      cols: [0, 1, 2],
      cellAt: (row, column) => ({ v: String.fromCharCode(97 + row * 3 + column) }),
    })
    handleRibbonCommand(harness.ctx, 'paste-special:transpose')
    await new Promise((resolve) => setImmediate(resolve))
    expect(harness.written).toEqual([
      [{ v: 'a' }, { v: 'd' }],
      [{ v: 'b' }, { v: 'e' }],
      [{ v: 'c' }, { v: 'f' }],
    ])
    expect(harness.writtenShape).toEqual([5, 2, 3, 2])
    expect(harness.messages).toContain('已按转置粘贴到目标区域')
  })

  it('asks for a copy first when the copy cache is empty', async () => {
    const harness = makePasteHarness({
      rows: [0],
      cols: [0],
      cellAt: () => null,
      emptyCache: true,
    })
    handleRibbonCommand(harness.ctx, 'paste-special:transpose')
    await new Promise((resolve) => setImmediate(resolve))
    expect(harness.written).toBeNull()
    expect(harness.messages).toContain('请先复制或剪切内容')
  })
})

describe('paste-special:text', () => {
  it('re-types the copied TSV without any styling', async () => {
    const harness = makePasteHarness({
      rows: [0],
      cols: [0, 1, 2, 3],
      cellAt: (_row, column) => [{ v: 1 }, { v: 'foo' }, { v: true }, { v: '001' }][column] ?? null,
    })
    handleRibbonCommand(harness.ctx, 'paste-special:text')
    await new Promise((resolve) => setImmediate(resolve))
    // Numbers stay numeric, booleans parse, and "001" remains literal text.
    // CellValueType: STRING=1, NUMBER=2, BOOLEAN=3.
    expect(harness.written).toEqual([
      [
        { v: 1, t: 2 },
        { v: 'foo', t: 1 },
        { v: true, t: 3 },
        { v: '001', t: 1 },
      ],
    ])
    expect(harness.messages).toContain('已只粘贴文本')
  })
})
