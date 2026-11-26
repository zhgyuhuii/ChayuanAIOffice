/**
 * Giant-document session (Node main process only).
 *
 * A document.xml past the V8 string ceiling cannot become a JS string in any
 * process, so the normal one-shot parse is impossible. This session instead:
 *
 *  1. inflates word/document.xml once, metered — cancelled one byte past what
 *     the entry declared, the same honesty check the bulk gate applies,
 *     merged with the work the parse would do anyway (the giant twin of
 *     "verify while parsing") — into a Buffer in the main process, where the
 *     string ceiling never applies;
 *  2. byte-scans it with `scanBodyElements` for top-level element anchors;
 *  3. serves any [first, first+count) window by re-assembling a SMALL
 *     document.xml — real prefix bytes + the window's element bytes + real
 *     suffix bytes — inside a cached slim base archive (media replaced by
 *     lazy-served placeholders, oversized parts dropped), and running the
 *     ordinary `parseDocx` on it unchanged. Blocks therefore come out of the
 *     exact production parser with full fidelity; docxIndex values are
 *     window-local (giant documents are read-only this round, so nothing
 *     anchors saves to them).
 */
import JSZip from 'jszip'
import { createInflateRaw, inflateRawSync } from 'node:zlib'
import { Readable } from 'node:stream'
import { parseDocx } from './parse'
import { scanBodyElements, type GiantElement } from './giant-scan'
import { lazyMediaPlaceholder } from './lazy-media'
import { LOCAL_FILE_ZIP_LIMITS, openZipFile, type ZipEntry, type ZipFile } from './zip-splice'

/** document.xml entries at or under this still fit a JS string comfortably
 *  (the ceiling is ~512 MB of UTF-16; the margin covers decode copies) and go
 *  through the normal renderer parse. Above it, giant mode. */
export const GIANT_DOCUMENT_XML_BYTES = 200 * 1024 * 1024

/** parts larger than this are dropped from the window base archive: they are
 *  media/embeddings the lazy server can serve on demand, not XML the parser
 *  needs. Small parts ride along so styles/numbering/notes/comments render. */
const WINDOW_BASE_PART_LIMIT = 32 * 1024 * 1024

/** cancellation margin over the declared size: an honest part completes at
 *  its declaration, a liar is stopped one byte past it (same rule as the
 *  metered-inflation gate). */
const INFLATE_MARGIN = 64 * 1024

const DOCUMENT_PART_RE = /^word\/document\d*\.xml$/i
const MEDIA_PART_RE = /^word\/media\//i

export interface GiantMeta {
  documentXmlBytes: number
  bodyBytes: number
  blockCount: number
}

export interface GiantWindow {
  /** window-local parsed document (blocks + every small part parsed) */
  parsed: Awaited<ReturnType<typeof parseDocx>>
  first: number
  count: number
}

/** Cheap central-directory probe: is this file a docx whose document.xml is
 *  past the giant line? Null when the archive cannot be opened at all.
 *  `minGiantBytes` overrides the production line (tests use a tiny one). */
export async function probeGiantDocx(
  filePath: string,
  minGiantBytes: number = GIANT_DOCUMENT_XML_BYTES,
): Promise<{ giant: boolean; documentXmlBytes: number; docPath: string | null } | null> {
  let zip: ZipFile
  try {
    zip = await openZipFile(filePath, LOCAL_FILE_ZIP_LIMITS)
  } catch {
    return null
  }
  try {
    const docEntry = largestDocumentEntry(zip)
    if (!docEntry) return null
    return {
      giant: docEntry.usize > minGiantBytes,
      documentXmlBytes: docEntry.usize,
      docPath: docEntry.name,
    }
  } finally {
    await zip.close()
  }
}

function largestDocumentEntry(zip: ZipFile): ZipEntry | null {
  let docEntry: ZipEntry | null = null
  for (const e of zip.entries.values()) {
    if (DOCUMENT_PART_RE.test(e.name) && (!docEntry || e.usize > docEntry.usize)) docEntry = e
  }
  return docEntry
}

export class GiantDocxSession {
  private readonly buf: Buffer
  private readonly bodyContentStart: number
  private readonly bodyContentEnd: number
  private readonly baseZipBytes: Buffer
  private readonly docPath: string
  private readonly anchors: GiantElement[]

  private constructor(
    buf: Buffer,
    scan: { bodyContentStart: number; bodyContentEnd: number },
    anchors: GiantElement[],
    baseZipBytes: Buffer,
    docPath: string,
    readonly documentXmlBytes: number,
  ) {
    this.buf = buf
    this.bodyContentStart = scan.bodyContentStart
    this.bodyContentEnd = scan.bodyContentEnd
    this.anchors = anchors
    this.baseZipBytes = baseZipBytes
    this.docPath = docPath
  }

