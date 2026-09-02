import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { SectionSettings } from '@chatoffice/docx-engine'

const twipsToPx = (twips: number) => (twips / 1440) * 96

/**
 * Vertical ruler beside the page: inch numbers down the edge, gray top/bottom
 * margin zones. Like Word, the gray/white boundaries are draggable to change
 * the section's top/bottom margins (0.05in snap, live zone feedback).
 */
export function VRuler({
  section,
  onMargins,
}: {
  section: SectionSettings
  onMargins?: (margins: { marginTop?: number; marginBottom?: number }) => void
}) {
  const height = twipsToPx(section.pageHeight)
  const marginTop = twipsToPx(section.marginTop)
  const marginBottom = twipsToPx(section.marginBottom)
  const inches = Math.floor(section.pageHeight / 1440)

  const dragRef = useRef(false)
  const handleMarginMouseDown = (e: ReactPointerEvent<HTMLDivElement>, edge: 'top' | 'bottom') => {
    if (!onMargins) return
    e.preventDefault()
    const handleEl = e.currentTarget
    const rulerEl = handleEl.closest('.vruler') as HTMLElement
    const zone = rulerEl.querySelector(
      edge === 'top' ? '.vruler-zone-top' : '.vruler-zone-bottom',
    ) as HTMLElement | null
    dragRef.current = true
    let snapped = edge === 'top' ? section.marginTop : section.marginBottom
    // capture the pointer on the handle so moves/ups keep flowing to it
    try {
      handleEl.setPointerCapture(e.pointerId)
    } catch {
      /* capture is best-effort */
    }

    const onPointerMove = (ev: PointerEvent) => {
      const rect = rulerEl.getBoundingClientRect()
      const scale = rect.height / height || 1
      const y = (ev.clientY - rect.top) / scale
      // ruler px -> twips via the page's own px/twips ratio
      const rawTwips = edge === 'top' ? (y / height) * section.pageHeight : ((height - y) / height) * section.pageHeight
      snapped = Math.round(rawTwips / 72) * 72
      snapped = Math.max(
        144,
        Math.min(
          snapped,
          section.pageHeight - 720 - (edge === 'top' ? section.marginBottom : section.marginTop),
        ),
      )
      if (zone) {
        if (edge === 'top') {
          zone.style.height = `${twipsToPx(snapped)}px`
        } else {
          zone.style.top = `${height - twipsToPx(snapped)}px`
          zone.style.height = `${twipsToPx(snapped)}px`
        }
      }
    }

    const onPointerUp = () => {
      handleEl.removeEventListener('pointermove', onPointerMove)
      handleEl.removeEventListener('pointerup', onPointerUp)
      handleEl.removeEventListener('pointercancel', onPointerUp)
      try {
        handleEl.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
      dragRef.current = false
      if (snapped !== (edge === 'top' ? section.marginTop : section.marginBottom))
        onMargins(edge === 'top' ? { marginTop: snapped } : { marginBottom: snapped })
    }

    handleEl.addEventListener('pointermove', onPointerMove)
    handleEl.addEventListener('pointerup', onPointerUp)
    handleEl.addEventListener('pointercancel', onPointerUp)
  }

  return (
    <div className="vruler" style={{ height }}>
      <div className="vruler-zone vruler-zone-top" style={{ height: marginTop }} />
      <div
        className="vruler-zone vruler-zone-bottom"
        style={{ top: height - marginBottom, height: marginBottom }}
      />

      {onMargins && (
        <>
          <div
            className="vruler-margin-handle"
            style={{ top: marginTop }}
            onPointerDown={(e) => handleMarginMouseDown(e, 'top')}
          />
          <div
            className="vruler-margin-handle"
            style={{ top: height - marginBottom }}
            onPointerDown={(e) => handleMarginMouseDown(e, 'bottom')}
          />
        </>
      )}

      {Array.from({ length: inches }, (_, i) => (
        <span key={i} className="vruler-num" style={{ top: twipsToPx(i * 1440) }}>
          {i + 1}
        </span>
      ))}
    </div>
  )
}
