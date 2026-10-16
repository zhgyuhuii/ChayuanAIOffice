import { Fragment, useEffect, useState, type ReactNode } from 'react'
import type { KbCitation } from '@chatoffice/ai-provider/browser'

/**
 * Minimal dependency-free markdown for chat bubbles: paragraphs, ul/ol,
 * headings, pipe tables, fenced code, **bold**, *italic*, `inline code`.
 * Tolerates partial (streaming) input — anything unrecognized renders as
 * plain text.
 *
 * Markdown links stay literal text unless the host passes a nav (single `nav`
 * prop or a `navs` list) whose scheme the href carries — then they become
 * in-app navigation links. External URLs never turn into clickable links here.
 *
 * Images (`![alt](src)`, data:image/https: sources only) render as small
 * thumbnails — generated images would otherwise fill the panel — and open a
 * plain lightbox on click (click anywhere / Esc closes; no chrome, no labels).
 *
 * With `citations`, valid `[n]` markers in plain text render as clickable
 * superscript chips (KB answers); inline code and fenced blocks are untouched.
 */

/** citation contract behind [n] chips (verbatim KbCitation) */
export type MarkdownCitation = KbCitation

export interface MarkdownNav {
  /** href prefix that renders as an in-app navigation link (e.g. 'docnav://') */
  scheme: string
  onNavigate: (href: string) => void
}

export interface MarkdownImage {
  /** Resolve an image href from `![alt](href)`; return undefined to skip the image */
  resolve?: (href: string) => string | undefined
}

/** first nav whose scheme prefixes href; undefined keeps the link dead text */
function matchNav(navs: readonly MarkdownNav[], href: string): MarkdownNav | undefined {
  return navs.find((n) => href.startsWith(n.scheme))
}

// Hrefs may carry one level of balanced parens (sheet names like `Data (2)`
// arrive as sheetnav://Data%20(2)!B2), so the href cannot simply stop at ')'.
const HREF = /(?:[^\s()]|\([^\s()]*\))+/.source
const INLINE_RE = new RegExp(
  `(\`[^\`\\n]+\`|\\*\\*[^*\\n]+?\\*\\*|\\*[^*\\n]+?\\*|!\\[[^\\]\\n]*\\]\\(${HREF}\\)|\\[[^\\]\\n]+\\]\\(${HREF}\\))`,
  'g',
)
const LINK_RE = new RegExp(`^\\[([^\\]]+)\\]\\((${HREF})\\)$`)
const IMAGE_RE = new RegExp(`^!\\[([^\\]]*)\\]\\((${HREF})\\)$`)
/** a whole line that is nothing but an image, the manual's figure syntax */
const IMG_LINE_RE = new RegExp(`^\\s*!\\[([^\\]]*)\\]\\((${HREF})\\)$`)
/** images render as <img> only for safe sources: editor CSPs allow data:
 * images everywhere, and generated images ride in as data: URLs; remote
 * https: is allowed, everything else stays literal text */
const IMAGE_SRC_RE = /^(data:image\/[a-z0-9+.-]+;base64,[A-Za-z0-9+\/=]+|https:\/\/\S+)$/i
const CITE_TEXT_RE = /\[(\d{1,2})\]/g

interface CiteContext {
  citations: readonly KbCitation[]
  onCitationClick: (citation: KbCitation) => void
}

