/** create_document blank-document redirect: content for the open blank document
 *  must go through write_document, not a separate file (UOS 实测误建两个新文档的根治守卫). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { executeTool } from '../src/renderer/ai/tools'

const editors = new Set<Editor>()
afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors.clear()
})

function createEditor(paragraphText: string | null): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: paragraphText
        ? [
            {
              type: 'docParagraph',
              attrs: { docxIndex: null },
              content: [{ type: 'text', text: paragraphText }],
            },
          ]
        : [{ type: 'docParagraph', attrs: { docxIndex: null } }],
    },
  })
  editors.add(editor)
  return editor
}

const NUM_IDS = { bullet: null, ordered: null }

type DesktopStub = { desktop?: unknown }

async function run(
  paragraphText: string | null,
  input: Record<string, unknown>,
  createDocument: ReturnType<typeof vi.fn> = vi.fn(async () => ({ ok: true })),
) {
  const editor = createEditor(paragraphText)
  const w = window as unknown as DesktopStub
  const saved = w.desktop
  w.desktop = { createDocument }
  try {
    return await executeTool(editor, { id: 't1', name: 'create_document', input }, NUM_IDS)
  } finally {
    w.desktop = saved
  }
}

describe('create_document blank-document guard', () => {
  it('redirects to write_document on a blank document (no file created)', async () => {
    const createDocument = vi.fn(async () => ({ ok: true }))
    const exec = await run(null, { title: '大美河山', content: '<h1>大美河山</h1>' }, createDocument)
    expect(exec.isError).toBe(true)
    expect(createDocument).not.toHaveBeenCalled()
    expect(exec.output).toContain('write_document')
    expect(exec.output).toContain('insertCover')
    expect(exec.output).toContain('separateFile')
  })

  it('separateFile:true passes on a blank document (explicit ask)', async () => {
    const createDocument = vi.fn(async () => ({ ok: true }))
    const exec = await run(
      null,
      { title: '大美河山', content: '<h1>大美河山</h1>', separateFile: true },
      createDocument,
    )
    expect(exec.isError).toBeUndefined()
    expect(createDocument).toHaveBeenCalledOnce()
  })

  it('a document with content is unaffected', async () => {
    const createDocument = vi.fn(async () => ({ ok: true }))
    const exec = await run('x', { title: 'Summary', content: '<p>Body</p>' }, createDocument)
    expect(exec.isError).toBeUndefined()
    expect(createDocument).toHaveBeenCalledOnce()
  })
})
