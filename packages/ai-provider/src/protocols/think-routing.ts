/**
 * Router for models that emit their reasoning as a literal `<think>…</think>`
 * block inside `content` — engines that do not parse it into
 * `reasoning_content` (observed live: xinference llama.cpp + custom GGUF
 * registrations). Chunk-boundary safe: the open/close tags may be split
 * across deltas, so the router buffers until a tag can be decided.
 *
 * `route()` classifies one delta into reasoning/content pieces; `flush()`
 * releases anything held back at end of stream. Probing stays conservative:
 * content that does not open with `<think>` passes through untouched.
 */
const OPEN = '<think>'
const CLOSE = '</think>'

export type ThinkPiece = { kind: 'reasoning' | 'content'; text: string }

export function createThinkRouter() {
  let mode: 'probe' | 'think' | 'plain' = 'probe'
  let probe = ''
  let tail = ''

  function emitThink(s: string): ThinkPiece[] {
    const close = s.indexOf(CLOSE)
    if (close < 0) {
      // hold back a possible partial close tag spanning chunks
      const keep = Math.min(CLOSE.length - 1, s.length)
      tail = s.slice(s.length - keep)
      return [{ kind: 'reasoning', text: s.slice(0, s.length - keep) }]
    }
    tail = ''
    mode = 'plain'
    const reasoning = s.slice(0, close)
    const rest = s.slice(close + CLOSE.length)
    const out: ThinkPiece[] = [{ kind: 'reasoning', text: reasoning }]
    if (rest) out.push({ kind: 'content', text: rest })
    return out
  }

  return {
    route(delta: string): ThinkPiece[] {
      if (mode === 'plain') return [{ kind: 'content', text: delta }]
      const s = tail + delta
      tail = ''
      if (mode === 'think') return emitThink(s)
      probe += s
      const head = probe.replace(/^\s+/, '')
      if (head.startsWith(OPEN)) {
        mode = 'think'
        const after = probe.slice(probe.indexOf(OPEN) + OPEN.length)
        return after ? emitThink(after) : []
      }
      if (head.length >= OPEN.length || (head.length > 0 && !OPEN.startsWith(head))) {
        mode = 'plain'
        return [{ kind: 'content', text: probe }]
      }
      return []
    },
    flush(): ThinkPiece[] {
      const held = tail
      tail = ''
      if (!held) return []
      if (mode === 'think') return [{ kind: 'reasoning', text: held }]
      return [{ kind: 'content', text: held }]
    },
  }
}

/** Non-stream form: split a complete content string at its think block. */
export function splitThinkContent(content: string): { reasoning: string; content: string } {
  const head = content.replace(/^\s+/, '')
  if (!head.startsWith(OPEN)) return { reasoning: '', content }
  const close = head.indexOf(CLOSE)
  if (close < 0) return { reasoning: head.slice(OPEN.length).trim(), content: '' }
  const reasoning = head.slice(OPEN.length, close).trim()
  const rest = head.slice(close + CLOSE.length)
  return { reasoning, content: rest }
}
