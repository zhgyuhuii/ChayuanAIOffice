import { describe, expect, it } from 'vitest'
import {
  AgentLoop,
  isUpstreamHardError,
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

  it('degraded turns keep tool_calls out of history (no-FC APIs reject unpaired assistant.tool_calls)', async () => {
    const transport = scriptedTransport([
      // run 1: two silent turns → probe
      (cb) => {
        cb.onDelta("I'll get right on that")
        cb.onDone()
      },
      (cb) => {
        cb.onDelta('consider it scheduled')
        cb.onDone()
      },
      // probe turn: JSON tool call lands → degraded promoted
      (cb) => {
        cb.onDelta('{"tool":"do_thing","input":{"n":1}}')
        cb.onDone()
      },
      // post-result turn: plain answer
      (cb) => {
        cb.onDelta('All done!')
        cb.onDone()
      },
      // next degraded run (multi-turn): model calls another tool
      (cb) => {
        cb.onDelta('{"tool":"do_thing","input":{"n":2}}')
        cb.onDone()
      },
      // final answer
      (cb) => {
        cb.onDelta('Second action done too.')
        cb.onDone()
      },
    ])
    const loop = new AgentLoop({
      transport,
      skill: makeSkill(() => ({ output: 'done-ok', summary: 'done', mutated: true })),
      events: { onDone: () => {} },
    })
    loop.run('make a deck')
    await flushAll()
    loop.run('and one more thing')
    await flushAll()
    expect(loop.isDegraded).toBe(true)
    // EVERY assistant message in history must be free of tool_calls: degraded
    // results fold into user text, so a tool_calls-bearing assistant message
    // would arrive unpaired and be rejected by no-FC model APIs.
    const msgs = loop.messages as unknown as Array<{ role: string; toolCalls?: unknown }>
    for (const m of msgs) {
      if (m.role === 'assistant') expect(m.toolCalls).toBeUndefined()
    }
    // and the wire never sees a role:'tool' message either
    expect(msgs.some((m) => m.role === 'tool')).toBe(false)
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

describe('isUpstreamHardError', () => {
  it('matches worker crash wrappers, 5xx, and Python exceptions; not soft failures', () => {
    expect(isUpstreamHardError("[address=0.0.0.0:41471, pid=1411] 'id'")).toBe(true)
    expect(isUpstreamHardError('HTTP 500: Internal Server Error')).toBe(true)
    expect(isUpstreamHardError("HTTP 502: [address=0.0.0:41471] KeyError('id')")).toBe(true)
    expect(isUpstreamHardError('The model returned no content (empty stream)')).toBe(false)
    expect(isUpstreamHardError("I'll get right on that")).toBe(false)
  })
})

describe('hard-error degraded retry', () => {
  it('a native-tools run killed by a server crash reruns once in degraded mode and completes', async () => {
    const transport = scriptedTransport([
      // run 1 turn 1 (native tools on the wire): the model server's worker crashes
      (cb) => cb.onError("[address=0.0.0.0:41471, pid=1411] 'id'"),
      // degraded rerun turn 1: JSON tool call in plain text
      (cb) => {
        cb.onDelta('{"tool":"do_thing","input":{"n":1}}')
        cb.onDone()
      },
      // degraded turn 2: final answer
      (cb) => {
        cb.onDelta('All done!')
        cb.onDone()
      },
    ])
    const executions: string[] = []
    const errors: string[] = []
    let lastResult: { text?: string; degraded?: boolean } | undefined
    const loop = new AgentLoop({
      transport,
      skill: makeSkill((call) => {
        executions.push(call.name)
        return { output: 'done-ok', summary: 'done', mutated: true }
      }),
      events: {
        onDone: (res) => (lastResult = res),
        onError: (e) => errors.push(e),
      },
    })
    loop.run('make a deck')
    await flushAll()
    // the crash never reached the user, the rerun went out without wire tools
    expect(errors).toEqual([])
    expect(transport.requests[0]!.toolCount).toBe(1)
    expect(transport.requests[1]!.toolCount).toBe(0)
    expect(transport.requests[1]!.system).toContain('DEGRADED MODE')
    expect(executions).toEqual(['do_thing'])
    expect(lastResult?.degraded).toBe(true)
    expect(lastResult?.text).toBe('All done!')
    expect(loop.isDegraded).toBe(true)
  })

  it('a second hard error from the degraded run surfaces (retry happens once)', async () => {
    const crash = "[address=0.0.0.0:41471, pid=1411] 'id'"
    const transport = scriptedTransport([
      (cb) => cb.onError(crash), // native run dies → degraded rerun
      (cb) => cb.onError(crash), // degraded run dies too → surface
    ])
    const errors: string[] = []
    const loop = new AgentLoop({
      transport,
      skill: makeSkill(),
      events: { onError: (e) => errors.push(e) },
    })
    loop.run('go')
    await flushAll()
    expect(transport.requests).toHaveLength(2)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('address=0.0.0.0:41471')
    expect(loop.isDegraded).toBe(true)
  })

  it('no degradedFallback → a hard error surfaces without a retry', async () => {
    const transport = scriptedTransport([(cb) => cb.onError('HTTP 500: boom')])
    const skill = makeSkill()
    skill.degradedFallback = undefined
    const errors: string[] = []
    const loop = new AgentLoop({
      transport,
      skill,
      events: { onError: (e) => errors.push(e) },
    })
    loop.run('go')
    await flushAll()
    expect(transport.requests).toHaveLength(1)
    expect(errors).toEqual(['HTTP 500: boom'])
  })

  it('a hard error after text already streamed surfaces without a rerun (no double render)', async () => {
    const transport = scriptedTransport([
      (cb) => {
        cb.onDelta('partial answer ')
        cb.onError('HTTP 500: the worker died mid-stream')
      },
    ])
    const errors: string[] = []
    const loop = new AgentLoop({
      transport,
      skill: makeSkill(),
      events: { onError: (e) => errors.push(e) },
    })
    loop.run('go')
    await flushAll()
    expect(transport.requests).toHaveLength(1)
    expect(errors).toHaveLength(1)
  })
})

describe('degraded history sanitization (hard-error degrade mid-conversation)', () => {
  it('rewrites native tool_calls/tool history into the JSON-text protocol on the degraded rerun', async () => {
    const transport = scriptedTransport([
      // run 1 turn 1 (native tools): model issues a real tool call, it executes…
      (cb) => {
        cb.onToolCall({ id: 't1', name: 'do_thing', input: { a: 1 } })
        cb.onDone()
      },
      // …run 1 turn 2 (the replay turn): server crashes on the tool_calls replay
      (cb) => cb.onError("[address=0.0.0.0:41471, pid=1411] 'id'"),
      // degraded rerun turn 1: history rewritten — model re-issues via JSON text
      (cb) => {
        cb.onDelta('{"tool":"do_thing","input":{"n":2}}')
        cb.onDone()
      },
      // degraded turn 2: final answer
      (cb) => {
        cb.onDelta('All done!')
        cb.onDone()
      },
      // a follow-up degraded run keeps working on the same history
      (cb) => {
        cb.onDelta('Follow-up answer.')
        cb.onDone()
      },
    ])
    const executions: string[] = []
    const errors: string[] = []
    let lastResult: { degraded?: boolean; text?: string } | undefined
    const loop = new AgentLoop({
      transport,
      skill: makeSkill((call) => {
        executions.push(call.name)
        return { output: 'done-ok', summary: 'done', mutated: true }
      }),
      events: { onDone: (res) => (lastResult = res), onError: (e) => errors.push(e) },
    })
    loop.run('first ask')
    await flushAll()
    // the crash never surfaced; the degraded rerun completed the run
    expect(errors).toEqual([])
    expect(executions).toEqual(['do_thing', 'do_thing'])
    expect(lastResult?.degraded).toBe(true)
    expect(lastResult?.text).toBe('All done!')
    // wire shapes: native request carried tools, both degraded ones none
    expect(transport.requests[0]!.toolCount).toBe(1)
    expect(transport.requests[1]!.toolCount).toBe(1)
    expect(transport.requests[2]!.toolCount).toBe(0)
    expect(transport.requests[2]!.system).toContain('DEGRADED MODE')
    expect(transport.requests[3]!.toolCount).toBe(0)
    // the replayed history is protocol-clean: no role:'tool', no assistant
    // tool_calls — prior calls appear as JSON text, results as [Tool result:]
    for (const req of transport.requests.slice(2)) {
      expect(req.system).toContain('DEGRADED MODE')
    }
    const msgs = loop.messages as Array<{ role: string; text?: string; toolCalls?: unknown }>
    expect(msgs.some((m) => m.role === 'tool')).toBe(false)
    for (const m of msgs) {
      if (m.role === 'assistant') expect(m.toolCalls).toBeUndefined()
    }
    const historyText = msgs.map((m) => m.text ?? '').join('\n')
    expect(historyText).toContain('[Tool result: do_thing]')
    expect(historyText).toContain('"tool":"do_thing"')
    // a follow-up degraded run keeps working
    loop.run('second ask')
    await flushAll()
    expect(transport.requests.length).toBeGreaterThanOrEqual(5)
  })
})
