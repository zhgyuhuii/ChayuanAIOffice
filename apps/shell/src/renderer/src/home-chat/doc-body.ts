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

// ── Markdown 正文 → 受限 HTML(docx/pdf 兜底) ──
// 弱模型常无视「docx 要受限 HTML」的契约、按 Markdown 写正文。用户要的是
// word:拒绝会把类型逼成 md(错误提示里出现 md 字样即逃生门),重试又可能再写
// Markdown — 所以就地转换,类型不动。只做契约内的结构与行内标记,嵌套列表、
// Setext 标题等超集特性不支持(受限契约本来也表达不了)。

/** 块级 Markdown 信号行:正文起点(其前的对话性开场白剥掉) */
function isMarkdownBlockSignal(line: string): boolean {
  const t = line.trim()
  return (
    /^#{1,6}\s/.test(t) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    t.startsWith('>') ||
    t.startsWith('```') ||
    t.startsWith('|') ||
    /^<toc\b/i.test(t)
  )
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 行内标记:图片丢弃、链接留文本、加粗/斜体/删除线、行内代码去壳 */
function markdownInline(s: string): string {
  return escapeHtmlText(s)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/`([^`]+)`/g, '$1')
}

/** 段内多行拼接:前行尾是 CJK 字符/全角标点时不补半角空格 */
function joinFlowLines(parts: string[]): string {
  let s = ''
  for (const p of parts) s = s ? s + (/[\u3000-\u9fff\uff00-\uffef]$/.test(s) ? '' : ' ') + p : p
  return s
}

function splitMdRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

/**
 * Markdown 正文 → create_document 的受限 HTML 片段。从第一个块级信号行起
 * 转换(其前的开场白丢弃);没有任何块级信号(纯对话文本)返回 '' — 调用方
 * 按长度门槛拒绝。
 */
export function markdownToRestrictedHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const start = lines.findIndex(isMarkdownBlockSignal)
  if (start < 0) return ''
  const out: string[] = []
  let para: string[] = []
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${markdownInline(joinFlowLines(para))}</p>`)
      para = []
    }
  }
  let i = start
  while (i < lines.length) {
    const line = lines[i]!
    const t = line.trim()
    if (!t) {
      flushPara()
      i++
      continue
    }
    if (t.startsWith('```')) {
      flushPara()
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        buf.push(lines[i]!)
        i++
      }
      i++ // 闭合围栏(或文末)
      out.push(`<pre>${escapeHtmlText(buf.join('\n'))}</pre>`)
      continue
    }
    // <toc> 直通(T3 目录域标记),围栏外的原样标签只放行这一个
    if (/^<toc\b[^>]*\/>\s*$/.test(t) || /^<toc\b[^>]*>\s*<\/toc\s*>\s*$/.test(t)) {
      flushPara()
      out.push('<toc></toc>')
      i++
      continue
    }
    const heading = t.match(/^(#{1,6})\s+(.*)$/u)
    if (heading) {
      flushPara()
      const level = Math.min(heading[1]!.length, 3)
      out.push(`<h${level}>${markdownInline(heading[2]!)}</h${level}>`)
      i++
      continue
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(t)) {
      // 水平线:受限契约没有对应物,吞掉
      flushPara()
      i++
      continue
    }
    if (t.startsWith('|')) {
      flushPara()
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        rows.push(splitMdRow(lines[i]!.trim()))
        i++
      }
      // 分隔行(| --- | --- |)只用于确认表头,不产出行
      const body = rows.filter((r) => !r.every((c) => /^:?-+:?$/.test(c) || c === ''))
      const [head, ...rest] = body
      const html: string[] = ['<table>']
      if (head?.length) {
        html.push('<thead><tr>')
        for (const c of head) html.push(`<th>${markdownInline(c)}</th>`)
        html.push('</tr></thead>')
      }
      if (rest.length) {
        html.push('<tbody>')
        for (const r of rest) {
          html.push('<tr>')
          for (const c of r) html.push(`<td>${markdownInline(c)}</td>`)
          html.push('</tr>')
        }
        html.push('</tbody>')
      }
      html.push('</table>')
      out.push(html.join(''))
      continue
    }
    if (t.startsWith('>')) {
      flushPara()
      const buf: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) {
        buf.push(lines[i]!.replace(/^\s*>\s?/, ''))
        i++
      }
      out.push(`<blockquote><p>${markdownInline(joinFlowLines(buf))}</p></blockquote>`)
      continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara()
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]!)) {
        items.push(`<li>${markdownInline(lines[i]!.replace(/^\s*[-*+]\s+/, ''))}</li>`)
        i++
      }
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushPara()
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) {
        items.push(`<li>${markdownInline(lines[i]!.replace(/^\s*\d+[.)]\s+/, ''))}</li>`)
        i++
      }
      out.push(`<ol>${items.join('')}</ol>`)
      continue
    }
    para.push(t)
    i++
  }
  flushPara()
  return out.join('\n')
}