  get meta(): GiantMeta {
    return {
      documentXmlBytes: this.documentXmlBytes,
      bodyBytes: this.bodyContentEnd - this.bodyContentStart,
      blockCount: this.anchors.length,
    }
  }

  /** Opens a giant session, or null when the file does not need giant mode
   *  (small document.xml / not a docx / unreadable — caller falls back). */
  static async open(
    filePath: string,
    opts: { mediaHash?: string; minGiantBytes?: number } = {},
  ): Promise<GiantDocxSession | null> {
    const zip = await openZipFile(filePath, LOCAL_FILE_ZIP_LIMITS)
    try {
      const docEntry = largestDocumentEntry(zip)
      if (!docEntry || docEntry.usize <= (opts.minGiantBytes ?? GIANT_DOCUMENT_XML_BYTES)) {
        return null
      }

      const buf = await inflateEntryMetered(zip, docEntry)
      const anchors: GiantElement[] = []
      const gen = scanBodyElements(buf)
      for (;;) {
        const next = gen.next()
        if (next.done) {
          const scan = {
            bodyContentStart: next.value.bodyContentStart,
            bodyContentEnd: next.value.bodyContentEnd,
          }
          const baseZipBytes = await buildWindowBaseBytes(zip, docEntry.name, opts.mediaHash)
          return new GiantDocxSession(buf, scan, anchors, baseZipBytes, docEntry.name, buf.length)
        }
        anchors.push(next.value)
      }
    } finally {
      await zip.close()
    }
  }

  /** Parses one window of blocks through the ordinary production parser. */
  async window(first: number, count: number): Promise<GiantWindow> {
    const els = this.anchors.slice(first, first + count)
    const parts: Buffer[] = [this.buf.subarray(0, this.bodyContentStart)]
    for (const el of els) parts.push(this.buf.subarray(el.start, el.end))
    parts.push(this.buf.subarray(this.bodyContentEnd))
    const windowXml = Buffer.concat(parts).toString('utf8')

    const zip = await JSZip.loadAsync(this.baseZipBytes)
    zip.file(this.docPath, windowXml)
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const parsed = await parseDocx(bytes, { expandAltChunks: false })
    return { parsed, first, count: els.length }
  }

  /** Anchor snapshot for height estimation / navigation / tests. */
  anchorSummary(): Array<{ name: string; bytes: number }> {
    return this.anchors.map((el) => ({ name: el.name, bytes: el.end - el.start }))
  }
}

/** Metered inflate of one entry straight to a Buffer: stops (and rejects) one
 *  byte past the declared uncompressed size — a lying central directory costs
 *  at most its claim plus the margin, exactly like the bulk gate's per-part
 *  check, and the verify pass IS the parse's inflate (no second round trip). */
async function inflateEntryMetered(zip: ZipFile, entry: ZipEntry): Promise<Buffer> {
  const compressed = await zip.read(entry.dataOffset, entry.csize)
  if (entry.method === 0) {
    if (compressed.length > entry.usize + INFLATE_MARGIN) {
      throw underDeclared(entry, compressed.length)
    }
    return compressed
  }
  if (entry.method !== 8) {
    throw new Error(`zip: unsupported compression method ${entry.method} for ${entry.name}`)
  }
  const limit = entry.usize + INFLATE_MARGIN
  const chunks: Buffer[] = []
  let seen = 0
  for await (const chunk of Readable.from([compressed]).pipe(createInflateRaw())) {
    seen += chunk.length
    if (seen > limit) throw underDeclared(entry, seen)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function underDeclared(entry: ZipEntry, seen: number): Error {
  return new Error(
    `zip rejected: part ${entry.name} declares ${entry.usize} uncompressed bytes ` +
      `but inflates past that (saw ${seen})`,
  )
}

/** The shared per-window base archive bytes: every small part kept, media
 *  replaced by lazy-served placeholders, oversized parts dropped. */
async function buildWindowBaseBytes(
  zip: ZipFile,
  docPath: string,
  mediaHash: string | undefined,
): Promise<Buffer> {
  const out = new JSZip()
  for (const entry of zip.entries.values()) {
    if (entry.name === docPath) continue
    if (entry.usize > WINDOW_BASE_PART_LIMIT) continue
    const raw = await zip.read(entry.dataOffset, entry.csize)
    if (mediaHash && MEDIA_PART_RE.test(entry.name)) {
      out.file(entry.name, lazyMediaPlaceholder(mediaHash))
      continue
    }
    out.file(entry.name, entry.method === 0 ? raw : inflateRawSync(raw))
  }
  return out.generateAsync({ type: 'nodebuffer' })
}
