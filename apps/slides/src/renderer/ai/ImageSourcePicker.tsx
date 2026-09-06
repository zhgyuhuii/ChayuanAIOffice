/**
 * ImageSourcePicker — deck imagery source control for the AI composer: the
 * five-value source select (auto/web/model/local/svg) plus the local-folder
 * flow. Picking 'local' opens the folder scan; the preview grid (default
 * all-selected) feeds the confirmed pool used by generate_deck's 'local'
 * source. Every source choice persists to settings.imageSource immediately —
 * the override becomes the new default (last use wins,
 * docs/image-source-plan.md #1/#7/#8).
 */
import React, { useRef, useState } from 'react'
import type { AiImageSource } from '@chatoffice/ai-provider'
import { useI18n } from '../i18n/locale'

const SOURCES: AiImageSource[] = ['auto', 'web', 'model', 'local', 'svg']

export interface ImageSourcePickerProps {
  source: AiImageSource
  poolCount: number
  onSourceChange: (s: AiImageSource) => void
  onPoolChange: (items: string[]) => void
}

interface ScanItem {
  name: string
  dataUri: string
  vector: boolean
}

export function ImageSourcePicker({
  source,
  poolCount,
  onSourceChange,
  onPoolChange,
}: ImageSourcePickerProps): React.JSX.Element {
  const { t } = useI18n()
  const [preview, setPreview] = useState<ScanItem[] | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const scanningRef = useRef(false)

  const LABELS: Record<AiImageSource, string> = {
    auto: t('aiImgSrcAuto'),
    web: t('aiImgSrcWeb'),
    model: t('aiImgSrcModel'),
    local: t('aiImgSrcLocal'),
    svg: t('aiImgSrcSvg'),
  }

  const scan = async () => {
    if (scanningRef.current) return
    scanningRef.current = true
    setScanning(true)
    setError('')
    try {
      const r = await window.slidesApi.pickImageFolder()
      if (r.canceled) return
      if (r.error) {
        setError(t('aiImgSrcScanFail', { err: r.error }))
        return
      }
      if (!r.items.length) {
        setError(t('aiImgSrcNone'))
        return
      }
      setPreview(r.items)
      setChecked(new Set(r.items.map((_, i) => i)))
    } catch (e) {
      setError(t('aiImgSrcScanFail', { err: e instanceof Error ? e.message : String(e) }))
    } finally {
      scanningRef.current = false
      setScanning(false)
    }
  }

  const confirm = () => {
    if (!preview) return
    onPoolChange(preview.filter((_, i) => checked.has(i)).map((it) => it.dataUri))
    setPreview(null)
  }

  return (
    <>
      <select
        className="ai-imgsrc-select"
        value={source}
        aria-label={t('aiImgSrcLabel')}
        title={t('aiImgSrcLabel')}
        onChange={(e) => {
          const s = e.target.value as AiImageSource
          onSourceChange(s)
          if (s === 'local' && poolCount === 0) void scan()
        }}
      >
        {SOURCES.map((s) => (
          <option key={s} value={s}>
            {LABELS[s]}
          </option>
        ))}
      </select>
      {source === 'local' && (
        <button
          className="ai-attach-btn"
          onClick={() => void scan()}
          disabled={scanning}
          data-tip={t('aiImgSrcPickFolder')}
          aria-label={t('aiImgSrcPickFolder')}
        >
          {scanning ? '…' : `📁${poolCount ? ` ${poolCount}` : ''}`}
        </button>
      )}
      {error && <span className="ai-imgsrc-error">{error}</span>}
      {preview && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            background: 'rgba(0,0,0,.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setPreview(null)}
        >
          <div
            style={{
              background: 'var(--bg, #ffffff)',
              color: 'var(--text, #1a1a1a)',
              borderRadius: 10,
              padding: 16,
              maxWidth: 720,
              maxHeight: '80vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('aiImgSrcTitle')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 96px)', gap: 8 }}>
              {preview.map((it, i) => (
                <label
                  key={i}
                  style={{ display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer', fontSize: 11 }}
                >
                  <img
                    src={it.dataUri}
                    alt={it.name}
                    style={{
                      width: 96,
                      height: 72,
                      objectFit: 'cover',
                      borderRadius: 6,
                      border: checked.has(i) ? '2px solid #2563eb' : '2px solid transparent',
                    }}
                  />
                  <span
                    style={{
                      display: 'flex',
                      gap: 4,
                      alignItems: 'center',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked.has(i)}
                      onChange={(e) => {
                        setChecked((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(i)
                          else next.delete(i)
                          return next
                        })
                      }}
                    />
                    {it.name}
                  </span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button onClick={() => setPreview(null)}>{t('aiImgSrcCancel')}</button>
              <button disabled={checked.size === 0} onClick={confirm}>
                {t('aiImgSrcConfirm', { n: checked.size })}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
