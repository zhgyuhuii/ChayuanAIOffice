import { useState } from 'react'

import { Dropdown } from '@chatoffice/ui'

import { ColorPicker } from '@chatoffice/ui'

import { useI18n, type StringKey } from './i18n/locale'
import { formatFillDate } from './fill-tools'
import type { CellFormatPatch } from '@chatoffice/xlsx-gateway/domain/workbook-dsl'
import { saveCustomCellStyle, saveCustomTableStyle } from './custom-styles'
import { RangePickButton, useRangePickSession, type RangePickHandler } from './range-pick'
import type { SheetVisualRef } from './ribbon-actions'

/**
 * 数据处理组 / 样式组富菜单的配套小对话框（WPS 同名功能的最小闭环）：
 * 批量插入文本、序列、条件统计、突出显示单元格规则/项目选取规则、
 * 新建表格样式/数据透视表样式、新建单元格样式、选择窗格。
 */

/// dialog shell 与 ExcelShell 的 StandardColWidthDialog 同构（backdrop +
/// format-cells-dialog link-dialog 容器），单独抽出避免重复。
function DialogShell({
  title,
  children,
  onClose,
}: {
  readonly title: string
  readonly children: React.ReactNode
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="format-cells-dialog link-dialog"
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header>{title}</header>
        <div className="dialog-body">{children}</div>
        <footer className="dialog-actions">
          <button className="secondary" onClick={onClose}>
            {t('dlgCancel')}
          </button>
        </footer>
      </div>
    </div>
  )
}

function ActionButton({
  label,
  onClick,
}: {
  readonly label: string
  readonly onClick: () => void
}): React.JSX.Element {
  return (
    <button className="primary-action" onClick={onClick}>
      {label}
    </button>
  )
}

/** 批量插入文本到单元格：一段文本 + 落点（开头/中间/结尾）。 */
export function FillInsertTextDialog({
  where,
  onApply,
  onClose,
}: {
  readonly where: 'start' | 'mid' | 'end'
  readonly onApply: (text: string) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const title = t('appFillInsertText')
  const apply = (): void => {
    if (text === '') return
    onApply(text)
    onClose()
  }
  return (
    <DialogShell title={title} onClose={onClose}>
      <label>
        {t('appFillInsertDlgText')}
        <input
          autoFocus
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') apply()
            if (event.key === 'Escape') onClose()
          }}
        />
      </label>
      <p className="dialog-note">
        {where === 'start'
          ? t('appFillInsertDlgStartNote')
          : where === 'mid'
            ? t('appFillInsertDlgMidNote')
            : t('appFillInsertDlgEndNote')}
      </p>
      <ActionButton label={t('dlgOk')} onClick={apply} />
    </DialogShell>
  )
}

