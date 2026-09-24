import { describe, expect, it } from 'vitest'
import { renderCitationChips } from '../src/kb/kb-cite'
import type { KbCitation } from '@chatoffice/ai-provider/browser'

describe('renderCitationChips', () => {
  const citations: KbCitation[] = [
    { n: 1, kbId: 'default', docId: 'd1', docName: '规格.md', headingPath: '总则', text: 'x' },
    { n: 2, kbId: 'default', docId: 'd2', docName: 'faq.md', text: 'y' },
  ]

  it('replaces valid [n] markers with chips carrying the source tooltip', () => {
    const html = '<p>答案第一句[1]，第二句[2]。</p>'
    const out = renderCitationChips(html, citations)
    expect(out).toContain('<sup class="kb-cite" data-kb-n="1" title="规格.md › 总则">1</sup>')
    expect(out).toContain('<sup class="kb-cite" data-kb-n="2" title="faq.md">2</sup>')
    expect(out).not.toContain('[1]')
  })

  it('leaves markers without a citation and plain numbers untouched', () => {
    const html = '<p>[3] 不存在，<code>arr[1]</code> 是代码</p>'
    const out = renderCitationChips(html, citations)
    expect(out).toContain('[3]')
    expect(out).toContain('arr[1]')
  })

  it('returns the html unchanged when there are no citations', () => {
    const html = '<p>[1]</p>'
    expect(renderCitationChips(html, undefined)).toBe(html)
    expect(renderCitationChips(html, [])).toBe(html)
  })
})
