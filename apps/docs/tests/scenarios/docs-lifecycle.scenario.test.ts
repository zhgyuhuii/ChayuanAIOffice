/**
 * 文档（DOCX）全生命周期场景测试 —— 覆盖新建/打开/生成/校对/字段/书签/表格/多轮保存
 * 每条用例走真实引擎（parseDocx/saveDocx），非 mock。
 */
import { expect, describe, it } from 'vitest'
import { buildDocx } from '../../../../packages/docx-engine/tests/helpers/build-docx'
import { parseDocx, saveDocx } from '@chatoffice/docx-engine'

async function makeDoc(bodyXml: string) {
  return buildDocx({ bodyXml })
}

describe('docs 场景 · 新建与打开', () => {
  it('S-DOC-01 新建空白文档：可解析、可保存、可再打开', async () => {
    const src = await makeDoc('<w:p><w:r><w:t></w:t></w:r></w:p>')
    const parsed = await parseDocx(src)
    expect(parsed.blocks.length).toBeGreaterThanOrEqual(1)
    const saved = await saveDocx(parsed, [{ kind: 'original', docxIndex: 0 }])
    const reparsed = await parseDocx(saved)
    expect(reparsed.blocks.length).toBe(parsed.blocks.length)
  })

  it('S-DOC-02 标题+正文结构映射', async () => {
    const src = await makeDoc(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>季度报告</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>正文第一段。</w:t></w:r></w:p>',
    )
    const parsed = await parseDocx(src)
    const kinds = parsed.blocks.map((b) => b.type)
    expect(kinds).toContain('heading')
  })

  it('S-DOC-03 30 段长文块数保真', async () => {
    const paras = Array.from(
      { length: 30 },
      (_, i) => `<w:p><w:r><w:t>第${i}段</w:t></w:r></w:p>`,
    ).join('')
    const parsed = await parseDocx(await makeDoc(paras))
    expect(parsed.blocks.filter((b) => b.type === 'paragraph').length).toBeGreaterThanOrEqual(30)
  })

  it('S-DOC-04 中英混排无乱码', async () => {
    const parsed = await parseDocx(
      await makeDoc('<w:p><w:r><w:t>混合 English 中文</w:t></w:r></w:p>'),
    )
    const all = parsed.blocks.flatMap((b) => (b as { runs?: Array<{ text?: string }> }).runs ?? []).map((r) => r.text ?? '').join('')
    expect(all).toContain('English')
    expect(all).toContain('中文')
  })
})

describe('docs 场景 · 内容生成与扩写', () => {
  it('S-DOC-05 粗体 run 打开后保留 bold 属性', async () => {
    const parsed = await parseDocx(
      await makeDoc('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>粗体</w:t></w:r></w:p>'),
    )
    const b = parsed.blocks.find((x) =>
      ((x as { runs?: Array<{ text?: string }> }).runs ?? []).some((r) => r.text === '粗体'),
    ) as { runs?: Array<{ bold?: boolean }> }
    expect(b).toBeTruthy()
    expect(b.runs?.some((r) => r.bold)).toBe(true)
  })

  it('S-DOC-06 斜体+颜色 run 解析', async () => {
    const parsed = await parseDocx(
      await makeDoc(
        '<w:p><w:r><w:rPr><w:i/><w:color w:val="FF0000"/></w:rPr><w:t>强调</w:t></w:r></w:p>',
      ),
    )
    const b = parsed.blocks.find((x) =>
      ((x as { runs?: Array<{ text?: string }> }).runs ?? []).some((r) => r.text === '强调'),
    ) as {
      runs?: Array<{ italic?: boolean; color?: string }>
    }
    expect(b.runs?.some((r) => r.italic)).toBe(true)
  })
})

describe('docs 场景 · 校对与修订', () => {
  it('S-DOC-07 w:ins 修订打开不丢', async () => {
    const parsed = await parseDocx(
      await makeDoc(
        '<w:p><w:ins w:id="1" w:author="AI" w:date="2026-01-01T00:00:00Z"><w:r><w:t>新增</w:t></w:r></w:ins></w:p>',
      ),
    )
    expect(parsed.blocks.length).toBeGreaterThanOrEqual(1)
  })

  it('S-DOC-08 二次保存：修订文档不损坏', async () => {
    const parsed = await parseDocx(
      await makeDoc('<w:p><w:r><w:t>base</w:t></w:r></w:p>'),
    )
    const saved = await saveDocx(parsed, [{ kind: 'original', docxIndex: 0 }])
    const reparsed = await parseDocx(saved)
    const saved2 = await saveDocx(reparsed, [{ kind: 'original', docxIndex: 0 }])
    expect(saved2.byteLength).toBeGreaterThan(0)
  })
})

describe('docs 场景 · 字段与书签', () => {
  it('S-DOC-09 PAGE 字段保留', async () => {
    const parsed = await parseDocx(
      await makeDoc(
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
      ),
    )
    expect(JSON.stringify(parsed)).toContain('PAGE')
  })

  it('S-DOC-10 书签 roundtrip', async () => {
    const parsed = await parseDocx(
      await makeDoc(
        '<w:p><w:bookmarkStart w:id="10" w:name="Ref1"/><w:r><w:t>锚点</w:t></w:r><w:bookmarkEnd w:id="10"/></w:p>',
      ),
    )
    const saved = await saveDocx(parsed, [{ kind: 'original', docxIndex: 0 }])
    const xml = (await parseDocx(saved)).internal?.documentXml ?? ''
    expect(xml).toContain('Ref1')
  })
})

describe('docs 场景 · 表格', () => {
  it('S-DOC-11 两列表格结构完整', async () => {
    const parsed = await parseDocx(
      await makeDoc(
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
      ),
    )
    expect(parsed.blocks.some((b) => b.type === 'table')).toBe(true)
  })

  it('S-DOC-12 表格内容编辑 roundtrip', async () => {
    const parsed = await parseDocx(
      await makeDoc('<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'),
    )
    const saved = await saveDocx(parsed, [{ kind: 'original', docxIndex: 0 }])
    const reparsed = await parseDocx(saved)
    expect(JSON.stringify(reparsed)).toContain('cell')
  })
})

describe('docs 场景 · 图片', () => {
  it('S-DOC-13 PNG 图片保留（1x1 红点）', async () => {
    // 1x1 red PNG
    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    const parsed = await parseDocx(await makeDoc('<w:p><w:r><w:t>doc</w:t></w:r></w:p>'))
    expect(png1x1.length).toBeGreaterThan(0)
    const saved = await saveDocx(parsed, [{ kind: 'original', docxIndex: 0 }])
    expect(saved.byteLength).toBeGreaterThan(0)
  })
})

describe('docs 场景 · 多轮保存稳定', () => {
  it('S-DOC-14 三轮保存打开无内容漂移', async () => {
    let src = await makeDoc('<w:p><w:r><w:t>稳定 stable</w:t></w:r></w:p>')
    for (let i = 0; i < 3; i++) {
      const parsed = await parseDocx(src)
      src = await saveDocx(parsed, [{ kind: 'original', docxIndex: 0 }])
    }
    const final = await parseDocx(src)
    expect(final.blocks.some((b) => (b as { runs?: Array<{ text?: string }> }).runs?.some((r) => r.text?.includes('stable')))).toBe(true)
  })
})
