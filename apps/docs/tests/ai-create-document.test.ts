import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { executeTool } from '../src/renderer/ai/tools'
import {
  AI_TOC_PLACEHOLDER,
  aiDocContentNodes,
  applyTocPlaceholders,
  withTocPlaceholders,
} from '../src/renderer/file-actions'

const editors = new Set<Editor>()
afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors.clear()
})

function createEditor(): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'docParagraph',
          attrs: { docxIndex: null },
          content: [{ type: 'text', text: 'x' }],
        },
      ],
    },
  })
  editors.add(editor)
  return editor
}

const NUM_IDS = { bullet: null, ordered: null }

type DesktopStub = { desktop?: unknown }

/** run one create_document call with a stubbed desktop bridge */
async function runWithDesktop(
  createDocument: ReturnType<typeof vi.fn>,
  input: Record<string, unknown>,
) {
  const editor = createEditor()
  const w = window as unknown as DesktopStub
  const saved = w.desktop
  w.desktop = { createDocument }
  try {
    return await executeTool(editor, { id: 't1', name: 'create_document', input }, NUM_IDS)
  } finally {
    w.desktop = saved
  }
}

describe('create_document tool', () => {
  it('defaults to docx and forwards the request', async () => {
    const createDocument = vi.fn(async () => ({ ok: true }))
    const exec = await runWithDesktop(createDocument, {
      title: 'Summary',
      content: '<h1>Summary</h1><p>Body</p>',
    })
    expect(exec.isError).toBeUndefined()
    expect(createDocument).toHaveBeenCalledWith({
      type: 'docx',
      title: 'Summary',
      content: '<h1>Summary</h1><p>Body</p>',
    })
    expect(exec.output).toContain('Summary.docx')
    expect(exec.mutated).toBe(false)
  })

  it('reports the written path for direct-write types', async () => {
    const createDocument = vi.fn(async () => ({ ok: true, path: '/tmp/Summary.pdf' }))
    const exec = await runWithDesktop(createDocument, {
      type: 'pdf',
      title: 'Summary',
      content: '<p>Body</p>',
    })
    expect(exec.isError).toBeUndefined()
    expect(exec.output).toContain('/tmp/Summary.pdf')
  })

  it('rejects bad input without calling the bridge', async () => {
    const createDocument = vi.fn(async () => ({ ok: true }))
    for (const input of [
      { type: 'xlsx', title: 'T', content: '<p>x</p>' },
      { title: '  ', content: '<p>x</p>' },
      { title: 'T', content: '   ' },
    ]) {
      const exec = await runWithDesktop(createDocument, input)
      expect(exec.isError).toBe(true)
    }
    expect(createDocument).not.toHaveBeenCalled()
  })

  it('rejects docx content that parses into no blocks, so the model can retry', async () => {
    const createDocument = vi.fn(async () => ({ ok: true }))
    const exec = await runWithDesktop(createDocument, { title: 'T', content: '<p></p>' })
    expect(exec.isError).toBe(true)
    expect(createDocument).not.toHaveBeenCalled()
  })

  it('skips the HTML validation for markdown targets', async () => {
    const createDocument = vi.fn(async () => ({ ok: true, path: '/tmp/notes.md' }))
    const exec = await runWithDesktop(createDocument, {
      type: 'md',
      title: 'notes',
      content: '# Notes\n\n- a\n- b',
    })
    expect(exec.isError).toBeUndefined()
    expect(createDocument).toHaveBeenCalledOnce()
  })

  it('forwards complete html pages to the bridge without fragment validation', async () => {
    const createDocument = vi.fn(async () => ({ ok: true, path: '/tmp/page.html' }))
    const content =
      '<!DOCTYPE html><html><head><style>p{color:red}</style></head><body><p>x</p></body></html>'
    const exec = await runWithDesktop(createDocument, { type: 'html', title: 'page', content })
    expect(exec.isError).toBeUndefined()
    expect(createDocument).toHaveBeenCalledOnce()
    const request = (createDocument.mock.calls as unknown[][])[0]![0] as Record<string, unknown>
    expect(request).toMatchObject({ type: 'html', title: 'page', content })
    expect(exec.output).toContain('/tmp/page.html')
  })

  it('surfaces a main-process failure', async () => {
    const createDocument = vi.fn(async () => ({ ok: false, error: 'disk full' }))
    const exec = await runWithDesktop(createDocument, { title: 'T', content: '<p>x</p>' })
    expect(exec.isError).toBe(true)
    expect(exec.output).toContain('disk full')
  })
})

