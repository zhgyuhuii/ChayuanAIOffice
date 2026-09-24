// Table batch dialogs (删除文字所在行/列, 追加替换文字, 手动列宽度, 第一行/列样式,
// 表格/图像题注) — the chayuan-wps dialog contracts rebuilt on the shared
// DocOpsModal shell. Three-step 删除流程 (form → confirm count → done) mirrors
// the wps DeleteTextDialog.
import { useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useI18n } from '../../i18n/locale'
import { DocOpsField, DocOpsModal, DocOpsNotice, useAutoFocus } from './DocOpsModal'
import {
  addCaptions,
  appendReplaceCellText,
  deleteHitRowsColumns,
  previewTextHits,
  setManualColumnWidth,
  applyFirstRowColStyle,
  type TableStylePreset,
} from '../table-ops'
import { imageCaptionRanges, tableCaptionRanges } from '../image-ops'

// ---- 删除文字所在行 / 删除文字所在列 ------------------------------------------

export function DeleteTextDialog({
  editor,
  mode,
  onClose,
}: {
  editor: Editor
  mode: 'row' | 'column'
  onClose: () => void
}) {
  const { t } = useI18n()
  const [keyword, setKeyword] = useState('')
  const [kind, setKind] = useState<'row' | 'column'>(mode)
  const [hits, setHits] = useState<number | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useAutoFocus(inputRef)

  const search = () => {
    if (!keyword.trim()) return
    setDone(null)
    setHits(previewTextHits(editor, keyword.trim(), kind).length)
  }
  const confirmDelete = () => {
    const found = previewTextHits(editor, keyword.trim(), kind)
    const outcome = deleteHitRowsColumns(editor, found, kind)
    setHits(null)
    setDone(outcome.count)
  }

  return (
    <DocOpsModal
      title={kind === 'row' ? t('docopsDeleteTextRowTitle') : t('docopsDeleteTextColTitle')}
      onClose={onClose}
      width={420}
      footer={
        done === null ? (
          <>
            <button className="btn-ghost" onClick={onClose}>
              {t('appCancel')}
            </button>
            {hits === null ? (
              <button className="btn-primary" disabled={!keyword.trim()} onClick={search}>
                {t('docopsSearch')}
              </button>
            ) : (
              <button className="btn-primary" disabled={hits === 0} onClick={confirmDelete}>
                {t('docopsConfirmDelete')}
              </button>
            )}
          </>
        ) : (
          <button className="btn-primary" onClick={onClose}>
            {t('appOk')}
          </button>
        )
      }
    >
      <div className="docops-radio-row" role="radiogroup">
        <label>
          <input
            type="radio"
            name="delTextMode"
            checked={kind === 'row'}
            onChange={() => setKind('row')}
          />
          {t('docopsDeleteTextRowTitle')}
        </label>
        <label>
          <input
            type="radio"
            name="delTextMode"
            checked={kind === 'column'}
            onChange={() => setKind('column')}
          />
          {t('docopsDeleteTextColTitle')}
        </label>
      </div>
      <DocOpsField label={t('docopsKeyword')}>
        <input
          ref={inputRef}
          value={keyword}
          placeholder={t('docopsKeywordPlaceholder')}
          onChange={(e) => {
            setKeyword(e.target.value)
            setHits(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && search()}
        />
      </DocOpsField>
      {hits !== null && (
        <DocOpsNotice
          kind={hits > 0 ? 'info' : 'warn'}
          text={t('docopsFoundCount', { count: hits })}
        />
      )}
      {done !== null && (
        <DocOpsNotice kind="info" text={t('docopsDeletedCount', { count: done })} />
      )}
    </DocOpsModal>
  )
}

// ---- 追加替换文字 --------------------------------------------------------------

export function AppendReplaceTextDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const { t } = useI18n()
  const [find, setFind] = useState('')
  const [mode, setMode] = useState<'replace' | 'append'>('replace')
  const [content, setContent] = useState('')
  const [done, setDone] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useAutoFocus(inputRef)

  const run = () => {
    const outcome = appendReplaceCellText(editor, find.trim(), content, mode)
    setDone(outcome.count)
  }

  return (
    <DocOpsModal
      title={t('docopsAppendReplaceTitle')}
      onClose={onClose}
      width={400}
      footer={
        done === null ? (
          <>
            <button className="btn-ghost" onClick={onClose}>
              {t('appCancel')}
            </button>
            <button className="btn-primary" disabled={!find.trim()} onClick={run}>
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
      <DocOpsField label={t('docopsFindText')}>
        <input
          ref={inputRef}
          value={find}
          onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && find.trim() && run()}
        />
      </DocOpsField>
      <div className="docops-radio-row" role="radiogroup">
        <label>
          <input
            type="radio"
            name="appendReplaceMode"
            checked={mode === 'replace'}
            onChange={() => setMode('replace')}
          />
          {t('docopsReplaceWith')}
        </label>
        <label>
          <input
            type="radio"
            name="appendReplaceMode"
            checked={mode === 'append'}
            onChange={() => setMode('append')}
          />
          {t('docopsAppendAfter')}
        </label>
      </div>
      <DocOpsField label={mode === 'replace' ? t('docopsReplaceWith') : t('docopsAppendAfter')}>
        <input value={content} onChange={(e) => setContent(e.target.value)} />
      </DocOpsField>
      {done !== null && (
        <DocOpsNotice kind="info" text={t('docopsCellsUpdated', { count: done })} />
      )}
    </DocOpsModal>
  )
}

// ---- 手动列宽度 ----------------------------------------------------------------

export function ManualColWidthDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const { t } = useI18n()
  const [width, setWidth] = useState('60')
  const inputRef = useRef<HTMLInputElement>(null)
  useAutoFocus(inputRef)
  const parsed = Number(width)
  const valid = Number.isFinite(parsed) && parsed >= 5 && parsed <= 500

  const run = () => {
    if (!valid) return
    setManualColumnWidth(editor, parsed)
    onClose()
  }

  return (
    <DocOpsModal
      title={t('docopsManualColWidthTitle')}
      onClose={onClose}
      width={380}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            {t('appCancel')}
          </button>
          <button className="btn-primary" disabled={!valid} onClick={run}>
            {t('appOk')}
          </button>
        </>
      }
    >
      <DocOpsField label={t('docopsColWidthPt')} hint={t('docopsColWidthHint')}>
        <input
          ref={inputRef}
          type="number"
          min={5}
          max={500}
          value={width}
          onChange={(e) => setWidth(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && run()}
        />
      </DocOpsField>
    </DocOpsModal>
  )
}

// ---- 第一行 / 第一列指定样式 -----------------------------------------------------

export const TABLE_STYLE_PRESETS: Array<TableStylePreset & { id: string; labelKey: string }> = [
  { id: 'bold', labelKey: 'docopsStyleBold', bold: true },
  { id: 'grayFill', labelKey: 'docopsStyleGrayFill', bold: true, fill: 'D9D9D9' },
  { id: 'blueFill', labelKey: 'docopsStyleBlueFill', bold: true, fill: 'DDEBF7', color: '1F4E79' },
  { id: 'greenFill', labelKey: 'docopsStyleGreenFill', bold: true, fill: 'E2EFDA', color: '375623' },
  { id: 'orangeFill', labelKey: 'docopsStyleOrangeFill', bold: true, fill: 'FCE4D6', color: '833C0C' },
  { id: 'center', labelKey: 'docopsStyleCenter', align: 'center', bold: true },
]

export function TableStyleDialog({
  editor,
  target,
  onClose,
}: {
  editor: Editor
  target: 'column' | 'row'
  onClose: () => void
}) {
  const { t } = useI18n()
  const [presetId, setPresetId] = useState('bold')
  const [done, setDone] = useState<number | null>(null)
  const preset = TABLE_STYLE_PRESETS.find((p) => p.id === presetId)

  const run = () => {
    if (!preset) return
    const outcome = applyFirstRowColStyle(editor, target, preset)
    setDone(outcome.count)
  }

  return (
    <DocOpsModal
      title={target === 'column' ? t('docopsFirstColStyleTitle') : t('docopsFirstRowStyleTitle')}
      onClose={onClose}
      width={460}
      footer={
        done === null ? (
          <>
            <button className="btn-ghost" onClick={onClose}>
              {t('appCancel')}
            </button>
            <button className="btn-primary" disabled={!preset} onClick={run}>
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
      <div className="docops-style-grid">
        {TABLE_STYLE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`docops-style-card${presetId === p.id ? ' selected' : ''}`}
            onClick={() => setPresetId(p.id)}
          >
            <span
              className="docops-style-swatch"
              style={{
                background: p.fill ? `#${p.fill}` : undefined,
                color: p.color ? `#${p.color}` : undefined,
                fontWeight: p.bold ? 700 : 400,
              }}
            >
              {t('docopsStyleSwatch')}
            </span>
            <span>{t(p.labelKey as never)}</span>
          </button>
        ))}
      </div>
      {done !== null && (
        <DocOpsNotice kind="info" text={t('docopsCellsUpdated', { count: done })} />
      )}
    </DocOpsModal>
  )
}

