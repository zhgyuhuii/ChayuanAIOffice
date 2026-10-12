/**
 * SVG sanitizer for model-generated vector graphics (docs/image-source-plan.md
 * #6): script/foreignObject/event-handler/external-reference stripping, with
 * internal anchors and data:image hrefs kept.
 */
import { describe, expect, it } from 'vitest'
import { repairSvgEntities, sanitizeSvg } from '../src/svg-sanitize'

describe('sanitizeSvg', () => {
  it('keeps a clean SVG untouched', () => {
    const svg = '<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#f00"/></svg>'
    const r = sanitizeSvg(svg)
    expect(r.ok).toBe(true)
    expect(r.svg).toBe(svg)
    expect(r.removed).toEqual([])
  })

  it('strips script blocks and lone script tags', () => {
    const r = sanitizeSvg(
      '<svg viewBox="0 0 10 10"><script>alert(1)</script><script src="https://x.evil/s.js"/><rect width="10" height="10"/></svg>',
    )
    expect(r.svg).not.toContain('<script')
    expect(r.svg).not.toContain('alert')
    expect(r.removed.some((m) => m.includes('script'))).toBe(true)
  })

  it('strips event handler attributes', () => {
    const r = sanitizeSvg(
      '<svg viewBox="0 0 10 10" onload="alert(1)"><rect width="10" height="10" onclick="x()"/></svg>',
    )
    expect(r.svg).not.toContain('onload')
    expect(r.svg).not.toContain('onclick')
  })

  it('strips foreignObject blocks', () => {
    const r = sanitizeSvg(
      '<svg viewBox="0 0 10 10"><foreignObject><body><img src=x onerror=alert(1)></body></foreignObject><rect width="10" height="10"/></svg>',
    )
    expect(r.svg).not.toContain('foreignObject')
  })

  it('drops external hrefs but keeps internal anchors', () => {
    const r = sanitizeSvg(
      '<svg viewBox="0 0 10 10" xmlns:xlink="http://www.w3.org/1999/xlink">' +
        '<use xlink:href="https://evil/x.svg"/><use xlink:href="#arrow"/><image href="data:image/png;base64,AAA"/><rect width="10" height="10"/></svg>',
    )
    expect(r.svg).toContain('xlink:href="#arrow"')
    expect(r.svg).toContain('href="data:image/png;base64,AAA"')
    expect(r.svg).not.toContain('evil')
    expect(r.removed.some((m) => m.includes('external href'))).toBe(true)
  })

  it('neutralizes external url() references in style attributes', () => {
    const r = sanitizeSvg(
      `<svg viewBox="0 0 10 10"><rect style="fill: url(https://evil/img.png) none" width="10" height="10"/></svg>`,
    )
    expect(r.svg).not.toContain('https://evil')
    expect(r.removed.some((m) => m.includes('external url()'))).toBe(true)
  })

  it('reports ok:false when the markup stops being an SVG', () => {
    expect(sanitizeSvg('<div>not svg</div>').ok).toBe(false)
    expect(sanitizeSvg('<svg><rect/></svg>').ok).toBe(true)
  })
})

describe('repairSvgEntities', () => {
  it('escapes bare ampersands (the most common model markup error)', () => {
    expect(repairSvgEntities('<text>R&D</text>')).toBe('<text>R&amp;D</text>')
    expect(repairSvgEntities('<text>M&A Q&A</text>')).toBe('<text>M&amp;A Q&amp;A</text>')
    expect(
      repairSvgEntities('<path d="M0 0 L10 10 &amp;& 20 20"/>'),
    ).toBe('<path d="M0 0 L10 10 &amp;&amp; 20 20"/>')
  })

  it('maps HTML-only named entities to numeric character references', () => {
    expect(repairSvgEntities('<text>A&nbsp;B</text>')).toBe('<text>A&#160;B</text>')
    expect(repairSvgEntities('<text>©&copy;™&trade;—&mdash;</text>')).toBe(
      '<text>©&#169;™&#8482;—&#8212;</text>',
    )
  })

  it('leaves the five predefined XML entities and numeric refs untouched', () => {
    const svg = '<text a="&quot;x&quot;">a&lt;b&amp;c&gt;&#169;&#xA9;</text>'
    expect(repairSvgEntities(svg)).toBe(svg)
  })

  it('leaves unknown named entities alone (the precise decoder diagnostic handles them)', () => {
    expect(repairSvgEntities('<text>&nosuchentity;</text>')).toBe('<text>&nosuchentity;</text>')
  })
})
