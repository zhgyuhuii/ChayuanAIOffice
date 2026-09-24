/**
 * ChartSpec(标准形状)→ ECharts option 组装器。
 * 用途:Q5 签定——设计器预览 39 组全部 ECharts 出图;标准组无代码时由
 * 数据表格经 ChartSpec 生成预览。样式字段严格受限(仅 OOXML 可表达子集)。
 */

import type { ChartSpec } from '../spec/chartspec'

/** PowerPoint 默认主题色板(pptx-render 同款基准) */
const DEFAULT_PALETTE = [
  '#5470c6',
  '#91cc75',
  '#fac858',
  '#ee6666',
  '#73c0de',
  '#3ba272',
  '#fc8452',
  '#9a60b4',
  '#ea7ccc',
]

function legendPos(pos: string | undefined): Record<string, unknown> {
  switch (pos) {
    case 'top':
      return { top: 0, left: 'center' }
    case 'bottom':
      return { bottom: 0, left: 'center' }
    case 'right':
      return { right: 0, top: 'middle' }
    default:
      return undefined as never // 'left'/缺省用 ECharts 默认
  }
}

export function optionFromChartSpec(spec: ChartSpec): Record<string, unknown> {
  const data = spec.data ?? { categories: [], series: [] }
  const style = spec.style ?? {}
  const palette = style.palette && style.palette.length > 0 ? style.palette : DEFAULT_PALETTE
  const categories =
    data.categories ??
    Array.from({ length: data.series[0]?.values.length ?? 0 }, (_, i) => `${i + 1}`)
  const legend = {
    show: style.showLegend ?? true,
    ...(style.legendPos ? legendPos(style.legendPos) : {}),
  }

  const base: Record<string, unknown> = {
    color: palette,
    tooltip: { trigger: 'item' },
    legend,
    ...(spec.title || style.title ? { title: { text: spec.title ?? style.title } } : {}),
  }

  const numeric = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null

  if (spec.type === 'pie' || spec.type === 'doughnut') {
    const s = data.series[0]
    return {
      ...base,
      tooltip: { trigger: 'item' },
      series: [
        {
          type: 'pie',
          radius: spec.type === 'doughnut' ? ['40%', '68%'] : '62%',
          center: ['50%', '55%'],
          label: { show: style.showDataLabels ?? true },
          data: categories.map((c, i) => ({ name: String(c), value: numeric(s?.values[i]) ?? 0 })),
        },
      ],
    }
  }

  if (spec.type === 'radar') {
    const maxes = categories.map((_, i) =>
      Math.max(1, ...data.series.map((s) => Math.ceil(Number(numeric(s.values[i]) ?? 0)))),
    )
    return {
      ...base,
      radar: {
        indicator: categories.map((c, i) => ({ name: String(c), max: maxes[i] })),
      },
      series: [
        {
          type: 'radar',
          data: data.series.map((s) => ({ name: s.name, value: s.values.map(numeric) })),
        },
      ],
    }
  }

  if (spec.type === 'candlestick') {
    return {
      ...base,
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: categories.map(String) },
      yAxis: { type: 'value', scale: true },
      series: data.series.map((s) => ({
        name: s.name,
        type: 'candlestick',
        data: s.values.map((v) => (Array.isArray(v) ? v : [0, 0, 0, 0])),
      })),
    }
  }

  // line / area / bar / scatter / bubble / combo:直角坐标系族
  const perSeriesType = (t?: string): string => {
    if (spec.type === 'area') return 'line'
    if (spec.type === 'bubble' || spec.type === 'scatter') return 'scatter'
    return t ?? (spec.type === 'bar' ? 'bar' : 'line')
  }
  const series = data.series.map((s) => {
    const st = perSeriesType(s.type)
    const item: Record<string, unknown> = {
      name: s.name,
      type: st,
      data: s.values.map(numeric),
    }
    if (st === 'line') {
      if (style.smooth) item.smooth = true
      if (style.stacked) item.stack = 'total'
      if (spec.type === 'area') item.areaStyle = {}
    }
    if (st === 'bar' && style.stacked) item.stack = 'total'
    if (st === 'scatter') item.symbolSize = spec.type === 'bubble' ? 14 : 9
    return item
  })

  const categoryAxis = { type: 'category', data: categories.map(String) }
  const valueAxis = { type: 'value' }
  return {
    ...base,
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 24, top: 48, bottom: 40, containLabel: true },
    xAxis: style.horizontal ? valueAxis : categoryAxis,
    yAxis: style.horizontal ? categoryAxis : valueAxis,
    series,
  }
}

export interface OptionTable {
  categories: string[]
  series: Array<{ name: string; values: Array<number | null> }>
}

/** 从 option 提取标准表格(仅简单的类目轴+纯数值系列;复杂配置返回 null 走代码编辑) */
export function extractTableFromOption(option: unknown): OptionTable | null {
  if (!option || typeof option !== 'object') return null
  const o = option as Record<string, unknown>
  const xAxis = o.xAxis as Record<string, unknown> | undefined
  if (!xAxis || xAxis.type !== 'category' || !Array.isArray(xAxis.data)) return null
  if (Array.isArray(o.yAxis) || Array.isArray(o.xAxis)) return null // 多轴组合:交给代码编辑
  const series = o.series
  if (!Array.isArray(series) || series.length === 0) return null
  const cats = xAxis.data.map((c) =>
    typeof c === 'object' && c !== null && 'value' in (c as object)
      ? String((c as { value: unknown }).value)
      : String(c),
  )
  const table: OptionTable = { categories: cats, series: [] }
  for (const s of series) {
    if (!s || typeof s !== 'object') return null
    const so = s as Record<string, unknown>
    const type = so.type
    if (type !== 'line' && type !== 'bar') return null // 非平面表形状
    if (!Array.isArray(so.data)) return null
    const values: Array<number | null> = []
    for (const v of so.data) {
      if (v === null || v === '') {
        values.push(null)
        continue
      }
      if (typeof v === 'number' && Number.isFinite(v)) {
        values.push(v)
        continue
      }
      if (typeof v === 'object' && v !== null && 'value' in (v as object)) {
        const n = (v as { value: unknown }).value
        if (typeof n === 'number' && Number.isFinite(n)) {
          values.push(n)
          continue
        }
      }
      return null // 复杂数据点([x,y] 散点、对象等)
    }
    table.series.push({ name: typeof so.name === 'string' ? so.name : '', values })
  }
  return table
}
