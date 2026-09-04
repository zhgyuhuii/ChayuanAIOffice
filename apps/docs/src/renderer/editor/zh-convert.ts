import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import OpenCC from 'opencc-js'

export type ZhConvertDir = 's2t' | 't2s'

// dictionaries are constructed lazily and cached: each Converter builds its
// table once (~ms) and the same direction is reused across invocations
const converters = new Map<ZhConvertDir, ((input: string) => string) | null>()

function converterFor(dir: ZhConvertDir): (input: string) => string {
  let conv = converters.get(dir)
  if (conv === undefined) {
    try {
      conv =
        dir === 's2t'
          ? OpenCC.Converter({ from: 'cn', to: 'tw' })
          : OpenCC.Converter({ from: 'tw', to: 'cn' })
    } catch {
      conv = null
    }
    converters.set(dir, conv)
  }
  // conversion unavailable (broken bundle): identity keeps the edit a no-op
  return conv ?? ((input: string) => input)
}

/** rewrite every text run in the selection, keeping its marks (same skeleton as applyCase) */
export function applyZhConvert(editor: Editor, dir: ZhConvertDir): boolean {
  const { from, to } = editor.state.selection
  if (from === to) return false
  const convert = converterFor(dir)
  return editor
    .chain()
    .focus()
    .command(({ state, tr }) => {
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText || !node.text) return
        const start = Math.max(from, pos)
        const end = Math.min(to, pos + node.nodeSize)
        const slice = node.text.slice(start - pos, end - pos)
        const next = convert(slice)
        if (next !== slice) {
          tr.replaceWith(
            tr.mapping.map(start),
            tr.mapping.map(end),
            state.schema.text(next, node.marks),
          )
        }
      })
      // keep the selection spanning the converted text (length may change:
      // 里→裡 are 1:1 but vocabulary pairs like 软件→軟體 stay 1:1 too; keep the
      // same restore rule as applyCase for safety)
      if (tr.docChanged) {
        const grew = tr.doc.content.size - state.doc.content.size
        tr.setSelection(TextSelection.create(tr.doc, from, to + grew))
      }
      return tr.docChanged
    })
    .run()
}
