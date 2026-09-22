// 表单内容 dialog — lists every underline-blank form field (label + current
// value), quick-fill writes back into the blanks; double-click a row to jump
// the caret there. 表单模式 itself is a ribbon toggle (docops/form-mode.ts).
import { useMemo, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useI18n } from '../../i18n/locale'
import { DocOpsModal, DocOpsNotice } from './DocOpsModal'
import { fillFormFields, focusField, scanFormFields, type FormField } from '../form-mode'

export function FormContentDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const { t } = useI18n()
  const fields = useMemo(() => scanFormFields(editor.state.doc), [editor])
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [done, setDone] = useState<number | null>(null)

  const filled = Object.entries(drafts).filter(([, v]) => v.trim() !== '')
  const label = (field: FormField, index: number) =>
    field.label || t('docopsFormFieldN', { n: index + 1 })

  const apply = () => {
    const fills = Object.entries(drafts)
      .map(([i, value]) => ({ field: fields[Number(i)]!, value: value.trim() }))
      .filter((f) => f.field && f.value)
    const count = fillFormFields(editor, fills)
    setDone(count)
  }

  return (
    <DocOpsModal
      title={t('docopsFormContentTitle')}
      onClose={onClose}
      width={560}
      footer={
        done === null ? (
          <>
            <button className="btn-ghost" onClick={onClose}>
              {t('appClose')}
            </button>
            <button className="btn-primary" disabled={filled.length === 0} onClick={apply}>
              {t('docopsFormFill', { count: filled.length })}
            </button>
          </>
        ) : (
          <button className="btn-primary" onClick={onClose}>
            {t('appOk')}
          </button>
        )
      }
    >
      {fields.length === 0 ? (
        <DocOpsNotice kind="warn" text={t('docopsFormNoFields')} />
      ) : (
        <>
          <DocOpsNotice kind="info" text={t('docopsFormHint')} />
          <div className="docops-table-wrap docops-table-scroll">
            <table className="docops-table">
              <thead>
                <tr>
                  <th>{t('docopsFormFieldLabel')}</th>
                  <th>{t('docopsFormValue')}</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field, i) => (
                  <tr
                    key={field.from}
                    title={t('docopsFormJump')}
                    onDoubleClick={() => focusField(editor, field)}
                  >
                    <td>{label(field, i)}</td>
                    <td>
                      <input
                        value={drafts[i] ?? ''}
                        onChange={(e) => setDrafts({ ...drafts, [i]: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && e.currentTarget.blur()}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {done !== null && <DocOpsNotice kind="info" text={t('docopsFormFilled', { count: done })} />}
    </DocOpsModal>
  )
}
