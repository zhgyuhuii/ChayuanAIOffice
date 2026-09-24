// image-ops — the 图像批量操作 family (6 items) harvested from chayuan-wps
// (docs/chayuan-wps-harvest-analysis.md §4). The wps SaveAsPicture/EMF export
// chain collapses here: docInlineImage carries its dataUrl source directly.
import type { Editor } from '@tiptap/core'
import { applyTr, collectImages, type DocOpOutcome } from './docops-core'
import type { ImageTarget } from './docops-core'

/** 导出全部图像 — {fileName, dataUrl} pairs for the export-files IPC */
export function collectImageFiles(
  editor: Editor,
): Array<{ fileName: string; dataUrl: string }> {
  const images = collectImages(editor.state.doc)
  const out: Array<{ fileName: string; dataUrl: string }> = []
  for (const img of images) {
    const dataUrl = String(img.node.attrs.dataUrl ?? '')
    if (!dataUrl) continue
    const ext = extensionOfDataUrl(dataUrl)
    out.push({ fileName: `图片_${img.index}.${ext}`, dataUrl })
  }
  return out
}

function extensionOfDataUrl(dataUrl: string): string {
  const m = dataUrl.match(/^data:image\/([a-z0-9.+-]+)/i)
  if (m) {
    const t = m[1]!.toLowerCase()
    if (t === 'jpeg') return 'jpg'
    if (t === 'svg+xml') return 'svg'
    return t
  }
  return 'png'
}

/** 删除全部图像 — remove every inline image (descending) */
export function deleteAllImages(editor: Editor): DocOpOutcome {
  const images = collectImages(editor.state.doc)
  if (images.length === 0) return { ok: true, count: 0 }
  applyTr(editor, (tr) => {
    for (let i = images.length - 1; i >= 0; i--) {
      const img = images[i]!
      tr.delete(img.pos, img.pos + img.node.nodeSize)
    }
    return true
  })
  return { ok: true, count: images.length }
}

export interface UniformImageSpec {
  /** target width in px; null keeps the natural width */
  widthPx?: number | null
  heightPx?: number | null
  /** keep aspect ratio: the missing side derives from the original */
  lockAspect?: boolean
  /** outline: color hex (no #) + width in points; null border removes it */
  borderColor?: string | null
  borderWidthPt?: number | null
  /** paragraph alignment for the image's paragraph (null = leave) */
  align?: 'left' | 'center' | 'right' | null
}

/** 统一图像格式 — apply size/border/alignment to every image */
export function uniformImageFormat(editor: Editor, spec: UniformImageSpec): DocOpOutcome {
  const images: ImageTarget[] = collectImages(editor.state.doc)
  if (images.length === 0) return { ok: true, count: 0 }
  const wants =
    spec.widthPx != null ||
    spec.heightPx != null ||
    spec.borderColor !== undefined ||
    spec.align != null
  if (!wants) return { ok: false, count: 0, error: 'empty-spec' }
  applyTr(editor, (tr) => {
    images.forEach((img) => {
      const attrs = { ...img.node.attrs } as Record<string, unknown>
      if (spec.widthPx != null || spec.heightPx != null) {
        const w = Number(img.node.attrs.widthPx) || 0
        const h = Number(img.node.attrs.heightPx) || 0
        let nextW = spec.widthPx ?? null
        let nextH = spec.heightPx ?? null
        if (spec.lockAspect) {
          if (nextW != null && nextH == null && w > 0 && h > 0) {
            nextH = Math.round((h / w) * nextW)
          } else if (nextH != null && nextW == null && w > 0 && h > 0) {
            nextW = Math.round((w / h) * nextH)
          }
        }
        attrs.widthPx = nextW
        attrs.heightPx = nextH
      }
      if (spec.borderColor !== undefined) {
        attrs.border =
          spec.borderColor && (spec.borderWidthPt ?? 0) > 0
            ? { color: spec.borderColor, widthPt: spec.borderWidthPt ?? 0.75 }
            : null
      }
      tr.setNodeMarkup(img.pos, undefined, attrs)
      if (spec.align) {
        // the image's parent paragraph takes the alignment (wps aligns the paragraph)
        const $pos = tr.doc.resolve(tr.mapping.map(img.pos))
        for (let d = $pos.depth; d > 0; d--) {
          const node = $pos.node(d)
          if (node.type.name === 'docParagraph') {
            tr.setNodeMarkup($pos.before(d), undefined, { ...node.attrs, align: spec.align })
            break
          }
        }
      }
    })
    return true
  })
  return { ok: true, count: images.length }
}

/** 清除图像格式 — drop border/explicit size overrides, restore natural size */
export function clearImageFormat(editor: Editor): DocOpOutcome {
  const images = collectImages(editor.state.doc)
  if (images.length === 0) return { ok: true, count: 0 }
  applyTr(editor, (tr) => {
    images.forEach((img) => {
      tr.setNodeMarkup(img.pos, undefined, {
        ...img.node.attrs,
        border: null,
        widthPx: null,
        heightPx: null,
      })
    })
    return true
  })
  return { ok: true, count: images.length }
}

/** 图像题注 uses table-ops' caption engine; expose positions in document order */
export function imageCaptionRanges(editor: Editor): Array<{ from: number; to: number }> {
  // inline images live inside paragraphs; caption anchors on the whole paragraph
  const ranges = new Map<number, { from: number; to: number }>()
  const doc = editor.state.doc
  collectImages(doc).forEach((img) => {
    const $pos = doc.resolve(img.pos)
    for (let d = $pos.depth; d >= 0; d--) {
      const node = $pos.node(d)
      if (node.type.name === 'docParagraph') {
        const from = $pos.before(d)
        if (!ranges.has(from)) ranges.set(from, { from, to: from + node.nodeSize })
        break
      }
    }
  })
  return [...ranges.values()].sort((a, b) => a.from - b.from)
}

/** 表格题注 targets (top-level table ranges, document order) */
export function tableCaptionRanges(editor: Editor): Array<{ from: number; to: number }> {
  const doc = editor.state.doc
  const out: Array<{ from: number; to: number }> = []
  doc.forEach((node, offset) => {
    if (node.type.name === 'docTable') out.push({ from: offset, to: offset + node.nodeSize })
  })
  return out
}

const IMAGE_CAPTION_RE = /^(图|Figure|附图)\s*\d+(?:[-.]\d+)?/

/** 删除图像题注 — same two-tier detection, 图/Figure labels */
export function deleteImageCaptions(editor: Editor): DocOpOutcome {
  // reuse the generic engine via a local copy specialized on 图 captions: the
  // generic walker keys on docTable anchors, so image captions use the
  // whole-document tier only (any short 图N paragraph outside tables)
  const doc = editor.state.doc
  const ranges: Array<{ pos: number; size: number }> = []
  doc.forEach((node, offset) => {
    if (node.type.name !== 'docParagraph') return
    const text = node.textContent.trim()
    if (text.length === 0 || text.length > 120) return
    if (IMAGE_CAPTION_RE.test(text)) ranges.push({ pos: offset, size: node.nodeSize })
  })
  if (ranges.length === 0) return { ok: true, count: 0 }
  applyTr(editor, (tr) => {
    const sorted = [...ranges].sort((a, b) => b.pos - a.pos)
    for (const r of sorted) {
      const pos = tr.mapping.map(r.pos)
      tr.delete(pos, pos + r.size)
    }
    return true
  })
  return { ok: true, count: ranges.length }
}
