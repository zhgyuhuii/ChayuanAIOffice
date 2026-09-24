// @vitest-environment jsdom
// T3 排版接力（首页侧）：create_document 成功时，用户本轮原始指令随
// docx 请求透传（instruction 字段）——docs 渲染器据此在内容落纸后跑一轮
// 本地排版（setFont/insertToc/…）；md 请求不带该字段。
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

/** a document body comfortably past MIN_DOC_BODY_CHARS (50) */
const DOC_BODY =
  '<h1>季度报告</h1><h2>概述</h2><p>这是一段足够长的正文，用来通过最小文档长度校验。</p>'

type StreamChunk = {
  requestId: string
  type: 'delta' | 'tool-call' | 'done'
  text?: string
  toolCall?: { id: string; name: string; input: Record<string, unknown> }
}

function makeBridge(docType: 'docx' | 'md') {
  const created: CreateDocumentRequest[] = []
  let listener: ((chunk: StreamChunk) => void) | null = null
  let toolRound = 0
  const bridge: HomeAgentBridge = {
    aiStream: async (request) => {
      const id = request.requestId
      listener?.({ requestId: id, type: 'delta', text: DOC_BODY })
      // only the first turn calls the tool; the follow-up turn closes plainly
      // (the real model stops calling create_document after it succeeded)
      if (toolRound++ === 0) {
        listener?.({
          requestId: id,
          type: 'tool-call',
          toolCall: {
            id: 'call-1',
            name: 'create_document',
            input: { title: '季度报告', type: docType },
          },
        })
      } else {
        listener?.({ requestId: id, type: 'delta', text: '文档已生成。' })
      }
      listener?.({ requestId: id, type: 'done' })
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
  return { bridge, created }
}

const events: HomeAgentEvents = {
  onText: () => {},
  onBusy: () => {},
  onDone: () => {},
  onError: () => {},
}

async function runCreate(bridge: HomeAgentBridge, instruction: string): Promise<void> {
  const agent = new HomeAgent(bridge, events, texts)
  await agent.send(instruction, [])
  // the tool executes after the stream settles — give the async chain a tick
  for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 10))
}

describe('create_document formatting-instruction relay (T3)', () => {
  it('forwards the raw user instruction with the docx create request', async () => {
    const { bridge, created } = makeBridge('docx')
    const instruction = '帮我写一篇周报，要生成目录，字体用宋体，标题16号，点击目录跳转'
    await runCreate(bridge, instruction)
    expect(created).toHaveLength(1)
    expect(created[0]!.type).toBe('docx')
    expect(created[0]!.instruction).toBe(instruction)
    expect(created[0]!.content).toBe(DOC_BODY)
  })

  it('omits the instruction for markdown documents (formatting is docx-only)', async () => {
    const { bridge, created } = makeBridge('md')
    await runCreate(bridge, '写一篇 Markdown 笔记')
    expect(created).toHaveLength(1)
    expect(created[0]!.type).toBe('md')
    expect('instruction' in created[0]!).toBe(false)
  })
})
