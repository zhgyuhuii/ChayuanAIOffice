/**
 * 内嵌图表工作簿(P3 标准引擎收割):插入的图表携带 embeddings xlsx,
 * PowerPoint/WPS 的"编辑数据"才有数据源;miniZipSync 产物必须是合法 zip
 * (JSZip 能解开、部件齐、数据正确)。
 */
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { openPptx, savePptx, addChart } from '../src/index'
import { buildChartWorkbookXlsxBase64, miniZipSync } from '../src/chart-workbook'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  '01_standard_business.pptx',
)

describe('miniZipSync', () => {
  it('产物是合法 zip(JSZip 可解、内容一致)', async () => {
    const buf = miniZipSync([
      { path: 'a.txt', data: Buffer.from('hello 图表', 'utf8') },
      { path: 'dir/b.bin', data: Buffer.from([0, 1, 2, 255]) },
    ])
    const zip = await JSZip.loadAsync(buf)
    expect(await zip.file('a.txt')!.async('string')).toBe('hello 图表')
    expect(Array.from(await zip.file('dir/b.bin')!.async('uint8array'))).toEqual([0, 1, 2, 255])
  })
})

describe('buildChartWorkbookXlsxBase64', () => {
  it('是一个可解的 xlsx,数据与类别/系列对齐', async () => {
    const b64 = buildChartWorkbookXlsxBase64(
      ['Q1', 'Q2'],
      [
        { name: '华东', values: [120, 88] },
        { name: '华南', values: [70, null] },
      ],
    )
    const zip = await JSZip.loadAsync(Buffer.from(b64, 'base64'))
    expect(zip.file('[Content_Types].xml')).toBeTruthy()
    expect(zip.file('xl/worksheets/sheet1.xml')).toBeTruthy()
    const shared = await zip.file('xl/sharedStrings.xml')!.async('string')
    expect(shared).toContain('华东')
    expect(shared).toContain('Q1')
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    expect(sheet).toContain('<v>120</v>')
    // null 值不写单元格(缺口)
    expect(sheet).not.toMatch(/<c r="C3"[^>]*><v>/)
  })
})

describe('addChart 内嵌工作簿', () => {
  it('插入 → 保存 → 重开,chart part 带 externalData 与 embeddings xlsx', async () => {
    const opened = await openPptx(readFileSync(FIXTURE))
    const r = addChart(opened, 0, {
      kind: 'bar',
      categories: ['一月', '二月'],
      series: [{ name: '销量', values: [3, 5] }],
      offset: { x: 0, y: 0, cx: 4000000, cy: 2400000 },
    })
    expect(r).toBeTruthy()
    const saved = await savePptx(opened)
    const zip = await JSZip.loadAsync(saved)
    const wb = zip.file(/ppt\/charts\/embeddings\/Microsoft_Excel_Worksheet\d+\.xlsx/)[0]
    expect(wb).toBeTruthy()
    const chartXml = await zip.file(/ppt\/charts\/chart\d+\.xml/)[0]!.async('string')
    expect(chartXml).toContain('<c:externalData r:id="rId1">')
    const relsName = chartXml ? 'ok' : ''
    expect(relsName).toBe('ok')
    const relsFile = zip.file(/ppt\/charts\/_rels\/chart\d+\.xml\.rels/)[0]
    expect(relsFile).toBeTruthy()
    const rels = await relsFile!.async('string')
    expect(rels).toContain('relationships/package')
    // 内嵌 xlsx 本身合法
    const inner = await JSZip.loadAsync(await wb!.async('nodebuffer'))
    expect(inner.file('xl/workbook.xml')).toBeTruthy()
  })
})
