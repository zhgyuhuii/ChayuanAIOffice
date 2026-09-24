/**
 * Allowlist sanitizer for model-produced HTML (home chat document bodies).
 * Strips everything outside the restricted set the docs create_document
 * pipeline accepts, plus <script>/<style>/event handlers. Partial fragments
 * mid-stream are fine: DOMParser auto-closes open tags.
 */

const ALLOWED_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'br',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'a',
  'span',
  'div',
  // generated images streamed as markdown by the image models (data: URLs)
  'img',
])

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href']),
  img: new Set(['src', 'alt']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan']),
}

function sanitizeNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? '')
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  if (!ALLOWED_TAGS.has(tag)) {
    // unwrap: keep children so bold-inside-unknown-tag still shows its text
    const fragment = doc.createDocumentFragment()
    for (const child of Array.from(el.childNodes)) {
      const clean = sanitizeNode(child, doc)
      if (clean) fragment.appendChild(clean)
    }
    return fragment
  }
  const out = doc.createElement(tag)
  const allowedAttrs = ALLOWED_ATTRS[tag]
  if (allowedAttrs) {
    for (const attr of Array.from(el.attributes)) {
      if (!allowedAttrs.has(attr.name.toLowerCase())) continue
      if (tag === 'a' && attr.name.toLowerCase() === 'href') {
        const href = attr.value.trim()
        if (!/^https?:\/\//i.test(href)) continue
      }
      if (tag === 'img' && attr.name.toLowerCase() === 'src') {
        const src = attr.value.trim()
        if (!/^(data:image\/[a-z+.-]+;base64,|https?:\/\/)/i.test(src)) continue
      }
      out.setAttribute(attr.name, attr.value)
    }
    if (tag === 'a') {
      out.setAttribute('target', '_blank')
      out.setAttribute('rel', 'noreferrer')
    }
  }
  for (const child of Array.from(el.childNodes)) {
    const clean = sanitizeNode(child, doc)
    if (clean) out.appendChild(clean)
  }
  return out
}

/** Sanitize a (possibly partial) restricted-HTML fragment into safe HTML. */
export function sanitizeDocHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out = document.createElement('div')
  for (const child of Array.from(doc.body.childNodes)) {
    const clean = sanitizeNode(child, document)
    if (clean) out.appendChild(clean)
  }
  return out.innerHTML
}
