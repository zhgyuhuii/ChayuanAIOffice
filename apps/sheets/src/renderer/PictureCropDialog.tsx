import { useEffect, useRef, useState } from 'react'

import { t } from './i18n/locale'

export interface PictureCropRect {
  readonly l: number
  readonly t: number
  readonly r: number
  readonly b: number
}

const MIN_SPAN = 0.05

/**
 * Non-destructive crop editor: the full original is shown with a dimmed
 * crop frame; eight handles adjust the srcRect fractions that will ride the
 * saved `<a:srcRect>`. Enter applies, Esc cancels — the visual keeps its
 * original bytes, so a crop is always reversible (重设图片).
 */
export function PictureCropDialog({
  getSource,
  srcRect,
  onApply,
  onClose,
}: {
  readonly getSource: () => Promise<{ mediaType: string; base64: string } | null>
  readonly srcRect: PictureCropRect | null
  readonly onApply: (srcRect: PictureCropRect) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const [source, setSource] = useState<string | null>(null)
  const [crop, setCrop] = useState<PictureCropRect>(srcRect ?? { l: 0, t: 0, r: 0, b: 0 })
  const [drag, setDrag] = useState<{
    corner: string
    startX: number
    startY: number
    start: PictureCropRect
  } | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const cropRef = useRef<PictureCropRect>(crop)
  cropRef.current = crop

  useEffect(() => {
    let isCurrent = true
    void getSource()
      .then((media) => {
        if (!isCurrent || !media) return
        setSource(`data:${media.mediaType};base64,${media.base64}`)
      })
      .catch(() => undefined)
    return () => {
      isCurrent = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        onApply(cropRef.current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const corners = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const

  const onHandleDown = (corner: string) => (event: React.PointerEvent) => {
    const box = boxRef.current?.getBoundingClientRect()
    if (!box) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      corner,
      startX: event.clientX,
      startY: event.clientY,
      start: crop,
    })
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag) return
    const box = boxRef.current?.getBoundingClientRect()
    if (!box) return
    const fx = (event.clientX - drag.startX) / box.width
    const fy = (event.clientY - drag.startY) / box.height
    let { l, t, r, b } = drag.start
    // A left/top edge moves with the pointer; a right/bottom edge mirrors
    // it, so an outward drag restores cropped content (negative deltas).
    if (drag.corner.includes('w')) l = clampSpan(l + fx, r)
    if (drag.corner.includes('e')) r = clampSpan(r - fx, l)
    if (drag.corner.includes('n')) t = clampSpan(t + fy, b)
    if (drag.corner.includes('s')) b = clampSpan(b - fy, t)
    setCrop({ l, t, r, b })
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="format-cells-dialog picture-crop-dialog"
        role="dialog"
        aria-label={t('appPicCropTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header>{t('appPicCropTitle')}</header>
        <section className="dialog-body picture-crop-body">
          <div
            className="picture-crop-stage"
            ref={boxRef}
            onPointerMove={onPointerMove}
            onPointerUp={() => setDrag(null)}
            onPointerCancel={() => setDrag(null)}
          >
            {source ? (
              <img className="picture-crop-image" src={source} alt="" draggable={false} />
            ) : (
              <div className="picture-crop-loading" />
            )}
            <div
              className="picture-crop-frame"
              style={{
                left: `${crop.l * 100}%`,
                top: `${crop.t * 100}%`,
                width: `${Math.max(0, (1 - crop.l - crop.r) * 100)}%`,
                height: `${Math.max(0, (1 - crop.t - crop.b) * 100)}%`,
              }}
            />
            {corners.map((corner) => (
              <span
                key={corner}
                className={`picture-crop-handle handle-${corner}`}
                data-corner={corner}
                onPointerDown={onHandleDown(corner)}
                style={{
                  left: `${(corner.includes('w') ? crop.l : corner.includes('e') ? 1 - crop.r : 0.5) * 100}%`,
                  top: `${(corner.includes('n') ? crop.t : corner.includes('s') ? 1 - crop.b : 0.5) * 100}%`,
                }}
              />
            ))}
          </div>
          <p className="picture-crop-hint">{t('appPicCropHint')}</p>
        </section>
        <footer className="picture-crop-footer">
          <button type="button" onClick={() => setCrop({ l: 0, t: 0, r: 0, b: 0 })}>
            {t('appPicReset')}
          </button>
          <span className="picture-crop-actions">
            <button type="button" onClick={onClose}>
              {t('appPicCropCancel')}
            </button>
            <button type="button" className="primary" onClick={() => onApply(crop)}>
              {t('appPicCropApply')}
            </button>
          </span>
        </footer>
      </div>
    </div>
  )
}

/// One side never moves past the opposite edge (5% of the span stays open).
function clampSpan(value: number, opposite: number): number {
  const min = -opposite + MIN_SPAN
  const max = 1 - MIN_SPAN - opposite
  return Math.min(max, Math.max(min, value))
}
