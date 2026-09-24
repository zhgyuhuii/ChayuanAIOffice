import { describe, expect, it } from 'vitest'

import { handleRibbonCommand, type RibbonCommandContext } from '../src/renderer/ribbon-actions'
import {
  fillUpMatrix,
  fillLeftMatrix,
  fillSeries123,
  rankColumn,
  fillBlanksFromAbove,
  formatFillDate,
  insertTextAtPosition,
  seriesValues,
  condStatsFormula,
} from '../src/renderer/fill-tools'
import { iconThresholds } from '../src/renderer/ribbon-actions'

/// Harness for the 数据处理组 commands: a 3×2 selection with a value grid,
/// a worksheet mock recording range writes, freeze calls and CF-rule builds.
function makeHarness(
  overrides: {
    grid?: (string | number | null)[][]
    selection?: { row: number; col: number; height: number; width: number }
  } = {},
) {
  const messages: string[] = []
  const writes: Array<[string, number, number, number, number, unknown]> = []
  const formulas: Array<[number, number, string]> = []
  const freezes: Array<Record<string, number>> = []
  const rules: string[] = []
  const removedRules: string[] = []
  const sel = overrides.selection ?? { row: 0, col: 0, height: 3, width: 2 }
  const grid = overrides.grid ?? [
    [1, 'a'],
    [2, 'b'],
    [3, 'c'],
  ]
  const worksheet = {
    getMaxRows: () => 100,
    getMaxColumns: () => 100,
    getSheetId: () => 's',
    setFreeze: (spec: Record<string, number>) => freezes.push(spec),
    cancelFreeze: () => freezes.push({ cancel: 1 }),
    getRange: (r: number, c: number, h = 1, w = 1) => ({
      getValue: () => grid[r]?.[c] ?? null,
      setValues: (matrix: unknown) => writes.push(['setValues', r, c, h, w, matrix]),
      setFormula: (formula: string) => formulas.push([r, c, formula]),
    }),
    newConditionalFormattingRule: () => makeBuilder(rules),
    getConditionalFormattingRules: () => [
      { cfId: 'rule-1', ranges: [{ startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 }] },
      { cfId: 'rule-2', ranges: [{ startRow: 50, endRow: 60, startColumn: 5, endColumn: 6 }] },
    ],
    deleteConditionalFormattingRule: (id: string) => removedRules.push(id),
    addConditionalFormattingRule: (rule: unknown) => {
      const built = rule as { chain?: string[] }
      if (built?.chain) rules.push(built.chain.join('→'))
    },
  }
  const active = {
    getRow: () => sel.row,
    getColumn: () => sel.col,
    getHeight: () => sel.height,
    getWidth: () => sel.width,
    getValues: () => grid,
    getRange: () => ({ startRow: sel.row, endRow: sel.row + sel.height - 1, startColumn: sel.col, endColumn: sel.col + sel.width - 1 }),
    setValues: (matrix: unknown) => writes.push(['setValues-active', sel.row, sel.col, sel.height, sel.width, matrix]),
  }
  const workbook = {
    getActiveSheet: () => worksheet,
    getActiveRange: () => active,
    getId: () => 'u',
    getSheetId: () => 's',
    getSheets: () => [workbook as unknown as { getSheetId: () => string }, { getSheetId: () => 's2', getRange: worksheet.getRange }],
    executeCommand: (_id: string, _params?: unknown) => Promise.resolve(true),
  }
  const ctx = {
    univerRef: {
      current: {
        univerAPI: { getActiveWorkbook: () => workbook, executeCommand: () => Promise.resolve(true) },
      },
    },
    setMessage: (m: string) => messages.push(m),
    lazyWorkbookRef: { current: null },
  } as unknown as RibbonCommandContext
  return { ctx, messages, writes, formulas, freezes, rules, removedRules }
}

