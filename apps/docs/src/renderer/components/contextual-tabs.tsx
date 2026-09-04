/**
 * Contextual tab bodies — extracted verbatim from Ribbon.tsx during the
 * schema migration (strangler step 4): Shape Format, Picture Format and the
 * two Table Tools tabs. Same JSX, same class strings, same behavior. The
 * Ribbon shell owns their entry conditions (inShape / inImage / inTable) and
 * passes its editor-bound helper machinery as props; the schema host builds
 * the same prop object from the shared bindings hooks, so both chrome paths
 * render identical bodies. The helper-bundle props are intentionally loose
 * (any) — this adapter layer dies with the legacy shell at the end of the
 * migration.
 */
import type { TableLook } from '@chatoffice/docx-engine'
import { Dropdown } from '@chatoffice/ui'
import { useI18n, type StringKey } from '../i18n/locale'
import { ShapeColorPalette } from './ribbon-tab-shared'
import { IconSparkle } from './icons'
import { WRAP_OPTIONS } from './ContextMenu'

/** CSS px per cm at 96dpi (picture size inputs display in centimeters) */
const PX_PER_CM = 96 / 2.54
import { TABLE_AUTO_FIT_OPTIONS } from './Ribbon'
import { PICTURE_CM_MAX, PICTURE_CM_MIN } from './Ribbon'
import {
  applyTablePreset,
  setTableAutoFit,
  toggleRepeatHeaderRows,
} from '../editor/table-properties'
import {
  IconAlignCenter,
  IconAlignJustify,
  IconAlignLeft,
  IconAlignRight,
  IconAutoFit,
  IconBorderAll,
  IconBorderInner,
  IconBorderNone,
  IconBorderOuter,
  IconCaret,
  IconCellAlignBottom,
  IconCellAlignMiddle,
  IconCellAlignTop,
  IconColDelete,
  IconColInsertLeft,
  IconColInsertRight,
  IconCrop,
  IconFlipH,
  IconFlipV,
  IconFontColorA,
  IconMergeCells,
  IconRemoveBg,
  IconRepeatHeader,
  IconReplacePicture,
  IconRotateLeft,
  IconRotateRight,
  IconRowDelete,
  IconRowInsertAbove,
  IconRowInsertBelow,
  IconShading,
  IconSplitCells,
  IconTableDelete,
  IconTableProperties,
} from './icons'

export const TABLE_PRESETS = [
  {
    label: 'ribbonTablePresetGrid',
    headerFill: null,
    band1Fill: null,
    band2Fill: null,
    borderColor: '808080',
  },
  {
    label: 'ribbonTablePresetBlueHeader',
    headerFill: 'D9EAF7',
    band1Fill: null,
    band2Fill: null,
    borderColor: '5B9BD5',
  },
  {
    label: 'ribbonTablePresetBlueBanded',
    headerFill: 'BDD7EE',
    band1Fill: 'DDEBF7',
    band2Fill: 'FFFFFF',
    borderColor: '9DC3E6',
  },
  {
    label: 'ribbonTablePresetGrayBanded',
    headerFill: 'D9E1F2',
    band1Fill: 'E7E6E6',
    band2Fill: 'FFFFFF',
    borderColor: 'A5A5A5',
  },
  {
    label: 'ribbonTablePresetGreenHeader',
    headerFill: 'E2F0D9',
    band1Fill: null,
    band2Fill: null,
    borderColor: '70AD47',
  },
] as const satisfies ReadonlyArray<{
  label: StringKey
  headerFill: string | null
  band1Fill: string | null
  band2Fill: string | null
  borderColor: string
}>

