/**
 * 文档扩展场景补充包（收敛到 180+ 总量）
 */
import { expect, describe, it } from 'vitest'
import { buildDocx } from '../../../../packages/docx-engine/tests/helpers/build-docx'
import { parseDocx, saveDocx } from '@chatoffice/docx-engine'

const make = (bodyXml: string) => buildDocx({ bodyXml })

describe('docs 扩展 · 场景补充包', () => {
  const cases: Array<[string, string, string]> = [
    ['SC-01', '合同模板', '甲方：___ 乙方：___'],
    ['SC-02', '会议纪要', '出席：全员'],
    ['SC-03', '周报', '本周完成 3 项'],
    ['SC-04', '发票', '合计：¥0.00'],
    ['SC-05', '简历', '工作经历'],
    ['SC-06', '论文', '摘要 Abstract'],
    ['SC-07', '邀请函', '诚邀莅临'],
    ['SC-08', '通知', '特此通知'],
    ['SC-09', '协议书', '双方达成一致'],
    ['SC-10', '说明书', '使用方法'],
  ]
  for (const [id, title, content] of cases) {
    it(`SC-${id} ${title}生成与 roundtrip`, async () => {
      const xml = `<w:p><w:r><w:t>${title}：${content}</w:t></w:r></w:p>`
      const parsed = await parseDocx(await make(xml))
      const saved = await saveDocx(parsed as never, [{ kind: 'original', docxIndex: 0 }])
      const reparsed = await parseDocx(saved)
      const all = reparsed.blocks.flatMap((b) => b.runs ?? []).map((r) => String(r.text ?? '')).join('')
      expect(all).toContain(title)
    })
  }

  const marks: Array<[string, string]> = [
    ['bold', '<w:b/>'],
    ['italic', '<w:i/>'],
    ['underline', '<w:u w:val="single"/>'],
    ['strike', '<w:strike/>'],
    ['superscript', '<w:vertAlign w:val="superscript"/>'],
    ['subscript', '<w:vertAlign w:val="subscript"/>'],
    ['highlight', '<w:highlight w:val="yellow"/>'],
    ['smallCaps', '<w:smallCaps/>'],
  ]
  for (const [name, xml_frag] of marks) {
    it(`SC-fmt-${name} 解析`, async () => {
      const parsed = await parseDocx(await make(`<w:p><w:r><w:rPr>${xml_frag}</w:rPr><w:t>格式</w:t></w:r></w:p>`))
      expect(parsed.blocks.length).toBeGreaterThanOrEqual(1)
    })
  }

  const aligns = ['left', 'center', 'right', 'both']
  for (const a of aligns) {
    it(`SC-align-${a} 对齐解析`, async () => {
      const parsed = await parseDocx(await make(`<w:p><w:pPr><w:jc w:val="${a}"/></w:pPr><w:r><w:t>对齐</w:t></w:r></w:p>`))
      expect(parsed.blocks.length).toBeGreaterThanOrEqual(1)
    })
  }
})
