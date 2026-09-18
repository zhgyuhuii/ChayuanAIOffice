import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { pdfRectToCss, viewToPdf } from './annotations'
import type { PageGeom } from './annotations'
import type { RedactionInput } from '../shared/ipc'

export interface LocalRedaction extends RedactionInput {
  id: string
}

export function RedactionLayer({
  active,
  geom,
  scale,
  pageWidth,
  pageHeight,
  marks,
  onCommit,
}: {
  active: boolean
  geom: PageGeom
  scale: number
  pageWidth: number
  pageHeight: number
  marks: LocalRedaction[]
  onCommit: (rect: RedactionInput['rect']) => void
}) {
  const [live, setLive] = useState<RedactionInput['rect'] | null>(null)
  const start = useRef<[number, number] | null>(null)
  const toPdf = (e: ReactPointerEvent): [number, number] => {
    const box = e.currentTarget.getBoundingClientRect()
    return viewToPdf(geom, (e.clientX - box.left) / scale, (e.clientY - box.top) / scale)
  }
  const down = (e: ReactPointerEvent) => {
    if (!active || e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = toPdf(e)
  }
  const move = (e: ReactPointerEvent) => {
    if (!active || !start.current) return
    const [x, y] = toPdf(e)
    const [sx, sy] = start.current
    setLive([Math.min(sx, x), Math.min(sy, y), Math.max(sx, x), Math.max(sy, y)])
  }
  const up = () => {
    const rect = live
    start.current = null
    setLive(null)
    if (!rect || rect[2] - rect[0] < 3 || rect[3] - rect[1] < 3) return
    onCommit(rect)
  }
  const all = [...marks.map((mark) => mark.rect), ...(live ? [live] : [])]
  return (
    <div
      className="pdf-redaction-layer"
      style={{
        width: pageWidth * scale,
        height: pageHeight * scale,
        pointerEvents: active ? 'auto' : 'none',
      }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {all.map((rect, index) => (
        <div
          key={index}
          className="pdf-redaction-mark"
          style={pdfRectToCss(geom, rect, scale)}
          aria-label="Pending redaction"
        />
      ))}
    </div>
  )
}