// adapted: 上游 #1915 navs 列表导航 + 图床 images resolver 作为第 6 参织入本地 renderInline
function renderInline(
  text: string,
  navs: readonly MarkdownNav[],
  cite?: CiteContext,
  onZoomOpen?: (src: string) => void,
  insert?: { run: (src: string) => void; label: string },
  images?: MarkdownImage,
): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  // plain text segments carry [n] chips when a citation list is attached
  const pushText = (str: string): void => {
    if (!cite || cite.citations.length === 0) {
      out.push(str)
      return
    }
    let tLast = 0
    for (const m of str.matchAll(CITE_TEXT_RE)) {
      const citation = cite.citations.find((c) => c.n === Number(m[1]))
      if (!citation) continue
      const i = m.index ?? 0
      if (i > tLast) out.push(str.slice(tLast, i))
      const head = citation.headingPath ? ` › ${citation.headingPath}` : ''
      out.push(
        <sup
          key={key++}
          className="kb-cite"
          title={`${citation.docName}${head}`}
          onClick={() => cite.onCitationClick(citation)}
        >
          {citation.n}
        </sup>,
      )
      tLast = i + m[0].length
    }
    out.push(str.slice(tLast))
  }
  for (const m of text.matchAll(INLINE_RE)) {
    const i = m.index ?? 0
    if (i > last) pushText(text.slice(last, i))
    const tok = m[0] ?? ''
    if (tok.startsWith('`')) out.push(<code key={key++}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('**')) out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('!')) {
      // adapted: 上游 resolver 优先（图床/manual 资产），未提供 resolver 时按本地 IMAGE_SRC_RE 白名单直渲染
      const img = IMAGE_RE.exec(tok)
      const raw = img?.[2] ?? ''
      const src = img
        ? (images?.resolve?.(raw) ?? (IMAGE_SRC_RE.test(raw) ? raw : undefined))
        : undefined
      if (img && src) {
        const node = (
          <img
            key={key++}
            className="ai-md-img"
            src={src}
            alt={img[1] ?? ''}
            title={img[1] ?? ''}
            loading="lazy"
            onClick={() => onZoomOpen?.(src)}
          />
        )
        if (insert) {
          out.push(
            <span key={key++} className="ai-md-img-wrap">
              {node}
              <button
                type="button"
                className="ai-md-img-insert"
                title={insert.label}
                onClick={() => insert.run(src)}
              >
                {insert.label}
              </button>
            </span>,
          )
        } else {
          out.push(node)
        }
      } else {
        pushText(tok) // unresolvable or unsafe source stays literal
      }
    } else if (tok.startsWith('[')) {
      const link = LINK_RE.exec(tok)
      const href = link?.[2] ?? ''
      const hit = link ? matchNav(navs, href) : undefined
      if (link && hit) {
        out.push(
          <a
            key={key++}
            className="ai-md-nav"
            href={href}
            onClick={(e) => {
              e.preventDefault()
              hit.onNavigate(href)
            }}
          >
            {link[1]}
          </a>,
        )
      } else {
        pushText(tok) // non-nav links keep today's literal rendering
      }
    } else out.push(<em key={key++}>{tok.slice(1, -1)}</em>)
    last = i + tok.length
  }
  if (last < text.length) pushText(text.slice(last))
  return out
}

type CellAlign = 'left' | 'center' | 'right' | undefined

type MdBlock =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'h'; text: string; level: number }
  | { kind: 'table'; align: CellAlign[]; head: string[]; rows: string[][] }
  | { kind: 'code'; lang: string; lines: string[] }
  | { kind: 'img'; alt: string; href: string }

const FENCE_RE = /^\s*(`{3,}|~{3,})/
const DELIM_CELL_RE = /^\s*:?-+:?\s*$/

/** Splits a table row on pipes that are neither escaped nor inside inline code. */
function splitCells(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inCode = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\' && line[i + 1] === '|') {
      cur += '|'
      i++
    } else if (ch === '`') {
      inCode = !inCode
      cur += ch
    } else if (ch === '|' && !inCode) {
      cells.push(cur)
      cur = ''
    } else cur += ch
  }
  cells.push(cur)
  if (cells.length && !cells[0]?.trim()) cells.shift()
  if (cells.length && !cells[cells.length - 1]?.trim()) cells.pop()
  return cells.map((c) => c.trim())
}

