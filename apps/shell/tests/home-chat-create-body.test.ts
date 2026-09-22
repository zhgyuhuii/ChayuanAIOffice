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
  '# 大美中国\n\n## 山河壮丽\n\n从雪山之巅到东海之滨，这是一段足够长的 Markdown 正文，用来通过最小文档长度校验。\n\n- 要点一\n- 要点二'

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
    // 拒绝提示绝不能给模型留 md 逃生门——上次事故里模型就是被提示里的
    // 「md wants plain Markdown source」诱导把 type=docx 改成了 md
    expect(toolFeedback).not.toMatch(/\bmd\b/i)
    expect(toolFeedback).not.toContain('Markdown')
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

  it('converts a markdown body to restricted html for docx (type never silently demoted)', async () => {
    // 事故场景:用户要 word,模型却按 Markdown 写正文并调 type=docx。
    // 旧行为:提取不到 HTML → 拒绝 + 提示里出现 md → 模型改 type=md 得逞,
    // 用户要 word 得到 md。新行为:就地转换,docx 落盘,一轮成功。
    const { bridge, created } = makeBridge([
      {
        text: MD_BODY,
        toolCall: { id: 'c1', name: 'create_document', input: { title: '大美中国', type: 'docx' } },
      },
      { text: '文档已生成。' },
    ])
    const { events, dones, errors } = makeEvents()
    await run(bridge, events)
    expect(errors).toEqual([])
    expect(created).toHaveLength(1)
    expect(created[0]!.type).toBe('docx')
    expect(created[0]!.content).toContain('<h1>大美中国</h1>')
    expect(created[0]!.content).toContain('<h2>山河壮丽</h2>')
    expect(created[0]!.content).toContain('<ul><li>要点一</li><li>要点二</li></ul>')
    // 落盘内容不再是裸 Markdown 语法
    expect(created[0]!.content).not.toContain('#')
    expect(created[0]!.content).not.toContain('- 要点')
    expect(dones.at(-1)?.createdDoc).toEqual({ title: '大美中国', docType: 'docx' })
  })

  it('strips the preamble when converting a markdown body for docx', async () => {
    const { bridge, created } = makeBridge([
      {
        text: `${PREAMBLE}\n\n${MD_BODY}`,
        toolCall: { id: 'c1', name: 'create_document', input: { title: '大美中国', type: 'docx' } },
      },
      { text: '文档已生成。' },
    ])
    const { events } = makeEvents()
    await run(bridge, events)
    expect(created).toHaveLength(1)
    expect(created[0]!.type).toBe('docx')
    expect(created[0]!.content.startsWith('<h1>大美中国</h1>')).toBe(true)
    expect(created[0]!.content).not.toContain('我来为你写')
  })

  it('recovers when the model splits body and tool call across turns (GJB dead-end)', async () => {
    // 事故现场:轮1空正文调 create_document 被拒;轮2补写完整正文却不再调
    // 工具。旧行为:运行就此结束,文档不创建(「生成文档后打不开编辑器」)。
    // 新行为:verifyResponse 强制补一轮工具调用,正文从历史回溯取得。
    const { bridge, created, wireRequests } = makeBridge([
      { toolCall: { id: 'c1', name: 'create_document', input: { title: '软件设计大纲', type: 'docx' } } },
      { text: DOC_BODY },
      { toolCall: { id: 'c2', name: 'create_document', input: { title: '软件设计大纲', type: 'docx' } } },
      { text: '文档已生成。' },
    ])
    const { events, dones, errors } = makeEvents()
    await run(bridge, events)
    expect(errors).toEqual([])
    expect(created).toHaveLength(1)
    expect(created[0]!.type).toBe('docx')
    expect(created[0]!.content).toBe(DOC_BODY)
    expect(dones.at(-1)?.createdDoc).toEqual({ title: '软件设计大纲', docType: 'docx' })
    // 第 3 次 wire 请求(纠错轮)带着 verifyResponse 的补调指令
    const correction = wireRequests[2] as { messages: Array<{ role: string; text?: string }> }
    expect(
      correction.messages.some((m) => m.text?.includes('failed because the body was not written yet')),
    ).toBe(true)
  })

  it('recovers the same dead-end for markdown bodies', async () => {
    const { bridge, created } = makeBridge([
      { toolCall: { id: 'c1', name: 'create_document', input: { title: '笔记', type: 'md' } } },
      { text: MD_BODY },
      { toolCall: { id: 'c2', name: 'create_document', input: { title: '笔记', type: 'md' } } },
      { text: '已创建。' },
    ])
    const { events, errors } = makeEvents()
    await run(bridge, events)
    expect(errors).toEqual([])
    expect(created).toHaveLength(1)
    expect(created[0]!.type).toBe('md')
    expect(created[0]!.content).toBe(MD_BODY)
  })

  it('accepts a signal-free pure-paragraph markdown body in the current turn (md keeps the length-only gate)', async () => {
    const prose = '这是一段没有任何 Markdown 块级信号的纯段落笔记正文，长度早已越过最小文档门槛，应当按原文直传创建 md 文件而不被拒绝。'
    const { bridge, created } = makeBridge([
      {
        text: prose,
        toolCall: { id: 'c1', name: 'create_document', input: { title: '随笔', type: 'md' } },
      },
      { text: '已创建。' },
    ])
    const { events, errors } = makeEvents()
    await run(bridge, events)
    expect(errors).toEqual([])
    expect(created).toHaveLength(1)
    expect(created[0]!.content).toBe(prose)
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
