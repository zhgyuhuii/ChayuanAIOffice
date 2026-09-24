import { describe, expect, it } from 'vitest'
import { parseChartExDetail } from '../src/chart'
import { optionFromChartEx, chartExGroupOf } from '@chatoffice/chart-kit/data-table'

/** 与 /tmp/chartex-evidence 手造样本同构的 chartEx part(层级旭日) */
const CHARTEX_SUNBURST = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cx:chartSpace xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<cx:chartData>
<cx:externalData r:id="rId3" autoUpdate="0"/>
<cx:data id="0">
<cx:strDim type="cat">
<cx:f>Sheet1!$A$2:$C$4</cx:f>
<cx:lvl ptCount="3"><cx:pt idx="0"><cx:v>Branch 1</cx:v></cx:pt><cx:pt idx="1"><cx:v>Branch 1</cx:v></cx:pt><cx:pt idx="2"><cx:v>Branch 2</cx:v></cx:pt></cx:lvl>
<cx:lvl ptCount="3"><cx:pt idx="0"><cx:v>Stem 1</cx:v></cx:pt><cx:pt idx="1"><cx:v>Stem 1</cx:v></cx:pt><cx:pt idx="2"><cx:v>Stem 2</cx:v></cx:pt></cx:lvl>
<cx:lvl ptCount="3"><cx:pt idx="0"><cx:v>Leaf 1</cx:v></cx:pt><cx:pt idx="1"><cx:v>Leaf 2</cx:v></cx:pt><cx:pt idx="2"><cx:v>Leaf 3</cx:v></cx:pt></cx:lvl>
</cx:strDim>
<cx:numDim type="size">
<cx:f>Sheet1!$D$2:$D$4</cx:f>
<cx:lvl ptCount="3" formatCode="General"><cx:pt idx="0"><cx:v>22</cx:v></cx:pt><cx:pt idx="1"><cx:v>12</cx:v></cx:pt><cx:pt idx="2"><cx:v>18</cx:v></cx:pt></cx:lvl>
</cx:numDim>
</cx:data>
</cx:chartData>
<cx:chart>
<cx:title overlay="0"><cx:tx><cx:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>标题X</a:t></a:r></a:p></cx:rich></cx:tx></cx:title>
<cx:plotArea>
<cx:plotAreaRegion>
<cx:series layoutId="sunburst">
<cx:tx><cx:txData><cx:f>Sheet1!$D$1</cx:f><cx:v>Size</cx:v></cx:txData></cx:tx>
<cx:dataId val="0"/>
</cx:series>
</cx:plotAreaRegion>
</cx:plotArea>
</cx:chart>
</cx:chartSpace>`

describe('parseChartExDetail(chartEx 读端,层级保留)', () => {
  it('提取 layoutId/全部层级/数值/标题', () => {
    const d = parseChartExDetail(CHARTEX_SUNBURST)!
    expect(d).toBeTruthy()
    expect(d.layoutId).toBe('sunburst')
    expect(d.levels).toHaveLength(3)
    expect(d.levels[0]).toEqual(['Branch 1', 'Branch 1', 'Branch 2'])
    expect(d.levels[2]).toEqual(['Leaf 1', 'Leaf 2', 'Leaf 3'])
    expect(d.values).toEqual([22, 12, 18])
    expect(d.title).toBe('标题X')
  })

  it('经典 c: part 不匹配(返回 null)', () => {
    expect(parseChartExDetail('<c:chartSpace xmlns:c="x"/>')).toBeNull()
  })

  it('与 chart-kit 组装器衔接:层级 → 树形 sunburst option', () => {
    const d = parseChartExDetail(CHARTEX_SUNBURST)!
    const opt = optionFromChartEx(d.layoutId, { categoryLevels: d.levels, values: d.values }) as {
      series: Array<{
        type: string
        data: Array<{ name: string; children?: unknown[]; value?: number }>
      }>
    }
    expect(opt.series[0].type).toBe('sunburst')
    // Branch 1 聚合 Stem 1 → Leaf 1/2;Branch 2 → Stem 2 → Leaf 3
    expect(opt.series[0].data).toHaveLength(2)
    expect(opt.series[0].data[0].name).toBe('Branch 1')
    expect(chartExGroupOf(d.layoutId)).toBe('sunburst')
  })
})