function parseDelimiterRow(line: string): CellAlign[] | null {
  if (!line.includes('-')) return null
  const cells = splitCells(line)
  if (!cells.length || !cells.every((c) => DELIM_CELL_RE.test(c))) return null
  return cells.map((c) => {
    const l = c.startsWith(':')
    const r = c.endsWith(':')
    if (l && r) return 'center'
    if (r) return 'right'
    if (l) return 'left'
    return undefined
  })
}

function parseBlocks(text: string): MdBlock[] {
  const blocks: MdBlock[] = []
  let cur: MdBlock | null = null
  const flush = (): void => {
    if (cur) {
      blocks.push(cur)
      cur = null
    }
  }
  const lines = text.split('\n')
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx] ?? ''
    const line = raw.trimEnd()
    if (cur?.kind === 'code') {
      if (FENCE_RE.test(line)) flush()
      else cur.lines.push(raw)
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    // Standalone image line: ![alt](href) — the manual's figure syntax, and a
    // thing an AI reply can contain on its own. It is a *block* only when the
    // host can resolve it; see the render side, which falls back to the literal
    // text rather than dropping the line.
    const img = IMG_LINE_RE.exec(line)
    if (img) {
      flush()
      blocks.push({ kind: 'img', alt: img[1] ?? '', href: img[2] ?? '' })
      continue
    }
    if (FENCE_RE.test(line)) {
      flush()
      cur = { kind: 'code', lang: /^\s*(`{3,}|~{3})\s*(\S*)/.exec(line)?.[2] ?? '', lines: [] }
      continue
    }
    if (cur?.kind === 'table') {
      if (line.includes('|')) {
        const width = cur.head.length
        const cells = splitCells(line).slice(0, width)
        while (cells.length < width) cells.push('')
        cur.rows.push(cells)
        continue
      }
      flush()
    }
    if (line.includes('|')) {
      const align = parseDelimiterRow(lines[idx + 1] ?? '')
      if (align) {
        const head = splitCells(line)
        if (head.length === align.length) {
          flush()
          cur = { kind: 'table', align, head, rows: [] }
          idx++
          continue
        }
      }
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      flush()
      blocks.push({ kind: 'h', text: h[2] ?? '', level: (h[1] ?? '#').length })
      continue
    }
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line)
    if (ul) {
      if (cur?.kind !== 'ul') {
        flush()
        cur = { kind: 'ul', items: [] }
      }
      cur.items.push(ul[1] ?? '')
      continue
    }
    const ol = /^\s*\d+[.、)]\s+(.*)$/.exec(line)
    if (ol) {
      if (cur?.kind !== 'ol') {
        flush()
        cur = { kind: 'ol', items: [] }
      }
      cur.items.push(ol[1] ?? '')
      continue
    }
    if (cur?.kind !== 'p') {
      flush()
      cur = { kind: 'p', lines: [] }
    }
    cur.lines.push(line)
  }
  flush()
  return blocks
}

export function Markdown({
  text,
  nav,
  navs,
  images,
  citations,
  onCitationClick,
  onInsertImage,
  insertImageLabel,
}: {
  text: string
  nav?: MarkdownNav
  navs?: readonly MarkdownNav[]
  /** adapted: 上游图床 resolve 钩子；未提供时本地安全源白名单仍生效 */
  images?: MarkdownImage
  citations?: readonly KbCitation[] | undefined
  onCitationClick?: ((citation: KbCitation) => void) | undefined
  /** host hook: rendered as an action chip under each generated image so the
   * picture can be pushed into the hosting document (editor panels only) */
  onInsertImage?: ((src: string) => void) | undefined
  insertImageLabel?: string | undefined
}): React.JSX.Element {
  // the legacy single nav rides along with the newer list; first scheme
  // match wins, and hosts never pass overlapping schemes anyway
  const navList: readonly MarkdownNav[] = nav ? [nav, ...(navs ?? [])] : (navs ?? [])
  const cite: CiteContext | undefined =
    citations && citations.length > 0 && onCitationClick
      ? { citations, onCitationClick }
      : undefined
  const insert: { run: (src: string) => void; label: string } | undefined = onInsertImage
    ? { run: onInsertImage, label: insertImageLabel ?? '↧' }
    : undefined
  // lightbox: one zoomed image at a time, no chrome — generated pictures are
  // data: URLs already in memory, so this stays cheap
  const [zoom, setZoom] = useState<string | null>(null)
  const openZoom = (src: string) => setZoom(src)
  useEffect(() => {
    if (!zoom) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoom(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [zoom])
  return (
    <div className="ai-md">
      {parseBlocks(text).map((b, i) => {
        if (b.kind === 'h') {
          // level class lets hosts scale heading sizes (chat keeps them equal;
          // the manual styles h2/h3 distinctly)
          return (
            <p key={i} className={`ai-md-h ai-md-h${b.level}`}>
              {renderInline(b.text, navList, cite, openZoom, insert, images)}
            </p>
          )
        }
        if (b.kind === 'img') {
          // adapted: resolver 优先；本地 chat 面板无 resolver 时按 IMAGE_SRC_RE 白名单回退（不丢缩略图），都不中才落字面量
          const src = images?.resolve?.(b.href) ?? (IMAGE_SRC_RE.test(b.href) ? b.href : undefined)
          if (!src) return <p key={i}>{`![${b.alt}](${b.href})`}</p>
          const img = (
            <img
              key={i}
              className="ai-md-img"
              src={src}
              alt={b.alt}
              loading="lazy"
              onClick={() => openZoom(src)}
            />
          )
          // insert chip rides on whole-line images too (local chat panels push
          // the generated picture into the hosting document)
          if (!insert) return img
          return (
            <span key={i} className="ai-md-img-wrap">
              {img}
              <button
                type="button"
                className="ai-md-img-insert"
                title={insert.label}
                onClick={() => insert.run(src)}
              >
                {insert.label}
              </button>
            </span>
          )
        }
        if (b.kind === 'ul' || b.kind === 'ol') {
          const items = b.items.map((it, j) => (
            <li key={j}>{renderInline(it, navList, cite, openZoom, insert, images)}</li>
          ))
          return b.kind === 'ul' ? <ul key={i}>{items}</ul> : <ol key={i}>{items}</ol>
        }
        if (b.kind === 'code') {
          // generated clips arrive as ```video fences — render an inline player
          // for safe sources (data:video base64, https:), anything else as code
          if (b.lang === 'video' && b.lines.length === 1) {
            const src = (b.lines[0] ?? '').trim()
            if (/^(data:video\/[a-z0-9+.-]+;base64,[A-Za-z0-9+/=]+|https:\/\/\S+)$/i.test(src)) {
              return <video key={i} className="ai-md-video" controls preload="metadata" src={src} />
            }
          }
          return (
            <pre key={i} className="ai-md-pre">
              <code>{b.lines.join('\n')}</code>
            </pre>
          )
        }
        if (b.kind === 'table') {
          const cellStyle = (j: number): React.CSSProperties | undefined =>
            b.align[j] ? { textAlign: b.align[j] } : undefined
          return (
            <div key={i} className="ai-md-table-wrap">
              <table className="ai-md-table">
                <thead>
                  <tr>
                    {b.head.map((c, j) => (
                      <th key={j} style={cellStyle(j)}>
                        {renderInline(c, navList, cite, openZoom, insert, images)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((c, j) => (
                        <td key={j} style={cellStyle(j)}>
                          {renderInline(c, navList, cite, openZoom, insert, images)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        return (
          <p key={i}>
            {b.lines.map((ln, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(ln, navList, cite, openZoom, insert, images)}
              </Fragment>
            ))}
          </p>
        )
      })}
      {zoom && (
        <div
          className="ai-md-zoom"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setZoom(null)
          }}
        >
          <img src={zoom} alt="" />
        </div>
      )}
    </div>
  )
}
