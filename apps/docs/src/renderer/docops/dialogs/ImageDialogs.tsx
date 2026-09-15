// 统一图像格式 dialog — the chayuan-wps UniformImageFormatDialog contract
// (width/height with aspect lock, outline width+color, paragraph alignment);
// brightness/contrast ride on the docProtected image channel only, so the
// inline-image dialog omits them honestly.
import { useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useI18n } from '../../i18n/locale'
import { DocOpsField, DocOpsModal, DocOpsNotice, useAutoFocus } from './DocOpsModal'
import { uniformImageFormat } from '../image-ops'

const BORDER_COLORS: Array<{ id: string; hex: string; labelKey: string }> = [
  { id: 'none', hex: '', labelKey: 'docopsBorderNone' },
  { id: 'black', hex: '000000', labelKey: 'docopsBorderBlack' },
  { id: 'gray', hex: '808080', labelKey: 'docopsBorderGray' },
  { id: 'silver', hex: 'C0C0C0', labelKey: 'docopsBorderSilver' },
  { id: 'darkblue', hex: '00008B', labelKey: 'docopsBorderDarkBlue' },
  { id: 'navy', hex: '1F4E79', labelKey: 'docopsBorderNavy' },
]

export function UniformImageFormatDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const { t } = useI18n()
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [lockAspect, setLockAspect] = useState(true)
  const [borderOn, setBorderOn] = useState(false)
  const [borderColorId, setBorderColorId] = useState('black')
  const [borderWidth, setBorderWidth] = useState('1')
  const [align, setAlign] = useState<'none' | 'left' | 'center' | 'right'>('none')
  const [done, setDone] = useState<number | null>(null)
  const widthRef = useRef<HTMLInputElement>(null)
  useAutoFocus(widthRef)

  const w = Number(width)
  const h = Number(height)
  const hasSize = (width !== '' && Number.isFinite(w) && w > 0) || (height !== '' && Number.isFinite(h) && h > 0)
  const borderValid = !borderOn || (Number.isFinite(Number(borderWidth)) && Number(borderWidth) > 0)
  const valid = (hasSize || borderOn || align !== 'none') && borderValid

  const run = () => {
    if (!valid) return
    const color = BORDER_COLORS.find((c) => c.id === borderColorId)
    const outcome = uniformImageFormat(editor, {
      widthPx: width !== '' && Number.isFinite(w) && w > 0 ? w : null,
      heightPx: height !== '' && Number.isFinite(h) && h > 0 ? h : null,
      lockAspect,
      borderColor: borderOn ? (color?.hex || '000000') : null,
      borderWidthPt: borderOn ? Number(borderWidth) : null,
      align: align === 'none' ? null : align,
    })
    setDone(outcome.count)
  }

  return (
    <DocOpsModal
      title={t('docopsUniformImageTitle')}
      onClose={onClose}
      width={440}
      footer={
        done === null ? (
          <>
            <button className="btn-ghost" onClick={onClose}>
              {t('appCancel')}
            </button>
            <button className="btn-primary" disabled={!valid} onClick={run}>
              {t('appOk')}
            </button>
          </>
        ) : (
          <button className="btn-primary" onClick={onClose}>
            {t('appOk')}
          </button>
        )
      }
    >
      <div className="docops-two-col">
        <DocOpsField label={t('docopsImgWidthPx')}>
          <input
            ref={widthRef}
            type="number"
            min={1}
            value={width}
            placeholder="—"
            onChange={(e) => setWidth(e.target.value)}
          />
        </DocOpsField>
        <DocOpsField label={t('docopsImgHeightPx')}>
          <input
            type="number"
            min={1}
            value={height}
            placeholder="—"
            onChange={(e) => setHeight(e.target.value)}
          />
        </DocOpsField>
      </div>
      <label className="docops-check-row">
        <input type="checkbox" checked={lockAspect} onChange={(e) => setLockAspect(e.target.checked)} />
        {t('docopsLockAspect')}
      </label>
      <label className="docops-check-row">
        <input type="checkbox" checked={borderOn} onChange={(e) => setBorderOn(e.target.checked)} />
        {t('docopsImageBorder')}
      </label>
      {borderOn && (
        <div className="docops-two-col">
          <DocOpsField label={t('docopsBorderWidthPt')}>
            <input
              type="number"
              min={0.25}
              max={20}
              step={0.25}
              value={borderWidth}
              onChange={(e) => setBorderWidth(e.target.value)}
            />
          </DocOpsField>
          <DocOpsField label={t('docopsBorderColor')}>
            <select value={borderColorId} onChange={(e) => setBorderColorId(e.target.value)}>
              {BORDER_COLORS.map((c) => (
                <option key={c.id} value={c.id}>
                  {t(c.labelKey as never)}
                </option>
              ))}
            </select>
          </DocOpsField>
        </div>
      )}
      <DocOpsField label={t('docopsImageAlign')}>
        <select value={align} onChange={(e) => setAlign(e.target.value as typeof align)}>
          <option value="none">{t('docopsAlignUnchanged')}</option>
          <option value="left">{t('docopsAlignLeft')}</option>
          <option value="center">{t('docopsAlignCenter')}</option>
          <option value="right">{t('docopsAlignRight')}</option>
        </select>
      </DocOpsField>
      {done !== null && (
        <DocOpsNotice kind="info" text={t('docopsImagesUpdated', { count: done })} />
      )}
    </DocOpsModal>
  )
}
