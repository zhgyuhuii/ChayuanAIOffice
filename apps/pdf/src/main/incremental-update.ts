import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { PDFArray, PDFDocument, PDFHexString, PDFRef, PDFString } from 'pdf-lib'
import type { PDFObject } from 'pdf-lib'

/**
 * Incremental-update assembly: append a new revision (changed + new objects,
 * one xref section, /Prev pointing at the previous one) instead of rewriting
 * the whole file. Reading a 1 GB document and re-serializing it through
 * pdf-lib's save() used to hold the original bytes, the parsed object graph
 * and a full second copy of the file in memory at once; an appended revision
 * keeps the output proportional to the edit instead of the document.
 *
 * The primitives (previous-xref discovery, xref table/stream emitters, object
 * serialization) are shared with the signature assembler in pdf-sign.ts, which
 * pioneered this layout for certificate signing.
 */

export const latin1 = (text: string): Buffer => Buffer.from(text, 'latin1')

/** Serialize one indirect object exactly as it will appear in the revision */
export function serialize(ref: PDFRef, object: PDFObject): Buffer {
  const body = new Uint8Array(object.sizeInBytes())
  object.copyBytesInto(body, 0)
  return Buffer.concat([
    latin1(`${ref.objectNumber} ${ref.generationNumber} obj\n`),
    Buffer.from(body),
    latin1('\nendobj\n'),
  ])
}

export interface PreviousXref {
  offset: number
  /** The previous section is an xref stream, so this update must be one too */
  isStream: boolean
  size: number
}

export function readPreviousXref(bytes: Buffer): PreviousXref {
  const tail = bytes.subarray(Math.max(0, bytes.length - 2048)).toString('latin1')
  const marker = tail.lastIndexOf('startxref')
  const match = marker >= 0 ? /startxref\s+(\d+)/.exec(tail.slice(marker)) : null
  if (!match) throw new Error('incremental update: no startxref in the previous revision')
  const offset = Number(match[1])
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset >= bytes.length) {
    throw new Error('incremental update: previous startxref offset is out of range')
  }
  const head = bytes.subarray(offset, offset + 4096).toString('latin1')
  const isStream = !head.trimStart().startsWith('xref')
  const searchFrom = isStream ? head : head.slice(Math.max(0, head.indexOf('trailer')))
  const size = /\/Size\s+(\d+)/.exec(searchFrom)
  return { offset, isStream, size: size ? Number(size[1]) : 0 }
}

export function xrefTable(entries: { num: number; offset: number; gen: number }[]): Buffer {
  const sorted = [...entries].sort((a, b) => a.num - b.num)
  const runs: (typeof sorted)[] = []
  for (const entry of sorted) {
    const run = runs[runs.length - 1]
    if (run && run[run.length - 1]!.num + 1 === entry.num) run.push(entry)
    else runs.push([entry])
  }
  let text = 'xref\n'
  for (const run of runs) {
    text += `${run[0]!.num} ${run.length}\n`
    for (const e of run) {
      text += `${String(e.offset).padStart(10, '0')} ${String(e.gen).padStart(5, '0')} n \n`
    }
  }
  return latin1(text)
}

export function xrefStreamData(entries: { num: number; offset: number; gen: number }[]): {
  index: number[]
  data: Buffer
} {
  const sorted = [...entries].sort((a, b) => a.num - b.num)
  const index: number[] = []
  const rows: Buffer[] = []
  let previous = -2
  for (const e of sorted) {
    if (e.num === previous + 1) index[index.length - 1]!++
    else index.push(e.num, 1)
    previous = e.num
    const row = Buffer.alloc(7)
    row[0] = 1
    row.writeUInt32BE(e.offset, 1)
    row.writeUInt16BE(e.gen, 5)
    rows.push(row)
  }
  return { index, data: Buffer.concat(rows) }
}

/** Trailer dictionary entries shared by every appended revision */
function trailerEntries(pdf: PDFDocument, previous: PreviousXref): Map<string, string> {
  const trailer = new Map<string, string>()
  const catalogRef = pdf.context.trailerInfo.Root
  if (!(catalogRef instanceof PDFRef)) throw new Error('incremental update: no document catalog')
  trailer.set('Root', `${catalogRef.objectNumber} ${catalogRef.generationNumber} R`)
  const info = pdf.context.trailerInfo.Info
  if (info instanceof PDFRef) trailer.set('Info', `${info.objectNumber} ${info.generationNumber} R`)
  const id = pdf.context.trailerInfo.ID
  if (id instanceof PDFArray) {
    // Re-emit the identifier bytes as they are; a string's text form would re-encode binary IDs
    const parts = id.asArray().map((entry) => {
      if (!(entry instanceof PDFString) && !(entry instanceof PDFHexString)) return null
      return `<${Buffer.from(entry.asBytes()).toString('hex').toUpperCase()}>`
    })
    if (parts.length > 0 && parts.every((part) => part !== null))
      trailer.set('ID', `[ ${parts.join(' ')} ]`)
  }
  trailer.set('Prev', String(previous.offset))
  return trailer
}

/** Fingerprint of one indirect object's serialization */
interface ObjectFingerprint {
  size: number
  digest: Buffer
}

