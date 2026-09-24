import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const agentHarness = vi.hoisted(() => ({
  events: null as null | {
    onToolExecuted?: (event: {
      call: { id: string; name: string; input: unknown }
      execution: { summary: string; output?: string; isError?: boolean; mutated?: boolean }
    }) => void
    onTurnEnd?: () => void
    onDone?: (result: { text: string; cancelled: boolean; turnLimit: boolean }) => void
    onError?: (error: string) => void
  },
  run: vi.fn(),
  cancel: vi.fn(),
  reset: vi.fn(),
  restore: vi.fn(),
}))

vi.mock('@chatoffice/agent-core', async () => {
  const actual =
    await vi.importActual<typeof import('@chatoffice/agent-core')>('@chatoffice/agent-core')
  return {
    ...actual,
    AgentLoop: class MockAgentLoop {
      busy = false

      constructor(options: { events?: typeof agentHarness.events }) {
        agentHarness.events = options.events ?? null
      }

      run(...args: unknown[]) {
        agentHarness.run(...args)
      }

      cancel() {
        agentHarness.cancel()
      }

      reset() {
        agentHarness.reset()
      }

      restore(...args: unknown[]) {
        agentHarness.restore(...args)
      }
    },
  }
})

// react-konva's node entry requires the native 'canvas' package; these tests do not draw.
vi.mock('react-konva', () => {
  const stub = () => null
  return {
    Stage: stub,
    Layer: stub,
    Rect: stub,
    Group: stub,
    Transformer: stub,
    Line: stub,
    Arrow: stub,
    Text: stub,
    Ellipse: stub,
    Image: stub,
    Path: stub,
    Circle: stub,
    Arc: stub,
  }
})

import { AiPanel } from '../src/renderer/ai/AiPanel'
import { type AttachmentMeta } from '../src/shared/ipc'
// adapted: 360ce06 — the panel takes the local AiSettingsV2 shape
import { defaultSettingsV2, type AiSettingsV2 } from '@chatoffice/ai-provider'

const settings: AiSettingsV2 = defaultSettingsV2()

const mountedRoots: Array<{ root: Root; container: HTMLElement }> = []

function mount(element: React.ReactElement): { root: Root; container: HTMLElement } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  mountedRoots.push({ root, container })
  return { root, container }
}

function panelProps(overrides: Record<string, unknown> = {}) {
  return {
    slides: [],
    current: 0,
    selectedIds: [],
    images: new Map<string, HTMLImageElement>(),
    applySlide: () => {},
    applyDeck: () => {},
    fitWidthPx: 960,
    settings,
    open: true,
    onExpand: () => {},
    onCollapse: () => {},
    ...overrides,
  }
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

// LOCAL(2026-09-21, d8201ad0): 多会话改造后 loop 惰性构造——测试先从 composer 发一条
// 消息驱动 runWith 建 loop,再通过 harness 触发生命周期事件。
async function sendFromComposer(container: HTMLElement, text: string): Promise<void> {
  const ta = container.querySelector<HTMLTextAreaElement>('textarea[data-slides-ai-input]')
  expect(ta).not.toBeNull()
  const input = ta!
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )!.set!
    setter.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )
  })
  await flushEffects()
  await flushEffects()
}

/** conversation-index API mock: one seeded open conversation with the given chatId */
function installConversationsApi(seedChatId = 'deck-chat'): void {
  Object.defineProperty(window, 'projectApi', {
    configurable: true,
    value: {
      conversationsList: async () => ({
        projectId: 'default',
        conversations: [{ chatId: seedChatId, title: '', createdAt: 1, lastActiveAt: 1 }],
        openIds: [seedChatId],
        activeId: seedChatId,
      }),
      conversationCreate: async () => ({ projectId: 'default', chatId: `${seedChatId}-2` }),
      conversationMeta: async () => {},
      conversationsOpenSet: async () => {},
      conversationDelete: async () => {},
      conversationsDeleteAll: async () => {},
      conversationsRebind: async () => {},
      // per-conversation transcript store (the conversation body loads/persists)
      loadChat: async () => [],
      appendChat: async () => {},
    },
  })
}

function installSlidesApi(): void {
  Object.defineProperty(window, 'slidesApi', {
    configurable: true,
    value: {
      aiGskStatus: vi.fn(async () => ({ loggedIn: true })),
      // adapted: local AiPanel refreshes the ChatOffice login state on mount
      aiChatOfficeStatus: vi.fn(async () => ({ loggedIn: true })),
      beginHistoryBatch: vi.fn(async () => false),
      endHistoryBatch: vi.fn(async () => null),
      aiLogRunFailure: vi.fn(async () => undefined),
    },
  })
}

beforeAll(() => {
  Element.prototype.scrollTo ??= () => {}
})

beforeEach(() => {
  agentHarness.events = null
  agentHarness.run.mockReset()
  agentHarness.cancel.mockReset()
  agentHarness.reset.mockReset()
  agentHarness.restore.mockReset()
  installSlidesApi()
  Object.defineProperty(window, 'projectApi', { configurable: true, value: undefined })
  Object.defineProperty(window, 'desktop', {
    configurable: true,
    value: { readAttachmentImage: vi.fn(async () => ({ ok: false })) },
  })
})

