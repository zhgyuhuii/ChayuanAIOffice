/** @vitest-environment jsdom */
// adapted: 81129a6f7 (#2925) 本地 sheets Ribbon 为 SplitStackTool 分体钮架构（单/双下划线合并
// 一枚分体钮、家族亮灯），无上游双 <button data-tip> DOM 可渲染断言；本测试保留两条
// selection-format 语义用例（混合区域首格回显/单双变体刷新），按钮高亮矩阵由该架构差异吸收。
import {
  BooleanNumber,
  LogLevel,
  Univer,
  UniverInstanceType,
} from '@univerjs/core'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import '@univerjs/sheets/facade'
import { FUniver } from '@univerjs/core/facade'
import { describe, expect, it } from 'vitest'

import { selectionFormatEquals, toSelectionFormat } from '../src/renderer/selection-format'


describe('underline ribbon echo', () => {
  it('preserves the first-cell echo for mixed ranges', () => {
    const univer = new Univer({ logLevel: LogLevel.SILENT })
    univer.registerPlugin(UniverSheetsPlugin)
    univer.createUnit(UniverInstanceType.UNIVER_SHEET, {
      id: 'underline-echo',
      name: 'Underline',
      sheetOrder: ['s1'],
      sheets: {
        s1: {
          id: 's1',
          name: 'Sheet1',
          rowCount: 10,
          columnCount: 10,
          cellData: {
            0: {
              0: { v: 'single', s: { ul: { s: BooleanNumber.TRUE } } },
              1: { v: 'double', s: { ul: { s: BooleanNumber.TRUE, t: 10 } } },
              2: { v: 'off' },
              3: { v: 'single', s: { ul: { s: BooleanNumber.TRUE } } },
            },
          },
        },
      },
    })
    try {
      const sheet = FUniver.newAPI(univer).getActiveWorkbook()!.getActiveSheet()!
      for (const [range, underline, doubleUnderline] of [
        ['A1:D1', true, false],
        ['B1:D1', true, true],
        ['C1:D1', false, false],
      ] as const) {
        const format = toSelectionFormat(sheet.getRange(range).getCellStyleData() ?? {}, 'General')
        expect(format).toMatchObject({ underline, doubleUnderline })
      }
    } finally {
      univer.dispose()
    }
  })
  it('refreshes the selection when only the underline variant changes', () => {
    const single = toSelectionFormat({ ul: { s: BooleanNumber.TRUE } }, 'General')
    const double = toSelectionFormat({ ul: { s: BooleanNumber.TRUE, t: 10 } }, 'General')
    expect(selectionFormatEquals(single, double)).toBe(false)
    expect(selectionFormatEquals(double, single)).toBe(false)
    expect(selectionFormatEquals(double, { ...double })).toBe(true)
  })

})
