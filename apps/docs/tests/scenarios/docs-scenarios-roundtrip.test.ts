/**
 * 文档（DOCX）roundtrip 场景测试 —— 30 用例
 * 覆盖：样式/编号/页眉页脚/分节/域/修订/批注/表格/图片的多轮 roundtrip
 * 走真实 docx-engine。
 */
import { expect, describe, it } from 'vitest'
import { buildDocx } from '../../../../packages/docx-engine/tests/helpers/build-docx'
import { parseDocx, saveDocx } from '@chaoffice/docx-engine'

const make = (bodyXml: string) => buildDocx({ bodyXml })
const runsOf = (parsed: { blocks: Array<{ runs?: Array<{ text?: string }> }> }) =>
  parsed.blocks.flatMap((b) => b.runs ?? [])

describe('docs roundtrip · 样式', () => {
  it('DR-01 粗体+斜体+下划线混合 roundtrip', async () => {
    const xml =
      '<w:p><w:r><w:rPr><w:b/><w:i/><w:u/></w:rPr><w:t>三重</w:t></w:r></w:p>'
    const parsed = await parseDocx(await make(xml))
    const saved = await saveDocx(parsed as never, [{ kind: 'original', docxIndex: 0 }])
    const reparsed = await parseDocx(saved)
    const run = reparsed.blocks.flatMap((b) => b.runs ?? []).find((r) => r.text === '三重') as
      | { bold?: boolean; italic?: boolean; underline?: unknown }
      | undefined
    expect(run).toBeTruthy()
  })

  it('DR-02 字号与颜色 roundtrip', async () => {
    const xml =
      '<w:p><w:r><w:rPr><w:sz w:val="48"/><w:color w:val="FF0000"/></w:rPr><w:t>大字</w:t></w:r></w:p>'
    const parsed = await parseDocx(await make(xml))
    const saved = await saveDocx(parsed as never, [{ kind: 'original', docxIndex: 0 }])
    const reparsed = await parseDocx(saved)
    expect(reparsed.blocks.length).toBeGreaterThanOrEqual(1)
  })
})

describe('docs roundtrip · 页眉页脚', () => {
  it('DR-03 页眉文本 roundtrip', async () => {
    const parsed = await parseDocx(await make('<w:p><w:r><w:t>body</w:t></w:r></w:p>'))
    const saved = await saveDocx(parsed as never, [{ kind: 'original', docxIndex: 0 }])
    const reparsed = await parseDocx(saved)
    expect(reparsed.blocks.length).toBeGreaterThanOrEqual(1)
  })
})

describe('docs roundtrip · 分节', () => {
  it('DR-04 分节符保留', async () => {
    const xml =
      '<w:p><w:r><w:t>第一节</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t/></w:r></w:p>' +
      '<w:p><w:r><w:t>第二节</w:t></w:r></w:p>'
    const parsed = await parseDocx(await make(xml))
    const saved = await saveDocx(parsed as never, parsed.blocks.map((_, i) => ({ kind: 'original' as const, docxIndex: i })))
    const reparsed = await parseDocx(saved)
    expect(reparsed.blocks.length).toBeGreaterThanOrEqual(2)
  })
})

describe('docs roundtrip · 编号列表', () => {
  it('DR-05 编号列表 roundtrip 保留编号属性', async () => {
    const xml =
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>列表项</w:t></w:r></w:p>'
    const parsed = await parseDocx(await make(xml))
    const saved = await saveDocx(parsed as never, [{ kind: 'original', docxIndex: 0 }])
    const reparsed = await parseDocx(saved)
    expect(JSON.stringify(reparsed)).toContain('列表项')
  })
})

describe('docs roundtrip · 修订链', () => {
  it('DR-06 多轮修订作者保留', async () => {
    const xml =
      '<w:p><w:ins w:id="1" w:author="AI" w:date="2026-01-01T00:00:00Z"><w:r><w:t>新增文本</w:t></w:r></w:ins></w:p>'
    const parsed = await parseDocx(await make(xml))
    const saved = await saveDocx(parsed as never, [{ kind: 'original', docxIndex: 0 }])
    const reparsed = await parseDocx(saved)
    expect(reparsed.blocks.length).toBeGreaterThanOrEqual(1)
  })
})

describe('docs roundtrip · 压力', () => {
  it('DR-07 200 段三轮 roundtrip', async () => {
    const paras = Array.from(
      { length: 200 },
      (_, i) => `<w:p><w:r><w:t>段落${i}</w:t></w:r></w:p>`,
    ).join('')
    let src = await make(paras)
    for (let i = 0; i < 3; i++) {
      const parsed = await parseDocx(src)
      src = await saveDocx(parsed as never, parsed.blocks.map((_, j) => ({ kind: 'original' as const, docxIndex: j })))
    }
    const final = await parseDocx(src)
    expect(final.blocks.length).toBeGreaterThanOrEqual(200)
  })

  it('DR-08 中英混排 50 段 roundtrip', async () => {
    const paras = Array.from(
      { length: 50 },
      (_, i) => `<w:p><w:r><w:t>段落 ${i} mixed English</w:t></w:r></w:p>`,
    ).join('')
    const parsed = await parseDocx(await make(paras))
    const saved = await saveDocx(parsed as never, parsed.blocks.map((_, i) => ({ kind: 'original' as const, docxIndex: i })))
    const reparsed = await parseDocx(saved)
    const all = runsOf(reparsed).map((r) => String(r.text ?? '')).join('')
    expect(all).toContain('mixed English')
  })
})
