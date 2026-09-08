/**
 * Range → PNG rendering by cropping the live grid canvas. The screen mapping
 * mirrors shape-draw.ts: CSS px = surface + (scene − viewportScroll) × zoom,
 * where scene coordinates are unscaled sheet units offset by the header
 * strips (rowHeaderWidthAndMarginLeft / columnHeaderHeightAndMarginTop), and
 * the backing-store crop multiplies by the canvas device ratio.
 */
import { IRenderManagerService, SHEET_VIEWPORT_KEY } from '@univerjs/engine-render'
import { SheetSkeletonManagerService } from '@univerjs/preset-sheets-core'

import type { UniverRuntime } from './univer-state'

export interface AbsoluteRange {
  readonly startRow: number
  readonly endRow: number
  readonly startColumn: number
  readonly endColumn: number
}

export type RangeImageOutcome =
  | { readonly ok: true; readonly dataUrl: string }
  | { readonly ok: false; readonly reason: 'too-large' | 'render' }

const waitFrames = (frames: number): Promise<void> =>
  new Promise((resolve) => {
    const step = (left: number): void => {
      if (left <= 0) resolve()
      else requestAnimationFrame(() => step(left - 1))
    }
    step(frames)
  })

function fullyVisible(range: AbsoluteRange, visible: AbsoluteRange): boolean {
  return (
    range.startRow >= visible.startRow &&
    range.endRow <= visible.endRow &&
    range.startColumn >= visible.startColumn &&
    range.endColumn <= visible.endColumn
  )
}

/// Renders one absolute range. Scrolls it into view first when needed; a
/// range taller/wider than the viewport is refused ('too-large') the same
/// way WPS refuses to snapshot an off-screen selection.
export async function renderRangeToPng(
  runtime: UniverRuntime,
  range: AbsoluteRange,
): Promise<RangeImageOutcome> {
  const workbook = runtime.univerAPI.getActiveWorkbook()
  const worksheet = workbook?.getActiveSheet()
  if (!workbook || !worksheet) return { ok: false, reason: 'render' }
  const render = runtime.univer
    .__getInjector()
    .get(IRenderManagerService)
    .getRenderById(workbook.getId())
  const skeleton = render?.with(SheetSkeletonManagerService).getCurrentSkeleton()
  const canvas = render?.engine.getCanvasElement()
  if (!render || !skeleton || !canvas || !canvas.isConnected) return { ok: false, reason: 'render' }

  // Scroll the range into view, then give the repaint a few frames.
  try {
    await runtime.univerAPI.executeCommand('sheet.command.scroll-to-cell', {
      range,
      forceTop: true,
      forceLeft: true,
    })
  } catch {
    /* already at the best scroll position */
  }
  await waitFrames(4)

  const visible = worksheet.getVisibleRange() as AbsoluteRange | undefined
  if (!visible || !fullyVisible(range, visible)) return { ok: false, reason: 'too-large' }

  const rows = skeleton.rowHeightAccumulation
  const columns = skeleton.columnWidthAccumulation
  const sceneLeft = range.startColumn > 0 ? (columns[range.startColumn - 1] ?? 0) : 0
  const sceneRight = columns[Math.min(range.endColumn, columns.length - 1)] ?? 0
  const sceneTop = range.startRow > 0 ? (rows[range.startRow - 1] ?? 0) : 0
  const sceneBottom = rows[Math.min(range.endRow, rows.length - 1)] ?? 0
  if (sceneRight <= sceneLeft || sceneBottom <= sceneTop) return { ok: false, reason: 'render' }

  const viewMain = render.scene.getViewport(SHEET_VIEWPORT_KEY.VIEW_MAIN)
  const scrollX = viewMain?.viewportScrollX ?? 0
  const scrollY = viewMain?.viewportScrollY ?? 0
  const zoom = worksheet.getZoom() || 1
  // The canvas carries the header strips (headers draw inside the same
  // scene), so shift the grid-space rect by the header margins before
  // applying zoom — identical to shape-draw.ts's getCellRect handling.
  const surface = canvas.getBoundingClientRect()
  const deviceRatio = surface.width > 0 ? canvas.width / surface.width : 1
  const cssLeft = surface.x + (sceneLeft + skeleton.rowHeaderWidthAndMarginLeft - scrollX) * zoom
  const cssRight = surface.x + (sceneRight + skeleton.rowHeaderWidthAndMarginLeft - scrollX) * zoom
  const cssTop = surface.y + (sceneTop + skeleton.columnHeaderHeightAndMarginTop - scrollY) * zoom
  const cssBottom =
    surface.y + (sceneBottom + skeleton.columnHeaderHeightAndMarginTop - scrollY) * zoom

  const sx = Math.round((cssLeft - surface.x) * deviceRatio)
  const sy = Math.round((cssTop - surface.y) * deviceRatio)
  const sw = Math.round((cssRight - cssLeft) * deviceRatio)
  const sh = Math.round((cssBottom - cssTop) * deviceRatio)
  if (sw <= 0 || sh <= 0 || sx < 0 || sy < 0 || sx + sw > canvas.width || sy + sh > canvas.height)
    return { ok: false, reason: 'too-large' }

  try {
    const crop = document.createElement('canvas')
    crop.width = sw
    crop.height = sh
    const context = crop.getContext('2d')
    if (!context) return { ok: false, reason: 'render' }
    context.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)
    return { ok: true, dataUrl: crop.toDataURL('image/png') }
  } catch {
    return { ok: false, reason: 'render' }
  }
}

/// The bounding box of a discrete copy-cache range (rows/cols coordinates).
export function boundingRange(
  rows: readonly number[],
  cols: readonly number[],
): AbsoluteRange | null {
  if (rows.length === 0 || cols.length === 0) return null
  return {
    startRow: Math.min(...rows),
    endRow: Math.max(...rows),
    startColumn: Math.min(...cols),
    endColumn: Math.max(...cols),
  }
}
