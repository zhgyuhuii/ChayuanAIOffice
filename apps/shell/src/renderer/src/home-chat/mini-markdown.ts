/**
 * Minimal Markdown → HTML for home-chat display (assistant replies and .md
 * document bodies). Display-only: supports the common block/inline set and
 * escapes raw HTML in the source, so the output still goes through
 * sanitizeDocHtml as a second pass.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** inline: `code`, **bold**, *italic*, [text](url), ![alt](image url) */
function inline(text: string): string {
  let out = escapeHtml(text)
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  // images before links: data:image (generated images streamed by the image
  // models; CSP allows img data:) and plain http(s) only
  out = out.replace(
    /!\[([^\]]*)\]\((data:image\/[a-z0-9+.-]+;base64,[A-Za-z0-9+/=]+|https?:\/\/[^)\s]+)\)/g,
    '<img src="$2" alt="$1">',
  )
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
  return out
}

/** Render Markdown source to an HTML fragment (safe subset). */
export function markdownToHtml(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let code: { lang: string; lines: string[] } | null = null

  const flushPara = () => {
    if (para.length === 0) return
    html.push(`<p>${para.map(inline).join('<br>')}</p>`)
    para = []
  }
  const flushList = () => {
    if (!list) return
    const tag = list.ordered ? 'ol' : 'ul'
    html.push(`<${tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${tag}>`)
    list = null
  }
  const flushCode = () => {
    if (!code) return
    // generated clips arrive as ```video fences — inline player for safe
    // sources (data:video base64, https:), anything else stays a code block
    if (code.lang === 'video' && code.lines.length === 1) {
      const src = code.lines[0]!.trim()
      if (/^(data:video\/[a-z0-9+.-]+;base64,[A-Za-z0-9+/=]+|https:\/\/\S+)$/i.test(src)) {
        html.push(
          `<video class="chat-md-video" controls preload="metadata" src="${escapeHtml(src)}"></video>`,
        )
        code = null
        return
      }
    }
    html.push(`<pre><code>${escapeHtml(code.lines.join('\n'))}</code></pre>`)
    code = null
  }

  for (const line of lines) {
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      if (code) flushCode()
      else {
        flushPara()
        flushList()
        code = { lang: fence[1] ?? '', lines: [] }
      }
      continue
    }
    if (code) {
      code.lines.push(line)
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      flushPara()
      flushList()
      const level = heading[1]!.length
      html.push(`<h${level}>${inline(heading[2]!)}</h${level}>`)
      continue
    }
    const bullet = line.match(/^\s*[-*•]\s+(.+)$/)
    if (bullet) {
      flushPara()
      if (!list || list.ordered) {
        flushList()
        list = { ordered: false, items: [] }
      }
      list.items.push(bullet[1]!)
      continue
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (numbered) {
      flushPara()
      if (!list || !list.ordered) {
        flushList()
        list = { ordered: true, items: [] }
      }
      list.items.push(numbered[1]!)
      continue
    }
    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      flushPara()
      flushList()
      html.push(`<blockquote>${inline(quote[1]!)}</blockquote>`)
      continue
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara()
      flushList()
      html.push('<hr>')
      continue
    }
    if (!line.trim()) {
      flushPara()
      flushList()
      continue
    }
    para.push(line)
  }
  flushCode()
  flushPara()
  flushList()
  return html.join('')
}
