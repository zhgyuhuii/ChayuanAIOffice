import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { parseDocx, saveDocx, type NewChart } from '../src/index'
import { buildDocx } from './helpers/build-docx'

const CHART: NewChart = {
  kind: 'bar',
  title: 'Native chart',
  categories: ['Q1', 'Q2'],
  series: [{ name: 'sales', values: [1, 2] }],
}

const ECHART = {
  optionJson: '{"series":[{"type":"bar"}]}',
  code: null,
  groupId: 'bar',
  title: 'EChart',
  pngBase64:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
}

describe('docPr id 碰撞回归（原生图表与 echart 同次保存）', () => {
  it('原生图表与 echart 同一 saveDocx 各得唯一 docPr id，重解析双存', async () => {
    const source = await buildDocx({ bodyXml: '<w:p><w:r><w:t>前文</w:t></w:r></w:p>' })
    const parsed = await parseDocx(source)
    const saved = await saveDocx(parsed, [
      { kind: 'original', docxIndex: 0 },
      { kind: 'chart', chart: CHART },
      { kind: 'echart', echart: { ...ECHART, extentPx: { w: 640, h: 400 } } },
    ])
    const zip = await JSZip.loadAsync(saved)
    const docXml = zip.file('word/document.xml')!
      ? ((await zip.file('word/document.xml')!.async('string')) as string)
      : ''
    const ids = [...docXml.matchAll(/<wp:docPr id="(\d+)"/g)].map((m) => m[1])
    console.log('DOCPR IDS:', ids)
    expect(new Set(ids).size).toBe(ids.length) // 无重复 docPr id
    expect(zip.file('word/charts/chart1.xml')).toBeTruthy()
    expect(zip.file('word/echarts/echart1.json')).toBeTruthy()
    const reparsed = await parseDocx(saved)
    expect(reparsed.blocks.some((b) => b.chartDisplay)).toBe(true)
    expect(reparsed.blocks.some((b) => b.type === 'echart' || (b as { echart?: unknown }).echart)).toBe(true)
  })
})