/** 序列：方向（向下/向右）+ 类型（等差/等比）+ 步长 + 终止值。 */
export function SeriesDialog({
  onApply,
  onClose,
}: {
  readonly onApply: (
    dir: 'down' | 'right',
    type: 'linear' | 'growth',
    step: number,
    stop: number | null,
  ) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [dir, setDir] = useState<'down' | 'right'>('down')
  const [type, setType] = useState<'linear' | 'growth'>('linear')
  const [step, setStep] = useState('1')
  const [stop, setStop] = useState('')
  const parsedStep = Number(step.trim().replace(',', '.'))
  const valid = step.trim() !== '' && Number.isFinite(parsedStep) && parsedStep !== 0
  const apply = (): void => {
    if (!valid) return
    const parsedStop = stop.trim() === '' ? null : Number(stop.trim().replace(',', '.'))
    onApply(
      dir,
      type,
      parsedStep,
      parsedStop !== null && Number.isFinite(parsedStop) ? parsedStop : null,
    )
    onClose()
  }
  return (
    <DialogShell title={t('appSeriesDlgTitle')} onClose={onClose}>
      <label>
        {t('appSeriesDlgDir')}
        <Dropdown
          ariaLabel={t('appSeriesDlgDir')}
          value={dir}
          options={[
            { value: 'down', label: t('appSeriesDlgDown') },
            { value: 'right', label: t('appSeriesDlgRight') },
          ]}
          onPick={(v) => setDir(v as 'down' | 'right')}
        />
      </label>
      <label>
        {t('appSeriesDlgType')}
        <Dropdown
          ariaLabel={t('appSeriesDlgType')}
          value={type}
          options={[
            { value: 'linear', label: t('appSeriesDlgLinear') },
            { value: 'growth', label: t('appSeriesDlgGrowth') },
          ]}
          onPick={(v) => setType(v as 'linear' | 'growth')}
        />
      </label>
      <label>
        {t('appSeriesDlgStep')}
        <input
          autoFocus
          type="text"
          inputMode="decimal"
          value={step}
          onChange={(event) => setStep(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') apply()
            if (event.key === 'Escape') onClose()
          }}
        />
      </label>
      <label>
        {t('appSeriesDlgStop')}
        <input
          type="text"
          inputMode="decimal"
          value={stop}
          placeholder={t('appSeriesDlgStopNone')}
          onChange={(event) => setStop(event.target.value)}
        />
      </label>
      <ActionButton label={t('dlgOk')} onClick={apply} />
    </DialogShell>
  )
}

/** 条件统计：SUMIF / AVERAGEIF / COUNTIF 的最小参数面板。 */
export function CondStatsDialog({
  onApply,
  onClose,
  onPickRange,
}: {
  readonly onApply: (
    fn: 'sum' | 'average' | 'count',
    criteriaRange: string,
    criteria: string,
    sumRange: string,
  ) => void
  readonly onClose: () => void
  /// Collapsed grid picking for the two range fields.
  readonly onPickRange?: RangePickHandler | undefined
}): React.JSX.Element {
  const { t } = useI18n()
  const { picking, begin } = useRangePickSession(onPickRange)
  const [fn, setFn] = useState<'sum' | 'average' | 'count'>('sum')
  const [criteriaRange, setCriteriaRange] = useState('')
  const [criteria, setCriteria] = useState('')
  const [sumRange, setSumRange] = useState('')
  const valid =
    criteriaRange.trim() !== '' &&
    criteria.trim() !== '' &&
    (fn === 'count' || sumRange.trim() !== '')
  const apply = (): void => {
    if (!valid) return
    onApply(fn, criteriaRange.trim(), criteria.trim(), sumRange.trim())
    onClose()
  }
  // The dialog folds away while a range is picked on the grid.
  if (picking) return <></>
  return (
    <DialogShell title={t('appCondStatsDlgTitle')} onClose={onClose}>
      <label>
        {t('appCondStatsFn')}
        <Dropdown
          ariaLabel={t('appCondStatsFn')}
          value={fn}
          options={[
            { value: 'sum', label: t('appFnSum') },
            { value: 'average', label: t('appFnAverage') },
            { value: 'count', label: t('appFnCountNumbers') },
          ]}
          onPick={(v) => setFn(v as 'sum' | 'average' | 'count')}
        />
      </label>
      <label>
        {t('appCondStatsCritRange')}
        <span className="input-row">
          <input
            autoFocus
            type="text"
            value={criteriaRange}
            placeholder="A2:A100"
            onChange={(event) => setCriteriaRange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') apply()
              if (event.key === 'Escape') onClose()
            }}
          />
          {onPickRange && (
            <RangePickButton
              title={t('dlgFnPickRange')}
              onPick={() =>
                begin(t('appCondStatsCritRange'), { formula: true }, (value) =>
                  setCriteriaRange(value),
                )
              }
            />
          )}
        </span>
      </label>
      <label>
        {t('appCondStatsCriteria')}
        <input
          type="text"
          value={criteria}
          placeholder=">60"
          onChange={(event) => setCriteria(event.target.value)}
        />
      </label>
      {fn !== 'count' && (
        <label>
          {t('appCondStatsSumRange')}
          <span className="input-row">
            <input
              type="text"
              value={sumRange}
              placeholder="B2:B100"
              onChange={(event) => setSumRange(event.target.value)}
            />
            {onPickRange && (
              <RangePickButton
                title={t('dlgFnPickRange')}
                onPick={() =>
                  begin(t('appCondStatsSumRange'), { formula: true }, (value) => setSumRange(value))
                }
              />
            )}
          </span>
        </label>
      )}
      <ActionButton label={t('dlgOk')} onClick={apply} />
    </DialogShell>
  )
}

/** 突出显示单元格规则 / 项目选取规则共用的规则参数面板。 */
export type CfRuleDialogMode =
  | 'gt'
  | 'lt'
  | 'eq'
  | 'between'
  | 'contains'
  | 'dup'
  | 'top-n'
  | 'top-pct'
  | 'bottom-n'
  | 'bottom-pct'

