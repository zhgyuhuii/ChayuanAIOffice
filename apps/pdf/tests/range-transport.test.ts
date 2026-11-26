import { describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  PDF_RANGE_CHUNK_BYTES,
  PDF_RANGE_HEAD_BYTES,
  readFileHead,
  type PdfFileChunkApi,
} from '../src/renderer/file-bytes'
import { IpcRangeTransport } from '../src/renderer/range-transport'
import { loadPdfForRange } from '../src/renderer/open-document'
import { PDF_READ_CHUNK_BYTES } from '../src/shared/ipc'

/** Chunk API over an in-memory document, recording every slice requested —
 *  the same { data, fileSize } shape the main-process handler returns */
function fakeApi(content: Uint8Array, calls: Array<{ start: number; end: number }> = []) {
  return {
    readFileChunk: async (_path: string, start: number, end: number) => {
      calls.push({ start, end })
      const clamped = Math.min(end, content.length)
      return { data: content.slice(start, clamped), fileSize: content.length }
    },
  }
}

/** A document whose first pages parse from the head slice while most of the
 *  file is one huge unreferenced stream — a scanned-document stand-in whose
 *  byte ranges a lazy reader provably never needs. */
async function makePaddedPdf(padding: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  page.drawText('range transport probe', { x: 72, y: 700, size: 24 })
  doc.addPage([612, 792])
  doc.context.register(
    doc.context.stream(new Uint8Array(padding).fill(0x42), { Type: 'XObject', Subtype: 'Image' }),
  )
  return doc.save({ useObjectStreams: false })
}

describe('readFileHead', () => {
  it('returns the head slice plus the size for a large file', async () => {
    const content = new Uint8Array(PDF_RANGE_HEAD_BYTES + 1234)
    const calls: Array<{ start: number; end: number }> = []
    const head = await readFileHead(fakeApi(content, calls), '/docs/big.pdf')
    expect(calls).toEqual([{ start: 0, end: PDF_RANGE_HEAD_BYTES }])
    expect(head.data.length).toBe(PDF_RANGE_HEAD_BYTES)
    expect(head.fileSize).toBe(content.length)
    expect(head.whole).toBe(false)
  })

  it('reports a file smaller than the head as whole after one call', async () => {
    const content = new Uint8Array(4096).fill(7)
    const calls: Array<{ start: number; end: number }> = []
    const head = await readFileHead(fakeApi(content, calls), '/docs/small.pdf')
    expect(calls).toEqual([{ start: 0, end: PDF_RANGE_HEAD_BYTES }])
    expect(head.whole).toBe(true)
    expect(head.data).toEqual(content)
  })
})

describe('IpcRangeTransport', () => {
  it('serves requested ranges through the chunk IPC unchanged', async () => {
    const content = new Uint8Array(1024).fill(3)
    const calls: Array<{ start: number; end: number }> = []
    const transport = new IpcRangeTransport(
      1024,
      content.slice(0, 16),
      fakeApi(content, calls),
      '/d.pdf',
    )
    const delivered = vi.spyOn(transport, 'onDataRange')
    transport.requestDataRange(100, 200)
    await vi.waitFor(() => expect(delivered).toHaveBeenCalled())
    expect(calls).toEqual([{ start: 100, end: 200 }])
    expect(delivered.mock.calls[0]![0]).toBe(100)
    expect(delivered.mock.calls[0]![1]).toEqual(content.slice(100, 200))
  })

  it('clamps a request past the transport length', async () => {
    const content = new Uint8Array(500).fill(9)
    const calls: Array<{ start: number; end: number }> = []
    const transport = new IpcRangeTransport(
      500,
      content.slice(0, 8),
      fakeApi(content, calls),
      '/d.pdf',
    )
    const delivered = vi.spyOn(transport, 'onDataRange')
    transport.requestDataRange(480, 512)
    await vi.waitFor(() => expect(delivered).toHaveBeenCalled())
    expect(calls).toEqual([{ start: 480, end: 500 }])
  })

  it('stops delivering after abort', async () => {
    const content = new Uint8Array(64).fill(1)
    const calls: Array<{ start: number; end: number }> = []
    const transport = new IpcRangeTransport(
      64,
      content.slice(0, 4),
      fakeApi(content, calls),
      '/d.pdf',
    )
    const delivered = vi.spyOn(transport, 'onDataRange')
    // gate the IPC reply behind a manual resolve so abort lands first
    let release: (() => void) | null = null
    const api: PdfFileChunkApi = {
      readFileChunk: (path, start, end) => {
        calls.push({ start, end })
        return new Promise((resolve) => {
          release = () => resolve({ data: content.slice(start, end), fileSize: content.length })
        })
      },
    }
    const gated = new IpcRangeTransport(64, content.slice(0, 4), api, '/d.pdf')
    const gatedDelivered = vi.spyOn(gated, 'onDataRange')
    gated.requestDataRange(8, 16)
    gated.abort()
    release!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(gatedDelivered).not.toHaveBeenCalled()
    expect(delivered).not.toHaveBeenCalled()
  })

  it('reports a file that changed size underneath the session', async () => {
    const content = new Uint8Array(2048).fill(5)
    const shrunken = { readFileChunk: async () => ({ data: new Uint8Array(16), fileSize: 16 }) }
    const transport = new IpcRangeTransport(2048, content.slice(0, 4), shrunken, '/d.pdf')
    const delivered = vi.spyOn(transport, 'onDataRange')
    const failed = vi.fn()
    transport.onReadError = failed
    transport.requestDataRange(1024, 2048)
    await vi.waitFor(() => expect(failed).toHaveBeenCalled())
    expect(delivered).not.toHaveBeenCalled()
    expect(failed.mock.calls[0]![0]).toBeInstanceOf(Error)
  })

  it('reports a short slice instead of desyncing the chunked stream', async () => {
    const content = new Uint8Array(2048).fill(5)
    const short = {
      readFileChunk: async (_p: string, start: number, _e: number) => ({
        data: content.slice(start, start + 8),
        fileSize: content.length,
      }),
    }
    const transport = new IpcRangeTransport(2048, content.slice(0, 4), short, '/d.pdf')
    const delivered = vi.spyOn(transport, 'onDataRange')
    const failed = vi.fn()
    transport.onReadError = failed
    transport.requestDataRange(100, 200)
    await vi.waitFor(() => expect(failed).toHaveBeenCalled())
    expect(delivered).not.toHaveBeenCalled()
  })

  it('reports an IPC failure instead of hanging the parser', async () => {
    const content = new Uint8Array(64).fill(2)
    const failing = {
      readFileChunk: async () => {
        throw new Error('ENOENT')
      },
    }
    const transport = new IpcRangeTransport(64, content.slice(0, 4), failing, '/gone.pdf')
    const failed = vi.fn()
    transport.onReadError = failed
    transport.requestDataRange(8, 16)
    await vi.waitFor(() => expect(failed).toHaveBeenCalled())
    expect(failed.mock.calls[0]![0]).toBeInstanceOf(Error)
  })

  it('refuses ranges above the chunk IPC cap without invoking it', async () => {
    const content = new Uint8Array(PDF_READ_CHUNK_BYTES * 2)
    const calls: Array<{ start: number; end: number }> = []
    const transport = new IpcRangeTransport(
      content.length,
      content.slice(0, 4),
      fakeApi(content, calls),
      '/d.pdf',
    )
    const failed = vi.fn()
    transport.onReadError = failed
    transport.requestDataRange(0, PDF_READ_CHUNK_BYTES + 1)
    await vi.waitFor(() => expect(failed).toHaveBeenCalled())
    expect(calls).toEqual([])
  })
})