export function ShapeFormatTab({
  fs,
  canEdit,
  dropdown,
  setDropdown,
  shapeIsLine,
  setShapeStyle,
  shapeTextCommand,
  shapeTextActive,
  shapeMarkBtn,
  shapeAlignBtn,
}: {
  readonly fs: any
  readonly canEdit: any
  readonly dropdown: any
  readonly setDropdown: any
  readonly shapeIsLine: any
  readonly setShapeStyle: any
  readonly shapeTextCommand: any
  readonly shapeTextActive: any
  readonly shapeMarkBtn: any
  readonly shapeAlignBtn: any
}) {
  const { t } = useI18n()
  return (
    <>
      <div className="table-ribbon-body">
        <div className="ribbon-group">
          <div className="ribbon-group-items">
            {!shapeIsLine && (
              <div className="rb-split-wrap">
                <button
                  className="rb-big"
                  disabled={!canEdit}
                  data-tip={t('ribbonShapeFillTip')}
                  onClick={() =>
                    setDropdown((v: string | null) => (v === 'shapeFill' ? null : 'shapeFill'))
                  }
                >
                  <span className="rb-big-icon">
                    <IconShading />
                    <span
                      className="rb-color-bar"
                      style={{ background: fs.shapeFill ? `#${fs.shapeFill}` : 'transparent' }}
                    />
                  </span>
                  <span>{t('ribbonShapeFill')}</span>
                </button>
                {dropdown === 'shapeFill' && (
                  <ShapeColorPalette
                    current={fs.shapeFill}
                    noneLabel={t('ribbonNoFill')}
                    onPick={(hex) => {
                      setShapeStyle({ fill: hex })
                      setDropdown(null)
                    }}
                  />
                )}
              </div>
            )}
            <div className="rb-split-wrap">
              <button
                className="rb-big"
                disabled={!canEdit}
                data-tip={t('ribbonShapeOutlineTip')}
                onClick={() =>
                  setDropdown((v: string | null) => (v === 'shapeOutline' ? null : 'shapeOutline'))
                }
              >
                <span className="rb-big-icon">
                  <IconBorderAll />
                  <span
                    className="rb-color-bar"
                    style={{
                      background: fs.shapeBorderColor ? `#${fs.shapeBorderColor}` : 'transparent',
                    }}
                  />
                </span>
                <span>{t('ribbonShapeOutline')}</span>
              </button>
              {dropdown === 'shapeOutline' && (
                <ShapeColorPalette
                  current={fs.shapeBorderColor}
                  noneLabel={t('ribbonNoOutline')}
                  onPick={(hex) => {
                    setShapeStyle({ borderColor: hex })
                    setDropdown(null)
                  }}
                />
              )}
            </div>
          </div>
          <div className="ribbon-group-label">{t('ribbonGroupShapeStyles')}</div>
        </div>
        {fs.shapeHasText && (
          <div className="ribbon-group">
            <div className="ribbon-group-items">
              <div className="rb-col">
                <div className="rb-row">
                  {shapeMarkBtn('bold', shapeTextActive.bold, t('ribbonBoldTip'), <b>B</b>)}
                  {shapeMarkBtn('italic', shapeTextActive.italic, t('ribbonItalicTip'), <i>I</i>)}
                  {shapeMarkBtn(
                    'underline',
                    shapeTextActive.underline,
                    t('ribbonUnderlineTip'),
                    <u>U</u>,
                  )}
                  <div className="rb-split-wrap">
                    <button
                      className="rb-icon rb-color-btn"
                      disabled={!canEdit}
                      data-tip={t('ribbonFontColor')}
                      aria-label={t('ribbonFontColor')}
                      onClick={() =>
                        setDropdown((v: string | null) =>
                          v === 'shapeTextColor' ? null : 'shapeTextColor',
                        )
                      }
                    >
                      <span className="rb-color-glyph rb-color-glyph-svg">
                        <IconFontColorA />
                        <span
                          className="rb-color-bar"
                          style={{
                            background: shapeTextActive.color
                              ? `#${shapeTextActive.color}`
                              : 'transparent',
                          }}
                        />
                      </span>
                    </button>
                    {dropdown === 'shapeTextColor' && (
                      <ShapeColorPalette
                        current={shapeTextActive.color}
                        noneLabel={t('ribbonAutomatic')}
                        onPick={(hex) => {
                          shapeTextCommand.setColor(hex)
                          setDropdown(null)
                        }}
                      />
                    )}
                  </div>
                </div>
                <div className="rb-row">
                  {shapeAlignBtn('left', t('ribbonAlignLeftTip'), <IconAlignLeft />)}
                  {shapeAlignBtn('center', t('ribbonAlignCenterTip'), <IconAlignCenter />)}
                  {shapeAlignBtn('right', t('ribbonAlignRightTip'), <IconAlignRight />)}
                  {shapeAlignBtn('justify', t('ribbonJustifyTip'), <IconAlignJustify />)}
                </div>
              </div>
            </div>
            <div className="ribbon-group-label">{t('ribbonGroupText')}</div>
          </div>
        )}
      </div>
    </>
  )
}

