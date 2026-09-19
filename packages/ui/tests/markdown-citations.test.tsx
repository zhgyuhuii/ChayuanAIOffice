// @vitest-environment jsdom
/**
 * Markdown [n] citation chips: valid markers render as clickable superscripts
 * wired to onCitationClick, unknown numbers stay literal text, and code
 * spans/fenced blocks are never touched (same semantics as renderCitationChips).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Markdown } from '../src/Markdown'

let host: HTMLDivElement
let root: Root

const render = async (ui: React.ReactNode): Promise<void> => {
  await act(async () => {
    root.render(ui)
  })
}

beforeEach(async () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  return async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
  }
})

const citations = [
  { n: 1, kbId: 'k', docId: 'd1', docName: '差旅报销制度.md', headingPath: '住宿标准', text: 'x' },
  { n: 2, kbId: 'k', docId: 'd2', docName: '其他.md', text: 'y' },
]

describe('Markdown citation chips', () => {
  it('renders [n] chips for known citations and fires onCitationClick', async () => {
    const onCitationClick = vi.fn()
    await render(
      createElement(Markdown, {
        text: '一线 600 元 [1]，其他 450 元 [1]。',
        citations,
        onCitationClick,
      }),
    )
    const chips = [...host.querySelectorAll('sup.kb-cite')]
    expect(chips).toHaveLength(2)
    expect(chips[0]!.textContent).toBe('1')
    await act(async () => {
      ;(chips[0] as HTMLElement).click()
    })
    expect(onCitationClick).toHaveBeenCalledWith(citations[0])
  })

  it('keeps unknown numbers and code spans literal', async () => {
    await render(
      createElement(Markdown, {
        text: '编号 [9] 不存在，`代码中的 [1]` 保持原样',
        citations,
        onCitationClick: vi.fn(),
      }),
    )
    expect(host.querySelector('sup.kb-cite')).toBeNull()
    expect(host.textContent).toContain('[9]')
    expect(host.querySelector('code')?.textContent).toContain('[1]')
  })

  it('renders fenced code blocks untouched', async () => {
    await render(
      createElement(Markdown, {
        text: '前文 [1]\n```\narray[1]\n```\n后文 [2]',
        citations,
        onCitationClick: vi.fn(),
      }),
    )
    expect([...host.querySelectorAll('sup.kb-cite')]).toHaveLength(2)
    expect(host.querySelector('pre code')?.textContent).toContain('array[1]')
  })
})
