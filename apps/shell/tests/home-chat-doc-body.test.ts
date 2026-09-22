// 文档正文拆分(doc-body):create_document 的受限 HTML 正文不得按 markdown
// 渲染(裸标签乱码),拆出后由折叠块承接;流式未闭合尾界落到文本末尾。
import { describe, expect, it } from 'vitest'
import { extractDocumentBody, splitDocumentBody } from '../src/renderer/src/home-chat/doc-body'

const BODY =
  '<h1>季度报告</h1><h2>概述</h2><p>这是一段足够长的正文，用来通过最小文档长度校验。</p><ul><li>要点一</li><li>要点二</li></ul>'

describe('splitDocumentBody', () => {
  it('splits prose → html body → closing prose', () => {
    const { prose, body } = splitDocumentBody(`好的，正文如下：\n\n${BODY}\n\n已生成完毕。`)
    expect(body).toBe(BODY)
    expect(prose).toBe('好的，正文如下：\n\n已生成完毕。')
  })

  it('body-only reply leaves no prose', () => {
    const { prose, body } = splitDocumentBody(BODY)
    expect(body).toBe(BODY)
    expect(prose).toBe('')
  })

  it('streaming fragment without a closing tag extends the body to the end', () => {
    const partial =
      '<h1>季度报告</h1><p>正在生成中的正文片段：此时段落标签尚未闭合，模型仍在逐字输出，但内容长度早已越过最小文档正文校验门槛的八十个字符线，因此必须被识别为文档正文并整体折叠。</p>'.replace(
        '</p>',
        '',
      )
    const { prose, body } = splitDocumentBody(partial)
    expect(body).toBe(partial)
    expect(prose).toBe('')
  })

  it('short inline html stays in prose (not a document body)', () => {
    const { prose, body } = splitDocumentBody('说明 <br> 与 <strong>加粗</strong> 的用法')
    expect(body).toBeNull()
    expect(prose).toBe('说明 <br> 与 <strong>加粗</strong> 的用法')
  })

  it('minBodyChars: 0 lets a short block fragment pass (create_document extraction)', () => {
    const short = '<h1>便签</h1><p>今天买牛奶。</p>'
    // 展示侧默认 80 字门槛:短片段不当正文折叠
    expect(splitDocumentBody(short).body).toBeNull()
    // 创建侧传 0:只要存在块级标签就提取,长度门槛由 create_document 自己把守
    expect(splitDocumentBody(short, { minBodyChars: 0 }).body).toBe(short)
  })

  it('extractDocumentBody starts at a mid-line block tag and rejects tagless replies', () => {
    const body =
      '<h1>季度报告</h1><p>这是一段足够长的正文，用来通过最小文档长度校验。</p>'
    // 开场白与正文之间没有换行:创建侧提取从行中标签起(展示侧行首规则不适用)
    expect(extractDocumentBody(`好的，正文如下：${body}`)).toBe(body)
    // 纯对话性开场白没有正文块 → create_document 据此拒绝
    expect(extractDocumentBody('我来为你写一篇《大美中国》的文章。下面开始生成')).toBeNull()
  })

  it('plain markdown reply has no body', () => {
    const { prose, body } = splitDocumentBody('# 标题\n\n- 列表项\n\n正文段落。')
    expect(body).toBeNull()
    expect(prose).toBe('# 标题\n\n- 列表项\n\n正文段落。')
  })
})
