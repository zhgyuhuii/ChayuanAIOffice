/**
 * The attachment echo under a sent AI message: the file-type icon card and,
 * for images, the preview thumbnail. Every app's AiPanel carried a verbatim
 * copy of this block (docs/slides/sheets/html); the tile art is the shared
 * single-glyph family (./file-tiles — same source as the OS file-association
 * icons and the home lists), so the icon mapping lives here once.
 */
import { FileTileBadge, FILE_TILE_ICONS } from './file-tiles/badge'
import fileImageTile from './file-tiles/file-image.svg'

/** Structural stand-in for the per-app AttachmentMeta: only what the echo reads. */
export interface AiAttachmentLike {
  readonly path: string
  readonly name: string
  readonly ext: string
  readonly sizeBytes: number
}

/** image tile URL — the pending-thumbnail placeholder while a preview loads */
export const fileImageIcon = fileImageTile
/** kept for the barrel's compatibility surface; tiles replaced the banner art */
export const fileGeneralIcon = FILE_TILE_ICONS.txt
export const fileDocumentIcon = FILE_TILE_ICONS.txt

/** Image attachments render as thumbnails (previews) instead of icon cards. */
export const ATTACHMENT_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

/** Card icon: the shared single-glyph tile (ext → tile, gray-letter fallback). */
export function AttachmentCardIcon({ ext, size = 40 }: { ext: string; size?: number }) {
  return <FileTileBadge ext={ext} size={size} />
}

/** Card name slot width: 190 card - 2 border - 8/14 padding - 40 icon - 10 gap */
const CARD_NAME_MAX_WIDTH = 116
let cardNameCtx: CanvasRenderingContext2D | null = null

/** Ellipsize like the design: cut at the limit, strip trailing -_./spaces so
 *  punctuation never sits against the …; CSS text-overflow stays as fallback */
export function truncateCardName(name: string): string {
  cardNameCtx ??= document.createElement('canvas').getContext('2d')
  if (!cardNameCtx) return name
  // must match the stack the card name actually renders with (body font in styles.css)
  cardNameCtx.font =
    "500 13px 'Segoe UI', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
  if (cardNameCtx.measureText(name).width <= CARD_NAME_MAX_WIDTH) return name
  let lo = 1
  let hi = name.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (cardNameCtx.measureText(`${name.slice(0, mid)}…`).width <= CARD_NAME_MAX_WIDTH) lo = mid
    else hi = mid - 1
  }
  return `${name.slice(0, lo).replace(/[-_.\s]+$/, '')}…`
}

export function formatAttachmentSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(2)} KB`
}

/** Read-only echo of the attachments a user message consumed from the composer
 *  (image previews when the file is still readable; otherwise the placeholder icon) */
export function SentAttachments({
  atts,
  previews,
}: {
  atts: readonly AiAttachmentLike[]
  previews: Record<string, string>
}) {
  return (
    <div className="ai-msg-attachments">
      {atts.map((a) =>
        ATTACHMENT_IMAGE_EXTS.has(a.ext) ? (
          <span key={a.path} className="ai-attachment-thumb" title={a.name}>
            {previews[a.path] ? (
              <img src={previews[a.path]} alt={a.name} />
            ) : (
              <span className="ai-attachment-thumb-pending" aria-hidden>
                <img src={fileImageTile} alt="" />
              </span>
            )}
          </span>
        ) : (
          <span key={a.path} className="ai-attachment-card" title={a.name}>
            <span className="ai-attachment-card-icon">
              <AttachmentCardIcon ext={a.ext} />
            </span>
            <span className="ai-attachment-card-meta">
              <span className="ai-attachment-card-name">{truncateCardName(a.name)}</span>
              <span className="ai-attachment-card-size">{formatAttachmentSize(a.sizeBytes)}</span>
            </span>
          </span>
        ),
      )}
    </div>
  )
}