export function PictureFormatTab({
  fs,
  editor,
  canEdit,
  setPictureDialog,
  flipPicture,
  rotatePicture,
  replacePicture,
  resetPictureSize,
  setPictureSizeCm,
  compressPicture,
  aiReplace,
}: {
  readonly fs: any
  readonly editor: any
  readonly canEdit: any
  readonly chain: any
  readonly setPictureDialog: any
  readonly flipPicture: any
  readonly rotatePicture: any
  readonly replacePicture: any
  readonly resetPictureSize: any
  readonly setPictureSizeCm: any
  readonly compressPicture: any
  readonly aiReplace: {
    readonly open: boolean
    readonly busy: boolean
    readonly prompt: string
    readonly onPrompt: (value: string) => void
    readonly onToggle: () => void
    readonly onRun: () => void
  }
}) {
  const { t } = useI18n()
  return (
    <>
      <div className="table-ribbon-body">
        {/* ---- Adjust: remove background / crop / replace picture ---- */}
        <div className="ribbon-group">
          <div className="ribbon-group-items">
            <button
              className="rb-big"
              disabled={!canEdit}
              data-tip={t('ribbonRemoveBgTip')}
              onClick={() => setPictureDialog('cutout')}
            >
              <span className="rb-big-icon">
                <IconRemoveBg size={28} />
              </span>
              <span>{t('ribbonRemoveBg')}</span>
            </button>
            <button
              className="rb-big"
              disabled={!canEdit}
              data-tip={t('ribbonCropTip')}
              onClick={() => setPictureDialog('crop')}
            >
              <span className="rb-big-icon">
                <IconCrop size={28} />
              </span>
              <span>{t('ribbonCrop')}</span>
            </button>
            <button
              className="rb-big"
              disabled={!canEdit}
              data-tip={t('ribbonReplacePictureTip')}
              onClick={() => void replacePicture()}
            >
              <span className="rb-big-icon">
                <IconReplacePicture size={28} />
              </span>
              <span>{t('ribbonReplacePicture')}</span>
            </button>
          </div>
          <div className="ribbon-group-label">{t('ribbonGroupAdjust')}</div>
        </div>
        <div className="ribbon-sep" />
        {/* ---- Corrections: WPS-style ± brightness/contrast steppers (non-destructive a:lum) ---- */}
        <div className="ribbon-group">
          <div className="ribbon-group-items">
            <div className="rb-lum-col">
              {(['bright', 'contrast'] as const).map((field) => {
                const label = field === 'bright' ? t('ribbonPicBrightness') : t('ribbonPicContrast')
                const value = fs.imageLum?.[field] ?? 0
                const set = (next: number): void => {
                  if (!canEdit) return
                  const current = fs.imageLum ?? { bright: 0, contrast: 0 }
                  editor
                    .chain()
                    .focus()
                    .updateAttributes('docProtected', {
                      imageLum: { ...current, [field]: Math.max(-100000, Math.min(100000, next)) },
                    })
                    .run()
                }
                return (
                  <div className="rb-lum-row" key={field}>
                    <span className="rb-lum-label">{label}</span>
                    <button
                      className="rb-lum-btn"
                      disabled={!canEdit}
                      data-tip={t('ribbonPicDecrease')}
                      aria-label={t('ribbonPicDecrease')}
                      onClick={() => set(value - 10000)}
                    >
                      −
                    </button>
                    <span className="rb-lum-value">{Math.round(value / 1000)}%</span>
                    <button
                      className="rb-lum-btn"
                      disabled={!canEdit}
                      data-tip={t('ribbonPicIncrease')}
                      aria-label={t('ribbonPicIncrease')}
                      onClick={() => set(value + 10000)}
                    >
                      +
                    </button>
                  </div>
                )
              })}
              <button
                className="rb-lum-reset"
                disabled={!canEdit || (!fs.imageLum?.bright && !fs.imageLum?.contrast)}
                data-tip={t('ribbonPicResetAdjustTip')}
                onClick={() => {
                  if (!canEdit) return
                  editor.chain().focus().updateAttributes('docProtected', { imageLum: null }).run()
                }}
              >
                {t('ribbonPicReset')}
              </button>
              <Dropdown
                className="rb-wrap-dd"
                disabled={!canEdit}
                tip={t('ribbonCompressPicture')}
                value=""
                options={[
                  { value: '220', label: t('ribbonCompressPrint') },
                  { value: '150', label: t('ribbonCompressWeb') },
                  { value: '96', label: t('ribbonCompressEmail') },
                ]}
                onPick={(v) => void compressPicture?.(Number(v))}
              />
              <div className="rb-geom-dd" data-tip={t('ribbonCropToShape')}>
                <Dropdown
                  className="rb-wrap-dd"
                  disabled={!canEdit}
                  tip={t('ribbonCropToShape')}
                  value={fs.imageGeom ?? 'rect'}
                  options={[
                    'rect',
                    'roundRect',
                    'ellipse',
                    'triangle',
                    'diamond',
                    'pentagon',
                    'hexagon',
                    'star5',
                  ].map((prst) => ({
                    value: prst,
                    label:
                      prst === 'rect'
                        ? t('ribbonAutomatic')
                        : prst === 'ellipse'
                          ? '●'
                          : prst === 'roundRect'
                            ? '▢'
                            : prst === 'triangle'
                              ? '▲'
                              : prst === 'diamond'
                                ? '◆'
                                : prst === 'pentagon'
                                  ? '⬟'
                                  : prst === 'hexagon'
                                    ? '⬢'
                                    : '★',
                  }))}
                  onPick={(v) => {
                    if (!canEdit) return
                    editor
                      .chain()
                      .focus()
                      .updateAttributes('docProtected', { imageGeom: v === 'rect' ? null : v })
                      .run()
                  }}
                />
              </div>
              <Dropdown
                className="rb-wrap-dd"
                disabled={!canEdit}
                tip={t('ribbonShadow')}
                value={fs.imageShadow ? 'custom' : 'none'}
                options={[
                  { value: 'none', label: t('ribbonAutomatic') },
                  { value: 'br', label: t('ribbonShadowOffsetBr') },
                  { value: 'tr', label: t('ribbonShadowOffsetTr') },
                  { value: 'soft', label: t('ribbonShadowSoft') },
                ]}
                onPick={(v) => {
                  if (!canEdit) return
                  const presets: Record<
                    string,
                    {
                      blurPt: number
                      distPt: number
                      dirDeg: number
                      color: string
                      alpha: number
                    } | null
                  > = {
                    none: null,
                    br: { blurPt: 8, distPt: 5, dirDeg: 45, color: '000000', alpha: 0.6 },
                    tr: { blurPt: 8, distPt: 5, dirDeg: 315, color: '000000', alpha: 0.6 },
                    soft: { blurPt: 12, distPt: 0, dirDeg: 0, color: '000000', alpha: 0.55 },
                  }
                  editor
                    .chain()
                    .focus()
                    .updateAttributes('docProtected', { imageShadow: presets[v] ?? null })
                    .run()
                }}
              />
              <div className="rb-geom-dd" data-tip={t('ribbonAiReplace')}>
                <button
                  className={`rb-big${aiReplace.open ? ' active' : ''}`}
                  disabled={!canEdit}
                  data-tip={t('ribbonAiReplaceTip')}
                  onClick={aiReplace.onToggle}
                >
                  <span className="rb-big-icon">
                    <IconSparkle size={28} />
                  </span>
                  <span>{t('ribbonAiReplace')}</span>
                </button>
                {aiReplace.open && (
                  <div className="rb-ai-replace">
                    <textarea
                      rows={2}
                      placeholder={t('ribbonAiReplacePrompt')}
                      value={aiReplace.prompt}
                      onChange={(e) => aiReplace.onPrompt(e.target.value)}
                    />
                    <button
                      disabled={aiReplace.busy || !aiReplace.prompt.trim()}
                      onClick={aiReplace.onRun}
                    >
                      {aiReplace.busy ? '…' : t('ribbonAiReplaceRun')}
                    </button>
                  </div>
                )}
              </div>
              <Dropdown
                className="rb-wrap-dd"
                disabled={!canEdit}
                tip={t('ribbonTransparency')}
                value={
                  fs.imageOpacity != null ? String(Math.round((1 - fs.imageOpacity) * 100)) : '0'
                }
                options={[
                  { value: '0', label: t('ribbonAutomatic') },
                  { value: '15', label: '15%' },
                  { value: '30', label: '30%' },
                  { value: '50', label: '50%' },
                  { value: '65', label: '65%' },
                  { value: '80', label: '80%' },
                ].map((o) => ({ value: o.value, label: o.label }))}
                onPick={(v) => {
                  if (!canEdit) return
                  const pct = Number(v)
                  editor
                    .chain()
                    .focus()
                    .updateAttributes('docProtected', {
                      imageOpacity: pct > 0 ? 1 - pct / 100 : null,
                    })
                    .run()
                }}
              />
            </div>
          </div>
          <div className="ribbon-group-label">{t('ribbonPicGroupAdjust')}</div>
        </div>
        <div className="ribbon-sep" />
        {/* ---- Arrange: wrap text / align ---- */}
        <div className="table-tool-group">
          <div className="table-tool-row">
            <Dropdown
              className="rb-wrap-dd"
              disabled={!canEdit}
              tip={t('ribbonWrapText')}
              value={fs.imageWrap ?? ''}
              options={WRAP_OPTIONS.map((opt) => ({
                value: opt.value ?? '',
                label: t(opt.labelKey),
              }))}
              onPick={(v) => {
                if (!canEdit) return
                editor
                  .chain()
                  .focus()
                  .updateAttributes('docProtected', { imageWrap: v || null })
                  .run()
              }}
            />
          </div>
          <div className="table-tool-row">
            {(
              [
                ['left', <IconAlignLeft key="l" />, t('ribbonAlignLeftTip')],
                ['center', <IconAlignCenter key="c" />, t('ribbonAlignCenterTip')],
                ['right', <IconAlignRight key="r" />, t('ribbonAlignRightTip')],
              ] as const
            ).map(([value, icon, label]) => (
              <button
                key={value}
                className={
                  (fs.imageAlign ?? 'left') === value
                    ? 'table-tool-button active'
                    : 'table-tool-button'
                }
                disabled={!canEdit}
                data-tip={label}
                aria-label={label}
                onClick={() => {
                  if (!canEdit) return
                  editor
                    .chain()
                    .focus()
                    .updateAttributes('docProtected', {
                      imageAlign: value === 'left' ? null : value,
                    })
                    .run()
                }}
              >
                {icon}
              </button>
            ))}
          </div>
          <div className="table-tool-row">
            <button
              className="table-tool-button"
              disabled={!canEdit}
              data-tip={t('ribbonRotateRight')}
              aria-label={t('ribbonRotateRight')}
              onClick={() => rotatePicture(90)}
            >
              <IconRotateRight />
            </button>
            <button
              className="table-tool-button"
              disabled={!canEdit}
              data-tip={t('ribbonRotateLeft')}
              aria-label={t('ribbonRotateLeft')}
              onClick={() => rotatePicture(-90)}
            >
              <IconRotateLeft />
            </button>
            <button
              className={fs.imageFlipH ? 'table-tool-button active' : 'table-tool-button'}
              disabled={!canEdit}
              data-tip={t('ribbonFlipH')}
              aria-label={t('ribbonFlipH')}
              onClick={() => flipPicture('h')}
            >
              <IconFlipH />
            </button>
            <button
              className={fs.imageFlipV ? 'table-tool-button active' : 'table-tool-button'}
              disabled={!canEdit}
              data-tip={t('ribbonFlipV')}
              aria-label={t('ribbonFlipV')}
              onClick={() => flipPicture('v')}
            >
              <IconFlipV />
            </button>
          </div>
          <div className="ribbon-group-label">{t('ribbonGroupArrange')}</div>
        </div>
        <div className="ribbon-sep" />
        {/* ---- Size: height/width (cm, proportional) + reset ---- */}
        <div className="table-tool-group">
          <div
            className="table-tool-row table-size-inputs"
            key={`${fs.imageWidthPx ?? ''}x${fs.imageHeightPx ?? ''}`}
          >
            <label>
              {t('ribbonPicHeight')}
              <input
                type="number"
                min={PICTURE_CM_MIN}
                max={PICTURE_CM_MAX}
                step={0.1}
                defaultValue={
                  fs.imageHeightPx !== null ? (fs.imageHeightPx / PX_PER_CM).toFixed(2) : ''
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = parseFloat((e.target as HTMLInputElement).value)
                    if (Number.isFinite(v) && v > 0) setPictureSizeCm('h', v)
                  }
                }}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value)
                  const cur = fs.imageHeightPx !== null ? fs.imageHeightPx / PX_PER_CM : null
                  if (Number.isFinite(v) && v > 0 && (cur === null || Math.abs(v - cur) > 0.01)) {
                    setPictureSizeCm('h', v)
                  }
                }}
              />
              {t('ribbonCm')}
            </label>
            <label>
              {t('ribbonPicWidth')}
              <input
                type="number"
                min={PICTURE_CM_MIN}
                max={PICTURE_CM_MAX}
                step={0.1}
                defaultValue={
                  fs.imageWidthPx !== null ? (fs.imageWidthPx / PX_PER_CM).toFixed(2) : ''
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = parseFloat((e.target as HTMLInputElement).value)
                    if (Number.isFinite(v) && v > 0) setPictureSizeCm('w', v)
                  }
                }}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value)
                  const cur = fs.imageWidthPx !== null ? fs.imageWidthPx / PX_PER_CM : null
                  if (Number.isFinite(v) && v > 0 && (cur === null || Math.abs(v - cur) > 0.01)) {
                    setPictureSizeCm('w', v)
                  }
                }}
              />
              {t('ribbonCm')}
            </label>
          </div>
          <div className="table-tool-row">
            <button data-tip={t('ribbonResetSizeTip')} onClick={() => void resetPictureSize()}>
              {t('ribbonResetSize')}
            </button>
          </div>
          <div className="ribbon-group-label">{t('ribbonGroupSize')}</div>
        </div>
      </div>
    </>
  )
}

