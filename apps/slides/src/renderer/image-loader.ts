/**
 * Incremental image loading: each decoded image is surfaced in small batches
 * instead of waiting for the whole deck (385 pictures used to render nothing
 * until the last one settled). Loaded/in-flight urls are tracked across calls
 * so re-collecting urls after an edit never reloads or discards progress —
 * except when the decoded-image LRU (byte budget below) evicts an entry under
 * memory pressure; an evicted url simply decodes again on the next load call.
 */
import { metafileToDataUrl } from '@chaoffice/docx-engine/metafile'

/** Slide media is cross-origin: without CORS a canvas that draws it is tainted (cutout, export). */
export function setImageSource(img: HTMLImageElement, url: string): void {
  if (url.startsWith('chaoffice-slide-media:')) img.crossOrigin = 'anonymous'
  img.src = url
}

export type ApplyImages = (entries: ReadonlyArray<readonly [string, HTMLImageElement]>) => void

/** Notified with the urls the LRU evicted, so the owner drops its references to them. */
export type EvictImages = (urls: ReadonlyArray<string>) => void

export interface ImageLoaderOptions {
  /** Decoded-image byte budget; the LRU evicts beyond it (default 128 MB). */
  budgetBytes?: number
  /** Owner-side cleanup for evicted urls (remove them from the applied image map). */
  onEvict?: EvictImages
}

/** Decoded-image budget: the 409-slide/2.7 GB incident (see MAX_METAFILE_RASTER_PX) sized this. */
export const MAX_DECODED_IMAGE_BYTES = 128 * 1024 * 1024

/** Unreadable dimensions (never after onload) still count, so the cache stays bounded. */
const NOMINAL_IMAGE_BYTES = 256 * 1024

/** Decoded RGBA bytes are what a settled HTMLImageElement actually pins. */
function decodedByteSize(img: HTMLImageElement): number {
  const px = (img.naturalWidth || 0) * (img.naturalHeight || 0)
  return px > 0 ? px * 4 : NOMINAL_IMAGE_BYTES
}

/**
 * Swap in a 1×1 blank so Chromium drops the decoded bitmap (and any rasterized
 * metafile) instead of pinning it on a detached element. Handlers come off
 * first: assigning src fires load/error asynchronously, which must not re-enter
 * the loader's bookkeeping for an evicted entry.
 */
function releaseImage(img: HTMLImageElement): void {
  img.onload = null
  img.onerror = null
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
}

interface LoadedEntry {
  img: HTMLImageElement
  bytes: number
}

/** EMF/WMF data URLs: browsers cannot decode metafiles — rasterize to PNG first (keyed by the original url). */
const METAFILE_RE = /^data:(image\/x-(?:emf|wmf)|image\/(?:emf|wmf));base64,/
const LAZY_METAFILE_RE = /^chaoffice-slide-media:.*[?&]mime=image%2F(?:x-)?(emf|wmf)(?:&|$)/i

/**
 * EMF headers size the raster from their device bounds, up to the converter's 8192px cap:
 * a 409-slide deck with 67 metafiles held 2.7 GB of 268 MB canvases. A slide picture never
 * shows above ~2x slide width, so cap the longest side.
 */
export const MAX_METAFILE_RASTER_PX = 2048
/** Base64 budget for metafile raster input (~40MB of bytes). */
export const MAX_METAFILE_BASE64_CHARS = 56 * 1024 * 1024

/**
 * Metafile text draws through canvas fonts, so the Office-private FontFaces (DFonts/cloud/
 * embedded, registered by doc-fonts.ts after the deck settles) must be in place first — an
 * EMF rasterized before that keeps its fallback face forever (Excel OLE previews in
 * Meiryo UI came out in the browser's default sans). `false` = a sync is in flight.
 */
function waitForDocFonts(timeoutMs = 4000): Promise<void> {
  if (typeof window === 'undefined' || window.__chaofficeDocFontsSynced !== false)
    return Promise.resolve()
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      if (window.__chaofficeDocFontsSynced !== false || Date.now() - started >= timeoutMs) resolve()
      else setTimeout(tick, 50)
    }
    setTimeout(tick, 50)
  })
}