// ---- 添加题注（表格 / 图像共用） ---------------------------------------------------

export function CaptionDialog({
  editor,
  kind,
  onClose,
}: {
  editor: Editor
  kind: 'table' | 'image'
  onClose: () => void
}) {
  const { t } = useI18n()
  const [label, setLabel] = useState(kind === 'table' ? '表' : '图')
  const [suffix, setSuffix] = useState('')
  const [position, setPosition] = useState<'above' | 'below'>('above')
  const [done, setDone] = useState<number | null>(null)
  const labelRef = useRef<HTMLInputElement>(null)
  useAutoFocus(labelRef)

  const run = () => {
    const ranges = kind === 'table' ? tableCaptionRanges(editor) : imageCaptionRanges(editor)
    const outcome = addCaptions(editor, ranges, { label: label.trim(), suffix, position })
    setDone(outcome.count)
  }

  return (
    <DocOpsModal
      title={kind === 'table' ? t('docopsTableCaptionTitle') : t('docopsImageCaptionTitle')}
      onClose={onClose}
      width={400}
      footer={
        done === null ? (
          <>
            <button className="btn-ghost" onClick={onClose}>
              {t('appCancel')}
            </button>
            <button className="btn-primary" disabled={!label.trim()} onClick={run}>
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
      <DocOpsField label={t('docopsCaptionLabel')} hint={t('docopsCaptionLabelHint')}>
        <input ref={labelRef} value={label} onChange={(e) => setLabel(e.target.value)} />
      </DocOpsField>
      <DocOpsField label={t('docopsCaptionSuffix')} hint={t('docopsCaptionSuffixHint')}>
        <input value={suffix} onChange={(e) => setSuffix(e.target.value)} />
      </DocOpsField>
      <div className="docops-radio-row" role="radiogroup">
        <label>
          <input
            type="radio"
            name="captionPos"
            checked={position === 'above'}
            onChange={() => setPosition('above')}
          />
          {t('docopsCaptionAbove')}
        </label>
        <label>
          <input
            type="radio"
            name="captionPos"
            checked={position === 'below'}
            onChange={() => setPosition('below')}
          />
          {t('docopsCaptionBelow')}
        </label>
      </div>
      {done !== null && (
        <DocOpsNotice kind="info" text={t('docopsCaptionsAdded', { count: done })} />
      )}
    </DocOpsModal>
  )
}
