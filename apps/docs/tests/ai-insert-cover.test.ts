/** insertCover op: one-shot cover page (+optional TOC) at the document start. */
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { executeOps, opNames } from '../src/renderer/ai/ops'

interface JsonNode {
  type: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

const text = (t: string, marks?: JsonNode['marks']): JsonNode => ({
  type: 'text',
  text: t,
  ...(marks && marks.length > 0 ? { marks } : {}),
})

const heading = (content: JsonNode[], level = 1): JsonNode => ({
  type: 'docHeading',
  attrs: { docxIndex: null, level },
  content,
})

const para = (content: JsonNode[], attrs: Record<string, unknown> = {}): JsonNode => ({
  type: 'docParagraph',
  attrs: { docxIndex: null, ...attrs },
  content,
})

const editors = new Set<Editor>()
afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors.clear()
})

function createEditor(content: JsonNode[]): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: { type: 'doc', content },
  })
  editors.add(editor)
  return editor
}

/** body fixture with headings so toc:true has entries */
function bodyDoc(): JsonNode[] {
  return [
    heading([text('第一章 大美河山')], 1),
    para([text('江山如此多娇。')]),
    heading([text('第二章 锦绣中华')], 1),
    para([text('风光这边独好。')]),
  ]
}

const runCover = (editor: Editor, op: Record<string, unknown>) =>
  executeOps(editor, [{ op: 'insertCover', ...op }])

describe('insertCover op', () => {
  it('is registered and offered to the model', () => {
    expect(opNames()).toContain('insertCover')
  })

  it('prepends centered cover blocks + a page break before the body', () => {
    const editor = createEditor(bodyDoc())
    const r = runCover(editor, { title: '大美河山', subtitle: '游记散文集', date: '2026年10月' })
    expect(r.ok).toBe(true)
    const doc = editor.state.doc
    // title | subtitle | date | page-break | original 4 body blocks
    expect(doc.childCount).toBe(8)
    const title = doc.child(0)
    expect(title.attrs.align).toBe('center')
    expect(title.textContent).toBe('大美河山')
    const titleRun = title.child(0)
    expect(titleRun.marks.find((m) => m.type.name === 'bold')).toBeTruthy()
    expect(
      titleRun.marks.find((m) => m.type.name === 'docTextStyle')?.attrs.sizeHalfPoints,
    ).toBe(72)
    expect(doc.child(3).textContent).toBe('')
    expect(
      doc.child(3).child(0)?.type.name === 'hardBreak' &&
        doc.child(3).child(0).attrs.pageBreak === true,
    ).toBe(true)
    // body follows intact
    expect(doc.child(4).textContent).toBe('第一章 大美河山')
  })

  it('toc:true inserts the TOC right after the cover blocks', () => {
    const editor = createEditor(bodyDoc())
    const r = runCover(editor, { title: '大美河山', toc: true })
    expect(r.ok).toBe(true)
    const doc = editor.state.doc
    // title | page-break | TOC field lines | body(4)
    expect(doc.child(2).type.name).toBe('docProtected')
    expect(doc.child(2).attrs.label).toBe('TOC field')
    expect(doc.child(doc.childCount - 1).textContent).toBe('风光这边独好。')
  })

  it('toc:true fails cleanly when the document has no headings yet (atomic)', () => {
    const editor = createEditor([para([text('还没有标题的正文')])])
    const r = runCover(editor, { title: '大美河山', toc: true })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('insertToc')
    // atomic: nothing was inserted
    expect(editor.state.doc.childCount).toBe(1)
  })

  it('refuses to stack a second cover on an existing large centered title', () => {
    const editor = createEditor([
      para([text('大美河山', [{ type: 'docTextStyle', attrs: { sizeHalfPoints: 72 } }])], {
        align: 'center',
      }),
      para([text('正文')]),
    ])
    const r = runCover(editor, { title: '又一个封面' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('already starts with a large centered title')
  })

  it('validates title and field types', () => {
    const editor = createEditor(bodyDoc())
    expect(runCover(editor, {}).ok).toBe(false)
    expect(runCover(editor, { title: '' }).ok).toBe(false)
    expect(runCover(editor, { title: 'T', toc: 'yes' }).ok).toBe(false)
  })
})
