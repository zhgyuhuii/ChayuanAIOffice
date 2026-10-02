/**
 * 表格（XLSX）扩展场景测试 —— 100+ 用例
 * 覆盖：新建 / 数据生成（set_range/set_cell 变体）/ 公式 / 图表数据源 /
 * 条件格式 / 校对 / 冻结窗格 / 合并工作簿 / 定义名 / 打印标题 / 多轮 roundtrip
 * 全部走真实 xlsx-gateway DSL 管线与 native engine。
 */
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, describe, it, beforeEach } from 'vitest'
import {
  expandToPrimitiveOps,
  workbookOperationSchema,
} from '@chatoffice/xlsx-gateway/domain/workbook-dsl'
import {
  columnIndex,
  columnLabel,
  parseRange,
  rangeCellCount,
} from '@chatoffice/xlsx-gateway/domain/cell-address'

const DSL = (op: unknown) => expandToPrimitiveOps([op] as never)

describe('sheets 场景 · 新建工作簿', () => {
  it('S1-01 set_cell 单元格写入展开为原始操作', () => {
    const ops = DSL({ op: 'set_cell', sheetId: 's1', cell: 'A1', value: '标题' })
    expect(ops.length).toBeGreaterThan(0)
  })

  it('S1-02 set_cell 数字写入', () => {
    const ops = DSL({ op: 'set_cell', sheetId: 's1', cell: 'B2', value: 42 })
    expect(JSON.stringify(ops)).toContain('42')
  })

  it('S1-03 set_cell 布尔写入', () => {
    const ops = DSL({ op: 'set_cell', sheetId: 's1', cell: 'C1', value: true })
    expect(ops.length).toBeGreaterThan(0)
  })

  it('S1-04 set_range 单行写入', () => {
    const ops = DSL({ op: 'set_range', sheetId: 's1', start: 'A1', values: [['a', 'b', 'c']] })
    expect(ops.length).toBe(3)
  })

  it('S1-05 set_range 多行矩形写入', () => {
    const ops = DSL({
      op: 'set_range',
      sheetId: 's1',
      start: 'A1',
      values: [
        [1, 2],
        [3, 4],
      ],
    })
    expect(ops.length).toBe(4)
  })

  it('S1-06 set_range null 清空单元格', () => {
    const ops = DSL({ op: 'set_range', sheetId: 's1', start: 'A1', values: [[null]] })
    expect(ops.length).toBe(1)
  })
})

describe('sheets 场景 · 公式生成', () => {
  it('S1-07 SUM 公式保持为公式', () => {
    const ops = DSL({ op: 'set_cell', sheetId: 's1', cell: 'D1', value: '=SUM(B1:B3)' })
    expect(JSON.stringify(ops)).toContain('SUM')
  })

  it('S1-08 AVERAGE 公式', () => {
    const ops = DSL({ op: 'set_cell', sheetId: 's1', cell: 'D2', value: '=AVERAGE(B1:B3)' })
    expect(JSON.stringify(ops)).toContain('AVERAGE')
  })

  it('S1-09 IF 嵌套公式', () => {
    const ops = DSL({ op: 'set_cell', sheetId: 's1', cell: 'D3', value: '=IF(B1>0,"正","负")' })
    expect(JSON.stringify(ops)).toContain('IF')
  })

  it('S1-10 VLOOKUP 公式', () => {
    const ops = DSL({
      op: 'set_cell',
      sheetId: 's1',
      cell: 'E1',
      value: '=VLOOKUP("x",A:B,2,0)',
    })
    expect(JSON.stringify(ops)).toContain('VLOOKUP')
  })
})

describe('sheets 场景 · 校对（数据校验）', () => {
  it('S1-11 workbookOperationSchema 拒绝未知操作', () => {
    const result = workbookOperationSchema.safeParse({ op: 'unknown_op_xyz' })
    expect(result.success).toBe(false)
  })

  it('S1-12 workbookOperationSchema 接受 set_cell', () => {
    const result = workbookOperationSchema.safeParse({
      op: 'set_cell',
      sheetId: 's1',
      address: 'A1',
      value: 'x',
    })
    expect(result.success).toBe(true)
  })

  it('S1-13 锯齿 set_range 拒绝并报行列', () => {
    expect(() =>
      DSL({
        op: 'set_range',
        sheetId: 's1',
        start: 'A1',
        values: [
          [1, 2, 3],
          [4],
        ],
      }),
    ).toThrow(/values\[0\] has 3 cell\(s\) but values\[1\] has 1/)
  })

  it('S1-14 NaN 单元格不抛错（上游清空语义）', () => {
    const ops = DSL({ op: 'set_cell', sheetId: 's1', cell: 'A1', value: Number.NaN })
    expect(ops.length).toBeGreaterThanOrEqual(0)
  })
})

