/**
 * Display mime for an archive media part: magic bytes win over the file extension.
 * Legacy converters routinely mislabel media (a PNG preview stored as .emf routed
 * the bytes into the EMF parser and rendered nothing), so sniff the real container
 * first and only fall back to the extension when the header is unrecognized.
 */

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  // Metafiles keep their real mime so the renderer's image loader rasterizes them
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false
  return true
}

/** Sniffed mime from magic bytes, or null when the header is unrecognized. */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  if (startsWith(bytes, [0x42, 0x4d])) return 'image/bmp'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp'
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]))
    return 'image/tiff'
  // EMF: record type 1 (EMR_HEADER) + " EMF" signature at offset 40
  if (
    startsWith(bytes, [0x01, 0x00, 0x00, 0x00]) &&
    startsWith(bytes, [0x20, 0x45, 0x4d, 0x46], 40)
  )
    return 'image/x-emf'
  // Placeable WMF
  if (startsWith(bytes, [0xd7, 0xcd, 0xc6, 0x9a])) return 'image/x-wmf'
  return null
}

/**
 * The extension an AI-fetched image may be stored under, or null when the bytes
 * are not a raster image the insert pipeline can label (PNG/JPEG/GIF only:
 * content-type headers are attacker-influenced, so the magic bytes decide —
 * a response that is HTML, JSON or SVG must never land in a deck as a picture).
 */
export function rasterImageExt(bytes: Uint8Array): 'png' | 'jpg' | 'gif' | null {
  switch (sniffImageMime(bytes)) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    default:
      return null
  }
}

/** Effective display mime: sniffed container first, then the extension, then PNG. */
export function displayMime(mediaRef: string, bytes: Uint8Array): string {
  const sniffed = sniffImageMime(bytes)
  if (sniffed) return sniffed
  const ext = mediaRef.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MIME[ext] ?? 'image/png'
}

/** Extension table for the audio/video containers the app embeds (mirrors media-kinds). */
const EXT_AV_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  // Chromium refuses to even load video/quicktime, but demuxes QuickTime bytes
  // fine through the ISO-BMFF path when served as video/mp4
  mov: 'video/mp4',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
}

/**
 * Container mime for an audio/video part, served verbatim by the slide-media
 * protocol. Magic bytes win over the extension (converters mislabel movies just
 * like they mislabel pictures); unknown bytes fall back to the extension table
 * and then to a kind-matched default.
 */
export function avMime(name: string, bytes: Uint8Array, kind: 'video' | 'audio'): string {
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm' // EBML
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return 'audio/ogg'
  if (startsWith(bytes, [0x49, 0x44, 0x33])) return 'audio/mpeg' // ID3v2
  if (bytes.length > 1 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)
    return 'audio/mpeg' // MPEG audio sync
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x41, 0x56, 0x45], 8))
    return 'audio/wav'
  // ISO-BMFF: brand at offset 8 distinguishes an audio-only M4A from a movie
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12))
    return brand === 'M4A ' ? 'audio/mp4' : 'video/mp4'
  }
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_AV_MIME[ext] ?? (kind === 'video' ? 'video/mp4' : 'audio/mpeg')
}