export function TableDesignTab({
  chain,
  runTableCommand,
  tableAttrs,
  styles,
  applyCellBorders,
  setTableLookOption,
  setBorderColor,
  setBorderSz,
  setCellAttr,
  borderColor,
  borderSz,
  tableLook,
}: {
  readonly chain: any
  readonly runTableCommand: any
  readonly tableAttrs: any
  readonly styles: any
  readonly applyCellBorders: any
  readonly setTableLookOption: any
  readonly applyColumnWidth: any
  readonly applyRowHeight: any
  readonly setBorderColor: any
  readonly setBorderSz: any
  readonly setCellAttr: any
  readonly borderColor: any
  readonly borderSz: any
  readonly tableLook: any
  readonly setTablePropertiesOpen: any
}) {
  const { t } = useI18n()
  return (
    <>
      <div className="table-ribbon-body">
        <div className="table-tool-group">
          <div className="table-style-gallery">
            <button
              className="table-style-card"
              data-tip={t('ribbonRemoveTableStyleTip')}
              onClick={() => chain().updateAttributes('docTable', { tblStyleId: null }).run()}
            >
              <span className="table-style-card-grid plain" />
              <span>{t('ribbonNoStyle')}</span>
            </button>
            {TABLE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                className="table-style-card"
                data-tip={t(preset.label)}
                onClick={() => runTableCommand(applyTablePreset(preset))}
              >
                <span
                  className="table-style-card-grid"
                  style={{
                    borderColor: `#${preset.borderColor}`,
                    borderTopColor: `#${preset.headerFill ?? 'FFFFFF'}`,
                    background: `repeating-linear-gradient(to bottom,#${preset.band1Fill ?? 'FFFFFF'} 0 50%,#${preset.band2Fill ?? preset.band1Fill ?? 'FFFFFF'} 50% 100%)`,
                  }}
                />
                <span>{t(preset.label)}</span>
              </button>
            ))}
            {[...(styles?.values() ?? [])]
              .filter((info) => info.type === 'table' && info.styleId !== 'TableNormal')
              .map((info) => (
                <button
                  key={info.styleId}
                  className={
                    tableAttrs.tblStyleId === info.styleId
                      ? 'table-style-card active'
                      : 'table-style-card'
                  }
                  data-tip={t('ribbonApplyTableStyleTip', { name: info.name })}
                  onClick={() =>
                    chain().updateAttributes('docTable', { tblStyleId: info.styleId }).run()
                  }
                >
                  <span
                    className="table-style-card-grid"
                    style={{
                      background: info.tableDisplay?.fill
                        ? `#${info.tableDisplay.fill}`
                        : undefined,
                      borderTopColor: info.tableDisplay?.firstRow?.fill
                        ? `#${info.tableDisplay.firstRow.fill}`
                        : undefined,
                    }}
                  />
                  <span>{info.name}</span>
                </button>
              ))}
          </div>
          <div className="ribbon-group-label">{t('ribbonGroupTableStyles')}</div>
        </div>
        <div className="ribbon-sep" />
        <div className="table-tool-group">
          <div className="table-style-options">
            {(
              [
                ['firstRow', 'ribbonTableFirstRow'],
                ['lastRow', 'ribbonTableLastRow'],
                ['bandedRows', 'ribbonTableBandedRows'],
                ['firstColumn', 'ribbonTableFirstColumn'],
                ['lastColumn', 'ribbonTableLastColumn'],
                ['bandedColumns', 'ribbonTableBandedColumns'],
              ] as Array<[keyof TableLook, StringKey]>
            ).map(([key, label]) => (
              <button
                key={key}
                className={
                  tableLook[key]
                    ? 'table-option-toggle table-tool-button active'
                    : 'table-option-toggle table-tool-button'
                }
                aria-pressed={tableLook[key]}
                onClick={() => runTableCommand(setTableLookOption(key, !tableLook[key]))}
              >
                <span className="table-option-check" aria-hidden="true" />
                <span>{t(label)}</span>
              </button>
            ))}
          </div>
          <div className="ribbon-group-label">{t('ribbonTableStyleOptions')}</div>
        </div>
        <div className="ribbon-sep" />
        <div className="table-tool-group">
          <div className="table-style-swatches">
            {['FFFFFF', 'D9EAF7', 'FFF2CC', 'E2F0D9', 'FCE4D6', 'E4DFEC'].map((hex) => (
              <button
                key={hex}
                className="table-style-swatch"
                data-tip={t('ribbonCellShadingTip', { hex })}
                aria-label={t('ribbonCellShadingTip', { hex })}
                style={{ background: `#${hex}` }}
                onClick={() => runTableCommand(setCellAttr('fill', hex))}
              />
            ))}
            <button
              className="table-style-clear"
              onClick={() => runTableCommand(setCellAttr('fill', null))}
            >
              {t('ribbonNoShading')}
            </button>
          </div>
          <div className="ribbon-group-label">{t('ribbonGroupShading')}</div>
        </div>
        <div className="ribbon-sep" />
        <div className="table-tool-group">
          <div className="table-tool-grid table-tool-grid-four">
            <button data-tip={t('ribbonAllBordersTip')} onClick={() => applyCellBorders('all')}>
              <IconBorderAll />
              {t('ribbonAllBorders')}
            </button>
            <button data-tip={t('ribbonOuterBordersTip')} onClick={() => applyCellBorders('outer')}>
              <IconBorderOuter />
              {t('ribbonOuterBorders')}
            </button>
            <button data-tip={t('ribbonInnerBordersTip')} onClick={() => applyCellBorders('inner')}>
              <IconBorderInner />
              {t('ribbonInnerBorders')}
            </button>
            <button data-tip={t('ribbonClearBordersTip')} onClick={() => applyCellBorders('none')}>
              <IconBorderNone />
              {t('ribbonNoBorders')}
            </button>
          </div>
          <div className="table-tool-row table-border-opts">
            <input
              type="color"
              data-tip={t('ribbonBorderColor')}
              value={`#${borderColor}`}
              onChange={(e) => setBorderColor(e.target.value.slice(1).toUpperCase())}
            />
            <Dropdown
              tip={t('ribbonBorderWidth')}
              value={String(borderSz)}
              options={[4, 8, 12, 18, 24].map((sz) => ({
                value: String(sz),
                label: t('ribbonPtValue', { n: sz / 8 }),
              }))}
              onPick={(v) => setBorderSz(Number(v))}
            />
          </div>
          <div className="ribbon-group-label">{t('ribbonGroupBorders')}</div>
        </div>
      </div>
    </>
  )
}