/// Records the builder chain: each method call appends `method(args)`, and
/// build() snapshots the chain so tests can assert the rule shape.
function makeBuilder(rules: string[]) {
  const chain: string[] = []
  const wrap = (result: unknown): unknown => result
  const builder: Record<string, unknown> = {
    whenNumberGreaterThan: (v: number) => (chain.push(`gt(${v})`), wrap(builder)),
    whenNumberLessThan: (v: number) => (chain.push(`lt(${v})`), wrap(builder)),
    whenNumberEqualTo: (v: number) => (chain.push(`eq(${v})`), wrap(builder)),
    whenNumberBetween: (a: number, b: number) => (chain.push(`between(${a},${b})`), wrap(builder)),
    whenTextContains: (t: string) => (chain.push(`contains(${t})`), wrap(builder)),
    setDuplicateValues: () => (chain.push('duplicate()'), wrap(builder)),
    setRank: (config: { isBottom?: boolean; isPercent?: boolean; value: number }) => (
      chain.push(`rank(${config.isBottom ? 'bottom' : 'top'},${config.isPercent ? 'pct' : 'n'},${config.value})`),
      wrap(builder)
    ),
    setAverage: (op: string) => (chain.push(`avg(${op})`), wrap(builder)),
    setBackground: (c: string) => (chain.push(`bg(${c})`), wrap(builder)),
    setFontColor: (c: string) => (chain.push(`ink(${c})`), wrap(builder)),
    setDataBar: (config: { positiveColor?: string }) => (chain.push(`bar(${config.positiveColor})`), wrap(builder)),
    setColorScale: (config: unknown[]) => (chain.push(`scale(${config.length})`), wrap(builder)),
    setIconSet: (config: { iconConfigs: Array<{ iconType: string; iconId: string }> }) => (
      chain.push(`icons(${config.iconConfigs.map((c) => `${c.iconType}:${c.iconId}`).join(',')})`),
      wrap(builder)
    ),
    setRanges: () => wrap(builder),
    build: () => {
      rules.push(chain.join('→'))
      return { chain: [...chain] }
    },
  }
  return builder
}

describe('fill direction pure helpers', () => {
  it('fillUp copies the bottom row over each column', () => {
    expect(fillUpMatrix([[1, 2], [3, 4], [5, 6]])).toEqual([[5, 6], [5, 6], [5, 6]])
  })

  it('fillLeft copies the rightmost column over each row', () => {
    expect(fillLeftMatrix([[1, 2, 3], [4, 5, 6]])).toEqual([[3, 3, 3], [6, 6, 6]])
  })

  it('fillSeries123 numbers down each column first', () => {
    expect(fillSeries123(2, 3)).toEqual([[1, 3, 5], [2, 4, 6]])
  })

  it('rankColumn is RANK.EQ semantics: ties share, next skips', () => {
    expect(rankColumn([10, 20, 20, 5])).toEqual([3, 1, 1, 4])
  })

  it('fillBlanksFromAbove carries the nearest value above, leading blanks stay', () => {
    expect(fillBlanksFromAbove([[1, null], [null, 9], [null, null]])).toEqual([[1, null], [1, 9], [1, 9]])
  })

  it('formatFillDate supports yyyy/mm/dd tokens', () => {
    expect(formatFillDate(new Date(2026, 8, 3), 'yyyy年m月d日')).toBe('2026年9月3日')
    expect(formatFillDate(new Date(2026, 8, 3), 'yyyy-mm-dd')).toBe('2026-09-03')
    expect(formatFillDate(new Date(2026, 8, 3), 'yyyymmdd')).toBe('20260903')
  })

  it('insertTextAtPosition places text at start/mid/end', () => {
    expect(insertTextAtPosition('abcd', 'X', 'start')).toBe('Xabcd')
    expect(insertTextAtPosition('abcd', 'X', 'mid')).toBe('abXcd')
    expect(insertTextAtPosition('abcd', 'X', 'end')).toBe('abcdX')
    expect(insertTextAtPosition(null, 'X', 'start')).toBe('X')
  })

  it('seriesValues generates linear/growth and clamps at the stop value', () => {
    expect(seriesValues({ height: 1, width: 4, down: false, growth: false, step: 2, stop: null, start: 1 })).toEqual([[1, 3, 5, 7]])
    expect(seriesValues({ height: 1, width: 4, down: false, growth: true, step: 2, stop: null, start: 1 })).toEqual([[1, 2, 4, 8]])
    expect(seriesValues({ height: 1, width: 4, down: false, growth: false, step: 2, stop: 5, start: 1 })).toEqual([[1, 3, 5, null]])
  })

  it('condStatsFormula builds SUMIF/AVERAGEIF/COUNTIF', () => {
    expect(condStatsFormula({ fn: 'sum', criteriaRange: 'A1:A9', criteria: '>60', sumRange: 'B1:B9' })).toBe('=SUMIF(A1:A9,">60",B1:B9)')
    expect(condStatsFormula({ fn: 'average', criteriaRange: 'A1:A9', criteria: 'x', sumRange: 'B1:B9' })).toBe('=AVERAGEIF(A1:A9,"x",B1:B9)')
    expect(condStatsFormula({ fn: 'count', criteriaRange: 'A1:A9', criteria: 'x', sumRange: '' })).toBe('=COUNTIF(A1:A9,"x")')
  })
})

