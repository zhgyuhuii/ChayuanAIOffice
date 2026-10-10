/**
 * Render-side image transcoding for the insert pipelines. docx/xlsx embedding
 * only accepts png/jpeg/gif (the OOXML media types old Word/Excel revisions
 * open), yet sources routinely hand us webp (Gemini image replies, CDN
 * thumbnails), bmp or avif — previously those were silently dropped by the
 * insert guards after the dialog had already closed ("窗口一闪、没插入").
 * decode → canvas → re-encode as png; null when the bytes cannot be decoded.
 */

const PIPELINE_SUPPORTED = /^data:image\/(?:png|jpeg|gif);base64,/i
const DATA_IMAGE = /^data:(image\/[a-z0-9.+-]+);base64,/i

function loadImage(src: string, timeoutMs = 8_000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // a decode that never settles (broken embedder, frozen compositor) must
    // not hang the insert flow — the dialog would sit open forever otherwise
    const timer = setTimeout(() => reject(new Error('image decode timed out')), timeoutMs)
    img.onload = () => {
      clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      clearTimeout(timer)
      reject(new Error('image decode failed'))
    }
    img.src = src
  })
}

/**
 * Pass through data URLs the insert pipelines already accept (png/jpeg/gif,
 * including animated gif); re-encode anything else decodable as png; null for
 * non-image data URLs or bytes the renderer cannot decode.
 */
export async function ensurePipelineImage(dataUrl: string): Promise<string | null> {
  if (PIPELINE_SUPPORTED.test(dataUrl)) return dataUrl
  if (!DATA_IMAGE.test(dataUrl)) return null
  try {
    const img = await loadImage(dataUrl)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || 1
    canvas.height = img.naturalHeight || 1
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    const png = canvas.toDataURL('image/png')
    return PIPELINE_SUPPORTED.test(png) ? png : null
  } catch {
    return null
  }
}
