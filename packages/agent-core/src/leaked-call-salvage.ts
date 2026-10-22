import type { AgentToolCall } from './types'

/**
 * Salvage for tool calls that leak into content text.
 *
 * Engines with partial tool-call support emit the model's native call markup
 * as plain content instead of protocol `tool_calls` — observed live with a
 * Qwen3 GGUF on xinference llama.cpp: a long `write_document` call inside an
 * unclosed `<think>` block came through as
 * `<tool_call>{"name": …, "arguments": …}</tool_call>` text (sometimes with
 * the opening tag swallowed by the reasoning), so nothing was executed and the
 * panel showed raw markup.
 *
 * Only explicit tool-call blocks whose tool name is known are salvaged —
 * prose that merely resembles JSON cannot misfire. Returns an empty array
 * when nothing salvageable is found.
 */
export function salvageLeakedToolCalls(
  text: string,
  knownToolNames: readonly string[],
): AgentToolCall[] {
  if (!text || !text.includes('tool_call')) return []
  const known = new Set(knownToolNames)
  const calls: AgentToolCall[] = []
  // paired blocks first; then degenerate emissions where the opening
  // <tool_call> was swallowed — the JSON sits at the end of the content
  const blocks = [
    ...[...text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)].map((m) => m[1] ?? ''),
  ]
  if (blocks.length === 0 && text.includes('</tool_call>')) {
    const head = text.slice(0, text.lastIndexOf('</tool_call>'))
    // walk candidate braces backward: the call object wraps the arguments
    // object, so the LAST '{' alone is the inner one — first parseable wins
    let start = head.lastIndexOf('{')
    while (start >= 0) {
      const candidate = head.slice(start).trim()
      try {
        JSON.parse(candidate)
        blocks.push(candidate)
        break
      } catch {
        start = head.lastIndexOf('{', start - 1)
      }
    }
  }
  for (const [i, block] of blocks.entries()) {
    const objStart = block.startsWith('{') ? 0 : block.lastIndexOf('{')
    if (objStart < 0) continue
    try {
      const obj = JSON.parse(block.slice(objStart)) as {
        name?: unknown
        tool?: unknown
        arguments?: unknown
        input?: unknown
      }
      const name =
        typeof obj.name === 'string' ? obj.name : typeof obj.tool === 'string' ? obj.tool : ''
      if (!name || !known.has(name)) continue
      const rawInput = obj.arguments ?? obj.input ?? {}
      const input = typeof rawInput === 'string' ? (JSON.parse(rawInput) as unknown) : rawInput
      calls.push({ id: `salvage_${i}`, name, input: input as Record<string, unknown> })
    } catch {
      // a malformed block is content, not a call
    }
  }
  return calls
}
