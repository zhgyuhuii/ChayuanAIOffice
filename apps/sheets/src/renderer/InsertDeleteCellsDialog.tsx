import { useState } from 'react'

import { useI18n } from './i18n/locale'

export type CellsShiftKind =
  'insert-right' | 'insert-down' | 'delete-left' | 'delete-up' | 'entire-row' | 'entire-col'

const INSERT_OPTIONS: readonly { readonly kind: CellsShiftKind; readonly labelKey: string }[] = [
  { kind: 'insert-down', labelKey: 'dlgShiftDown' },
  { kind: 'insert-right', labelKey: 'dlgShiftRight' },
  { kind: 'entire-row', labelKey: 'dlgEntireRow' },
  { kind: 'entire-col', labelKey: 'dlgEntireCol' },
]

const DELETE_OPTIONS: readonly { readonly kind: CellsShiftKind; readonly labelKey: string }[] = [
  { kind: 'delete-left', labelKey: 'dlgShiftLeft' },
  { kind: 'delete-up', labelKey: 'dlgShiftUp' },
  { kind: 'entire-row', labelKey: 'dlgEntireRow' },
  { kind: 'entire-col', labelKey: 'dlgEntireCol' },
]

/// 插入/删除单元格弹窗（行和列⌄ 子菜单首项）：四个移位方向单选，
/// 确定后映射为 sheet 命令（整行/整列即插删行/列）。
export function InsertDeleteCellsDialog({
  mode,
  onCommand,
  onClose,
}: {
  readonly mode: 'insert' | 'delete'
  readonly onCommand: (command: string) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const tt = t as unknown as (key: string) => string
  const [kind, setKind] = useState<CellsShiftKind>(
    mode === 'insert' ? 'insert-down' : 'delete-left',
  )
  const options = mode === 'insert' ? INSERT_OPTIONS : DELETE_OPTIONS
  const apply = (): void => {
    onCommand(`cells:${kind}`)
    onClose()
  }
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="format-cells-dialog paste-special-dialog"
        role="dialog"
        aria-label={tt(mode === 'insert' ? 'appRowcolInsertCells' : 'appRowcolDeleteCells')}
        onClick={(event) => event.stopPropagation()}
      >
        <header>{tt(mode === 'insert' ? 'appRowcolInsertCells' : 'appRowcolDeleteCells')}</header>
        <section className="dialog-body">
          <div className="paste-special-options" role="radiogroup">
            {options.map((option) => (
              <label key={option.kind} className="paste-special-option">
                <input
                  type="radio"
                  name={`cells-shift-${mode}`}
                  checked={kind === option.kind}
                  onChange={() => setKind(option.kind)}
                />
                <span>{tt(option.labelKey)}</span>
              </label>
            ))}
          </div>
        </section>
        <div className="dialog-actions">
          <button className="secondary" onClick={onClose}>
            {t('dlgCancel')}
          </button>
          <button className="primary-action" onClick={apply}>
            {t('dlgOk')}
          </button>
        </div>
      </div>
    </div>
  )
}
