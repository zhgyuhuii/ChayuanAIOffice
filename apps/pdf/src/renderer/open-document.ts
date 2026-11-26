import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDataRangeTransport, PDFDocumentLoadingTask } from 'pdfjs-dist'
import { DOC_OPTS } from './view-config'
import { PDF_RANGE_CHUNK_BYTES } from './file-bytes'

export function loadPdfForView(bytes: Uint8Array, password?: string) {
  // PDF.js transfers its input to the worker; retain the source for the
  // encrypted-document IPC and metadata checks later in the open pipeline.
  return getDocument({ data: bytes.slice(), password, ...DOC_OPTS })
}

/**
 * Open through a range transport: only the head slice exists on the render side
 * and pdf.js pulls every other byte range it needs (the tail xref first, page
 * objects as they render) through requestDataRange. disableAutoFetch keeps the
 * worker from pre-fetching the whole file; with a custom transport the worker
 * also forces auto-fetch off whenever streaming is advertised, so the lazy
 * behavior holds for the disableStream: false setting used here.
 */
export function loadPdfForRange(
  range: PDFDataRangeTransport,
  password?: string,
): PDFDocumentLoadingTask {
  return getDocument({
    range,
    rangeChunkSize: PDF_RANGE_CHUNK_BYTES,
    disableAutoFetch: true,
    disableStream: false,
    password,
    ...DOC_OPTS,
  })
}