export function CfRuleDialog({
  mode,
  onApplyHighlight,
  onApplyRank,
  onClose,
}: {
  readonly mode: CfRuleDialogMode
  readonly onApplyHighlight: (
    op: 'gt' | 'lt' | 'eq' | 'between' | 'contains' | 'dup',
    value: string,
    value2: string,
    styleId: string,
  ) => void
  readonly onApplyRank: (bottom: boolean, percent: boolean, count: number) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const rankMode = mode.startsWith('top') || mode.startsWith('bottom')
  const [value, setValue] = useState('')
  const [value2, setValue2] = useState('')
  const [styleId, setStyleId] = useState('light-red-text')
  const [count, setCount] = useState('10')
  const valid = rankMode
    ? Number.isInteger(Number(count)) && Number(count) >= 1
    : value.trim() !== '' && (mode !== 'between' || value2.trim() !== '')
  const styleOptions = (
    [
      ['light-red-text', 'appCfStyleLightRedText'],
      ['light-yellow-text', 'appCfStyleLightYellowText'],
      ['light-green-text', 'appCfStyleLightGreenText'],
      ['light-red', 'appCfStyleLightRed'],
      ['red-text', 'appCfStyleRedText'],
      ['red-border', 'appCfStyleRedBorder'],
    ] as const
  ).map(([id, labelKey]) => ({ value: id, label: t(labelKey as StringKey) }))
  const apply = (): void => {
    if (!valid) return
    if (rankMode) {
      onApplyRank(mode.startsWith('bottom'), mode.endsWith('pct'), Number(count))
    } else {
      onApplyHighlight(
        mode as 'gt' | 'lt' | 'eq' | 'between' | 'contains' | 'dup',
        value.trim(),
        value2.trim(),
        styleId,
      )
    }
    onClose()
  }
  return (
    <DialogShell title={t(rankMode ? 'appCfRankRule' : 'appCfHlRule')} onClose={onClose}>
      {rankMode ? (
        <label>
          {t('appCfDlgCount')}
          <input
            autoFocus
            type="text"
            inputMode="numeric"
            value={count}
            onChange={(event) => setCount(event.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') apply()
              if (event.key === 'Escape') onClose()
            }}
          />
        </label>
      ) : (
        <label>
          {mode === 'contains'
            ? t('appCfDlgText')
            : mode === 'dup'
              ? t('appCfDlgDupNote')
              : mode === 'between'
                ? t('appCfDlgValueMin')
                : t('appCfDlgValue')}
          {mode === 'dup' ? (
            <p className="dialog-note">{t('appCfDlgDupNote2')}</p>
          ) : (
            <input
              autoFocus
              type="text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') apply()
                if (event.key === 'Escape') onClose()
              }}
            />
          )}
        </label>
      )}
      {mode === 'between' && (
        <label>
          {t('appCfDlgValueMax')}
          <input type="text" value={value2} onChange={(event) => setValue2(event.target.value)} />
        </label>
      )}
      {!rankMode && mode !== 'dup' && (
        <label>
          {t('appCfDlgStyle')}
          <Dropdown
            ariaLabel={t('appCfDlgStyle')}
            value={styleId}
            options={styleOptions}
            onPick={setStyleId}
          />
        </label>
      )}
      <ActionButton label={t('dlgOk')} onClick={apply} />
    </DialogShell>
  )
}

/** 新建表格样式 / 新建数据透视表样式：名称 + 表头填充 + 镶边行填充。 */
export function NewTableStyleDialog({
  kind,
  onApply,
  onClose,
}: {
  readonly kind: 'table' | 'pivot'
  readonly onApply: (name: string, headerFill: string, bandFill: string | null) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [name, setName] = useState(
    kind === 'pivot' ? t('appPivotStyleDefaultName') : t('appTableStyleDefaultName'),
  )
  const [headerFill, setHeaderFill] = useState('#4472C4')
  const [bandFill, setBandFill] = useState<string | null>('#D9E1F2')
  const [bandOn, setBandOn] = useState(true)
  const valid = name.trim() !== ''
  const apply = (): void => {
    if (!valid) return
    onApply(name.trim(), headerFill, bandOn ? bandFill : null)
    onClose()
  }
  return (
    <DialogShell
      title={t(kind === 'pivot' ? 'appPivotStyleNew' : 'appTableStyleNew')}
      onClose={onClose}
    >
      <label>
        {t('appTableStyleDlgName')}
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') apply()
            if (event.key === 'Escape') onClose()
          }}
        />
      </label>
      <ColorField label={t('appTableStyleDlgHeader')} value={headerFill} onChange={setHeaderFill} />
      <label className="dialog-check">
        <input
          type="checkbox"
          checked={bandOn}
          onChange={(event) => setBandOn(event.target.checked)}
        />
        {t('appTableStyleDlgBand')}
      </label>
      {bandOn && (
        <ColorField
          label={t('appTableStyleDlgBandColor')}
          value={bandFill ?? '#D9E1F2'}
          onChange={setBandFill}
        />
      )}
      <MiniTablePreview headerFill={headerFill} bandFill={bandOn ? bandFill : null} />
      <ActionButton label={t('dlgOk')} onClick={apply} />
    </DialogShell>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (hex: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div className="dp-color-field">
      <span>{label}</span>
      <ColorPicker
        value={value}
        strings={{
          themeColors: t('appThemeColors'),
          standardColors: t('appStandardColors'),
          moreColors: t('appMoreColors'),
        }}
        onPick={(hex) => {
          if (hex) onChange(hex)
        }}
      />
      <i className="dp-color-chip" style={{ background: value }} />
    </div>
  )
}

