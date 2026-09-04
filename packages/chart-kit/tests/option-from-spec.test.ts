import { describe, expect, it } from 'vitest'
import { optionFromChartSpec, extractTableFromOption } from '../src/designer/optionFromSpec'
import { ChartSpec } from '../src/spec/chartspec'

const spec = (over: Partial<ChartSpec>): ChartSpec =>
  ChartSpec.parse({
    version: 1,
    type: 'bar',
    data: {
      categories: ['一', '二', '三'],
      series: [
        { name: 'A', values: [1, 2, 3] },
        { name: 'B', values: [4, 5, 6] },
      ],
    },
    ...over,
  })

describe('optionFromChartSpec', () => {
  it('bar:类目轴 + 双系列', () => {
    const o = optionFromChartSpec(spec({})) as {
      xAxis: { data: string[] }
      series: Array<{ type: string; data: number[] }>
    }
    expect(o.xAxis.data).toEqual(['一', '二', '三'])
    expect(o.series).toHaveLength(2)
    expect(o.series[0].type).toBe('bar')
    expect(o.series[1].data).toEqual([4, 5, 6])
  })

  it('area = line + areaStyle;stacked 传 stack', () => {
    const o = optionFromChartSpec(spec({ type: 'area', style: { stacked: true } })) as {
      series: Array<Record<string, unknown>>
    }
    expect(o.series[0].type).toBe('line')
    expect(o.series[0].areaStyle).toEqual({})
    expect(o.series[0].stack).toBe('total')
  })

  it('pie:单系列→name/value 数据点;doughnut 半径环形', () => {
    const pie = optionFromChartSpec(spec({ type: 'pie' })) as {
      series: Array<{ data: Array<{ name: string; value: number }> }>
    }
    expect(pie.series[0].data[0]).toEqual({ name: '一', value: 1 })
    const ring = optionFromChartSpec(spec({ type: 'doughnut' })) as {
      series: Array<{ radius: unknown }>
    }
    expect(ring.series[0].radius).toEqual(['40%', '68%'])
  })

  it('radar:categoricals → indicator', () => {
    const o = optionFromChartSpec(spec({ type: 'radar' })) as {
      radar: { indicator: Array<{ name: string; max: number }> }
    }
    expect(o.radar.indicator.map((i) => i.name)).toEqual(['一', '二', '三'])
    expect(o.radar.indicator[1].max).toBe(5)
  })

  it('candlestick:OHLC 四元组透传', () => {
    const o = optionFromChartSpec(
      spec({
        type: 'candlestick',
        data: { categories: ['d1'], series: [{ name: 'x', values: [[20, 24, 18, 25]] }] },
      }),
    ) as { series: Array<{ data: number[][] }> }
    expect(o.series[0].data).toEqual([[20, 24, 18, 25]])
  })

  it('受限样式:palette/title/legend 传递', () => {
    const o = optionFromChartSpec(
      spec({ title: '销量', style: { palette: ['#123456'], legendPos: 'right' } }),
    ) as Record<string, unknown>
    expect(o.color).toEqual(['#123456'])
    expect((o.title as { text: string }).text).toBe('销量')
  })
})

describe('extractTableFromOption', () => {
  it('简单类目轴 bar/line option → 表格', () => {
    const t = extractTableFromOption({
      xAxis: { type: 'category', data: ['a', 'b'] },
      series: [
        { type: 'bar', name: 's1', data: [1, 2] },
        { type: 'line', name: 's2', data: [3, null] },
      ],
    })
    expect(t).toEqual({
      categories: ['a', 'b'],
      series: [
        { name: 's1', values: [1, 2] },
        { name: 's2', values: [3, null] },
      ],
    })
  })

  it('散点 [x,y] 数据/旭日树/多轴 → null(走代码编辑)', () => {
    expect(
      extractTableFromOption({
        xAxis: { type: 'category', data: ['a'] },
        series: [{ type: 'scatter', data: [[1, 2]] }],
      }),
    ).toBeNull()
    expect(
      extractTableFromOption({ series: [{ type: 'sunburst', data: [{ name: 'a', value: 1 }] }] }),
    ).toBeNull()
    expect(
      extractTableFromOption({
        xAxis: [{ type: 'category', data: ['a'] }, { type: 'value' }],
        series: [{ type: 'line', data: [1] }],
      }),
    ).toBeNull()
  })
})
