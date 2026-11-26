import { act, createElement, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import {
  PlainTextEditor,
  type PlainTextEditorHandle,
} from '../src/renderer/source/PlainTextEditor'

/** mount the editor and hand back its live view + handle through a test harness */
function mount(
  initialText: string,
  mode: 'plain' | 'json',
  onChange: (text: string) => void = () => {},
): { view: EditorView; handle: () => PlainTextEditorHandle | null; unmount: () => void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let handle: PlainTextEditorHandle | null = null
  function Harness(): React.ReactNode {
    const ref = useRef<PlainTextEditorHandle | null>(null)
    ref.current = null as unknown as PlainTextEditorHandle | null
    return createElement(PlainTextEditor, {
      ref: (node: PlainTextEditorHandle | null) => {
        handle = node
      },
      initialText,
      mode,
      onChange,
      spellcheck: false,
    })
  }
  act(() => root.render(createElement(Harness)))
  const cm = container.querySelector('.cm-editor')
  expect(cm, 'CodeMirror mounted').not.toBeNull()
  const view = EditorView.findFromDOM(cm as HTMLElement)
  expect(view, 'view reachable from the DOM').not.toBeNull()
  return {
    view: view!,
    handle: () => handle,
    unmount: () =>
      act(() => {
        root.unmount()
        container.remove()
      }),
  }
}

describe('the raw source pane editor (PlainTextEditor)', () => {
  it('a user edit reports the full document text', () => {
    const seen: string[] = []
    const { view, unmount } = mount('{"a": 1}', 'json', (t) => seen.push(t))
    act(() => {
      view.dispatch({ changes: { from: 6, to: 6, insert: '2' } })
    })
    expect(seen).toEqual(['{"a": 21}'])
    unmount()
  })

  it('setDoc swaps the buffer without reporting an edit or an undo step', () => {
    const seen: string[] = []
    const { view, handle, unmount } = mount('one', 'plain', (t) => seen.push(t))
    act(() => {
      handle()?.setDoc('two')
    })
    expect(seen).toHaveLength(0)
    expect(handle()?.canUndo()).toBe(false)
    // an edit after the swap is reported against the swapped buffer
    act(() => {
      view.dispatch({ changes: { from: 0, to: 0, insert: 'X' } })
    })
    expect(seen).toEqual(['Xtwo'])
    unmount()
  })

  it('the undo/redo handles drive the editor history', () => {
    const { view, handle, unmount } = mount('a', 'plain')
    act(() => {
      view.dispatch({ changes: { from: 0, to: 0, insert: 'b' } })
    })
    expect(handle()?.canUndo()).toBe(true)
    act(() => {
      handle()?.undo()
    })
    expect(view.state.doc.toString()).toBe('a')
    act(() => {
      handle()?.redo()
    })
    expect(view.state.doc.toString()).toBe('ba')
    unmount()
  })

  it('a giant document mounts without the JSON grammar and still edits', () => {
    const seen: string[] = []
    // above the highlight gate the parse would dominate the open; the editor
    // itself must stay incremental and functional at this size
    const giant = `{"k": "${'x'.repeat(2_500_000)}"}`
    const { view, unmount } = mount(giant, 'json', (t) => seen.push(t))
    act(() => {
      view.dispatch({ changes: { from: giant.length - 2, to: giant.length - 2, insert: '!' } })
    })
    expect(seen).toHaveLength(1)
    expect(seen[0].endsWith('!"}')).toBe(true)
    unmount()
  })
})
