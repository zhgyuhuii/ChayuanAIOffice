import type { ReactElement } from 'react'
import { useRef, useState } from 'react'
import { useDismissablePopover } from '@chatoffice/ui'
import { useI18n } from './i18n/locale'
import { MenuRows, OptSample, type MenuRowOption } from './ExcelShell'
import { CaretIcon } from './ribbon-icons'

/**
 * WPS 数字组·转换⌄（对比清单 1）：触发器 = 图标 + 「转换」 + 右下角下拉箭头
 * （与行和列/工作表菜单同款）；下拉 = 行和列同构 MenuRows 富菜单——无滚动条，
 * 大小写转换 / 中英文符号转换点击向右展开子菜单，未实现项仅禁用。
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
  const item = (key: string, command: string | null, icon: React.ReactNode, label: string): MenuRowOption => ({
    value: key,
    label,
    icon,
    ...(command ? {} : { disabled: true as const }),
  })
  const group = (key: string, label: string, children: readonly MenuRowOption[]): MenuRowOption => ({
    value: key,
    label,
    children,
  })
  const options: readonly MenuRowOption[] = [
    item('num2text', 'convert:num2text', <OptSample>12</OptSample>, tt('appCvtNumToText')),
    item('text2num', 'convert:text2num', <OptSample>📷</OptSample>, tt('appCvtTextToNum')),
    item('link', null, <OptSample>🔗</OptSample>, tt('appCvtToHyperlink')),
    item('values-only', 'convert:values-only', <OptSample>123</OptSample>, tt('appCvtValuesOnly')),
    item('text2formula', 'convert:text2formula', <OptSample>fx</OptSample>, tt('appCvtTextToFormula')),
    item('formula2text', 'convert:formula2text', <OptSample>ƒx</OptSample>, tt('appCvtFormulaToText')),
    item('round', null, <OptSample>4⇢</OptSample>, tt('appCvtRound')),
    group(
      'case',
      tt('appCvtCase'),
      [
        item('up', 'convert:upper', <OptSample>Aa</OptSample>, tt('appCvtUpper')),
        item('low', 'convert:lower', <OptSample>aa</OptSample>, tt('appCvtLower')),
        item('cap', 'convert:capitalize', <OptSample>Aa</OptSample>, tt('appCvtCapitalize')),
      ],
    ),
    group(
      'symbols',
      tt('appCvtSymbols'),
      [
        item('en', 'convert:to-en-symbols', <OptSample>,.</OptSample>, tt('appCvtToEn')),
        item('cn', 'convert:to-cn-symbols', <OptSample>，。</OptSample>, tt('appCvtToCn')),
      ],
    ),
    item('subsup', null, <OptSample>X²</OptSample>, `${tt('appCvtSubSup')}…`),
  ]
  return (
    <div ref={wrapRef} className="menu-select">
      <button
        type="button"
        className="select-like compact convert-trigger"
        data-tip={tip}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('appConvertMenu')}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="menu-select-value">
          {/* WPS 转换图标：上下两条弯曲箭头合成方形——上线右→左行进、左端
              向下弯出箭头；下线左→右行进、右端向上弯出箭头 */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            width={18}
            height={18}
            aria-hidden="true"
          >
            <path d="M18.5 5.5H7.5v3.5" />
            <path d="M9.25 7.25 7.5 9.25 5.75 7.25" />
            <path d="M5.5 18.5h11V15" />
            <path d="M14.75 16.75 16.5 14.75l1.75 2" />
          </svg>
          {t('appConvertShort')}
        </span>
        <CaretIcon />
      </button>
      {open && (
        <div className="menu-select-drop convert-drop" role="menu" aria-label={t('appConvertMenu')}>
          <MenuRows options={options} value="" onPick={pick} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
