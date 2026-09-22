// @vitest-environment jsdom
// create_document 正文契约守卫（大美中国事故回归）：模型只写了对话性开场白
// （「我来为你写……下面开始生成」）就调工具时，docx 必须拒绝并提示先写正文
// 再重试，而不是把开场白原样落盘成整份文档；「开场白+正文同轮」与重试轮都
// 要把开场白剥掉，md 保持纯 Markdown 源直传（无块级信号，不套 HTML 提取）。
import { describe, expect, it } from 'vitest'
import { HomeAgent } from '../src/renderer/src/home-chat/agent'
import type {
  HomeAgentBridge,
  HomeAgentEvents,
  HomeAgentTexts,
} from '../src/renderer/src/home-chat/agent'
import type { CreateDocumentRequest } from '../../docs/src/shared/ipc'

const texts: HomeAgentTexts = {
  docBodyMissing: 'missing',
  createFailed: () => 'fail',
  openFailed: () => 'fail',
  unsupportedHandoff: 'no handoff',
  fileNotFound: 'none',
  unknownError: '出错了',
}

/** 事故现场的开场白：百来字，远超旧的 50 字长度门槛 */
const PREAMBLE =
  '我来为你写一篇《大美中国》的文章，包含封面、目录、标题和标准排版。先说明一点：封面背景（背景图/底色）在 Word 里需要页面背景设置，我会在文档里做好封面版式，你打开后在 Word 中「设计 → 页面颜色/背景」即可一键加上背景图。下面开始生成'

const DOC_BODY =
  '<h1>大美中国</h1><toc></toc><h2>山河壮丽</h2><p>这是一段足够长的正文，用来通过最小文档长度校验，山川湖海皆入画来。</p>'

const MD_BODY =
  '# 大美中国\n\n## 山河壮丽\n\n这是一段足够长的 Markdown 正文，用来通过最小文档长度校验，山河湖海皆成文章。'

type StreamChunk = {
  requestId: string
  type: 'delta' | 'tool-call' | 'done'
  text?: string
  toolCall?: { id: string; name: string; input: Record<string, unknown> }
}

interface TurnScript {
  text?: string
  toolCall?: { id: string; name: string; input: Record<string, unknown> }
}

function makeBridge(script: TurnScript[]) {
  const created: CreateDocumentRequest[] = []
  const wireRequests: unknown[] = []
  let listener: ((chunk: StreamChunk) => void) | null = null
  let round = 0
  const bridge: HomeAgentBridge = {
    aiStream: async (request) => {
      wireRequests.push(request)
      const turn = script[Math.min(round, script.length - 1)]!
      round += 1
      if (turn.text) {
        listener?.({ requestId: request.requestId, type: 'delta', text: turn.text })
      }
      if (turn.toolCall) {
        listener?.({ requestId: request.requestId, type: 'tool-call', toolCall: turn.toolCall })
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
    createDocument: async (request) => {
      created.push(request as CreateDocumentRequest)
      return { ok: true }
    },
    readAttachment: async () => ({ ok: true, name: '', totalChars: 0, text: '' }) as never,
    readAttachmentImage: async () => ({ ok: false }),
    recents: async () => ({ entries: [] }) as never,
    starred: async () => ({ entries: [] }) as never,
    listProjectFiles: async () => [],
    openWithHandoff: async () => {},
    getCurrentModel: () => ({ profileId: 'prof', modelId: 'glm-5.3' }),
  }
  return { bridge, created, wireRequests }
}

function makeEvents() {
  const dones: Parameters<HomeAgentEvents['onDone']>[0][] = []
  const errors: string[] = []
  const events: HomeAgentEvents = {
    onText: () => {},
    onBusy: () => {},
    onDone: (result) => dones.push(result),
    onError: (error) => errors.push(error),
  }
  return { events, dones, errors }
}

async function until(fn: () => boolean, what = 'condition'): Promise<void> {
  for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 10))
  if (!fn()) throw new Error(`timed out waiting for: ${what}`)
}

async function run(bridge: HomeAgentBridge, events: HomeAgentEvents): Promise<HomeAgent> {
  const agent = new HomeAgent(bridge, events, texts)
  await agent.send('帮我写一篇大美中国 1000以上 要有封面 要有目录', [])
  await until(() => !agent.busy, 'agent idle')
  return agent
}

describe('create_document body contract (开场白不得落盘)', () => {
  it('rejects a preamble-only reply, then accepts the retried body turn', async () => {
    const { bridge, created, wireRequests } = makeBridge([
      { text: PREAMBLE, toolCall: { id: 'c1', name: 'create_document', input: { title: '大美中国', type: 'docx' } } },
      { text: DOC_BODY, toolCall: { id: 'c2', name: 'create_document', input: { title: '大美中国', type: 'docx' } } },
      { text: '文档已生成。' },
    ])
    const { events, dones, errors } = makeEvents()
    await run(bridge, events)
    expect(errors).toEqual([])
    // 开场白轮被拒绝:第二轮的 wire 请求里带着契约提示的纠错反馈
    const second = wireRequests[1] as {
      messages: Array<{ role: string; results?: Array<{ output: string }> }>
    }
    const toolFeedback = second.messages
      .filter((m) => m.role === 'tool')
      .flatMap((m) => m.results ?? [])
      .map((r) => r.output)
      .join('\n')
    expect(toolFeedback).toContain('missing')
    expect(toolFeedback).toContain('conversational preamble')
    // 重试轮成功落盘,且正文不带开场白
    expect(created).toHaveLength(1)
    expect(created[0]!.type).toBe('docx')
    expect(created[0]!.content).toBe(DOC_BODY)
    expect(dones.at(-1)?.createdDoc).toEqual({ title: '大美中国', docType: 'docx' })
  })

  it('strips a leading preamble when preamble and body share one turn', async () => {
    const { bridge, created } = makeBridge([
      {
        text: `${PREAMBLE}${DOC_BODY}`,
        toolCall: { id: 'c1', name: 'create_document', input: { title: '大美中国', type: 'docx' } },
      },
      { text: '文档已生成。' },
    ])
    const { events } = makeEvents()
    await run(bridge, events)
    expect(created).toHaveLength(1)
    expect(created[0]!.content).toBe(DOC_BODY)
  })

  it('passes markdown source through verbatim for .md (no html extraction)', async () => {
    const { bridge, created } = makeBridge([
      {
        text: MD_BODY,
        toolCall: { id: 'c1', name: 'create_document', input: { title: '笔记', type: 'md' } },
      },
      { text: '已创建。' },
    ])
    const { events } = makeEvents()
    await run(bridge, events)
    expect(created).toHaveLength(1)
    expect(created[0]!.type).toBe('md')
    expect(created[0]!.content).toBe(MD_BODY)
  })

  it('passes a complete html document through verbatim (head/styles must survive)', async () => {
    const html =
      '<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif}</style></head><body><h1>大美中国</h1><p>这是一段足够长的完整 HTML 页面正文，用来验证整体直传不被片段提取截断。</p></body></html>'
    const { bridge, created } = makeBridge([
      {
        text: html,
        toolCall: { id: 'c1', name: 'create_document', input: { title: '页面', type: 'html' } },
      },
      { text: '已创建。' },
    ])
    const { events } = makeEvents()
    await run(bridge, events)
    expect(created).toHaveLength(1)
    expect(created[0]!.type).toBe('html')
    // 按 docx/pdf 的块级标签提取会把 <head>/<style> 砍掉 — html 类型必须整体直传
    expect(created[0]!.content).toBe(html)
  })
})
