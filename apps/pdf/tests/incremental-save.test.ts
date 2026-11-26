import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  applySaveRequestIncremental,
  incrementalSaveEligible,
  INCREMENTAL_SAVE_MIN_BYTES,
  savePdfToPath,
} from '../src/main/save-pdf'
import { readPreviousXref } from '../src/main/incremental-update'
import type { SavePdfRequest } from '../src/shared/ipc'

/** Build a small source document, classic xref table by default */
async function makeDoc(objectStreams = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  doc.addPage([612, 792])
  doc
    .getForm()
    .createTextField('user.name')
    .addToPage(page, { x: 20, y: 200, width: 200, height: 20 })
  return doc.save({ useObjectStreams: objectStreams })
}

const request = (over: Partial<SavePdfRequest> = {}): SavePdfRequest => ({
  path: '/tmp/test.pdf',
  markups: [],
  drawings: [],
  formValues: [],
  stamps: [],
  ...over,
})

const highlight = {
  pageIndex: 0,
  type: 'highlight' as const,
  color: [1, 0.87, 0.35] as [number, number, number],
  quads: [[10, 100, 60, 100, 10, 88, 60, 88]],
}

function pageAnnots(doc: PDFDocument, pageIndex: number): PDFDict[] {
  const annots = doc.getPage(pageIndex).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annots) return []
  return Array.from({ length: annots.size() }, (_, i) => annots.lookup(i, PDFDict))
}

const subtypeOf = (annot: PDFDict) => annot.lookup(PDFName.of('Subtype'), PDFName).decodeText()

/** pdf.js opens the document (the reader the product views files with) */
async function openWithPdfJs(bytes: Uint8Array) {
  const task = getDocument({ data: bytes.slice(), verbosity: 0, useSystemFonts: true })
  const doc = await task.promise
  // destroy() races the still-settling worker messages into a benign rejection
  return { doc, close: () => void task.destroy().catch(() => {}) }
}

describe('applySaveRequestIncremental', () => {
  it('appends a revision that carries the edit and preserves the original bytes', async () => {
    const original = await makeDoc()
    const { bytes, revision } = await applySaveRequestIncremental(
      original,
      request({
        markups: [highlight],
        formValues: [{ name: 'user.name', kind: 'text', value: 'Ada' }],
      }),
    )
    // incremental by construction: the output starts with the untouched original
    expect(Buffer.from(bytes.subarray(0, original.length)).equals(Buffer.from(original))).toBe(true)
    expect(revision.length).toBeGreaterThan(0)
    expect(bytes.length).toBe(original.length + revision.length)

    const out = await PDFDocument.load(bytes)
    expect(out.getPageCount()).toBe(2)
    // the form widget annot the source already carried stays first
    expect(pageAnnots(out, 0).map(subtypeOf)).toEqual(['Widget', 'Highlight'])
    expect(out.getForm().getTextField('user.name').getText()).toBe('Ada')
  })

  it('pdf.js reads the updated document through the chained xref', async () => {
    const original = await makeDoc()
    const { bytes } = await applySaveRequestIncremental(original, request({ markups: [highlight] }))
    const { doc, close } = await openWithPdfJs(bytes)
    try {
      expect(doc.numPages).toBe(2)
      // resolving the page tree and page objects walks the chained xref and the
      // revision's redefinitions; the annotation content itself is covered by
      // the pdf-lib assertions above
      const page = await doc.getPage(1)
      expect(page.pageNumber).toBe(1)
    } finally {
      void close()
    }
  })

  it('chains a second revision on top of the first', async () => {
    const first = await makeDoc()
    const afterFirst = await applySaveRequestIncremental(first, request({ markups: [highlight] }))
    const afterSecond = await applySaveRequestIncremental(
      afterFirst.bytes,
      request({ formValues: [{ name: 'user.name', kind: 'text', value: 'Second' }] }),
    )
    // the second output still starts with the first one byte for byte
    expect(
      Buffer.from(afterSecond.bytes.subarray(0, afterFirst.bytes.length)).equals(
        Buffer.from(afterFirst.bytes),
      ),
    ).toBe(true)

    const out = await PDFDocument.load(afterSecond.bytes)
    expect(out.getForm().getTextField('user.name').getText()).toBe('Second')
    // the first revision's annotation is still reachable through the chain
    expect(pageAnnots(out, 0).map(subtypeOf)).toEqual(['Widget', 'Highlight'])

    const { doc, close } = await openWithPdfJs(afterSecond.bytes)
    try {
      expect(doc.numPages).toBe(2)
    } finally {
      void close()
    }
  })

  it('serves an xref-stream original with an xref-stream revision', async () => {
    const original = await makeDoc(true)
    // pdf-lib's object-stream output carries an xref stream; the update must be one too
    expect(readPreviousXref(Buffer.from(original)).isStream).toBe(true)
    const { bytes } = await applySaveRequestIncremental(original, request({ markups: [highlight] }))

    const out = await PDFDocument.load(bytes)
    expect(pageAnnots(out, 0).map(subtypeOf)).toContain('Highlight')
    const { doc, close } = await openWithPdfJs(bytes)
    try {
      expect(doc.numPages).toBe(2)
    } finally {
      void close()
    }
  })

  it('removes pages through the revision without touching the original objects', async () => {
    const original = await makeDoc()
    const { bytes } = await applySaveRequestIncremental(original, request({ deletedPages: [1] }))
    const out = await PDFDocument.load(bytes)
    expect(out.getPageCount()).toBe(1)
    const { doc, close } = await openWithPdfJs(bytes)
    try {
      expect(doc.numPages).toBe(1)
    } finally {
      void close()
    }
  })
})

