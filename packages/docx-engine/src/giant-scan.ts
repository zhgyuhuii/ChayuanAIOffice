/**
 * Byte-level scanner for a giant word/document.xml (Node main process).
 *
 * The string scanner (`scan.ts`) locates every top-level <w:body> element by
 * character range, which is exactly right for patch-save — and exactly wrong
 * for a document.xml past the V8 string ceiling (~512 MB of UTF-16), where no
 * string ever exists to scan. This port walks the same state machine over the
 * raw UTF-8 bytes: every character the scanner branches on (< > " ' [ ] ! -)
 * is ASCII, and ASCII bytes cannot appear inside a UTF-8 multi-byte sequence,
 * so byte offsets are a faithful stand-in for character positions.
 *
 * It is a generator: the session serves the first-screen window as soon as
 * the first ~64 elements have been seen while the rest of a multi-GB body
 * keeps scanning in the background.
 *
 * Deliberately free of Node builtins (works on a plain Uint8Array) so the
 * renderer bundle never gains a node:Buffer edge through this module.
 */

/** One top-level <w:body> element, as a byte range [start, end) of document.xml. */
export interface GiantElement {
  /** tag name, e.g. "w:p", "w:tbl", "w:sectPr" */
  name: string
  start: number
  end: number
}

export interface GiantScanResult {
  /** byte offset just past `<w:body...>` (or -1 when absent) */
  bodyContentStart: number
  /** byte offset of `</w:body>` (file end when the body is unterminated) */
  bodyContentEnd: number
  /** element count at scan exhaustion */
  elementCount: number
}

const LT = 0x3c
const GT = 0x3e
const SLASH = 0x2f
const BANG = 0x21
const QUOTES = new Set([0x22, 0x27])
const OPEN_BRACKET = 0x5b
const CLOSE_BRACKET = 0x5d
const MINUS = 0x2d
const QUESTION = 0x3f

function startsWith(buf: Uint8Array, at: number, seq: readonly number[]): boolean {
  if (at + seq.length > buf.length) return false
  for (let i = 0; i < seq.length; i++) if (buf[at + i] !== seq[i]) return false
  return true
}

const COMMENT_OPEN = [LT, BANG, MINUS, MINUS]
const COMMENT_CLOSE = [MINUS, MINUS, GT]
const CDATA_OPEN = [LT, BANG, OPEN_BRACKET, 0x43, 0x44, 0x41, 0x54, 0x41, OPEN_BRACKET] // "<![CDATA["
const CDATA_CLOSE = [CLOSE_BRACKET, CLOSE_BRACKET, GT]
const PI_CLOSE = [QUESTION, GT]

/** first index ≥ from where `seq` occurs, or -1 */
function indexOfSeq(buf: Uint8Array, seq: readonly number[], from: number): number {
  outer: for (let i = from; i + seq.length <= buf.length; i++) {
    for (let k = 0; k < seq.length; k++) {
      if (buf[i + k] !== seq[k]) continue outer
    }
    return i
  }
  return -1
}

function isSpace(b: number): boolean {
  return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d
}

function isNameByte(b: number): boolean {
  return (
    (b >= 0x41 && b <= 0x5a) || // A-Z
    (b >= 0x61 && b <= 0x7a) || // a-z
    (b >= 0x30 && b <= 0x39) || // 0-9
    b === 0x5f || // _
    b === 0x3a || // :
    b === 0x2e || // .
    b === 0x2d // -
  )
}

interface ByteTag {
  start: number
  end: number
  name: string
  closing: boolean
  selfClosing: boolean
}

/** the tag beginning at `start`; mirrors scan.ts tagAt over bytes */
function tagAt(buf: Uint8Array, start: number): ByteTag {
  let quote = 0
  let end = buf.length
  for (let i = start + 1; i < buf.length; i++) {
    const b = buf[i]!
    if (quote) {
      if (b === quote) quote = 0
    } else if (QUOTES.has(b)) {
      quote = b
    } else if (b === GT) {
      end = i + 1
      break
    }
  }
  // name: after optional '</', ASCII name bytes
  let p = start + 1
  const closing = buf[p] === SLASH
  if (closing) p++
  const nameStart = p
  while (p < end && isNameByte(buf[p]!)) p++
  const name = nameStart === p ? '' : asciiName(buf, nameStart, p)
  return {
    start,
    end,
    name,
    closing,
    selfClosing: !closing && buf[end - 2] === SLASH,
  }
}