describe('数据处理组 commands', () => {
  it('fill-up / fill-left write the mirrored matrix back to the selection', () => {
    const up = makeHarness()
    handleRibbonCommand(up.ctx, 'fill-up')
    expect(up.writes[0]!).toEqual([
      'setValues-active',
      0,
      0,
      3,
      2,
      [[3, 'c'], [3, 'c'], [3, 'c']],
    ])
    const left = makeHarness()
    handleRibbonCommand(left.ctx, 'fill-left')
    expect(left.writes[0]![5]).toEqual([['a', 'a'], ['b', 'b'], ['c', 'c']])
  })

  it('fill-123 writes column-major serial numbers', () => {
    const h = makeHarness()
    handleRibbonCommand(h.ctx, 'fill-123')
    expect(h.writes[0]![5]).toEqual([[1, 4], [2, 5], [3, 6]])
  })

  it('fill-rank writes column ranks to the adjacent right block', () => {
    const h = makeHarness({ grid: [[10, 'x'], [20, 'x'], [20, 'x']] })
    handleRibbonCommand(h.ctx, 'fill-rank')
    // column A top→bottom is 10,20,20 → ranks 3,1,1; text column B unranked
    expect(h.writes[0]!).toEqual(['setValues', 0, 2, 3, 2, [[3, null], [1, null], [1, null]]])
  })

  it('fill-blanks fills blanks from above', () => {
    const h = makeHarness({ grid: [['x', null], [null, 'y'], [null, null]] })
    handleRibbonCommand(h.ctx, 'fill-blanks')
    expect(h.writes[0]![5]).toEqual([['x', null], ['x', 'y'], ['x', 'y']])
  })

  it('fill-insert-text splices text into every cell', () => {
    const h = makeHarness({ grid: [['ab', 'cd'], ['', 12], [null, null]] })
    handleRibbonCommand(h.ctx, 'fill-insert-text:start:' + encodeURIComponent('X-'))
    expect(h.writes[0]![5]).toEqual([['X-ab', 'X-cd'], ['X-', 'X-12'], ['X-', 'X-']])
  })

  it('fill-date writes the formatted today into the selection', () => {
    const h = makeHarness()
    handleRibbonCommand(h.ctx, 'fill-date:yyyymmdd')
    const matrix = h.writes[0]![5] as string[][]
    expect(matrix[0]![0]).toMatch(/^\d{8}$/)
  })

  it('fill-to-sheets pushes the values to the other sheets', () => {
    const h = makeHarness()
    handleRibbonCommand(h.ctx, 'fill-to-sheets')
    expect(h.writes.length).toBe(1)
    expect(h.messages[0]).toContain('1')
  })

  it('fill-series generates from the dialog spec', () => {
    const h = makeHarness({
      grid: [[1, null, null, null]],
      selection: { row: 0, col: 0, height: 1, width: 4 },
    })
    handleRibbonCommand(h.ctx, 'fill-series:right:linear:2:5')
    expect(h.writes[0]![5]).toEqual([[1, 3, 5, null]])
  })

  it('cond-stats inserts the aggregate formula below/right of the selection', () => {
    const h = makeHarness({ selection: { row: 0, col: 0, height: 1, width: 2 } })
    handleRibbonCommand(h.ctx, `cond-stats:sum:${encodeURIComponent('A1:A9')}:${encodeURIComponent('>60')}:${encodeURIComponent('B1:B9')}`)
    expect(h.formulas[0]![2]).toBe('=SUMIF(A1:A9,">60",B1:B9)')
  })

  it('freeze-rows / freeze-cols / freeze-rows-cols land on setFreeze', () => {
    const rows = makeHarness()
    handleRibbonCommand(rows.ctx, 'freeze-rows:5')
    expect(rows.freezes[0]).toEqual({ startRow: 5, startColumn: -1, xSplit: 0, ySplit: 5 })
    const cols = makeHarness()
    handleRibbonCommand(cols.ctx, 'freeze-cols:3')
    expect(cols.freezes[0]).toEqual({ startRow: -1, startColumn: 3, xSplit: 3, ySplit: 0 })
    const both = makeHarness()
    handleRibbonCommand(both.ctx, 'freeze-rows-cols:5:3')
    expect(both.freezes[0]).toEqual({ startRow: 5, startColumn: 3, xSplit: 3, ySplit: 5 })
  })

  it('cf-hl builds a styled highlight rule from the dialog payload', () => {
    const h = makeHarness()
    handleRibbonCommand(h.ctx, 'cf-hl:gt:50:light-red-text')
    expect(h.rules[0]).toContain('gt(50)')
    expect(h.rules[0]).toContain('bg(#FFC7CE)')
    expect(h.rules[0]).toContain('ink(#9C0006)')
  })

  it('cf-top / cf-average / cf-databar / cf-colorscale / cf-iconset build their rules', () => {
    const top = makeHarness()
    handleRibbonCommand(top.ctx, 'cf-top:0:0:10')
    expect(top.rules[0]).toContain('rank(top,n,10)')
    const avg = makeHarness()
    handleRibbonCommand(avg.ctx, 'cf-average:below')
    expect(avg.rules[0]).toContain('avg(')
    const bar = makeHarness()
    handleRibbonCommand(bar.ctx, 'cf-databar:grad-blue')
    expect(bar.rules[0]).toContain('bar(#638EC6)')
    const scale = makeHarness()
    handleRibbonCommand(scale.ctx, 'cf-colorscale:gwr')
    expect(scale.rules[0]).toContain('scale(3)')
    const icons = makeHarness()
    handleRibbonCommand(icons.ctx, 'cf-iconset:3arrows')
    expect(icons.rules[0]).toContain('icons(3Arrows:0,3Arrows:1,3Arrows:2)')
  })

  it('cf-clear:selection only drops rules overlapping the selection', () => {
    const h = makeHarness()
    handleRibbonCommand(h.ctx, 'cf-clear:selection')
    expect(h.removedRules).toEqual(['rule-1'])
    const sheet = makeHarness()
    handleRibbonCommand(sheet.ctx, 'cf-clear:sheet')
    expect(sheet.removedRules).toEqual(['rule-1', 'rule-2'])
  })
})

describe('icon set thresholds', () => {
  it('splits 100% evenly across the leading buckets', () => {
    expect(iconThresholds(3)).toEqual([67, 33])
    expect(iconThresholds(4)).toEqual([75, 50, 25])
    expect(iconThresholds(5)).toEqual([80, 60, 40, 20])
  })
})
