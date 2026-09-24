import type { Editor } from '@tiptap/core'
import { pinyin } from 'pinyin-pro'

/** Valid <w:ruby> fragment (without the enclosing w:r; generate re-wraps it verbatim). */
function buildRubyXml(base: string, rt: string): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return (
    '<w:ruby>' +
    '<w:rubyPr><w:rubyAlign w:val="center"/><w:rubyH2S w:val="none"/></w:rubyPr>' +
    '<w:rt><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">' +
    esc(rt) +
    '</w:t></w:r></w:rt>' +
    '<w:rubyBase><w:r><w:t xml:space="preserve">' +
    esc(base) +
    '</w:t></w:r></w:rubyBase>' +
    '</w:ruby>'
  )
}

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/

/**
 * WPS 拼音指南: replace the selected CJK text with per-character phonetic-guide
 * nodes (native <ruby> rendering; the exact <w:ruby> XML saves verbatim).
 * Non-CJK characters in the selection stay as plain text runs.
 */
export function applyPhoneticGuide(editor: Editor): boolean {
  const { from, to } = editor.state.selection
  if (from === to) return false
  const text = editor.state.doc.textBetween(from, to, '\n', '\n')
  if (!CJK_RE.test(text)) return false

  const readings = pinyin(text, { type: 'array', toneType: 'symbol' })
  const nodes: Array<
    ReturnType<typeof editor.schema.nodes.docRuby.create> | ReturnType<typeof editor.schema.text>
  > = []
  let idx = 0
  for (const ch of text) {
    const rt = readings[idx++] ?? ''
    if (ch === '\n' || !CJK_RE.test(ch)) {
      nodes.push(editor.schema.text(ch))
    } else {
      nodes.push(
        editor.schema.nodes.docRuby.create({
          base: ch,
          rt,
          xml: buildRubyXml(ch, rt),
        }),
      )
    }
  }
  return editor
    .chain()
    .focus()
    .command(({ tr, dispatch }) => {
      if (dispatch) tr.replaceWith(from, to, nodes)
      return true
    })
    .run()
}

/** 清除拼音: strip every docRuby in the selection back to its base characters. */
export function clearPhoneticGuide(editor: Editor): boolean {
  const { from, to } = editor.state.selection
  const hasRuby = (() => {
    let found = false
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.type.name === 'docRuby') found = true
    })
    return found
  })()
  if (!hasRuby) return false
  return editor
    .chain()
    .focus()
    .command(({ state, tr }) => {
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== 'docRuby') return
        const end = Math.min(pos + node.nodeSize, to)
        tr.replaceWith(
          tr.mapping.map(Math.max(from, pos)),
          tr.mapping.map(end),
          state.schema.text(String(node.attrs.base ?? '')),
        )
      })
      return true
    })
    .run()
}
