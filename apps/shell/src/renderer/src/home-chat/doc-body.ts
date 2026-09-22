/**
 * 把助手回复拆成「普通 prose + 文档正文 HTML 块」。create_document 的正文
 * 契约是受限 HTML(<h1>-<h3>/<p>/<ul>/<table>/…),直接按 markdown 渲染会把
 * 标签当文本逃逸成「乱码」;常规智能体(chat canvas/旁画布)都不在对话流里
 * 展示 artifact 正文 — 这里拆出后由 <DocBodyBlock> 折叠成一行,展开才渲染
 * sanitize 过的富文本预览。
 */

/** create_document 契约里的块级标签(doc-body 的可信开头/结尾信号) */
const BLOCK_TAGS = 'h[1-6]|p|ul|ol|table|blockquote|pre|div'
/** 展示侧:只认行首的块级开标签,句中提到的标签不当正文起点 */
const BLOCK_OPEN_RE = new RegExp(`(?:^|\\n)[ \\t]*<(${BLOCK_TAGS})\\b`, 'g')
/** 创建侧:开场白与正文之间不一定有换行,行中块级开标签也是正文起点 */
const BLOCK_OPEN_INLINE_RE = new RegExp(`<(${BLOCK_TAGS})\\b`, 'gi')
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

export interface SplitReplyOptions {
  /** 正文非空白字符下限;默认 80(展示侧防行内噪音),create_document 校验传 0 */
  minBodyChars?: number
}

export interface SplitReply {
  /** body 以外的说明文字,按 markdown 渲染 */
  prose: string
  /** 文档正文 HTML(可能仍在流式中,尾标签未闭);null = 没有正文块 */
  body: string | null
}

export function splitDocumentBody(text: string, options?: SplitReplyOptions): SplitReply {
  return splitByBlockTags(text, BLOCK_OPEN_RE, options?.minBodyChars ?? MIN_BODY_CHARS)
}

/**
 * create_document 落盘前的正文提取:开场白(「我来为你写…下面开始生成」)
 * 不得进文档,按块级开标签取第一个标签到文末结构段;行中出现的标签也算起点,
 * 大小写不敏感。null = 回复里没有正文块(创建侧据此拒绝并让模型先写正文)。
 */
export function extractDocumentBody(text: string): string | null {
  return splitByBlockTags(text, BLOCK_OPEN_INLINE_RE, 0).body
}

function splitByBlockTags(text: string, openRe: RegExp, minBodyChars: number): SplitReply {
  if (!text) return { prose: '', body: null }
  openRe.lastIndex = 0
  const match = openRe.exec(text)
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
    openRe.lastIndex = 0
    if (openRe.test(text.slice(bodyEnd))) bodyEnd = text.length
  }
  const body = text.slice(first, bodyEnd)
  if (body.replace(/\s/g, '').length < minBodyChars) return { prose: text, body: null }
  const before = text.slice(0, first).trim()
  const after = bodyEnd < text.length ? text.slice(bodyEnd).trim() : ''
  const prose = [before, after].filter(Boolean).join('\n\n')
  return { prose, body }
}
