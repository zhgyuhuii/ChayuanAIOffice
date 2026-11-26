import { PDFDataRangeTransport } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDF_READ_CHUNK_BYTES } from '../shared/ipc'
import type { PdfFileChunkApi } from './file-bytes'

/**
 * Bridges pdf.js's range loading onto the chunked IPC route: the open path hands
 * over only the file head plus its length, and every later slice the parser
 * needs (the xref at the tail, then page objects on demand) arrives through
 * readFileChunk. The document therefore never exists as one contiguous buffer
 * on the render side — the point of opening 1 GB+ files.
 *
 * Read failures have no error channel in PDFDataRangeTransport (a range reader
 * that never receives data would hang silently), so they surface through
 * `onReadError`, which the caller wires to destroy the loading task.
 */
export class IpcRangeTransport extends PDFDataRangeTransport {
  private aborted = false
  /** set by the owner right after creation, before any range can be requested */
  onReadError: ((err: Error) => void) | null = null

  constructor(
    length: number,
    initialData: Uint8Array,
    private readonly api: PdfFileChunkApi,
    private readonly path: string,
  ) {
    super(length, initialData)
  }

  requestDataRange(begin: number, end: number): void {
    if (this.aborted) return
    if (!Number.isInteger(begin) || !Number.isInteger(end) || begin < 0 || end <= begin) {
      this.fail(new Error(`pdf: invalid range request [${begin}, ${end})`))
      return
    }
    const to = Math.min(end, this.length)
    if (to - begin > PDF_READ_CHUNK_BYTES) {
      this.fail(new Error('pdf: range request exceeds the chunk IPC cap'))
      return
    }
    this.api
      .readFileChunk(this.path, begin, to)
      .then(
        ({ data, fileSize }) => {
          if (this.aborted) return
          // The file changed underneath the session (shrunk, replaced by an
          // undo restore, deleted): serving the slice would silently corrupt
          // the parse, and a short read would desync the chunked stream.
          if (fileSize !== this.length || data.length !== to - begin) {
            this.fail(
              new Error(
                `pdf: file changed during ranged open (size ${fileSize}, expected ${this.length})`,
              ),
            )
            return
          }
          this.onDataRange(begin, data)
        },
        (err: unknown) => {
          if (this.aborted) return
          this.fail(err instanceof Error ? err : new Error(String(err)))
        },
      )
      .catch(() => {
        /* fail() must never turn into an unhandled rejection of its own */
      })
  }

  abort(): void {
    this.aborted = true
  }

  private fail(err: Error): void {
    this.aborted = true
    try {
      this.onReadError?.(err)
    } catch {
      /* the owner's error handling must not break the transport */
    }
  }
}