/** Shared serialization buffer, grown geometrically so a whole-document pass
 *  never allocates per object (stream objects can be hundreds of MB) */
class Scratch {
  private bytes = new Uint8Array(4096)
  view(size: number): Uint8Array {
    if (size > this.bytes.length) this.bytes = new Uint8Array(Math.max(size, this.bytes.length * 2))
    return this.bytes.subarray(0, size)
  }
}

/**
 * Digest of every indirect object as it stands right after loading, keyed by
 * object number. Comparing against a later pass finds exactly the objects a
 * save mutated — pdf-lib offers no dirty tracking of its own, and re-serializing
 * an untouched object changes nothing, so a spurious mismatch could only ever
 * include a redundant copy of an unchanged object, never drop a changed one.
 */
export type ObjectSnapshot = Map<number, ObjectFingerprint>

export function snapshotObjects(pdf: PDFDocument): ObjectSnapshot {
  const snapshot: ObjectSnapshot = new Map()
  const scratch = new Scratch()
  for (const [ref, object] of pdf.context.enumerateIndirectObjects()) {
    const body = scratch.view(object.sizeInBytes())
    object.copyBytesInto(body, 0)
    snapshot.set(ref.objectNumber, {
      size: body.length,
      digest: createHash('sha256').update(body).digest(),
    })
  }
  return snapshot
}

/**
 * Lift pdf-lib's next free object number above every slot the previous xref
 * reserved. Must run BEFORE any mutation allocates refs: objects living inside
 * object streams are invisible to pdf-lib's linear parser, so its own
 * largestObjectNumber can sit below the file's real /Size and a fresh object
 * would silently reuse a number the previous revision still has in use — the
 * update's entry then shadows live data and readers lose whole objects.
 */
export function reserveObjectNumbers(original: Buffer, pdf: PDFDocument): PreviousXref {
  const previous = readPreviousXref(original)
  pdf.context.largestObjectNumber = Math.max(pdf.context.largestObjectNumber, previous.size - 1)
  return previous
}

/**
 * Build the bytes to append after `original`: every object whose serialization
 * no longer matches `snapshot` (plus every object created since), a fresh xref
 * section covering them, and a trailer chained to the previous one through
 * /Prev. `original` itself is emitted untouched in front of the result.
 */
export function assembleIncrementalUpdate(
  original: Buffer,
  pdf: PDFDocument,
  snapshot: ObjectSnapshot,
): Buffer {
  const previous = readPreviousXref(original)
  // Defense in depth for direct callers that skipped reserveObjectNumbers:
  // late for already-allocated refs, but still correct for /Size.
  pdf.context.largestObjectNumber = Math.max(pdf.context.largestObjectNumber, previous.size - 1)

  const changed: Array<{ ref: PDFRef; object: PDFObject }> = []
  const scratch = new Scratch()
  for (const [ref, object] of pdf.context.enumerateIndirectObjects()) {
    const before = snapshot.get(ref.objectNumber)
    if (before === undefined) {
      changed.push({ ref, object })
      continue
    }
    const size = object.sizeInBytes()
    if (size !== before.size) {
      changed.push({ ref, object })
      continue
    }
    const body = scratch.view(size)
    object.copyBytesInto(body, 0)
    if (!createHash('sha256').update(body).digest().equals(before.digest)) {
      changed.push({ ref, object })
    }
  }
  if (changed.length === 0) throw new Error('incremental update: nothing to write')

  const parts: Buffer[] = [original, latin1(original[original.length - 1] === 0x0a ? '' : '\n')]
  let length = parts[0]!.length + parts[1]!.length
  const offsets: { num: number; offset: number; gen: number }[] = []
  for (const { ref, object } of changed) {
    offsets.push({ num: ref.objectNumber, offset: length, gen: ref.generationNumber })
    const bytes = serialize(ref, object)
    parts.push(bytes)
    length += bytes.length
  }

  const trailer = trailerEntries(pdf, previous)
  const size = Math.max(pdf.context.largestObjectNumber, ...offsets.map((o) => o.num)) + 1
  const xrefOffset = length
  if (previous.isStream) {
    const xrefNum = size
    const all = [...offsets, { num: xrefNum, offset: xrefOffset, gen: 0 }]
    const { index, data } = xrefStreamData(all)
    const body = deflateSync(data)
    const dict =
      `<< /Type /XRef /Size ${xrefNum + 1} /W [1 4 2] /Index [${index.join(' ')}] /Filter /FlateDecode` +
      [...trailer].map(([k, v]) => ` /${k} ${v}`).join('') +
      ` /Length ${body.length} >>`
    parts.push(latin1(`${xrefNum} 0 obj\n${dict}\nstream\n`))
    parts.push(body)
    parts.push(latin1('\nendstream\nendobj\n'))
  } else {
    parts.push(xrefTable(offsets))
    const dict = `<< /Size ${size}` + [...trailer].map(([k, v]) => ` /${k} ${v}`).join('') + ' >>'
    parts.push(latin1(`trailer\n${dict}\n`))
  }
  parts.push(latin1(`startxref\n${xrefOffset}\n%%EOF\n`))
  return Buffer.concat(parts)
}
