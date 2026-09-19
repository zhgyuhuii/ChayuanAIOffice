import type { ReactElement } from 'react'
import { useRef, useState } from 'react'
import { useDismissablePopover } from '@chatoffice/ui'
import { useI18n } from './i18n/locale'
import { MenuRows, OptSample, type MenuRowOption } from './ExcelShell'
import { CaretIcon } from './ribbon-icons'

/**
 * WPS 数字组·转换⌄，严格对照 WPS 表格实测截图（2026-09-18 本机 WPS 采集）：
 * 触发器 = 直向双向箭头⇄ + 「转换」 + ⌄，无边框透明底、与格式框同行等高；
 * 下拉 = 主段六项（转换为数值/转换为文本/转为日期/转为大写/转为中文大写/
 * 转为分数）+ 分隔线 + 三个子菜单（大小写转换/中英文符号/上下标）+ 分隔线
 * + 自定义转换…（未实现项仅禁用）。
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
  // MenuRows dispatches option.value — so the value IS the wire command
  // (dispatching the key id was a silent no-op the app handler ignores).
  // Disabled items keep the key as an inert value.
  const item = (key: string, command: string | null, icon: React.ReactNode, label: string): MenuRowOption => ({
    value: command ?? key,
    label,
    icon,
    ...(command ? {} : { disabled: true as const }),
  })
  const group = (key: string, label: string, children: readonly MenuRowOption[]): MenuRowOption => ({
    value: key,
    label,
    children,
  })
  /// WPS 主段：数值/文本/日期/大写/中文大写/分数
  const mainOptions: readonly MenuRowOption[] = [
    item('to-value', 'convert:text2num', <OptSample>123</OptSample>, tt('appCvtToValue')),
    item('to-text', 'convert:num2text', <OptSample>A</OptSample>, tt('appCvtToText')),
    item('to-date', 'convert:to-date', <OptSample>1/5</OptSample>, tt('appCvtToDate')),
    item('to-upper', 'convert:upper', <OptSample>A</OptSample>, tt('appCvtToUpper')),
    item('to-cn-upper', 'convert:to-cn-upper', <OptSample>壹</OptSample>, tt('appCvtToCnUpper')),
    item('to-fraction', 'convert:to-fraction', <OptSample>1/2</OptSample>, tt('appCvtToFraction')),
  ]
  /// WPS 子菜单段：大小写 / 中英文符号 / 上下标
  const groupOptions: readonly MenuRowOption[] = [
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
    group(
      'subsup',
      tt('appCvtSubSupHead'),
      [
        item('sup', null, <OptSample>X²</OptSample>, tt('appCvtSup')),
        item('sub', null, <OptSample>X₂</OptSample>, tt('appCvtSub')),
      ],
    ),
  ]
  const footerOptions: readonly MenuRowOption[] = [
    item('custom', null, <OptSample>⚙</OptSample>, `${tt('appCvtCustom')}…`),
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
          {/* WPS 转换图标：直向双向箭头 ⇄——上右行/下左行两条细线箭头 */}
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
            <path d="M4.5 8.75h13.5" />
            <path d="m15.75 6.5 2.25 2.25-2.25 2.25" />
            <path d="M19.5 15.25H6" />
            <path d="M8.25 13 6 15.25 8.25 17.5" />
          </svg>
          {t('appConvertShort')}
        </span>
        <CaretIcon />
      </button>
      {open && (
        <div className="menu-select-drop convert-drop" role="menu" aria-label={t('appConvertMenu')}>
          <MenuRows options={mainOptions} value="" onPick={pick} onClose={() => setOpen(false)} />
          <div className="rb-menu-sep" />
          <MenuRows options={groupOptions} value="" onPick={pick} onClose={() => setOpen(false)} />
          <div className="rb-menu-sep" />
          <MenuRows options={footerOptions} value="" onPick={pick} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