describe('incrementalSaveEligible', () => {
  it('requires a large source and graph-only stages', () => {
    const base = request({ markups: [highlight] })
    expect(incrementalSaveEligible(base, INCREMENTAL_SAVE_MIN_BYTES)).toBe(true)
    expect(incrementalSaveEligible(base, INCREMENTAL_SAVE_MIN_BYTES - 1)).toBe(false)
    expect(
      incrementalSaveEligible(
        request({
          textEdits: [
            { pageIndex: 0, rect: [0, 0, 1, 1], oldText: 'a', newText: 'b', fontSize: 12 },
          ],
        }),
        INCREMENTAL_SAVE_MIN_BYTES,
      ),
    ).toBe(false)
    expect(
      incrementalSaveEligible(
        request({ redactions: [{ pageIndex: 0, rect: [0, 0, 1, 1] }] }),
        1 << 30,
      ),
    ).toBe(false)
    expect(
      incrementalSaveEligible(
        request({
          encryption: {
            userPassword: 'u',
            ownerPassword: 'o',
            permissions: { printing: true, modifying: false, annotating: false, copying: true },
          },
        }),
        1 << 30,
      ),
    ).toBe(false)
  })
})

describe('savePdfToPath incremental path', () => {
  /** A PDF of at least the eligibility threshold: one page plus one huge raw
   *  (uncompressed) stream object nothing references — the bulk of a scanned
   *  document, without making the test hash 64 MB of image data. */
  async function makeLargeDoc(bytes: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    doc
      .getForm()
      .createTextField('user.name')
      .addToPage(page, { x: 20, y: 200, width: 200, height: 20 })
    doc.context.register(
      doc.context.stream(new Uint8Array(bytes - 4096).fill(0x41), {
        Type: 'XObject',
        Subtype: 'Image',
      }),
    )
    return doc.save({ useObjectStreams: false })
  }

  it('saves a large document by appending a revision (in place)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gen-pdf-inc-'))
    const src = join(dir, 'big.pdf')
    const original = await makeLargeDoc(INCREMENTAL_SAVE_MIN_BYTES + 64 * 1024)
    expect(original.length).toBeGreaterThan(INCREMENTAL_SAVE_MIN_BYTES)
    writeFileSync(src, original)

    await savePdfToPath(
      src,
      src,
      request({ path: src, formValues: [{ name: 'user.name', kind: 'text', value: 'Grace' }] }),
    )

    const saved = new Uint8Array(readFileSync(src))
    expect(saved.length).toBeGreaterThan(original.length)
    // the original revision is still the file's head: an incremental save
    expect(Buffer.from(saved.subarray(0, original.length)).equals(Buffer.from(original))).toBe(true)
    const out = await PDFDocument.load(saved)
    expect(out.getForm().getTextField('user.name').getText()).toBe('Grace')
    expect(readdirSync(dir)).toEqual(['big.pdf'])
  })

  it('Save As copies the source and appends the revision to the copy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gen-pdf-inc-'))
    const src = join(dir, 'big.pdf')
    const dst = join(dir, 'copy.pdf')
    writeFileSync(src, await makeLargeDoc(INCREMENTAL_SAVE_MIN_BYTES + 64 * 1024))
    const srcSize = statSync(src).size

    await savePdfToPath(src, dst, request({ path: src, targetPath: dst, markups: [highlight] }))

    // source untouched, target is source + revision
    expect(statSync(src).size).toBe(srcSize)
    const target = new Uint8Array(readFileSync(dst))
    expect(Buffer.from(target.subarray(0, srcSize)).equals(readFileSync(src))).toBe(true)
    const out = await PDFDocument.load(target)
    expect(pageAnnots(out, 0).map(subtypeOf)).toContain('Highlight')
    expect(readdirSync(dir).sort()).toEqual(['big.pdf', 'copy.pdf'])
  })
})
