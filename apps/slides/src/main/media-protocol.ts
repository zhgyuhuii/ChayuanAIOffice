/**
 * HTTP Range semantics for the chaoffice-slide-media protocol handler.
 * Chromium's <video>/<audio> issue `Range: bytes=...` requests (the initial load
 * asks for `bytes=0-`, seeking asks for an explicit window); a handler that
 * answers everything with 200 makes the player buffer the whole file up front
 * and breaks seeking, so slice the body and answer 206/416 like a static file
 * server.
 */

export interface ByteRange {
  start: number
  /** inclusive end, already clamped to total - 1 */
  end: number
}

/**
 * Parse a single-range `Range` header against a body of `total` bytes.
 * - `null` → serve the full body (header missing, syntactically invalid, or a
 *   multi-range request, which media elements never send)
 * - `'unsatisfiable'` → answer 416 (start beyond the end of the body)
 */
export function parseRangeHeader(header: string | null | undefined, total: number): ByteRange | 'unsatisfiable' | null {
  if (!header) return null
  // Header names arrive lower-cased from Chromium, but stay case-insensitive anyway
  const spec = /^bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/.exec(header.trim())
  if (!spec) return null
  const [, rawStart, rawEnd] = spec
  if (rawStart === '' && rawEnd === '') return null
  let start: number
  let end: number
  if (rawStart === '') {
    // suffix range: the last N bytes
    const n = Math.min(Number(rawEnd), total)
    if (n === 0) return 'unsatisfiable'
    start = total - n
    end = total - 1
  } else {
    start = Number(rawStart)
    if (!Number.isFinite(start)) return null
    if (rawEnd === '') {
      end = total - 1
    } else {
      const parsed = Number(rawEnd)
      // An explicitly reversed window is syntactically invalid → full 200
      if (!Number.isFinite(parsed) || parsed < start) return null
      end = Math.min(parsed, total - 1)
    }
    // A start at/past the end of the body is satisfiable by nothing → 416
    if (start >= total) return 'unsatisfiable'
  }
  return { start, end }
}

/** Response headers shared by every slide-media reply (full and partial alike). */
export function baseMediaHeaders(mime: string, length: number): Record<string, string> {
  return {
    'Content-Type': mime,
    'Content-Length': String(length),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    // Tells the media element it may seek by re-requesting a window
    'Accept-Ranges': 'bytes',
  }
}
