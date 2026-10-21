import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@chaoffice/agent-core'
import { streamForProvider } from '../src/stream'
import { jsonResponse, okResponse, sseStream } from './test-utils'

afterEach(() => {
  vi.unstubAllGlobals()
})

function collector() {
  const deltas: string[] = []
  const toolCalls: Array<{ name: string; input: unknown }> = []
  const errors: string[] = []
  return {
    deltas,
    toolCalls,
    errors,
    cb: {
      signal: new AbortController().signal,
      onDelta: (text: string) => deltas.push(text),
      onToolCall: (call: { name: string; input: unknown }) => toolCalls.push(call),
      onStopReason: () => undefined,
    },
  }
}

describe('non-stream salvage for empty-stream engines', () => {
  it('a stream+tools request that carries only [DONE] is retried non-stream and yields tool calls', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>
      bodies.push(body)
      if (body.stream === true) {
        // the xinference llama.cpp disease: SSE opens and closes with nothing
        return okResponse(sseStream(['data: [DONE]']))
      }
      return jsonResponse({
        choices: [
          {
            finish_reason: 'tool_calls',
            index: 0,
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'c1',
                  type: 'function',
                  function: { name: 'do_thing', arguments: '{"a":1}' },
                },
              ],
            },
          },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const history: AgentMessage[] = [{ role: 'user', text: 'do the thing' }]
    const c = collector()
    await streamForProvider(
      'openai',
      { apiKey: 'k', model: 'm' },
      'sys',
      history,
      [{ name: 'do_thing', description: 'd', inputSchema: { type: 'object' } }],
      100,
      { ...c.cb, sessionId: 's1' } as typeof c.cb,
    )
    expect(c.errors).toEqual([])
    expect(c.toolCalls).toHaveLength(1)
    expect(c.toolCalls[0]!.name).toBe('do_thing')
    // the salvage attempt went out without streaming
    expect(bodies[0]!.stream).toBe(true)
    expect(bodies[1]!.stream).toBeUndefined()
    expect(bodies[1]!.tools).toBeTruthy()
  })

  it('a plain-content engine answer is salvaged as a single delta', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>
      bodies.push(body)
      if (body.stream === true) return okResponse(sseStream(['data: [DONE]']))
      return jsonResponse({
        choices: [
          { finish_reason: 'stop', index: 0, message: { role: 'assistant', content: '成功' } },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const deltas: string[] = []
    await streamForProvider(
      'openai',
      { apiKey: 'k', model: 'm' },
      'sys',
      [{ role: 'user', text: 'hi' }],
      [],
      50,
      {
        signal: new AbortController().signal,
        onDelta: (t) => deltas.push(t),
        onToolCall: () => undefined,
        onStopReason: () => undefined,
      },
    )
    expect(deltas.join('')).toBe('成功')
    expect(bodies.length).toBe(2)
  })
})
