// @vitest-environment jsdom
// web_search 工具门控与失败回退:搜索通道不可用时工具从工具箱收起(模型全程
// 用自身知识作答,而不是撞上必失败的调用);通道可用时照常暴露;桥未提供
// 探测能力时保持旧行为(不门控)。搜索失败的工具反馈必须指示「用自身知识
// 回答并注明可能过时」,让一次后端故障不再拖死整轮对话。
import { describe, expect, it } from 'vitest'
import { HomeAgent } from '../src/renderer/src/home-chat/agent'
import type {
  HomeAgentBridge,
  HomeAgentEvents,
  HomeAgentTexts,
} from '../src/renderer/src/home-chat/agent'

const texts: HomeAgentTexts = {
  docBodyMissing: 'missing',
  createFailed: () => 'fail',
  openFailed: () => 'fail',
  unsupportedHandoff: 'no handoff',
  fileNotFound: 'none',
  unknownError: '出错了',
}

type StreamChunk = {
  requestId: string
  type: 'delta' | 'tool-call' | 'done'
  text?: string
  toolCall?: { id: string; name: string; input: Record<string, unknown> }
}

interface BridgeOptions {
  search?: boolean | null
  webSearchError?: string
}

function makeBridge(opts: BridgeOptions = {}) {
  const wireRequests: unknown[] = []
  let listener: ((chunk: StreamChunk) => void) | null = null
  let round = 0
  const bridge: HomeAgentBridge = {
    aiStream: async (request) => {
      wireRequests.push(request)
      // round 1: the model calls web_search; round 2: plain answer
      if (round++ === 0) {
        listener?.({
          requestId: request.requestId,
          type: 'tool-call',
          toolCall: { id: 'c1', name: 'web_search', input: { query: '最新版本' } },
        })
      } else {
        listener?.({ requestId: request.requestId, type: 'delta', text: '回答完毕。' })
      }
      listener?.({ requestId: request.requestId, type: 'done' })
    },
    aiStreamCancel: async () => {},
    onAiStream: (l) => {
      listener = l as typeof listener
      return () => {
        listener = null
      }
    },
    createDocument: async () => ({ ok: true }) as never,
    readAttachment: async () => ({ ok: true, name: '', totalChars: 0, text: '' }) as never,
    readAttachmentImage: async () => ({ ok: false }),
    recents: async () => ({ entries: [] }) as never,
    starred: async () => ({ entries: [] }) as never,
    listProjectFiles: async () => [],
    openWithHandoff: async () => {},
    getCurrentModel: () => ({ profileId: 'p', modelId: 'm' }),
    webSearch: async () =>
      ({
        results: [],
        method: 'error',
        ...(opts.webSearchError ? { error: opts.webSearchError } : {}),
      }) as never,
    ...(opts.search === null || opts.search === undefined
      ? {}
      : {
          searchCapabilities: async () => ({ search: opts.search! }),
        }),
  }
  return { bridge, wireRequests }
}

const events: HomeAgentEvents = {
  onText: () => {},
  onBusy: () => {},
  onDone: () => {},
  onError: (e) => {
    throw new Error(`unexpected run error: ${e}`)
  },
}

function toolNames(req: unknown): string[] {
  return ((req as { tools?: Array<{ name: string }> }).tools ?? []).map((t) => t.name)
}

async function run(bridge: HomeAgentBridge): Promise<void> {
  const agent = new HomeAgent(bridge, events, texts)
  await agent.send('最新版本是多少', [])
  for (let i = 0; i < 100 && agent.busy; i++) await new Promise((r) => setTimeout(r, 10))
  expect(agent.busy).toBe(false)
}

describe('web_search tool gate (搜索通道可用性门控)', () => {
  it('hides web_search when the probe says no usable backend', async () => {
    const { bridge, wireRequests } = makeBridge({ search: false })
    await run(bridge)
    expect(wireRequests).toHaveLength(2)
    for (const req of wireRequests) expect(toolNames(req)).not.toContain('web_search')
  })

  it('exposes web_search when a usable backend resolves', async () => {
    const { bridge, wireRequests } = makeBridge({ search: true })
    await run(bridge)
    expect(wireRequests.length).toBeGreaterThan(0)
    expect(toolNames(wireRequests[0])).toContain('web_search')
  })

  it('keeps web_search exposed when the bridge provides no probe (backward compat)', async () => {
    const { bridge, wireRequests } = makeBridge({})
    await run(bridge)
    expect(toolNames(wireRequests[0])).toContain('web_search')
  })

  it('a failed search orders a knowledge fallback instead of inviting retries', async () => {
    const { bridge, wireRequests } = makeBridge({
      search: true,
      webSearchError: 'duckduckgo: AbortError',
    })
    await run(bridge)
    // round 2 replays the tool result — its feedback must steer the model to
    // answer from its own knowledge, honestly labeled
    const second = wireRequests[1] as {
      messages: Array<{ role: string; text?: string; results?: Array<{ output: string }> }>
    }
    const feedback = second.messages
      .flatMap((m) => (m.role === 'tool' ? (m.results ?? []) : []))
      .map((r) => r.output)
      .join('\n')
    expect(feedback).toContain('Search is unavailable right now')
    expect(feedback).toContain('outdated or unverified')
    expect(feedback).toContain('retry at most once')
  })
})