function asciiName(buf: Uint8Array, from: number, to: number): string {
  let out = ''
  for (let i = from; i < to; i++) out += String.fromCharCode(buf[i]!)
  return out
}

/**
 * Byte-end of an opaque construct (comment / CDATA / PI / DOCTYPE) starting at
 * `start`, or -1 when the `<` there begins none of them. CDATA inside text
 * elements still has to be skipped so its `<`/`>` bytes are not parsed as
 * tags; the save path's opaque-region bookkeeping has no giant twin (giant
 * documents are read-only this round), only the skip matters.
 */
function opaqueEnd(buf: Uint8Array, start: number): number {
  if (startsWith(buf, start, COMMENT_OPEN)) {
    const at = indexOfSeq(buf, COMMENT_CLOSE, start + 4)
    return at === -1 ? buf.length : at + 3
  }
  if (startsWith(buf, start, CDATA_OPEN)) {
    const at = indexOfSeq(buf, CDATA_CLOSE, start + 9)
    return at === -1 ? buf.length : at + 3
  }
  if (buf[start + 1] === QUESTION) {
    const at = indexOfSeq(buf, PI_CLOSE, start + 2)
    return at === -1 ? buf.length : at + 2
  }
  if (buf[start + 1] !== BANG) return -1
  // DOCTYPE with internal subset: bracket depth under quote awareness
  let quote = 0
  let depth = 0
  for (let i = start + 2; i < buf.length; i++) {
    const b = buf[i]!
    if (quote) {
      if (b === quote) quote = 0
      continue
    }
    if (QUOTES.has(b)) quote = b
    else if (b === OPEN_BRACKET) depth++
    else if (b === CLOSE_BRACKET) depth = Math.max(0, depth - 1)
    else if (b === GT && depth === 0) return i + 1
  }
  return buf.length
}

/**
 * Yields each top-level body element as it closes, then returns the scan
 * summary. The first yield comes after the opening elements of the body, so a
 * caller can build a first screen while a multi-GB tail is still scanning.
 */
export function* scanBodyElements(buf: Uint8Array): Generator<GiantElement, GiantScanResult> {
  let cursor = 0
  let bodyContentStart = -1
  let bodyContentEnd = -1
  let inBody = false
  let elementCount = 0
  const stack: Array<{ name: string; start: number }> = []

  while (cursor < buf.length) {
    // find the next '<'
    let start = -1
    for (let i = cursor; i < buf.length; i++) {
      if (buf[i] === LT) {
        start = i
        break
      }
    }
    if (start === -1) break
    const opaque = opaqueEnd(buf, start)
    if (opaque !== -1) {
      cursor = opaque
      continue
    }
    const tag = tagAt(buf, start)
    cursor = tag.end

    if (!inBody) {
      if (!tag.closing && tag.name === 'w:body') {
        if (bodyContentStart === -1) bodyContentStart = tag.end
        if (!tag.selfClosing) inBody = true
        else if (bodyContentEnd === -1) bodyContentEnd = tag.end
      }
      continue
    }

    if (stack.length === 0 && tag.closing && tag.name === 'w:body') {
      bodyContentEnd = start
      inBody = false
      continue
    }

    if (tag.closing) {
      if (stack.length === 0) {
        throw new Error(`unexpected closing tag </${tag.name}> at byte ${start}`)
      }
      const current = stack.pop()!
      if (stack.length === 0) {
        elementCount++
        yield { name: current.name, start: current.start, end: tag.end }
      }
      continue
    }

    if (tag.selfClosing) {
      if (stack.length === 0) {
        elementCount++
        yield { name: tag.name, start: tag.start, end: tag.end }
      }
      continue
    }

    stack.push({ name: tag.name, start: tag.start })
  }

  if (bodyContentStart === -1) {
    throw new Error('document.xml has no <w:body> element')
  }
  return {
    bodyContentStart,
    bodyContentEnd: bodyContentEnd === -1 ? buf.length : bodyContentEnd,
    elementCount,
  }
}