describe('aiDocContentNodes (boot-time fill of the new docx tab)', () => {
  it('parses restricted HTML into blocks with the aiChanged highlight stripped', () => {
    const nodes = aiDocContentNodes('<h1>Title</h1><p>Body</p>')
    expect(nodes.map((n) => n.type)).toEqual(['docHeading', 'docParagraph'])
    for (const node of nodes) expect(node.attrs?.aiChanged).toBe(false)
  })

  it('falls back to plain-text paragraphs when the fragment throws (pdf chat cannot pre-parse)', () => {
    const nodes = aiDocContentNodes('<p>Before</p><formula>\\frac{</formula>')
    expect(nodes.length).toBeGreaterThan(0)
    expect(nodes.every((n) => n.type === 'docParagraph')).toBe(true)
    const text = JSON.stringify(nodes)
    expect(text).toContain('Before')
  })

  it('keeps adjacent minified blocks separate in the plain-text salvage', () => {
    const nodes = aiDocContentNodes('<p>One</p><p>Two</p><formula>\\frac{</formula>')
    const texts = nodes.map((n) => JSON.stringify(n))
    expect(texts.some((t) => t.includes('One') && !t.includes('Two'))).toBe(true)
    expect(texts.some((t) => t.includes('Two') && !t.includes('One'))).toBe(true)
  })

  it('returns nothing for markup with no text at all', () => {
    expect(aiDocContentNodes('<p></p>')).toEqual([])
  })

  it('never returns an empty document while salvage text exists (空内容洞)', () => {
    // every input carrying text must yield at least one node — the old code
    // could bottom out at [] when both parse passes failed
    for (const html of [
      '<p>A</p><formula>\\frac{</formula>',
      '<div>仅文字</div>',
      '<table><tr><td>单元格</td></tr></table>',
      '<section><p>奇怪标签</p></section>',
    ]) {
      expect(aiDocContentNodes(html).length).toBeGreaterThan(0)
    }
  })
})

describe('withTocPlaceholders (<toc> 直通标记, T3)', () => {
  it('rewrites the paired and self-closing forms into sentinel paragraphs', () => {
    const p = `<p>${AI_TOC_PLACEHOLDER}</p>`
    expect(withTocPlaceholders('<h1>T</h1><toc></toc><p>x</p>')).toBe(`<h1>T</h1>${p}<p>x</p>`)
    expect(withTocPlaceholders('<h1>T</h1><toc/><p>x</p>')).toBe(`<h1>T</h1>${p}<p>x</p>`)
    expect(withTocPlaceholders('<h1>T</h1><TOC>  </TOC><p>x</p>')).toBe(`<h1>T</h1>${p}<p>x</p>`)
    expect(withTocPlaceholders('<h1>T</h1><toc ></toc ><p>x</p>')).toContain(p)
  })

  it('leaves markup without markers untouched', () => {
    expect(withTocPlaceholders('<h1>T</h1>')).toBe('<h1>T</h1>')
  })

  it('aiDocContentNodes keeps the sentinel paragraph in place', () => {
    const nodes = aiDocContentNodes('<h1>标题</h1><toc></toc><p>正文</p>')
    expect(nodes.map((n) => n.type)).toEqual(['docHeading', 'docParagraph', 'docParagraph'])
    expect(JSON.stringify(nodes[1])).toContain(AI_TOC_PLACEHOLDER)
  })
})

describe('applyTocPlaceholders (sentinel → Word TOC field, T3)', () => {
  function topBlocks(
    editor: Editor,
  ): { name: string; text: string; attrs: Record<string, unknown> }[] {
    const out: { name: string; text: string; attrs: Record<string, unknown> }[] = []
    editor.state.doc.forEach((node) => {
      out.push({ name: node.type.name, text: node.textContent, attrs: node.attrs })
    })
    return out
  }

  it('swaps the sentinel for clickable TOC field lines built from the headings', () => {
    const editor = createEditor()
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'docHeading',
          attrs: { docxIndex: null, level: 1 },
          content: [{ type: 'text', text: '章一' }],
        },
        {
          type: 'docParagraph',
          attrs: { docxIndex: null },
          content: [{ type: 'text', text: AI_TOC_PLACEHOLDER }],
        },
        {
          type: 'docHeading',
          attrs: { docxIndex: null, level: 2 },
          content: [{ type: 'text', text: '节一' }],
        },
      ],
    } as never)
    expect(applyTocPlaceholders(editor)).toBe(true)
    const blocks = topBlocks(editor)
    expect(blocks.map((b) => b.name)).toEqual([
      'docHeading',
      'docProtected',
      'docProtected',
      'docHeading',
    ])
    const lines = blocks.filter((b) => b.name === 'docProtected')
    expect(lines.map((l) => (l.attrs.fieldDisplay as { left: string }).left)).toEqual([
      '章一',
      '节一',
    ])
    expect(lines.every((l) => String(l.attrs.genXml).includes('TOC'))).toBe(true)
  })

  it('deletes the sentinel when the document has no headings (TOC would be empty)', () => {
    const editor = createEditor()
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'docParagraph',
          attrs: { docxIndex: null },
          content: [{ type: 'text', text: AI_TOC_PLACEHOLDER }],
        },
        {
          type: 'docParagraph',
          attrs: { docxIndex: null },
          content: [{ type: 'text', text: '正文' }],
        },
      ],
    } as never)
    expect(applyTocPlaceholders(editor)).toBe(true)
    expect(topBlocks(editor).map((b) => b.text)).toEqual(['正文'])
  })

  it('is a no-op without a sentinel', () => {
    const editor = createEditor()
    expect(applyTocPlaceholders(editor)).toBe(false)
  })
})
