// Style dialogs — 统计已使用的样式 (usage report with jump-to-first-use) and
// 清理未使用的样式 (checkbox cleanup; deletions ride SaveOptions.styleDeletes).
import { useMemo, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { StyleInfo } from '@chatoffice/docx-engine'
import { TextSelection } from '@tiptap/pm/state'
import { useI18n } from '../../i18n/locale'
import { DocOpsModal, DocOpsNotice } from './DocOpsModal'
import { computeStyleUsage, removableUnusedStyles } from '../text-ops'

/** select + scroll to the first block using a style */
function jumpToBlock(editor: Editor, blockIndex: number): void {
  const block = editor.state.doc.maybeChild(blockIndex)
  if (!block) return
  let offset = 0
  for (let i = 0; i < blockIndex; i++) offset += editor.state.doc.child(i)!.nodeSize
  const $pos = editor.state.doc.resolve(offset + 1)
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.near($pos)).scrollIntoView(),
  )
  editor.commands.focus()
}

export function StyleStatisticsDialog({
  editor,
  styles,
  onClose,
}: {
  editor: Editor
  styles: Map<string, StyleInfo>
  onClose: () => void
}) {
  const { t } = useI18n()
  const report = useMemo(() => computeStyleUsage(editor.state.doc, styles), [editor, styles])
  const rows = useMemo(
    () => [...report.used, ...report.unused.map((u) => ({ ...u, uses: 0 }))],
    [report],
  )
  return (
    <DocOpsModal
      title={t('docopsStyleStatsTitle')}
      onClose={onClose}
      width={540}
      footer={
        <button className="btn-primary" onClick={onClose}>
          {t('appClose')}
        </button>
      }
    >
      <DocOpsNotice
        kind="info"
        text={t('docopsStyleStatsSummary', {
          used: report.used.length,
          unused: report.unused.length,
        })}
      />
      <div className="docops-table-wrap">
        <table className="docops-table">
          <thead>
            <tr>
              <th>{t('docopsStyleName')}</th>
              <th>{t('docopsStyleType')}</th>
              <th>{t('docopsStyleUses')}</th>
              <th>{t('docopsStyleFirstUse')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.styleId}
                className={row.uses > 0 && row.firstUseBlock !== undefined ? 'docops-row-link' : undefined}
                onClick={() => {
                  if (row.uses > 0 && row.firstUseBlock !== undefined) jumpToBlock(editor, row.firstUseBlock)
                }}
              >
                <td title={row.styleId}>{row.name}</td>
                <td>
                  {row.type === 'paragraph'
                    ? t('docopsStyleTypePara')
                    : row.type === 'table'
                      ? t('docopsStyleTypeTable')
                      : t('docopsStyleTypeChar')}
                </td>
                <td>{row.uses}</td>
                <td>
                  {row.uses > 0 && row.firstUseBlock !== undefined
                    ? t('docopsStyleBlockN', { n: row.firstUseBlock + 1 })
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DocOpsModal>
  )
}

export function UnusedStylesDialog({
  editor,
  styles,
  onRemove,
  onClose,
}: {
  editor: Editor
  styles: Map<string, StyleInfo>
  /** hand the removed styleIds to the host (they ride the next save) */
  onRemove: (styleIds: string[]) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const report = useMemo(() => computeStyleUsage(editor.state.doc, styles), [editor, styles])
  const { removable, kept } = useMemo(() => removableUnusedStyles(report.unused), [report])
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(removable.filter((r) => r.visible).map((r) => r.styleId)),
  )
  const [done, setDone] = useState<number | null>(null)

  const allChecked = removable.filter((r) => r.visible).every((r) => checked.has(r.styleId))
  const toggleAll = () => {
    setChecked(
      allChecked
        ? new Set()
        : new Set(removable.filter((r) => r.visible).map((r) => r.styleId)),
    )
  }
  const clean = () => {
    const ids = [...checked]
    // live registry drop: the style pickers/gallery stop offering them
    for (const id of ids) styles.delete(id)
    onRemove(ids)
    setDone(ids.length)
  }

  if (done !== null) {
    return (
      <DocOpsModal title={t('docopsCleanStylesTitle')} onClose={onClose} width={460}
        footer={<button className="btn-primary" onClick={onClose}>{t('appOk')}</button>}>
        <DocOpsNotice kind="info" text={t('docopsStylesRemoved', { count: done })} />
      </DocOpsModal>
    )
  }

  return (
    <DocOpsModal
      title={t('docopsCleanStylesTitle')}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            {t('appCancel')}
          </button>
          <button className="btn-primary" disabled={checked.size === 0} onClick={clean}>
            {t('docopsCleanSelected', { count: checked.size })}
          </button>
        </>
      }
    >
      {removable.length === 0 ? (
        <DocOpsNotice kind="info" text={t('docopsNoUnusedStyles')} />
      ) : (
        <>
          <DocOpsNotice kind="warn" text={t('docopsCleanStylesHint')} />
          <div className="docops-check-row">
            <label>
              <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              {t('docopsSelectAll')}
            </label>
          </div>
          <div className="docops-table-wrap docops-table-scroll">
            <table className="docops-table">
              <tbody>
                {removable.map((row) => (
                  <tr key={row.styleId}>
                    <td>
                      <label>
                        <input
                          type="checkbox"
                          disabled={!row.visible}
                          checked={checked.has(row.styleId)}
                          onChange={() => {
                            const next = new Set(checked)
                            if (next.has(row.styleId)) next.delete(row.styleId)
                            else next.add(row.styleId)
                            setChecked(next)
                          }}
                        />{' '}
                        {row.name}
                      </label>
                    </td>
                    <td>
                      {row.type === 'paragraph'
                        ? t('docopsStyleTypePara')
                        : row.type === 'table'
                          ? t('docopsStyleTypeTable')
                          : t('docopsStyleTypeChar')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {kept.length > 0 && (
            <DocOpsNotice kind="info" text={t('docopsStylesKept', { count: kept.length })} />
          )}
        </>
      )}
    </DocOpsModal>
  )
}
