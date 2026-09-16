/**
 * 把助手回复拆成「普通 prose + 文档正文 HTML 块」。create_document 的正文
 * 契约是受限 HTML(<h1>-<h3>/<p>/<ul>/<table>/…),直接按 markdown 渲染会把
 * 标签当文本逃逸成「乱码」;常规智能体(chat canvas/旁画布)都不在对话流里
 * 展示 artifact 正文 — 这里拆出后由 <DocBodyBlock> 折叠成一行,展开才渲染
 * sanitize 过的富文本预览。
 */

/** create_document 契约里的块级标签(doc-body 的可信开头/结尾信号) */
const BLOCK_OPEN_RE = /(?:^|\n)[ \t]*<(h[1-6]|p|ul|ol|table|blockquote|pre|div)\b/g
const BLOCK_CLOSERS = [
  '</p>',
  '</h1>',
  '</h2>',
  '</h3>',
  '</h4>',
  '</h5>',
  '</h6>',
  '</ul>',
  '</ol>',
  '</table>',
  '</blockquote>',
  '</pre>',
  '</div>',
  '</li>',
  '</tr>',
]

/** 短于此的 HTML 片段不算文档正文(行内 <br>/<strong> 之类的噪音) */
const MIN_BODY_CHARS = 80

export interface SplitReply {
  /** body 以外的说明文字,按 markdown 渲染 */
  prose: string
  /** 文档正文 HTML(可能仍在流式中,尾标签未闭);null = 没有正文块 */
  body: string | null
}

export function splitDocumentBody(text: string): SplitReply {
  if (!text) return { prose: '', body: null }
  BLOCK_OPEN_RE.lastIndex = 0
  const match = BLOCK_OPEN_RE.exec(text)
  if (!match) return { prose: text, body: null }
  // 命中位置 = 标签的 '<'(跳过前导空白/换行)
  const first = match.index + match[0].indexOf('<')
  // 尾界:最后一个块级闭合标签之后;但其后又出现块级开标签 = 仍在流式
  // (正文还没写完),尾界落到文本末尾
  let end = -1
  for (const closer of BLOCK_CLOSERS) {
    const idx = text.lastIndexOf(closer)
    if (idx >= 0) end = Math.max(end, idx + closer.length)
  }
  let bodyEnd = end > first ? Math.min(end, text.length) : text.length
  if (bodyEnd < text.length) {
    BLOCK_OPEN_RE.lastIndex = 0
    if (BLOCK_OPEN_RE.test(text.slice(bodyEnd))) bodyEnd = text.length
  }
  const body = text.slice(first, bodyEnd)
  if (body.replace(/\s/g, '').length < MIN_BODY_CHARS) return { prose: text, body: null }
  const before = text.slice(0, first).trim()
  const after = bodyEnd < text.length ? text.slice(bodyEnd).trim() : ''
  const prose = [before, after].filter(Boolean).join('\n\n')
  return { prose, body }
}
