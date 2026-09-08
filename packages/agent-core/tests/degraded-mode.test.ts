import { describe, expect, it } from 'vitest'
import {
  AgentLoop,
  parseDegradedToolCalls,
  type AgentSkill,
  type AgentStreamCallbacks,
  type AgentTransport,
  type ToolExecution,
} from '../src'

/** transport scripted turn by turn; records each request's tool count + system */
function scriptedTransport(
  script: Array<(cb: AgentStreamCallbacks) => void>,
): AgentTransport & { requests: Array<{ toolCount: number; system: string }> } {
  let turn = 0
  const transport = {
    requests: [] as Array<{ toolCount: number; system: string }>,
    stream(
      request: { messages: unknown[]; tools: unknown[]; system: string },
      cb: AgentStreamCallbacks,
    ) {
      transport.requests.push({ toolCount: request.tools.length, system: request.system })
      const step = script[turn++]
      if (step) queueMicrotask(() => step(cb))
      return { cancel: () => queueMicrotask(() => cb.onDone()) }
    },
  }
  return transport as never
}

function makeSkill(execute?: (call: { name: string }) => ToolExecution): AgentSkill {
  return {
    id: 'test',
    systemPrompt: 'system',
    tools: [{ name: 'do_thing', description: 'd', inputSchema: { type: 'object' } }],
    buildContext: () => '',
    executeTool: execute ?? (() => ({ output: 'ok', summary: 'done', mutated: true })),
    degradedFallback: () => ({
      systemSuffix:
        'DEGRADED MODE: to act, output only a JSON object {"tool": name, "input": {...}}. Available tool: do_thing.',
    }),
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const flushAll = async (n = 8) => {
  for (let i = 0; i < n; i++) await flush()
}

describe('parseDegradedToolCalls', () => {
  const known = ['do_thing']
  it('parses a single object, an array, fences, and field aliases', () => {
    expect(parseDegradedToolCalls('{"tool":"do_thing","input":{"a":1}}', known)).toEqual([
      { id: 'deg_0', name: 'do_thing', input: { a: 1 } },
    ])
    expect(
      parseDegradedToolCalls('```json\n[{"name":"do_thing","arguments":{"b":2}}]\n```', known),
    ).toEqual([{ id: 'deg_0', name: 'do_thing', input: { b: 2 } }])
    expect(
      parseDegradedToolCalls(
        'Sure! {"tool_name":"do_thing","args":{"c":3}} hope that helps',
        known,
      ),
    ).toEqual([{ id: 'deg_0', name: 'do_thing', input: { c: 3 } }])
  })

  it('drops unknown tools and non-JSON chatter', () => {
    expect(parseDegradedToolCalls('{"tool":"nope"}', known)).toEqual([])
    expect(parseDegradedToolCalls('I will now do the thing!', known)).toEqual([])
    expect(parseDegradedToolCalls('{broken json', known)).toEqual([])
  })
})

describe('degraded mode', () => {
  it('runs a probe across two silent runs, promotes on a landed JSON call, feeds results as user text', async () => {
    const transport = scriptedTransport([
      // run 1 turn 1: silent (silentTurns=1, run ends)
      (cb) => {
        cb.onDelta("I'll generate that for you right away")
        cb.onDone()
      },
      // run 2 turn 1: silent again (silentTurns=2 → probe starts in-run)
      (cb) => {
        cb.onDelta('Let me generate the deck now, starting immediately')
        cb.onDone()
      },
      // probe turn: JSON tool call in plain text
      (cb) => {
        cb.onDelta('{"tool":"do_thing","input":{"n":1}}')
        cb.onDone()
      },
      // post-result turn: plain answer (degraded mode normal exit)
      (cb) => {
        cb.onDelta('All done!')
        cb.onDone()
      },
    ])
    const executions: string[] = []
    let lastResult: { degraded?: boolean } | undefined
    const loop = new AgentLoop({
      transport,
      skill: makeSkill((call) => {
        executions.push(call.name)
        return { output: 'done-ok', summary: 'done', mutated: true }
      }),
      events: { onDone: (res) => (lastResult = res) },
    })
    loop.run('make a deck')
    await flushAll()
    expect(loop.isDegraded).toBe(false) // one silent run must not degrade
    loop.run('did you do it?')
    await flushAll()
    expect(executions).toEqual(['do_thing'])
    expect(lastResult?.degraded).toBe(true)
    expect(loop.isDegraded).toBe(true)
    // probe request: no wire tools + degraded suffix in system
    const probe = transport.requests[2]!
    expect(probe.toolCount).toBe(0)
    expect(probe.system).toContain('DEGRADED MODE')
    // tool result folded into a user text message (no role:'tool' on degraded runs);
    // the final message is the post-result assistant answer
    const msgs = loop.messages as Array<{ role: string; text?: string }>
    expect(msgs.at(-1)?.role).toBe('assistant')
    expect(msgs.at(-2)?.role).toBe('user')
    expect(msgs.at(-2)?.text).toContain('done-ok')
  })

  it('a probe that just talks is never retried (chatty FC model keeps native tools)', async () => {
    const transport = scriptedTransport([
      (cb) => {
        cb.onDelta('nice weather') // run 1: silent
        cb.onDone()
      },
      (cb) => {
        cb.onDelta('indeed') // run 2: silent → probe
        cb.onDone()
      },
      (cb) => {
        cb.onDelta('just chatting') // probe: plain text → restore
        cb.onDone()
      },
      (cb) => {
        cb.onDelta('hello again') // run 3: normal, wire tools back
        cb.onDone()
      },
    ])
    const loop = new AgentLoop({ transport, skill: makeSkill() })
    loop.run('hi')
    await flushAll()
    loop.run('hi again')
    await flushAll()
    expect(loop.isDegraded).toBe(false)
    loop.run('third')
    await flushAll()
    // run 3's request carried wire tools and no degraded suffix
    expect(transport.requests[3]!.toolCount).toBe(1)
    expect(transport.requests[3]!.system).not.toContain('DEGRADED MODE')
  })

  it('degrade() forces the JSON-text protocol statically', async () => {
    const transport = scriptedTransport([
      (cb) => {
        cb.onDelta('{"tool":"do_thing","input":{}}')
        cb.onDone()
      },
      (cb) => cb.onDelta('done'),
    ])
    const loop = new AgentLoop({ transport, skill: makeSkill() })
    expect(loop.degrade()).toBe(true)
    loop.run('go')
    await flushAll()
    expect(transport.requests[0]!.toolCount).toBe(0)
    expect(transport.requests[0]!.system).toContain('DEGRADED MODE')
    expect(loop.isDegraded).toBe(true)
  })

  it('degrade() parses and executes JSON tool calls in static mode, folds results as user text', async () => {
    const transport = scriptedTransport([
      (cb) => {
        cb.onDelta('{"tool":"do_thing","input":{"n":1}}')
        cb.onDone()
      },
      (cb) => {
        cb.onDelta('All done!')
        cb.onDone()
      },
    ])
    const executions: string[] = []
    let lastResult: { text?: string; degraded?: boolean } | undefined
    const loop = new AgentLoop({
      transport,
      skill: makeSkill((call) => {
        executions.push(call.name)
        return { output: 'done-ok', summary: 'done', mutated: true }
      }),
      events: { onDone: (res) => (lastResult = res) },
    })
    expect(loop.degrade()).toBe(true)
    loop.run('go')
    await flushAll()
    expect(executions).toEqual(['do_thing'])
    expect(lastResult?.degraded).toBe(true)
    expect(lastResult?.text).toBe('All done!')
    // degraded runs never put role:'tool' on the wire: the result is folded into a user text message
    const msgs = loop.messages as Array<{ role: string; text?: string }>
    expect(msgs.some((m) => m.role === 'tool')).toBe(false)
    expect(msgs.some((m) => m.role === 'user' && m.text?.includes('done-ok'))).toBe(true)
  })

  it('degrade() is a no-op for skills without degradedFallback', () => {
    const transport = scriptedTransport([(cb) => cb.onDone()])
    const skill = makeSkill()
    skill.degradedFallback = undefined
    const loop = new AgentLoop({ transport, skill })
    expect(loop.degrade()).toBe(false)
  })
})
