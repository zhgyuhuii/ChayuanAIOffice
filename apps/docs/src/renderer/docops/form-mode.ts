// form-mode — 表单模式 / 表单内容, the chayuan-wps 辅助填写 family adapted to
// this editor (docs/chayuan-wps-harvest-analysis.md §7). The wps version wraps
// bookmarks in content controls and protects the document (wdAllowOnlyFormFields);
// this editor has neither, so the adaptation anchors on what documents actually
// contain: underline blanks (___ / ＿＿＿ runs) are the form fields. 表单模式
// restricts edits to the blanks via a transaction filter; 表单内容 lists the
// blanks with their labels for quick in-dialog filling.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** ≥3 consecutive underscore-family characters make a fillable blank */
const BLANK_RE = /[＿_{]{3,}/g

export interface FormField {
  /** absolute range of the blank in the document */
  from: number
  to: number
  /** label text before the blank (trailing ：: removed), may be empty */
  label: string
  /** text currently inside the blank */
  value: string
}

/** scan every text node for blank runs; labels come from the paragraph's preceding text */
export function scanFormFields(doc: PmNode): FormField[] {
  const fields: FormField[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'text' || !node.text) return true
    const text = node.text
    let m: RegExpExecArray | null
    BLANK_RE.lastIndex = 0
    while ((m = BLANK_RE.exec(text)) !== null) {
      const from = pos + m.index
      const to = from + m[0].length
      // the label: text between this blank and the previous blank/paragraph start
      const $from = doc.resolve(from)
      const paraFrom = $from.start()
      const before = doc.textBetween(paraFrom, from, null, ' ')
      const prevBlank = before.lastIndexOf('_')
      const prevBlank2 = before.lastIndexOf('＿')
      const cut = Math.max(prevBlank, prevBlank2)
      const label = (cut >= 0 ? before.slice(cut + 1) : before)
        .replace(/[：:\s]+$/u, '')
        .replace(/^[（(【[]/, '')
        .replace(/[）)】]$/, '')
        .trim()
      fields.push({ from, to, label, value: m[0] })
    }
    return true
  })
  fields.sort((a, b) => a.from - b.from)
  return fields
}

// ---- form mode state --------------------------------------------------------

const FORM_MODE_KEY = new PluginKey<boolean>('docopsFormMode')
/** module-level mirror so the ribbon toggle reads it without an editor round-trip */
let formModeActive = false

export function isFormModeActive(): boolean {
  return formModeActive
}

export const FormModeExtension = Extension.create({
  name: 'docopsFormMode',
  addProseMirrorPlugins() {
    return [
      new Plugin<boolean>({
        key: FORM_MODE_KEY,
        state: {
          init: () => false,
          apply: (tr, prev) => tr.getMeta(FORM_MODE_KEY) ?? prev,
        },
        props: {
          decorations(state) {
            if (!FORM_MODE_KEY.getState(state)) return DecorationSet.empty
            const fields = scanFormFields(state.doc)
            return DecorationSet.create(
              state.doc,
              fields.map((f) =>
                Decoration.inline(f.from, f.to, { class: 'docops-form-field' }),
              ),
            )
          },
        },
        filterTransaction: (tr: Transaction) => {
          // plugin state lives on EditorState (unreachable from a tr); the
          // module flag is the same truth setFormMode writes
          if (!formModeActive) return true
          if (tr.getMeta('docopsFormModeBypass')) return true
          if (!tr.docChanged) return true
          // allow only edits whose replaced ranges fall inside a blank
          const fields = scanFormFields(tr.before)
          if (fields.length === 0) return true
          for (const step of tr.steps) {
            for (const [from, to] of stepRanges(step)) {
              const inside = fields.some((f) => from >= f.from && to <= f.to)
              if (!inside) return false
            }
          }
          return true
        },
      }),
    ]
  },
})

/** extract the [from,to] replaced ranges of a Replace/ReplaceAround step */
function stepRanges(step: unknown): Array<[number, number]> {
  const s = step as { from?: number; to?: number; gapFrom?: number; gapTo?: number }
  if (typeof s.from === 'number' && typeof s.to === 'number') {
    return [[s.from, s.to]]
  }
  return []
}

/** 表单模式 toggle: restricts editing to the blanks (fields highlight while on) */
export function setFormMode(editor: Editor, on: boolean): boolean {
  formModeActive = on
  const tr = editor.state.tr.setMeta(FORM_MODE_KEY, on)
  if (on) tr.setMeta('docopsFormModeBypass', true)
  editor.view.dispatch(tr)
  return on
}

/** 表单内容 write-back: replace blanks with filled values (descending), bypassing the filter */
export function fillFormFields(
  editor: Editor,
  fills: Array<{ field: FormField; value: string }>,
): number {
  const ordered = [...fills].sort((a, b) => b.field.from - a.field.from)
  let tr = editor.state.tr.setMeta('docopsFormModeBypass', true)
  for (const { field, value } of ordered) {
    if (!value) continue
    const from = tr.mapping.map(field.from)
    const to = tr.mapping.map(field.to)
    tr = tr.replaceWith(from, to, editor.state.schema.text(value))
  }
  if (tr.docChanged) editor.view.dispatch(tr)
  return fills.filter((f) => f.value).length
}

/** jump the caret into a field (dialog 定位) */
export function focusField(editor: Editor, field: FormField): void {
  const $pos = editor.state.doc.resolve(field.from)
  editor.view.dispatch(
    editor.state.tr
      .setMeta('docopsFormModeBypass', true)
      .setSelection(TextSelection.near($pos))
      .scrollIntoView(),
  )
  editor.commands.focus()
}
