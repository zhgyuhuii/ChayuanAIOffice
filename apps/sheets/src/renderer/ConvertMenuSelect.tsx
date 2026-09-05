import type { ReactElement, ReactNode } from 'react'
import { useRef, useState } from 'react'
import { useDismissablePopover } from '@chatoffice/ui'
import { useI18n } from './i18n/locale'
import { OptSample } from './ExcelShell'
import { CaretIcon } from './ribbon-icons'

/**
 * WPS 数字组·转换⌄（CT_Home.kuip typetransform + 用户截图）：图标+转换+caret
 * 触发器；下拉 = 截图全 10 项（VIP 徽标禁用、大小写/中英符号点击展开子项）。
 */
export function ConvertMenuSelect({
  'data-tip': tip,
  onCommand,
}: {
  readonly 'data-tip'?: string
  readonly onCommand: (command: string) => void
}): ReactElement {
  const { t } = useI18n()
  // keys live in strings-app (not ribbon StringKey union); cast to keep the menu self-contained
  const tt = t as unknown as (k: string) => string
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })
  const pick = (command: string): void => {
    setOpen(false)
    onCommand(command)
  }
  const item = (
    key: string,
    command: string | null,
    icon: ReactNode,
    vip: boolean,
    label: string,
  ): ReactElement => (
    <button
      type="button"
      key={key}
      className={command ? 'cv-item' : 'cv-item disabled'}
      disabled={!command}
      onClick={() => command && pick(command)}
    >
      <span className="cv-icon">{icon}</span>
      <span className="cv-label">{label}</span>
      {vip && <span className="cv-vip">VIP</span>}
    </button>
  )
  const groupRow = (key: string, label: string, items: React.ReactNode): ReactElement => (
    <div key={key} className="cv-group">
      <button
        type="button"
        className="cv-item cv-group-row"
        onClick={(e) => {
          const el = e.currentTarget.nextElementSibling as HTMLElement | null
          if (el) el.style.display = el.style.display === 'none' ? '' : 'none'
        }}
      >
        <span className="cv-icon">⤷</span>
        <span className="cv-label">{label}</span>
        <span className="cv-arrow">›</span>
      </button>
      <div className="cv-sub">{items}</div>
    </div>
  )
  return (
    <div ref={wrapRef} className="menu-select">
      <button
        type="button"
        className="select-like compact"
        data-tip={tip}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tool-symbol" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            width={20}
            height={20}
            aria-hidden="true"
          >
            <path d="M6 8.5h10.5l-2.8-2.8M18 15.5H7.5l2.8 2.8" />
          </svg>
        </span>
        <span className="menu-select-value">{t('appConvertMenu')}</span>
        <CaretIcon />
      </button>
      {open && (
        <div className="menu-select-drop convert-drop" role="menu" aria-label={t('appConvertMenu')}>
          {item(
            'num2text',
            'convert:num2text',
            <OptSample>12</OptSample>,
            false,
            tt('appCvtNumToText'),
          )}
          {item(
            'text2num',
            'convert:text2num',
            <OptSample>📷</OptSample>,
            false,
            tt('appCvtTextToNum'),
          )}
          {item('link', null, <OptSample>🔗</OptSample>, false, tt('appCvtToHyperlink'))}
          <div className="cv-sep" />
          {item(
            'values-only',
            'convert:values-only',
            <OptSample>123</OptSample>,
            true,
            tt('appCvtValuesOnly'),
          )}
          {item(
            'text2formula',
            'convert:text2formula',
            <OptSample>fx</OptSample>,
            true,
            tt('appCvtTextToFormula'),
          )}
          {item(
            'formula2text',
            'convert:formula2text',
            <OptSample>ƒx</OptSample>,
            true,
            tt('appCvtFormulaToText'),
          )}
          {item('round', null, <OptSample>4⇢</OptSample>, true, tt('appCvtRound'))}
          {groupRow(
            'case',
            tt('appCvtCase'),
            <>
              {item('up', 'convert:upper', <OptSample>Aa</OptSample>, false, tt('appCvtUpper'))}
              {item('low', 'convert:lower', <OptSample>aa</OptSample>, false, tt('appCvtLower'))}
              {item(
                'cap',
                'convert:capitalize',
                <OptSample>Aa</OptSample>,
                false,
                tt('appCvtCapitalize'),
              )}
            </>,
          )}
          {groupRow(
            'symbols',
            tt('appCvtSymbols'),
            <>
              {item(
                'en',
                'convert:to-en-symbols',
                <OptSample>,.</OptSample>,
                false,
                tt('appCvtToEn'),
              )}
              {item(
                'cn',
                'convert:to-cn-symbols',
                <OptSample>，。</OptSample>,
                false,
                tt('appCvtToCn'),
              )}
            </>,
          )}
          {item('subsup', null, <OptSample>X²</OptSample>, true, tt('appCvtSubSup') + '…')}
        </div>
      )}
    </div>
  )
}
