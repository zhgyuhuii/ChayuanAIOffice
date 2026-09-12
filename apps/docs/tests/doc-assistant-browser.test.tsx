// @vitest-environment jsdom
// AssistantBrowser: group-first browsing over a (here: mocked) pack manifest —
// groups render from the manifest, a domain click lazy-loads its list, running
// an assistant routes the built instruction through onRun, selection-only
// assistants demand a selection, and search covers the loaded library.
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const { teaDoc, selectionDoc } = vi.hoisted(() => {
  const teaDoc = {
    id: 'tea.tasting-note',
    domain: 'tea',
    label: '茶叶品鉴描述',
    shortLabel: '品鉴描述',
    icon: '👃',
    tags: ['品鉴'],
    description: '整理成分维度的品鉴描述',
    systemPrompt: '你是一位评茶师。',
    userPromptTemplate: '整理品鉴描述：{{input}}',
    actions: ['none'],
    defaultAction: 'none',
    inputSource: 'document',
    outputFormat: 'markdown',
  }
  const selectionDoc = {
    ...teaDoc,
    id: 'legal.clause-review',
    domain: 'legal',
    label: '条款审查',
    description: '逐条审查选中条款',
    inputSource: 'selection-only',
    defaultAction: 'comment',
  }
  return { teaDoc, selectionDoc }
})

vi.mock('../src/renderer/ai/assistants/packs/manifest', () => {
  const domains = [
    { key: 'tea', label: '茶叶', count: 1 },
    { key: 'legal', label: '合同 / 法务', count: 1 },
  ]
  const byDomain = new Map([
    ['tea', [teaDoc]],
    ['legal', [selectionDoc]],
  ])
  return {
    DOC_ASSISTANT_TOTAL: 2,
    DOC_ASSISTANT_DOMAINS: domains,
    loadDomain: async (key: string) => byDomain.get(key) ?? [],
    loadAllDomains: async () => byDomain,
  }
})

import { AssistantBrowser } from '../src/renderer/ai/AssistantBrowser'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn()
  localStorage.clear()
})

function mountBrowser(opts: {
  docEmpty?: boolean
  selection?: string
  onRun: (run: { instruction: string; display: string }) => void
}): { host: HTMLElement } {
  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  cleanups.push(() => {
    act(() => {
      root.unmount()
    })
  })
  act(() => {
    root.render(
      h(AssistantBrowser, {
        quickItems: [
          { id: 'summarize', label: '总结全文', desc: '总结要点', icon: null, run: () => {} },
        ],
        getSelectionText: () => opts.selection ?? '',
        docEmpty: opts.docEmpty ?? false,
        onRun: opts.onRun,
      }),
    )
  })
  return { host }
}

const flush = () => act(async () => {})

function textOf(host: HTMLElement): string {
  return host.textContent ?? ''
}

function clickButton(host: HTMLElement, label: string): void {
  const btn = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label))
  if (!btn) throw new Error(`no button containing "${label}"`)
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('AssistantBrowser', () => {
  it('renders quick items and the domain groups with counts', async () => {
    const { host } = mountBrowser({ onRun: () => {} })
    await flush()
    const text = textOf(host)
    expect(text).toContain('总结全文')
    expect(text).toContain('茶叶')
    expect(text).toContain('合同 / 法务')
    expect(text).toContain('2')
  })

  it('opens a domain, runs an assistant through onRun and remembers it', async () => {
    const runs: Array<{ instruction: string; display: string }> = []
    const { host } = mountBrowser({ onRun: (r) => runs.push(r) })
    await flush()
    clickButton(host, '茶叶')
    await flush()
    expect(textOf(host)).toContain('茶叶品鉴描述')
    clickButton(host, '茶叶品鉴描述')
    expect(runs.length).toBe(1)
    expect(runs[0].instruction).toContain('【角色设定】\n你是一位评茶师。')
    expect(runs[0].instruction).toContain('整理品鉴描述：')
    expect(runs[0].display).toBe('👃 茶叶品鉴描述 · 全文')
    await flush()
    expect(JSON.parse(localStorage.getItem('aidocs.assistantRecents') ?? '[]')).toEqual([
      'tea.tasting-note',
    ])
  })

  it('selection-only assistants demand a selection instead of running', async () => {
    const runs: Array<unknown> = []
    const { host } = mountBrowser({ onRun: () => runs.push(1), selection: '' })
    await flush()
    clickButton(host, '合同 / 法务')
    await flush()
    clickButton(host, '条款审查')
    expect(runs.length).toBe(0)
    expect(textOf(host)).toContain('请先在文档中选中要处理的文字')
  })

  it('search across the loaded library lists matches with their domain', async () => {
    const { host } = mountBrowser({ onRun: () => {} })
    await flush()
    const input = host.querySelector<HTMLInputElement>('.ai-assist-search')
    if (!input) throw new Error('no search input')
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    act(() => {
      setter?.call(input, '品鉴')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()
    expect(textOf(host)).toContain('茶叶品鉴描述')
    expect(textOf(host)).toContain('茶叶')
  })

  it('assistant rows are disabled for a blank document', async () => {
    const { host } = mountBrowser({ onRun: () => {}, docEmpty: true })
    await flush()
    clickButton(host, '茶叶')
    await flush()
    const row = [...host.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('茶叶品鉴描述'),
    )
    expect(row?.disabled).toBe(true)
  })
})
