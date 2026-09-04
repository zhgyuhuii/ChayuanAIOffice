import { describe, expect, it } from 'vitest'
import { ChartSpec, chartSpecJsonSchema, deriveEngine } from '../src/spec/chartspec'
import { validateChartSpec } from '../src/spec/validate'

const baseStandard = {
  version: 1,
  type: 'bar',
  data: {
    categories: ['一季度', '二季度', '三季度'],
    series: [{ name: '销售额', values: [120, 200, 150] }],
  },
}

describe('ChartSpec 契约', () => {
  it('标准类型 + data → engine=ooxml', () => {
    const v = validateChartSpec(baseStandard)
    expect(v.ok).toBe(true)
    expect(v.engine).toBe('ooxml')
    expect(v.spec?.type).toBe('bar')
  })

  it('deriveEngine:标准类型带 option → 降为 echarts(逃生舱)', () => {
    const spec = ChartSpec.parse({ ...baseStandard, option: { series: [{ type: 'bar' }] } })
    expect(deriveEngine(spec)).toBe('echarts')
  })

  it('标准档禁 option 的路由语义:校验器不允许标准档无 data', () => {
    const v = validateChartSpec({ version: 1, type: 'line' })
    expect(v.ok).toBe(false)
    expect(v.errors[0]).toMatch(/必须提供 data/)
  })

  it('扩展类型 + option → engine=echarts 且校验通过', () => {
    const v = validateChartSpec({
      version: 1,
      type: 'sankey',
      option: { series: [{ type: 'sankey' }] },
    })
    expect(v.ok).toBe(true)
    expect(v.engine).toBe('echarts')
  })

  it('未知 type 被白名单拒绝(Q7 白名单语义)', () => {
    const v = validateChartSpec({ version: 1, type: 'wordcloud', option: {} })
    expect(v.ok).toBe(false)
  })

  it('candlestick 值必须是 OHLC 四元组', () => {
    const bad = validateChartSpec({
      version: 1,
      type: 'candlestick',
      data: { categories: ['d1'], series: [{ name: 'x', values: [1] }] },
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors[0]).toMatch(/四元组/)

    const good = validateChartSpec({
      version: 1,
      type: 'candlestick',
      data: { categories: ['d1'], series: [{ name: 'x', values: [[20, 24, 18, 25]] }] },
    })
    expect(good.ok).toBe(true)
    expect(good.engine).toBe('ooxml')
  })

  it('层级类型(tree/treemap/sunburst/sankey)必须给 tree 或 option', () => {
    const bad = validateChartSpec({
      version: 1,
      type: 'sunburst',
      data: { series: [{ name: 'a', values: [1] }] },
    })
    expect(bad.ok).toBe(false)

    const good = validateChartSpec({
      version: 1,
      type: 'sunburst',
      tree: { name: 'root', children: [{ name: 'a', value: 1 }] },
    })
    expect(good.ok).toBe(true)
  })

  it('样式字段受限:非法颜色/超长标题被拒(Q5)', () => {
    const v = validateChartSpec({ ...baseStandard, style: { palette: ['red'] } })
    expect(v.ok).toBe(false)
    expect(validateChartSpec({ ...baseStandard, style: { palette: ['#ff0000'] } }).ok).toBe(true)
  })

  it('LLM 工具契约:可导出 JSON Schema(Q7)', () => {
    const schema = chartSpecJsonSchema()
    expect(schema).toBeTruthy()
    const json = JSON.stringify(schema)
    expect(json).toContain('candlestick')
    expect(json).toContain('sunburst')
  })
})
