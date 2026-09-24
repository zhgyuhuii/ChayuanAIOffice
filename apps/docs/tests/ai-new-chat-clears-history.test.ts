// LOCAL(2026-09-21, d8201ad0): 多会话改造后的历史转录语义——
// 「+ 新建对话」切换到全新会话(旧转录保留在其原 tab,数据不丢);
// 关闭 ✕ 把会话送进历史(转录不再显示)。原「New chat 清空 historic」断言
// 随销毁式 newChat 一并退役(#195 的诉求在新模型下由「关闭进历史」达成)。
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { AiPanel } from '../src/renderer/ai/AiPanel'
// adapted: the panel takes the local AiSettingsV2 shape
import { defaultSettingsV2, type AiSettingsV2 } from '@chatoffice/ai-provider'

const settings: AiSettingsV2 = defaultSettingsV2()

function createEditor(): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'docParagraph',
          attrs: { docxIndex: 0 },
          content: [{ type: 'text', text: 'EVs market research' }],
        },
      ],
    },
  })
}

function mount(element: React.ReactElement): {
  container: HTMLElement
  cleanup: () => void
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() => root.render(element))
  return {
    container,
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function panelProps(editor: Editor) {
  return {
    editor,
    blocks: [],
    settings,
    open: true,
  }
}

const HISTORY = [{ role: 'user', text: 'earlier question' }]

function mockProjectApi() {
  const win = window as unknown as { projectApi?: unknown }
  const previous = win.projectApi
  win.projectApi = {
    // the conversation index API the multi-conversation pool speaks
    conversationsList: vi.fn(async () => ({
      projectId: 'p',
      conversations: [{ chatId: 'seed', title: '', createdAt: 1, lastActiveAt: 1 }],
      openIds: ['seed'],
      activeId: 'seed',
    })),
    conversationCreate: vi.fn(async () => ({ projectId: 'p', chatId: 'fresh-1' })),
    conversationMeta: vi.fn(async () => {}),
    conversationsOpenSet: vi.fn(async () => {}),
    conversationDelete: vi.fn(async () => {}),
    conversationsDeleteAll: vi.fn(async () => {}),
    conversationsRebind: vi.fn(async () => {}),
    // the per-conversation transcript reader
    resolveChat: vi.fn(async () => ({ projectId: 'p', chatId: 'seed' })),
    // the transcript reader: only the seeded conversation has history
    loadChat: vi.fn(async (args: { chatId: string }) =>
      args.chatId === 'seed' ? HISTORY : [],
    ),
  }
  return () => {
    win.projectApi = previous
  }
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeAll(() => {
  // jsdom has no scrollTo; the panel auto-scrolls its chat log
  Element.prototype.scrollTo ??= () => {}
})

describe('AiPanel multi-conversation history', () => {
  it('seeded conversation paints its transcript; + switches to a fresh one; ✕ moves it to history', async () => {
    const restoreApi = mockProjectApi()
    try {
      const editor = createEditor()
      const { container, cleanup } = mount(createElement(AiPanel, panelProps(editor)))
      try {
        await flush()
        await flush()
        await flush()
        // the seeded conversation restored its transcript…
        expect(container.querySelectorAll('.ai-msg-historic').length).toBe(1)

        // 「+」creates a conversation and switches to it (fresh tab is active);
        // the old transcript stays mounted with its own tab (data retained)
        const plus = container.querySelector<HTMLButtonElement>('.ai-header-btn')
        expect(plus).not.toBeNull()
        act(() => plus!.click())
        await flush()
        expect(container.querySelectorAll('.ai-tab').length).toBe(3) // [seed][fresh-1][助手](D13:历史不是 tab)
        const activeLabel = () => container.querySelector('.ai-tab.active')?.textContent ?? ''
        expect(activeLabel().length).toBeGreaterThan(0)
        expect(activeLabel()).not.toContain('earlier') // fresh tab, not the seeded one

        // switch back: the old conversation becomes active again
        const seedTab = container.querySelectorAll<HTMLButtonElement>('.ai-tab')[0]!
        act(() => seedTab.click())
        await flush()
        expect(activeLabel()).toContain('earlier')

        // closing the seeded tab moves it to history: transcript no longer rendered
        const seedClose = container.querySelector<HTMLSpanElement>('.ai-tab-close')
        expect(seedClose).not.toBeNull()
        act(() => seedClose!.click())
        await flush()
        expect(container.querySelectorAll('.ai-msg-historic').length).toBe(0)
      } finally {
        cleanup()
        editor.destroy()
      }
    } finally {
      restoreApi()
    }
  })
})
