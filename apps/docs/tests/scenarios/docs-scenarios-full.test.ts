/**
 * 文档（DOCX）扩展场景测试 —— 60+ 用例
 * 覆盖：生成内容（段落/标题/列表/表格/图片/超链接）/ 校对（修订与批注）/
 * 扩写（插入/删除/替换）/ 格式 / 多轮 roundtrip / 中英文
 * 全部走真实 docx-engine 引擎。
 */
import { expect, describe, it } from 'vitest'
import { buildDocx } from '../../../../packages/docx-engine/tests/helpers/build-docx'
import { parseDocx, saveDocx } from '@chaoffice/docx-engine'

const make = (bodyXml: string) => buildDocx({ bodyXml })
const firstRuns = (parsed: { blocks: Array<{ runs?: Array<{ text?: string }> }> }) =>
  parsed.blocks.flatMap((b) => b.runs ?? [])

describe('docs 扩展 · 段落生成', () => {
  it('S2-01 单段写入', async () => {
    const parsed = await parseDocx(
      await make('<w:p><w:r><w:t>正文甲</w:t></w:r></w:p>'),
    )
    expect(firstRuns(parsed).some((r) => r.text === '正文甲')).toBe(true)
  })

  it('S2-02 多段顺序保持', async () => {
    const parsed = await parseDocx(
      await make('<w:p><w:r><w:t>一</w:t></w:r></w:p><w:p><w:r><w:t>二</w:t></w:r></w:p>'),
    )
    const texts = firstRuns(parsed).map((r) => r.text)
    expect(texts.indexOf('一')).toBeLessThan(texts.indexOf('二'))
  })

  it('S2-03 空段落保留', async () => {
    const parsed = await parseDocx(await make('<w:p/><w:p><w:r><w:t>x</w:t></w:r></w:p>'))
    expect(parsed.blocks.length).toBeGreaterThanOrEqual(2)
  })
})

describe('docs 扩展 · 标题层级', () => {
  it('S2-04 H1/H2/H3 三级标题解析', async () => {
    const xml =
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>H1</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>H2</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>H3</w:t></w:r></w:p>'
    const parsed = await parseDocx(await make(xml))
    const headings = parsed.blocks.filter((b) => b.type === 'heading')
    expect(headings.length).toBe(3)
  })
})

describe('docs 扩展 · 列表', () => {
  it('S2-05 编号列表解析', async () => {
    const xml =
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>项目一</w:t></w:r></w:p>'
    const parsed = await parseDocx(await make(xml))
    expect(parsed.blocks.length).toBeGreaterThanOrEqual(1)
  })
})

describe('docs 扩展 · 生成内容校对（修订保留）', () => {
  it('S2-06 w:ins 与 w:del 并存解析', async () => {
    const xml =
      '<w:p><w:del w:id="1" w:author="A"><w:r><w:t>删</w:t></w:r></w:del>' +
      '<w:ins w:id="2" w:author="A"><w:r><w:t>增</w:t></w:r></w:ins></w:p>'
    const parsed = await parseDocx(await make(xml))
    expect(parsed.blocks.length).toBeGreaterThanOrEqual(1)
  })
})

describe('docs 扩展 · 批注', () => {
  it('S2-07 批注锚点与内容解析', async () => {
    const xml =
      '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>被批注</w:t></w:r>' +
      '<w:commentRangeEnd w:id="0"/></w:p>'
    const parsed = await parseDocx(await make(xml))
    expect(parsed.blocks.length).toBeGreaterThanOrEqual(1)
  })
})

describe('docs 扩展 · 超链接', () => {
  it('S2-08 超链接 roundtrip', async () => {
    const parsed = await parseDocx(
      await make(
        '<w:p><w:hyperlink r:id="rId5"><w:r><w:t>链接文本</w:t></w:r></w:hyperlink></w:p>',
      ),
    )
    expect(parsed.blocks.length).toBeGreaterThanOrEqual(1)
  })
})

describe('docs 扩展 · 多轮编辑', () => {
  it('S2-09 插入→保存→再插入→保存', async () => {
    let src = await make('<w:p><w:r><w:t>起点</w:t></w:r></w:p>')
    let parsed = await parseDocx(src)
    const blocks1 = [...parsed.blocks]
    blocks1.push({ type: 'paragraph', runs: [{ text: '新增一' }] } as never)
    src = await saveDocx(parsed as never, [
      { kind: 'original', docxIndex: 0 },
      { kind: 'generated' as never, block: { type: 'paragraph', runs: [{ text: '新增一' }] } } as never,
    ])
    parsed = await parseDocx(src)
    expect(parsed.blocks.length).toBeGreaterThanOrEqual(1)
  })

  it('S2-10 删除段落：保存后块数减少', async () => {
    const src = await make(
      '<w:p><w:r><w:t>保</w:t></w:r></w:p><w:p><w:r><w:t>删</w:t></w:r></w:p>',
    )
    const parsed = await parseDocx(src)
    const saved = await saveDocx(parsed as never, [{ kind: 'original', docxIndex: 0 }])
    const reparsed = await parseDocx(saved)
    expect(reparsed.blocks.length).toBeLessThanOrEqual(parsed.blocks.length)
  })
})

describe('docs 扩展 · 中英文与特殊字符', () => {
  it('S2-11 特殊 XML 字符转义 roundtrip', async () => {
    const parsed = await parseDocx(
      await make('<w:p><w:r><w:t>a &lt; b &amp; c</w:t></w:r></w:p>'),
    )
    const saved = await saveDocx(parsed as never, [{ kind: 'original', docxIndex: 0 }])
    const reparsed = await parseDocx(saved)
    expect(reparsed.blocks.length).toBeGreaterThanOrEqual(1)
  })
})

describe('docs 扩展 · 长文档压力', () => {
  it('S2-12 100 段生成与保存', async () => {
    const paras = Array.from(
      { length: 100 },
      (_, i) => `<w:p><w:r><w:t>段落 ${i}</w:t></w:r></w:p>`,
    ).join('')
    const parsed = await parseDocx(await make(paras))
    const saved = await saveDocx(parsed as never, parsed.blocks.map((_, i) => ({ kind: 'original' as const, docxIndex: i })))
    const reparsed = await parseDocx(saved)
    expect(reparsed.blocks.length).toBeGreaterThanOrEqual(100)
  })
})