describe('loadPdfForRange against real pdf.js', () => {
  it('opens a multi-megabyte document without assembling it in memory', async () => {
    const content = await makePaddedPdf(3 * 1024 * 1024)
    expect(content.length).toBeGreaterThan(PDF_RANGE_HEAD_BYTES + 1024 * 1024)
    const calls: Array<{ start: number; end: number }> = []
    const api = fakeApi(content, calls)
    // a head well short of the file; pdf.js must pull the tail xref itself
    const head = await readFileHead(api, '/docs/padded.pdf', 64 * 1024)
    expect(head.whole).toBe(false)
    const transport = new IpcRangeTransport(
      head.fileSize,
      head.data.slice(),
      api,
      '/docs/padded.pdf',
    )
    const task = loadPdfForRange(transport)
    const doc = await task.promise
    try {
      expect(doc.numPages).toBe(2)
      // page objects + text content resolve through the lazily fetched ranges
      const page = await doc.getPage(1)
      const text = await page.getTextContent()
      expect(text.items.map((i) => ('str' in i ? i.str : '')).join('')).toContain(
        'range transport probe',
      )
    } finally {
      await task.destroy()
    }

    // the renderer asked for slices only: the whole file was never fetched
    const rangeCalls = calls.filter((c) => c.start > 0 || c.end < content.length)
    expect(rangeCalls.length).toBeGreaterThan(0)
    const fetched = rangeCalls.reduce((sum, c) => sum + (c.end - c.start), 0)
    expect(fetched).toBeLessThan(content.length)
    // every request stays inside the file and within the chunk cap
    for (const c of calls) {
      expect(c.start).toBeGreaterThanOrEqual(0)
      expect(c.end).toBeLessThanOrEqual(content.length)
      expect(c.end - c.start).toBeLessThanOrEqual(PDF_RANGE_CHUNK_BYTES)
    }
  })

  it('opens the same document through repeated revisions of an incremental save', async () => {
    // simulate the post-save reload: original + appended tail, still lazy
    const content = await makePaddedPdf(1024 * 1024)
    const padded = new Uint8Array(content.length + 4096)
    padded.set(content, 0)
    padded.fill(0x2f, content.length)
    const calls: Array<{ start: number; end: number }> = []
    const api = fakeApi(padded, calls)
    const head = await readFileHead(api, '/docs/rev.pdf', 64 * 1024)
    const transport = new IpcRangeTransport(head.fileSize, head.data.slice(), api, '/docs/rev.pdf')
    const task = loadPdfForRange(transport)
    const doc = await task.promise
    try {
      expect(doc.numPages).toBe(2)
    } finally {
      await task.destroy()
    }
  })
})
