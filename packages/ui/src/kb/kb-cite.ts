/**
 * Citation chips for KB-augmented answers: post-processes the rendered
 * markdown HTML and turns `[n]` markers (n valid in the message's citation
 * list) into clickable superscripts. Applied on the FINAL html, never on
 * stream fragments — streaming tokens can split a `[n]` across chunks.
 * Code spans/blocks are left untouched.
 */
import type { KbCitation } from '@chatoffice/ai-provider/browser'

const CITE_RE = /\[(\d{1,2})\]/g
const CODE_RE = /<(code|pre)[\s\S]*?<\/\1>/g

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function replaceOutsideCode(html: string, citations: KbCitation[]): string {
  const byN = new Map(citations.map((c) => [c.n, c]))
  const chip = (raw: string, digits: string): string => {
    const citation = byN.get(Number(digits))
    if (!citation) return raw
    const head = citation.headingPath ? ` › ${citation.headingPath}` : ''
    return `<sup class="kb-cite" data-kb-n="${citation.n}" title="${escapeAttr(
      `${citation.docName}${head}`,
    )}">${citation.n}</sup>`
  }
  let last = 0
  let out = ''
  for (const match of html.matchAll(CODE_RE)) {
    const index = match.index ?? 0
    out += html.slice(last, index).replace(CITE_RE, chip)
    out += match[0]
    last = index + match[0].length
  }
  out += html.slice(last).replace(CITE_RE, chip)
  return out
}

export function renderCitationChips(html: string, citations: KbCitation[] | undefined): string {
  if (!citations || citations.length === 0) return html
  return replaceOutsideCode(html, citations)
}
