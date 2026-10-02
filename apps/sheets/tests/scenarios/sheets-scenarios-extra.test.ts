/**
 * 表格扩展场景补充包
 */
import { expandToPrimitiveOps } from '@chatoffice/xlsx-gateway/domain/workbook-dsl'
const DSL = (op: unknown) => expandToPrimitiveOps([op] as never)

describe('sheets 扩展 · 场景补充包', () => {
  const products: Array<[string, number, number]> = [
    ['苹果', 3, 5.5], ['香蕉', 12, 2.0], ['橙子', 7, 3.2],
    ['葡萄', 20, 8.0], ['西瓜', 4, 12.0], ['柠檬', 15, 1.5],
  ]
  for (const [name, qty, price] of products) {
    it(`SC-${name} 数据行生成`, () => {
      const ops = DSL({ op: 'set_range', sheetId: 's', start: 'A1', values: [[name, qty, price]] })
      expect(ops.length).toBe(3)
    })
  }

  const formulas: Array<[string, string]> = [
    ['SUM', '=SUM(B1:B10)'], ['AVERAGE', '=AVERAGE(B1:B10)'],
    ['MAX', '=MAX(B1:B10)'], ['MIN', '=MIN(B1:B10)'],
    ['COUNT', '=COUNT(B1:B10)'], ['COUNTA', '=COUNTA(A1:A10)'],
  ]
  for (const [fn, formula] of formulas) {
    it(`SC-formula-${fn} 公式写入`, () => {
      const ops = DSL({ op: 'set_cell', sheetId: 's', cell: 'D1', value: formula })
      expect(JSON.stringify(ops)).toContain(fn)
    })
  }

  const months = ['1月', '2月', '3月', '4月', '5月', '6月']
  months.forEach((m, i) => {
    it(`SC-month-${i + 1} ${m}数据`, () => {
      const ops = DSL({ op: 'set_range', sheetId: 's', start: 'A1', values: [[m, (i + 1) * 100]] })
      expect(ops.length).toBe(2)
    })
  })

  it('SC-bulk-500 500 行批量', () => {
    const rows = Array.from({ length: 500 }, (_, i) => [`item${i}`, i])
    const ops = DSL({ op: 'set_range', sheetId: 's', start: 'A1', values: rows })
    expect(ops.length).toBe(1000)
  })
})