export function TableLayoutTab({
  fs,
  editor,
  dropdown,
  setDropdown,
  chain,
  runTableCommand,
  activeCellInfo,
  applyColumnWidth,
  applyRowHeight,
  setCellAttr,
  tableAutoFitMode,
  tableAutoFitLabel,
  sectionContentWidthPx,
  maxRowHeightCm,
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  mergeCells,
  splitCell,
  tableHeader,
  setTablePropertiesOpen,
}: {
  readonly fs: any
  readonly editor: any
  readonly dropdown: any
  readonly setDropdown: any
  readonly chain: any
  readonly runTableCommand: any
  readonly setTableLookOption: any
  readonly tableLook: any
  readonly activeCellInfo: any
  readonly applyCellBorders: any
  readonly applyColumnWidth: any
  readonly applyRowHeight: any
  readonly setCellAttr: any
  readonly tableAutoFitMode: any
  readonly tableAutoFitLabel: any
  readonly sectionContentWidthPx: any
  readonly maxRowHeightCm: any
  readonly addColumnAfter: any
  readonly addColumnBefore: any
  readonly addRowAfter: any
  readonly addRowBefore: any
  readonly deleteColumn: any
  readonly deleteRow: any
  readonly deleteTable: any
  readonly mergeCells: any
  readonly splitCell: any
  readonly tableHeader: any
  readonly setTablePropertiesOpen: any
}) {
  const { t } = useI18n()
  return (
    <>
      <div className="table-ribbon-body">
        <div className="table-tool-group table-tool-delete">
          <button className="table-tool-button danger" onClick={() => runTableCommand(deleteTable)}>
            <IconTableDelete />
            {t('ribbonDeleteTable')}
          </button>
          <div className="ribbon-group-label">{t('ribbonGroupDelete')}</div>
        </div>
        <div className="ribbon-sep" />
        <div className="table-tool-group">
          <div className="table-tool-grid table-tool-grid-four">
            <button onClick={() => runTableCommand(addRowBefore)}>
              <IconRowInsertAbove />
              {t('ribbonInsertAbove')}
            </button>
            <button onClick={() => runTableCommand(addRowAfter)}>
              <IconRowInsertBelow />
              {t('ribbonInsertBelow')}
            </button>
            <button onClick={() => runTableCommand(addColumnBefore)}>
              <IconColInsertLeft />
              {t('ribbonInsertLeft')}
            </button>
            <button onClick={() => runTableCommand(addColumnAfter)}>
              <IconColInsertRight />
              {t('ribbonInsertRight')}
            </button>
          </div>
          <div className="ribbon-group-label">{t('ribbonGroupRowsCols')}</div>
        </div>
        <div className="ribbon-sep" />
        <div className="table-tool-group">
          <div className="table-tool-row">
            <button disabled={!fs.canMergeCells} onClick={() => runTableCommand(mergeCells)}>
              <IconMergeCells />
              {t('ribbonMergeCells')}
            </button>
            <button disabled={!fs.canSplitCell} onClick={() => runTableCommand(splitCell)}>
              <IconSplitCells />
              {t('ribbonSplitCells')}
            </button>
          </div>
          <div className="ribbon-group-label">{t('ribbonGroupMerge')}</div>
        </div>
        <div className="ribbon-sep" />
        <div className="table-tool-group">
          <div className="table-tool-grid table-tool-grid-two">
            <button onClick={() => runTableCommand(deleteRow)}>
              <IconRowDelete />
              {t('ribbonDeleteRow')}
            </button>
            <button onClick={() => runTableCommand(deleteColumn)}>
              <IconColDelete />
              {t('ribbonDeleteColumn')}
            </button>
          </div>
          <div className="ribbon-group-label">{t('ribbonGroupRowColOps')}</div>
        </div>
        <div className="ribbon-sep" />
        <div className="table-tool-group">
          <div className="table-tool-row">
            {(
              [
                ['top', t('ribbonAlignTop'), IconCellAlignTop],
                ['center', t('ribbonAlignMiddle'), IconCellAlignMiddle],
                ['bottom', t('ribbonAlignBottom'), IconCellAlignBottom],
              ] as const
            ).map(([v, label, Icon]) => (
              <button
                key={v}
                className={
                  (activeCellInfo?.vAlign ?? 'top') === v
                    ? 'table-tool-button active'
                    : 'table-tool-button'
                }
                onClick={() => runTableCommand(setCellAttr('vAlign', v === 'top' ? null : v))}
              >
                <Icon />
                {label}
              </button>
            ))}
          </div>
          <div className="ribbon-group-label">{t('ribbonGroupAlignment')}</div>
        </div>
        <div className="ribbon-sep" />
        <div className="table-tool-group">
          <div className="table-tool-row">
            {(
              [
                ['left', t('appAlignLeft'), IconAlignLeft],
                ['center', t('appAlignCenter'), IconAlignCenter],
                ['right', t('appAlignRight'), IconAlignRight],
              ] as const
            ).map(([v, label, Icon]) => (
              <button
                key={v}
                className={
                  (editor.getAttributes('docTable').tblAlign ?? 'left') === v
                    ? 'table-tool-button active'
                    : 'table-tool-button'
                }
                title={label}
                // explicit 'left' (not null): the save path must strip an existing w:jc
                onClick={() => chain().updateAttributes('docTable', { tblAlign: v }).run()}
              >
                <Icon />
                {label}
              </button>
            ))}
          </div>
          <div className="ribbon-group-label">{t('ribbonGroupTableAlign')}</div>
        </div>
        <div className="ribbon-sep" />
        <div className="table-tool-group">
          <div className="table-tool-row table-size-inputs" key={activeCellInfo?.key ?? 'nosel'}>
            <label>
              {t('ribbonRowHeight')}
              <input
                type="number"
                min={0}
                max={maxRowHeightCm}
                step={0.1}
                placeholder={t('ribbonAuto')}
                defaultValue={activeCellInfo?.heightCm ? activeCellInfo.heightCm.toFixed(2) : ''}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const input = e.target as HTMLInputElement
                    const v = parseFloat(input.value)
                    const next = Number.isFinite(v) && v > 0 ? Math.min(v, maxRowHeightCm) : null
                    if (next !== null) input.value = next.toFixed(2)
                    applyRowHeight(next)
                  }
                }}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value)
                  const cur = activeCellInfo?.heightCm ?? null
                  const next = Number.isFinite(v) && v > 0 ? Math.min(v, maxRowHeightCm) : null
                  if (next !== null) e.target.value = next.toFixed(2)
                  if (next !== cur && (next !== null || cur !== null)) applyRowHeight(next)
                }}
              />
              {t('ribbonCm')}
            </label>
            <label>
              {t('ribbonColumnWidth')}
              <input
                type="number"
                min={0}
                max={(sectionContentWidthPx / 96) * 2.54}
                step={0.1}
                placeholder={t('ribbonAuto')}
                defaultValue={activeCellInfo?.widthCm ? activeCellInfo.widthCm.toFixed(2) : ''}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = parseFloat((e.target as HTMLInputElement).value)
                    if (Number.isFinite(v) && v > 0) applyColumnWidth(v)
                  }
                }}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value)
                  if (
                    Number.isFinite(v) &&
                    v > 0 &&
                    Math.abs(v - (activeCellInfo?.widthCm ?? 0)) > 0.01
                  ) {
                    applyColumnWidth(v)
                  }
                }}
              />
              {t('ribbonCm')}
            </label>
          </div>
          <div className="ribbon-group-label">{t('ribbonGroupCellSize')}</div>
        </div>
        <div className="ribbon-sep" />
        <div className="table-tool-group table-tool-autofit">
          <div className="table-tool-row">
            <div className="rb-split-wrap table-autofit-wrap">
              <button
                className={`table-command-button${dropdown === 'tableAutoFit' ? ' active' : ''}`}
                data-tip={t('ribbonAutoFit')}
                aria-expanded={dropdown === 'tableAutoFit'}
                onClick={() =>
                  setDropdown((current: any) =>
                    current === 'tableAutoFit' ? null : 'tableAutoFit',
                  )
                }
              >
                <IconAutoFit size={18} />
                <span className="table-command-copy">
                  <span>{t('ribbonAutoFit')}</span>
                  <small>{t(tableAutoFitLabel)}</small>
                </span>
                <IconCaret size={12} />
              </button>
              {dropdown === 'tableAutoFit' && (
                <div data-rb-panel="" className="layout-menu table-autofit-menu">
                  {TABLE_AUTO_FIT_OPTIONS.map(([mode, label]) => (
                    <button
                      key={mode}
                      className={tableAutoFitMode === mode ? 'active' : ''}
                      onClick={() => {
                        runTableCommand(setTableAutoFit(mode, sectionContentWidthPx))
                        setDropdown(null)
                      }}
                    >
                      <IconAutoFit size={17} />
                      <span>{t(label)}</span>
                      <span className="table-menu-state" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="ribbon-group-label">{t('ribbonAutoFit')}</div>
        </div>
        <div className="ribbon-sep" />
        <div className="table-tool-group table-tool-advanced">
          <div className="table-tool-stack">
            <button
              className={
                tableHeader.active
                  ? 'table-command-row table-tool-button active'
                  : 'table-command-row table-tool-button'
              }
              disabled={!tableHeader.enabled}
              aria-pressed={tableHeader.active}
              onClick={() => runTableCommand(toggleRepeatHeaderRows())}
            >
              <IconRepeatHeader size={17} />
              <span>{t('ribbonRepeatHeaderRows')}</span>
            </button>
            <button
              className="table-command-row"
              onClick={() => {
                setDropdown(null)
                setTablePropertiesOpen(true)
              }}
            >
              <IconTableProperties size={17} />
              <span>{t('ribbonTableProperties')}</span>
            </button>
          </div>
          <div className="ribbon-group-label">{t('ribbonTableData')}</div>
        </div>
      </div>
    </>
  )
}
