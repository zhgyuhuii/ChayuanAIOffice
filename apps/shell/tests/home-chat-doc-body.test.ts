// 文档正文拆分(doc-body):create_document 的受限 HTML 正文不得按 markdown
// 渲染(裸标签乱码),拆出后由折叠块承接;流式未闭合尾界落到文本末尾。
import { describe, expect, it } from 'vitest'
import {
  extractDocumentBody,
  markdownToRestrictedHtml,
  proseToRestrictedHtml,
  splitDocumentBody,
} from '../src/renderer/src/home-chat/doc-body'

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

describe('markdownToRestrictedHtml (docx/pdf 的 Markdown 兜底)', () => {
  it('converts headings, inline marks, lists, quotes, tables and code fences', () => {
    const md = [
      '# 大美中国',
      '',
      '## 山河壮丽',
      '',
      '这里有**加粗**和*斜体*以及~~删除~~的文字，`代码` 与 [链接](https://x.example) 保留文本。',
      '',
      '- 要点一',
      '- 要点二',
      '',
      '1. 第一',
      '2. 第二',
      '',
      '> 引用一句',
      '',
      '| 列一 | 列二 |',
      '| --- | --- |',
      '| 甲 | 乙 |',
      '',
      '```',
      'const x = 1 < 2',
      '```',
    ].join('\n')
    const html = markdownToRestrictedHtml(md)
    expect(html).toContain('<h1>大美中国</h1>')
    expect(html).toContain('<h2>山河壮丽</h2>')
    expect(html).toContain('<strong>加粗</strong>')
    expect(html).toContain('<em>斜体</em>')
    expect(html).toContain('<s>删除</s>')
    expect(html).toContain('代码 与 链接 保留文本')
    expect(html).toContain('<ul><li>要点一</li><li>要点二</li></ul>')
    expect(html).toContain('<ol><li>第一</li><li>第二</li></ol>')
    expect(html).toContain('<blockquote><p>引用一句</p></blockquote>')
    expect(html).toContain('<table><thead><tr><th>列一</th><th>列二</th></tr></thead>')
    expect(html).toContain('<td>甲</td>')
    // 表格分隔行不产行;行内语法字符全部消化
    expect(html).not.toContain('**')
    expect(html).not.toContain('](https')
    // 代码块内容转义,不逃逸成标签
    expect(html).toContain('<pre>const x = 1 &lt; 2</pre>')
  })

  it('starts at the first block signal (preamble dropped) and passes <toc> through', () => {
    const md =
      '我来为你写一篇文章。下面开始生成\n\n# 大美中国\n\n<toc></toc>\n\n正文第一段。\n\n正文第二段。'
    const html = markdownToRestrictedHtml(md)
    expect(html).not.toContain('我来为你写')
    expect(html.startsWith('<h1>大美中国</h1>')).toBe(true)
    expect(html).toContain('<toc></toc>')
    expect(html).toContain('<p>正文第一段。</p>')
    expect(html).toContain('<p>正文第二段。</p>')
  })

  it('escapes raw html in prose so user text cannot smuggle tags', () => {
    const html = markdownToRestrictedHtml('# 标题\n\n段落里有 <b>裸标签</b> 与 & 符号。')
    expect(html).toContain('&lt;b&gt;裸标签&lt;/b&gt;')
    expect(html).toContain('&amp; 符号')
  })

  it('returns empty for replies with no block signal at all', () => {
    expect(markdownToRestrictedHtml('我来为你写一篇《大美中国》的文章。下面开始生成')).toBe('')
    expect(markdownToRestrictedHtml('')).toBe('')
  })

  it('joins soft-wrapped lines without an ASCII gap after CJK text', () => {
    const html = markdownToRestrictedHtml('# 题\n\n雪山连绵，\n江水奔流，\n向东而去。')
    expect(html).toContain('<p>雪山连绵，江水奔流，向东而去。</p>')
  })
})

describe('proseToRestrictedHtml (纯散文兜底·大美江山事故回归)', () => {
  // 事故现场:作文类指令的正文是纯自然段,没有任何块级信号,extract/markdown
  // 双双返回空 → create_document 被拒 → 模型原样重试 → identical-turn 守卫
  // 中止运行,文档永远创建不出来。
  const ESSAY = [
    '大美江山，锦绣中华。北国千里冰封，万里雪飘，长城蜿蜒于崇山峻岭之间，尽显雄浑气魄。',
    '江南水乡则又是另一番韵味，小桥流水，烟雨朦胧，乌篷船划过碧波，两岸粉墙黛瓦倒映成画。',
    '西部大漠孤烟直，长河落日圆，戈壁滩上的胡杨千年不倒，诉说着生命的顽强与苍凉的岁月长歌。',
    '黄河九曲奔流入海，壶口瀑布浊浪排空，涛声如雷，这是母亲河的脉搏，也是民族精神的悠远回响。',
    '江山如此多娇，从雪山之巅到南海之滨，从草原牧歌到渔舟唱晚，处处皆是画卷，步步俱为诗行。',
    '愿山河无恙，岁月安澜，这锦绣河山的每一寸土地，都值得我们从心底去热爱，去守护，去传唱。',
  ].join('\n\n')

  it('converts a pure-paragraph essay to <p> blocks (no block signals anywhere)', () => {
    const html = proseToRestrictedHtml(ESSAY)
    expect(html.startsWith('<p>大美江山，锦绣中华。')).toBe(true)
    expect(html).toContain('<p>江南水乡')
    expect(html.split('<p>')).toHaveLength(7) // 6 段 + split 尾空串
    expect(html).not.toContain('#')
  })

  it('strips a leading conversational preamble paragraph before converting', () => {
    const html = proseToRestrictedHtml(`好的，我来为你写一篇《大美江山》的散文。下面开始生成\n\n${ESSAY}`)
    expect(html).not.toContain('我来为你写')
    expect(html.startsWith('<p>大美江山，锦绣中华。')).toBe(true)
  })

  it('rejects preamble-only and short replies (missing-body hint path stays)', () => {
    const preamble =
      '我来为你写一篇《大美江山》的文章，包含标题与正文排版。我会先写山河部分再写江河部分，你打开后如需调整随时告诉我。下面开始生成'
    expect(proseToRestrictedHtml(preamble)).toBe('')
    expect(proseToRestrictedHtml('大美江山，锦绣中华。')).toBe('')
    expect(proseToRestrictedHtml('')).toBe('')
  })

  it('keeps single-spaced output as one paragraph per line', () => {
    // 部分模型散文不用空行分段:逐行成段,6 行 → 6 个 <p>
    const singleSpaced = ESSAY.split('\n\n').join('\n')
    const html = proseToRestrictedHtml(singleSpaced)
    expect(html.split('<p>')).toHaveLength(7)
    expect(html).toContain('</p>')
  })

  it('joins soft-wrapped lines inside a paragraph without an ASCII gap after CJK', () => {
    const essay = `${ESSAY.split('\n\n')[0]}\n雪拥山关，\n云横秦岭。${ESSAY.split('\n\n')[1]}\n\n${ESSAY.split('\n\n').slice(2).join('\n\n')}`
    const html = proseToRestrictedHtml(essay)
    expect(html).toContain('雪拥山关，云横秦岭。')
  })
})
