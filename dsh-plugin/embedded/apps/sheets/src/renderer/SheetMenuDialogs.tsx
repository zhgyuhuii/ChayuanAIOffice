import { useState } from 'react'

import { useI18n } from './i18n/locale'

/// 移动或复制工作表（WPS 对齐）：目标位置（每张表之前 / 移至最后）+
/// 建立副本。提交 move-to-index 命令，copy 标志由命令层处理。
export function MoveCopySheetDialog({
  sheets,
  activeIndex,
  onApply,
  onClose,
}: {
  /// 当前全部工作表名（按顺序）
  readonly sheets: readonly string[]
  /// 活动表当前下标
  readonly activeIndex: number
  readonly onApply: (targetIndex: number, copy: boolean) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  // 默认移到最后；「移至最前」= 0，每张表之前 = 该表当前下标
  const [position, setPosition] = useState(sheets.length)
  const [copy, setCopy] = useState(false)
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="format-cells-dialog paste-special-dialog"
        role="dialog"
        aria-label={t('appSheetMoveOrCopy')}
        onClick={(event) => event.stopPropagation()}
      >
        <header>{t('appSheetMoveOrCopy')}</header>
        <section className="dialog-body">
          <div className="paste-special-options" role="radiogroup">
            <label className="paste-special-option">
              <input
                type="radio"
                name="move-copy-pos"
                checked={position === 0}
                onChange={() => setPosition(0)}
              />
              <span>{t('dlgMoveCopyBefore')}</span>
            </label>
            {sheets.map((name, index) =>
              index === activeIndex ? null : (
                <label key={`${name}-${index}`} className="paste-special-option">
                  <input
                    type="radio"
                    name="move-copy-pos"
                    checked={position === index}
                    onChange={() => setPosition(index)}
                  />
                  <span>
                    {t('dlgMoveCopyBefore')} · {name}
                  </span>
                </label>
              ),
            )}
            <label className="paste-special-option">
              <input
                type="radio"
                name="move-copy-pos"
                checked={position === sheets.length}
                onChange={() => setPosition(sheets.length)}
              />
              <span>{t('dlgMoveCopyToEnd')}</span>
            </label>
          </div>
          <label className="paste-special-option">
            <input
              type="checkbox"
              checked={copy}
              onChange={(event) => setCopy(event.target.checked)}
            />
            <span>{t('dlgMoveCopyCopy')}</span>
          </label>
        </section>
        <div className="dialog-actions">
          <button className="secondary" onClick={onClose}>
            {t('dlgCancel')}
          </button>
          <button className="primary-action" onClick={() => onApply(position, copy)}>
            {t('dlgOk')}
          </button>
        </div>
      </div>
    </div>
  )
}

/// 批量改名（WPS 对齐）：查找替换 + 前缀后缀，作用于全部工作表。
export function BatchRenameSheetDialog({
  onApply,
  onClose,
}: {
  readonly onApply: (find: string, replace: string, prefix: string, suffix: string) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [prefix, setPrefix] = useState('')
  const [suffix, setSuffix] = useState('')
  const filled = find.trim() !== '' || prefix.trim() !== '' || suffix.trim() !== ''
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="format-cells-dialog link-dialog"
        role="dialog"
        aria-label={t('appSheetBatchRename')}
        onClick={(event) => event.stopPropagation()}
      >
        <header>{t('appSheetBatchRename')}</header>
        <div className="dialog-body">
          <label>
            {t('dlgBatchFind')}
            <input autoFocus value={find} onChange={(event) => setFind(event.target.value)} />
          </label>
          <label>
            {t('dlgBatchReplace')}
            <input value={replace} onChange={(event) => setReplace(event.target.value)} />
          </label>
          <label>
            {t('dlgBatchPrefix')}
            <input value={prefix} onChange={(event) => setPrefix(event.target.value)} />
          </label>
          <label>
            {t('dlgBatchSuffix')}
            <input value={suffix} onChange={(event) => setSuffix(event.target.value)} />
          </label>
        </div>
        <footer className="dialog-actions">
          <button onClick={onClose}>{t('appCancel')}</button>
          <button
            className="primary"
            disabled={!filled}
            onClick={() => onApply(find, replace, prefix, suffix)}
          >
            {t('appOk')}
          </button>
        </footer>
      </div>
    </div>
  )
}