function MiniTablePreview({
  headerFill,
  bandFill,
}: {
  readonly headerFill: string
  readonly bandFill: string | null
}): React.JSX.Element {
  return (
    <div className="dp-table-preview" aria-hidden="true">
      <span className="dp-row dp-head" style={{ background: headerFill }}>
        <i />
        <i />
        <i />
      </span>
      {[0, 1, 2].map((row) => (
        <span
          key={row}
          className="dp-row"
          style={{ background: row % 2 === 1 ? (bandFill ?? '#FFFFFF') : '#FFFFFF' }}
        >
          <i />
          <i />
          <i />
        </span>
      ))}
    </div>
  )
}

/** 新建单元格样式：名称 + （可选）取当前选区格式。 */
export function NewCellStyleDialog({
  currentPatch,
  onApply,
  onClose,
}: {
  readonly currentPatch: CellFormatPatch | null
  readonly onApply: (name: string, patch: CellFormatPatch) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [useCurrent, setUseCurrent] = useState(currentPatch !== null)
  const valid = name.trim() !== '' && (!useCurrent || currentPatch !== null)
  const apply = (): void => {
    if (!valid) return
    onApply(name.trim(), useCurrent && currentPatch ? currentPatch : {})
    onClose()
  }
  return (
    <DialogShell title={t('appCellStyleDlgTitle')} onClose={onClose}>
      <label>
        {t('appCellStyleDlgName')}
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') apply()
            if (event.key === 'Escape') onClose()
          }}
        />
      </label>
      {currentPatch !== null && (
        <label className="dialog-check">
          <input
            type="checkbox"
            checked={useCurrent}
            onChange={(event) => setUseCurrent(event.target.checked)}
          />
          {t('appCellStyleDlgUseCurrent')}
        </label>
      )}
      <ActionButton label={t('dlgOk')} onClick={apply} />
    </DialogShell>
  )
}

/** 保存动作的公共收口（对话框不直接写存储以外的东西）。 */
export function persistCustomTableStyle(
  kind: 'table' | 'pivot',
  name: string,
  headerFill: string,
  bandFill: string | null,
): void {
  saveCustomTableStyle({
    id: `custom-${kind}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
    name,
    kind,
    headerFill,
    bandFill,
  })
}

export function persistCustomCellStyle(name: string, patch: CellFormatPatch): void {
  saveCustomCellStyle({
    id: `custom-cell-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
    name,
    patch,
  })
}

/** 选择窗格：列出当前工作表的浮动对象，点击定位。 */
export function SelectionPaneDialog({
  items,
  onLocate,
  onClose,
}: {
  readonly items: readonly SheetVisualRef[]
  readonly onLocate: (item: SheetVisualRef) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const kindLabels: Record<string, string> = {
    chart: t('appCharts'),
    image: t('appPicGroupPicture'),
    shape: t('appShapeName'),
    ole: 'OLE',
    slicer: 'Slicer',
  }
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="format-cells-dialog link-dialog"
        role="dialog"
        aria-label={t('appSelectionPane')}
        onClick={(event) => event.stopPropagation()}
      >
        <header>{t('appSelectionPane')}</header>
        <div className="dialog-body">
          {items.length === 0 ? (
            <p className="dialog-note">{t('appNoObjects')}</p>
          ) : (
            <div className="dp-pane-list" role="listbox" aria-label={t('appSelectionPane')}>
              {items.map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  role="option"
                  onClick={() => {
                    onLocate(item)
                    onClose()
                  }}
                >
                  <span className="dp-pane-kind">{kindLabels[item.kind] ?? item.kind}</span>
                  <span className="dp-pane-name">
                    {`${t('appObjectN', { n: index + 1 })} · ${item.id.slice(0, 12)}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <footer className="dialog-actions">
          <button className="secondary" onClick={onClose}>
            {t('dlgCancel')}
          </button>
        </footer>
      </div>
    </div>
  )
}

/** 录入当前日期子菜单：以今天为样例渲染每种格式的实时文案。 */
export const FILL_DATE_PATTERNS: ReadonlyArray<{
  readonly pattern: string
  readonly wide: boolean
}> = [
  { pattern: 'yyyy年m月d日', wide: false },
  { pattern: 'yyyy-m-d', wide: false },
  { pattern: 'yyyy.m.d', wide: false },
  { pattern: 'yyyy/m/d', wide: false },
  { pattern: 'yyyymmdd', wide: false },
  { pattern: 'yyyy年mm月dd日', wide: true },
  { pattern: 'yyyy-mm-dd', wide: true },
  { pattern: 'yyyy.mm.dd', wide: true },
  { pattern: 'yyyy/mm/dd', wide: true },
]

export function fillDateLabel(pattern: string): string {
  return formatFillDate(new Date(), pattern)
}
