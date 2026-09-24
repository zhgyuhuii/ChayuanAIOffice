import { useState } from 'react'

import { useI18n } from './i18n/locale'

/// WPS 选择性粘贴: the paste variants the sheet engine supports, as a radio
/// list (运算/跳过空格 are not offered — the engine has no such paste hooks).
export type PasteSpecialVariant =
  'all' | 'formula' | 'value' | 'format' | 'besides-border' | 'col-width' | 'transpose' | 'text'

export function PasteSpecialDialog({
  onApply,
  onClose,
}: {
  /// Applies the chosen variant (the caller maps it to a sheet command).
  readonly onApply: (variant: PasteSpecialVariant) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [variant, setVariant] = useState<PasteSpecialVariant>('all')
  const options: readonly { readonly key: PasteSpecialVariant; readonly label: string }[] = [
    { key: 'all', label: t('appPasteAll') },
    { key: 'formula', label: t('appPasteFormulasOnly') },
    { key: 'value', label: t('appPasteValuesOnly') },
    { key: 'format', label: t('appPasteFormattingOnly') },
    { key: 'besides-border', label: t('appPasteExceptBorders') },
    { key: 'col-width', label: t('appPasteColWidths') },
    { key: 'transpose', label: t('appPasteTranspose') },
    { key: 'text', label: t('appPasteTextOnly') },
  ]
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="format-cells-dialog paste-special-dialog"
        role="dialog"
        aria-label={t('appPasteSpecial')}
        onClick={(event) => event.stopPropagation()}
      >
        <header>{t('appPasteSpecial')}</header>
        <section className="dialog-body">
          <div
            className="paste-special-options"
            role="radiogroup"
            aria-label={t('appPasteSpecial')}
          >
            {options.map((option) => (
              <label key={option.key} className="paste-special-option">
                <input
                  type="radio"
                  name="paste-special-variant"
                  checked={variant === option.key}
                  onChange={() => setVariant(option.key)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </section>
        <div className="dialog-actions">
          <button className="secondary" onClick={onClose}>
            {t('dlgCancel')}
          </button>
          <button className="primary-action" onClick={() => onApply(variant)}>
            {t('dlgOk')}
          </button>
        </div>
      </div>
    </div>
  )
}