async function rasterizeMetafile(url: string): Promise<string | null> {
  const m = METAFILE_RE.exec(url)
  const lazy = LAZY_METAFILE_RE.exec(url)
  if (!m && !lazy) return null
  await waitForDocFonts()
  if (lazy) {
    const response = await fetch(url)
    if (!response.ok) return null
    const maxBytes = Math.floor((MAX_METAFILE_BASE64_CHARS * 3) / 4)
    const size = Number(response.headers.get('Content-Length'))
    if (size > maxBytes) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) return null
    return metafileToDataUrl(bytes, `image/x-${lazy[1]!.toLowerCase()}`, {
      maxSidePx: MAX_METAFILE_RASTER_PX,
    })
  }
  const b64 = url.slice(url.indexOf(',') + 1)
  // atob + Uint8Array double-allocate the payload on the main thread: refuse
  // huge metafiles before decoding (mirrors the 40MB PNG cap in element-clipboard).
  if (b64.length > MAX_METAFILE_BASE64_CHARS) return null
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const mime = m![1]!.includes('emf') ? 'image/x-emf' : 'image/x-wmf'
  return metafileToDataUrl(bytes, mime, { maxSidePx: MAX_METAFILE_RASTER_PX })
}

export function createImageLoader(
  apply: ApplyImages,
  batchSize = 16,
  delayMs = 100,
  { budgetBytes = MAX_DECODED_IMAGE_BYTES, onEvict }: ImageLoaderOptions = {},
) {
  // Map ordering is the LRU order: re-collected urls are refreshed to the
  // recency end; eviction walks from the cold end.
  const loaded = new Map<string, LoadedEntry>()
  const loading = new Set<string>()
  const failed = new Set<string>()
  const buf = new Map<string, HTMLImageElement>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let bytesCached = 0

  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (disposed || buf.size === 0) return
    const entries = [...buf]
    buf.clear()
    apply(entries)
  }

  const trimToBudget = () => {
    if (bytesCached <= budgetBytes) return
    const evicted: string[] = []
    for (const u of loaded.keys()) {
      if (bytesCached <= budgetBytes) break
      // Keep at least the newest entry: a single image larger than the whole
      // budget must not thrash the cache to empty on every settle.
      if (loaded.size - evicted.length <= 1) break
      // Mid-batch: this image is about to be applied, evicting it would blank
      // a batch the throttler is still delivering.
      if (buf.has(u)) continue
      evicted.push(u)
      bytesCached -= loaded.get(u)!.bytes
    }
    if (evicted.length === 0) return
    for (const u of evicted) {
      const entry = loaded.get(u)
      loaded.delete(u)
      if (entry) releaseImage(entry.img)
    }
    onEvict?.(evicted)
  }

  return {
    /** urls still decoding — 0 means every image the deck asked for has settled */
    pending(): number {
      return loading.size
    },
    load(urls: Iterable<string>) {
      for (const u of urls) {
        if (loading.has(u) || failed.has(u)) continue
        const cached = loaded.get(u)
        if (cached) {
          // Still wanted: refresh LRU recency without touching the element
          loaded.delete(u)
          loaded.set(u, cached)
          continue
        }
        loading.add(u)
        const img = new Image()
        const done = (ok: boolean) => {
          loading.delete(u)
          if (ok) {
            const entry = { img, bytes: decodedByteSize(img) }
            loaded.set(u, entry)
            bytesCached += entry.bytes
            if (!disposed) buf.set(u, img)
          } else failed.add(u)
          if (buf.size >= batchSize || loading.size === 0) flush()
          else if (!timer && buf.size > 0) timer = setTimeout(flush, delayMs)
          trimToBudget()
        }
        img.onload = () => done(true)
        img.onerror = () => done(false)
        if (METAFILE_RE.test(u) || LAZY_METAFILE_RE.test(u)) {
          void rasterizeMetafile(u)
            .then((png) => {
              if (png) img.src = png
              else done(false)
            })
            .catch(() => done(false))
        } else {
          setImageSource(img, u)
        }
      }
    },
    // Only guards setState after unmount; in-flight loads keep filling `loaded`
    dispose() {
      disposed = true
      if (timer) clearTimeout(timer)
    },
  }
}