afterEach(() => {
  for (const { root, container } of mountedRoots.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
  vi.restoreAllMocks()
})

describe('AiPanel agent run lifecycle (slides)', () => {
  it('persists a successful tool-only run so reopening can restore the completed turn', async () => {
    const appendChat = vi.fn(async () => undefined)
    installConversationsApi('deck-chat')
    Object.defineProperty(window, 'projectApi', {
      configurable: true,
      value: {
        ...((window as unknown as { projectApi?: Record<string, unknown> }).projectApi ?? {}),
        resolveChat: vi.fn(async () => ({ projectId: 'default', chatId: 'deck-chat' })),
        loadChat: vi.fn(async () => []),
        appendChat,
        rebindChat: vi.fn(async () => ({ projectId: 'default', chatId: 'deck-chat' })),
      },
    })

    const { container } = mount(
      createElement(AiPanel, panelProps({ currentFilePath: '/tmp/deck.pptx' })),
    )
    await flushEffects()
    appendChat.mockClear()

    // the lazy loop builds on the first send
    await sendFromComposer(container, 'run this')
    expect(agentHarness.events).not.toBeNull()
    act(() => {
      agentHarness.events!.onToolExecuted?.({
        call: { id: 'tool-1', name: 'apply_ops', input: { op: 'set_fill' } },
        execution: { summary: 'Changed the title fill', output: 'ok', mutated: true },
      })
      agentHarness.events!.onDone?.({ text: '', cancelled: false, turnLimit: false })
    })
    await flushEffects()

    expect(appendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'default',
        chatId: 'deck-chat',
        role: 'assistant',
        text: '',
        tools: [
          expect.objectContaining({
            name: 'apply_ops',
            summary: 'Changed the title fill',
            output: 'ok',
          }),
        ],
      }),
    )
  })

  it('keeps readable images and continues the run when another attachment read rejects', async () => {
    const readAttachmentImage = vi.fn(async (path: string) => {
      if (path.endsWith('good.png')) return { ok: true, base64: 'AAAA', mime: 'image/png' }
      throw new Error('attachment bridge unavailable')
    })
    Object.defineProperty(window, 'desktop', {
      configurable: true,
      value: { readAttachmentImage },
    })
    const attachments: AttachmentMeta[] = [
      { path: '/tmp/good.png', name: 'good.png', ext: 'png', sizeBytes: 128 },
      { path: '/tmp/bad.png', name: 'bad.png', ext: 'png', sizeBytes: 128 },
    ]

    mount(
      createElement(
        AiPanel,
        panelProps({
          preset: {
            text: 'Polish this slide',
            nonce: 1,
            autoRun: true,
            attachments,
          },
        }),
      ),
    )
    await flushEffects()

    expect(readAttachmentImage).toHaveBeenCalledWith('/tmp/good.png')
    expect(readAttachmentImage).toHaveBeenCalledWith('/tmp/bad.png')
    // adapted: local AiPanel also passes an empty media-attachment slot
    // ({audio, video}) after the images argument
    expect(agentHarness.run).toHaveBeenCalledWith(
      'Polish this slide',
      [{ base64: 'AAAA', mime: 'image/png' }],
      { audio: [], video: [] },
    )
  })

  it('offers the sign-in CTA only for chatoffice auth errors, never for generic run failures', async () => {
    // signed out: the old code stamped the login button onto ANY error
    Object.defineProperty(window, 'slidesApi', {
      configurable: true,
      value: {
        aiGskStatus: vi.fn(async () => ({ loggedIn: true })),
        aiChatOfficeStatus: vi.fn(async () => ({ loggedIn: false })),
        beginHistoryBatch: vi.fn(async () => false),
        endHistoryBatch: vi.fn(async () => null),
        aiLogRunFailure: vi.fn(async () => undefined),
      },
    })

    installConversationsApi()
    const { container } = mount(createElement(AiPanel, panelProps({})))
    await flushEffects()
    await sendFromComposer(container, 'check this deck')

    // the exact loop-stop message from an all-tools-failed run: no CTA
    act(() => {
      agentHarness.events!.onTurnEnd?.()
      agentHarness.events!.onError?.(
        'Every tool call failed for 8 turns in a row; the run was stopped. Please send the request again',
      )
    })
    await flushEffects()
    expect(container.querySelector('.ai-login-btn')).toBeNull()

    // a chatoffice sign-in failure would be the CTA's home — but the login
    // feature is not built yet (USER_LOGIN_READY=false), so the button is
    // suppressed everywhere until it ships
    act(() => {
      agentHarness.events!.onTurnEnd?.()
      agentHarness.events!.onError?.(
        'Not signed in to ChatOffice: click “Sign in” below, sign in, then retry',
      )
    })
    await flushEffects()
    expect(container.querySelector('.ai-login-btn')).toBeNull()
  })
})