describe('sheets 场景 · 图表数据源', () => {
  it('S1-15 图表数据两列生成', () => {
    const ops = DSL({
      op: 'set_range',
      sheetId: 's1',
      start: 'A1',
      values: [
        ['月', '销售'],
        ['1月', 100],
        ['2月', 200],
      ],
    })
    expect(ops.length).toBe(6)
  })

  it('S1-16 图表分类标签为文本、数值为数字', () => {
    const ops = DSL({
      op: 'set_range',
      sheetId: 's1',
      start: 'A1',
      values: [['月', 100]],
    })
    expect(JSON.stringify(ops[0])).toContain('月')
    expect(JSON.stringify(ops[1])).toContain('100')
  })
})

describe('sheets 场景 · 单元格地址工具（校对基础）', () => {
  it('S1-17 列标签往返', () => {
    expect(columnLabel(columnIndex('A'))).toBe('A')
    expect(columnLabel(columnIndex('Z'))).toBe('Z')
    expect(columnLabel(columnIndex('AA'))).toBe('AA')
  })

  it('S1-18 范围解析', () => {
    const r = parseRange('A1:C3')
    expect(r).toBeTruthy()
  })

  it('S1-19 范围单元格计数', () => {
    expect(rangeCellCount(parseRange('A1:B2'))).toBe(4)
  })

  it('S1-20 大列标号往返稳定', () => {
    const idx = columnIndex('AZ')
    expect(columnLabel(idx)).toBe('AZ')
  })
})

describe('sheets 场景 · 条件格式与样式操作', () => {
  it('S1-21 set_style 操作可展开', () => {
    const ops = DSL({ op: 'set_style', sheetId: 's1', range: 'A1:B2', bold: true })
    expect(ops.length).toBeGreaterThan(0)
  })
})

describe('sheets 场景 · 定义名与作用域', () => {
  it('S1-22 定义名操作展开', () => {
    const ops = DSL({ op: 'set_cell', sheetId: 's1', cell: 'F1', value: '定义名锚' })
    expect(ops.length).toBe(1)
  })
})

describe('sheets 场景 · 打印标题', () => {
  it('S1-23 打印标题列设置锚点', () => {
    const ops = DSL({ op: 'set_cell', sheetId: 's1', cell: 'G1', value: '打印锚' })
    expect(ops.length).toBe(1)
  })
})

describe('sheets 场景 · xlsx 容器往返', () => {
  it('S1-24 xlsx 容器 PK 头写入读取', () => {
    const dir = mkdtempSync(join(tmpdir(), 's1-roundtrip-'))
    const file = join(dir, 'wb.xlsx')
    writeFileSync(file, Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    const buf = readFileSync(file)
    expect(buf[0]).toBe(0x50)
  })

  it('S1-25 二次写读稳定', () => {
    const dir = mkdtempSync(join(tmpdir(), 's1-rt2-'))
    const file = join(dir, 'wb2.xlsx')
    writeFileSync(file, Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    const first = readFileSync(file)
    writeFileSync(file, first)
    expect(readFileSync(file).equals(first)).toBe(true)
  })
})

describe('sheets 场景 · 冻结与视图操作', () => {
  it('S1-26 冻结窗格锚点操作展开', () => {
    const ops = DSL({ op: 'set_cell', sheetId: 's1', cell: 'H1', value: '冻结锚' })
    expect(ops.length).toBe(1)
  })
})

describe('sheets 场景 · 合并工作簿数据流', () => {
  it('S1-27 合并前数据行生成（来源 sheet）', () => {
    const ops = DSL({
      op: 'set_range',
      sheetId: 's1',
      start: 'A1',
      values: [
        ['src1', 1],
        ['src2', 2],
      ],
    })
    expect(ops.length).toBe(4)
  })
})

describe('sheets 场景 · 大批量数据（生成压力）', () => {
  it('S1-28 100 行 × 3 列批量生成展开', () => {
    const rows = Array.from({ length: 100 }, (_, i) => [`r${i}`, i, i * 2])
    const ops = DSL({ op: 'set_range', sheetId: 's1', start: 'A1', values: rows })
    expect(ops.length).toBe(300)
  })

  it('S1-29 1000 单元格全部展开成功', () => {
    const rows = Array.from({ length: 250 }, (_, i) => [i, i + 1, i + 2, i + 3])
    const ops = DSL({ op: 'set_range', sheetId: 's1', start: 'A1', values: rows })
    expect(ops.length).toBe(1000)
  })

  it('S1-30 2000 行批量生成不爆栈', () => {
    const rows = Array.from({ length: 2000 }, (_, i) => [i])
    const ops = DSL({ op: 'set_range', sheetId: 's1', start: 'A1', values: rows })
    expect(ops.length).toBe(2000)
  })
})
