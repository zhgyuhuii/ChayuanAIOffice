import { describe, expect, it } from 'vitest'
import {
  toFlatTable,
  flatTableToTree,
  optionFromChartEx,
  chartExGroupOf,
  type ChartExDataBlock,
} from '../src/spec/data-table'

describe('toFlatTable(option → 扁平数据表)', () => {
  it('平面类目系:类别+数值系列', () => {
    const t = toFlatTable({
      xAxis: { type: 'category', data: ['Q1', 'Q2'] },
      series: [
        { type: 'bar', name: '华东', data: [120, 88] },
        { type: 'line', name: '华南', data: [70, 60] },
      ],
    })
    expect(t).toEqual({
      columns: ['类别', '华东', '华南'],
      rows: [
        ['Q1', 120, 70],
        ['Q2', 88, 60],
      ],
    })
  })

  it('层级族(sunburst):展平为 层级列+值', () => {
    const t = toFlatTable({
      series: [
        {
          type: 'sunburst',
          data: [
            {
              name: '东部',
              children: [
                { name: 'a', value: 1 },
                { name: 'b', value: 2 },
              ],
            },
            { name: '西部', children: [{ name: 'c', value: 3 }] },
          ],
        },
      ],
    })
    expect(t?.columns).toEqual(['层级1', '层级2', '值'])
    expect(t?.rows).toEqual([
      ['东部', 'a', 1],
      ['东部', 'b', 2],
      ['西部', 'c', 3],
    ])
  })

  it('非图表形状返回 null', () => {
    expect(toFlatTable({ visualMap: {} })).toBeNull()
    expect(toFlatTable(null)).toBeNull()
  })

  it('flatTableToTree:层级表聚回树(同名兄弟合并)', () => {
    const tree = flatTableToTree({
      columns: ['层级1', '层级2', '值'],
      rows: [
        ['东', 'a', 1],
        ['东', 'b', 2],
        ['西', 'c', 3],
        ['西', 'c', 4],
      ],
    })
    expect(tree).toEqual({
      name: 'root',
      children: [
        {
          name: '东',
          children: [
            { name: 'a', value: 1 },
            { name: 'b', value: 2 },
          ],
        },
        { name: '西', children: [{ name: 'c', value: 7 }] },
      ],
    })
  })
})

describe('optionFromChartEx(chartEx 数据 → ECharts option)', () => {
  const sunburstData: ChartExDataBlock = {
    categoryLevels: [
      ['B1', 'B1', 'B2'],
      ['S1', 'S1', 'S2'],
      ['L1', 'L2', 'L3'],
    ],
    values: [22, 12, 18],
  }

  it('sunburst:多层类别组装成树', () => {
    const opt = optionFromChartEx('sunburst', sunburstData) as {
      series: Array<{
        type: string
        data: Array<{ name: string; value?: number; children?: unknown[] }>
      }>
    }
    expect(opt.series[0].type).toBe('sunburst')
    const root = opt.series[0].data
    expect(root).toHaveLength(2)
    expect(root[0]).toEqual({
      name: 'B1',
      children: [
        {
          name: 'S1',
          children: [
            { name: 'L1', value: 22 },
            { name: 'L2', value: 12 },
          ],
        },
      ],
    })
    expect(root[1]).toEqual({
      name: 'B2',
      children: [{ name: 'S2', children: [{ name: 'L3', value: 18 }] }],
    })
  })

  it('waterfall/funnel:平面类目+值', () => {
    const opt = optionFromChartEx('waterfall', {
      categoryLevels: [['Start', 'Q1', 'End']],
      values: [120, 40, 175],
    }) as { xAxis: { data: string[] }; series: Array<{ type: string; data: number[] }> }
    expect(opt.xAxis.data).toEqual(['Start', 'Q1', 'End'])
    expect(opt.series[0].type).toBe('bar')
    expect(opt.series[0].data).toEqual([120, 40, 175])
  })

  it('空数据返回 null', () => {
    expect(optionFromChartEx('sunburst', { categoryLevels: [], values: [] })).toBeNull()
  })

  it('layoutId → 组映射', () => {
    expect(chartExGroupOf('sunburst')).toBe('sunburst')
    expect(chartExGroupOf('treemap')).toBe('treemap')
    expect(chartExGroupOf('waterfall')).toBe('bar')
    expect(chartExGroupOf('unknownLayout')).toBe('custom')
  })
})
