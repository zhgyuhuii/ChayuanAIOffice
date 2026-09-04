/** 图片压缩：非破坏参数之外的显式重采样（Word「压缩图片」） */

/** 分辨率预设（ppi）；显示尺寸由文档排版决定，源像素超过需要即降采样 */
export const COMPRESS_PRESETS = [
  { id: 'print', ppi: 220 },
  { id: 'web', ppi: 150 },
  { id: 'email', ppi: 96 },
] as const

export type CompressPresetId = (typeof COMPRESS_PRESETS)[number]['id']

/**
 * Re-encodes an image data URL at `ppi` for a picture displayed at
 * `displayWidthPx/HeightPx` (CSS px at 96dpi). Returns the original when the
 * source is already at or below the target resolution. `deleteCrop` bakes
 * nothing here — callers keep crop parametrics; the flag only matters for
 * whether the CROPPED or FULL frame drives the target size (cropped area
 * deletion re-encodes against the cropped window).
 */
export async function compressImageForDisplay(
  dataUrl: string,
  displayWidthPx: number,
  displayHeightPx: number,
  ppi: number,
  options?: { deleteCrop?: boolean; croppedFramePx?: { width: number; height: number } },
): Promise<string> {
  const img = await loadImage(dataUrl)
  const frame = options?.deleteCrop && options.croppedFramePx
    ? options.croppedFramePx
    : { width: displayWidthPx, height: displayHeightPx }
  const scale = ppi / 96
  const targetW = Math.max(1, Math.round(frame.width * scale))
  const targetH = Math.max(1, Math.round(frame.height * scale))
  // Source already no larger than the target: keep the original bytes.
  if (img.naturalWidth <= targetW && img.naturalHeight <= targetH) return dataUrl
  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, targetW, targetH)
  const isJpeg = /^data:image\/jpeg/i.test(dataUrl)
  return isJpeg ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png')
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image decode failed'))
    img.src = src
  })
}
