import { PDF_READ_CHUNK_BYTES } from '../shared/ipc'

/** Reads a granted file through the chunked IPC route: one invoke per slice
 * instead of a single multi-megabyte ArrayBuffer over IPC — a 42 MB
 * structured-clone deserialization has killed renderers before first paint
 * on Windows (chaoffice#2366), while small slices arrive fine. The main-side
 * handler reports the file size with every slice, so the loop needs no
 * separate stat round trip. */
export interface PdfFileChunkApi {
  readFileChunk(
    path: string,
    start: number,
    end: number,
  ): Promise<{ data: Uint8Array; fileSize: number }>
}

/** Head slice fetched up front by the ranged open path: pdf.js needs the file's
 * leading bytes (header magic plus the first parse steps), the renderer's own
 * /XFA marker pre-parse scans them, and the size riding along is what sizes the
 * range transport — all without touching the rest of a potentially huge file. */
export const PDF_RANGE_HEAD_BYTES = Math.min(1024 * 1024, PDF_READ_CHUNK_BYTES)

/** Range granularity pdf.js requests at. One IPC round trip per chunk, so this
 * trades latency against wasted bytes around each fetch; 1 MiB keeps a typical
 * page's objects in one or two invokes. Must stay within the main-side
 * readFileChunk cap (PDF_READ_CHUNK_BYTES) or every fetch is rejected. Lives
 * here (not in range-transport) so modules that only size their calls don't
 * pull the pdf.js class import — several tests stub that module. */
export const PDF_RANGE_CHUNK_BYTES = Math.min(1024 * 1024, PDF_READ_CHUNK_BYTES)

export interface PdfFileHead {
  /** bytes [0, data.length) of the file */
  data: Uint8Array
  fileSize: number
  /** true when data already covers the whole file (nothing left to stream) */
  whole: boolean
}

export async function readFileHead(
  api: PdfFileChunkApi,
  path: string,
  headBytes = PDF_RANGE_HEAD_BYTES,
): Promise<PdfFileHead> {
  const { data, fileSize } = await api.readFileChunk(path, 0, headBytes)
  return { data, fileSize, whole: data.length >= fileSize }
}

export async function readFileBytes(
  api: PdfFileChunkApi,
  path: string,
  chunkBytes = PDF_READ_CHUNK_BYTES,
): Promise<Uint8Array> {
  let offset = 0
  let fileSize = Infinity
  let out: Uint8Array | null = null
  do {
    const end = Math.min(offset + chunkBytes, fileSize)
    const { data, fileSize: size } = await api.readFileChunk(path, offset, end)
    if (data.length === 0) break
    if (out === null) {
      // the first slice reports the whole size: allocate the result once and
      // copy every slice straight into it (three copies of the file never
      // exist at the same time - the point of the chunked route)
      if (!Number.isFinite(size) || size < 0) return data.slice()
      out = new Uint8Array(size)
    } else if (out.length !== size) {
      // the size changed between slices (should not happen): grow once
      const grown: Uint8Array = new Uint8Array(size)
      grown.set(out.subarray(0, offset), 0)
      out = grown
    }
    out!.set(data, offset)
    offset += data.length
    fileSize = size
  } while (offset < fileSize)
  return out ? out.subarray(0, offset) : new Uint8Array(0)
}
