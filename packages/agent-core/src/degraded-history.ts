import type { AgentMessage } from './types'

/**
 * History sanitizer for degraded (JSON-text protocol) turns.
 *
 * A native-tools turn leaves `assistant.toolCalls` + `role:'tool'` messages in
 * history. Replay that history to a server whose tool-call support is broken
 * and it crashes again — the degrade must therefore rewrite what goes on the
 * wire: prior calls appear as the JSON text the protocol teaches, results as
 * the "[Tool result: …]" user messages the loop already produces for degraded
 * executions. Non-tool messages pass through untouched.
 */
export function sanitizeHistoryForDegraded(messages: readonly AgentMessage[]): AgentMessage[] {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const calls = m.toolCalls
        .map((c) => JSON.stringify({ tool: c.name, input: c.input }))
        .join('\n')
      const text = [m.text, calls].filter(Boolean).join('\n')
      return { role: 'assistant' as const, text }
    }
    if (m.role === 'tool') {
      const resultText = m.results
        .map((r) => `[Tool result: ${r.name}${r.isError ? ' (error)' : ''}]\n${r.output}`)
        .join('\n\n')
      return {
        role: 'user' as const,
        text: `[System] Tool execution results follow. To call another tool, output only its JSON object; to finish, answer in plain text.\n\n${resultText}`,
      }
    }
    return m
  })
}
