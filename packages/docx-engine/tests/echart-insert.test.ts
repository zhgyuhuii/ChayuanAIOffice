import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { parseDocx, saveDocx } from '../src/index'
import { buildDocx } from './helpers/build-docx'

/** 函数安全序列化的 option(与 chart-kit stringifyOption 同构) */
const OPTION_JSON = JSON.stringify(
  {
    title: { text: '基础旭日图' },
    series: [
      {
        type: 'sunburst',
        data: [{ name: 'a', value: 8, children: [{ name: 'a1', value: 4 }] }],
        label: { formatter: { __chartkit_fn__: '(v) => v.name' } },
      },
    ],
  },
  (_k, v) => (typeof v === 'function' ? { __chartkit_fn__: String(v) } : v),
)

const ECHART = {
  optionJson: OPTION_JSON,
  code: "option = { series: [{ type: 'sunburst' }] };",
  groupId: 'sunburst',
  title: '基础旭日图',
  pngBase64:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
}

describe('saveDocx kind:echart', () => {
  it('写入 PNG 媒体 + sidecar option 部件 + descr 十六进制指针 + json Content-Type', async () => {
    const source = await buildDocx({ bodyXml: '<w:p><w:r><w:t>前文</w:t></w:r></w:p>' })
    const parsed = await parseDocx(source)
    const saved = await saveDocx(parsed, [
      { kind: 'original', docxIndex: 0 },
      { kind: 'echart', echart: { ...ECHART, extentPx: { w: 640, h: 400 } } },
    ])

    const zip = await JSZip.loadAsync(saved)
    expect(zip.file('word/echarts/echart1.json')).toBeTruthy()
    expect(zip.file('word/media/chartkitechart1.png')).toBeTruthy()
    const contentTypes = await zip.file('[Content_Types].xml')!.async('string')
    expect(contentTypes).toContain('Extension="json"')

    const sidecar = JSON.parse(await zip.file('word/echarts/echart1.json')!.async('string')) as {
      option: string
      code: string | null
      title: string | null
    }
    expect(sidecar.option).toContain('sunburst')
    expect(sidecar.code).toContain('option =')
  })

  it('重新解析恢复 type:echart 块(option/groupId/快照齐活,可再编辑)', async () => {
    const source = await buildDocx({ bodyXml: '<w:p><w:r><w:t>前文</w:t></w:r></w:p>' })
    const parsed = await parseDocx(source)
    const saved = await saveDocx(parsed, [
      { kind: 'original', docxIndex: 0 },
      { kind: 'echart', echart: ECHART },
    ])

    const reparsed = await parseDocx(saved)
    const echartBlock = reparsed.blocks.find((b) => b.type === 'echart')
    expect(echartBlock).toBeTruthy()
    expect(echartBlock!.echartGroupId).toBe('sunburst')
    expect(echartBlock!.echartOption).toContain('sunburst')
    expect(echartBlock!.echartOption).toContain('__chartkit_fn__')
    expect(echartBlock!.echartCode).toContain('option =')
    expect(echartBlock!.imageDataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('一次保存多张图分配不同部件名', async () => {
    const source = await buildDocx({ bodyXml: '<w:p><w:r><w:t>x</w:t></w:r></w:p>' })
    const parsed = await parseDocx(source)
    const saved = await saveDocx(parsed, [
      { kind: 'original', docxIndex: 0 },
      { kind: 'echart', echart: ECHART },
      { kind: 'echart', echart: { ...ECHART, groupId: 'sankey' } },
    ])
    const zip = await JSZip.loadAsync(saved)
    expect(zip.file('word/echarts/echart1.json')).toBeTruthy()
    expect(zip.file('word/echarts/echart2.json')).toBeTruthy()
    const reparsed = await parseDocx(saved)
    expect(reparsed.blocks.filter((b) => b.type === 'echart')).toHaveLength(2)
  })
})
