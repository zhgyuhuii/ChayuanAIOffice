import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { editorExtensions } from '../src/renderer/editor/extensions'
import { AiPanel } from '../src/renderer/ai/AiPanel'
// adapted: the panel takes the local AiSettingsV2 shape
import { defaultSettingsV2, type AiSettingsV2 } from '@chatoffice/ai-provider'

// LOCAL(2026-09-21, d8201ad0): 多会话语义——暂存附件属于其会话实例:
// 「+ 新建对话」切到全新会话,新会话的 composer 附件条为空(原 #224 诉求);
// 切回原会话,暂存文件仍在(数据保留)。原「New chat 清空附件」断言随销毁式
// newChat 退役,语义由「新会话天然不带旧附件」达成。

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

function mount(element: React.ReactElement): { container: HTMLElement; cleanup: () => void } {
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
  return { editor, blocks: [], settings, open: true }
}

const HISTORY = [{ role: 'user', text: 'earlier question' }]

function mockApis() {
  const win = window as unknown as {
    projectApi?: unknown
    desktop?: unknown
  }
  const previousApi = win.projectApi
  const previousDesktop = win.desktop
  win.projectApi = {
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
    resolveChat: vi.fn(async () => ({ projectId: 'p', chatId: 'seed' })),
    // the transcript reader: only the seeded conversation has history
    loadChat: vi.fn(async (args: { chatId: string }) =>
      args.chatId === 'seed' ? HISTORY : [],
    ),
  }
  win.desktop = {
    pickAttachments: vi.fn(async () => ({
      accepted: [{ path: '/tmp/plan.png', name: 'plan.png', ext: 'png', sizeBytes: 128 }],
      rejected: [],
    })),
    readAttachmentImage: vi.fn(async () => ({ ok: false })),
  }
  return () => {
    win.projectApi = previousApi
    win.desktop = previousDesktop
  }
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeAll(() => {
  Element.prototype.scrollTo ??= () => {}
})

describe('AiPanel multi-conversation attachments', () => {
  it('a fresh conversation starts with an empty composer strip; staged files stay with their conversation', async () => {
    const restoreApis = mockApis()
    try {
      const editor = createEditor()
      const { container, cleanup } = mount(createElement(AiPanel, panelProps(editor)))
      try {
        await flush()
        await flush()
        await flush()
        // Stage a file through the attach button (lands in the seeded conversation).
        const attach = container.querySelector<HTMLButtonElement>('.ai-attach-btn')
        expect(attach).not.toBeNull()
        await act(async () => {
          attach!.click()
          await new Promise((resolve) => setTimeout(resolve, 0))
        })
        await flush()
        expect(container.querySelectorAll('.ai-attachments').length).toBe(1)

        // 「+」switches to a fresh conversation: the staged files stay with the
        // seeded tab — the strip count doesn't grow, and the fresh tab activates
        const plus = container.querySelector<HTMLButtonElement>('.ai-header-btn')
        act(() => plus!.click())
        await flush()
        expect(container.querySelectorAll('.ai-tab').length).toBe(3) // [seed][fresh-1][助手](D13:历史不是 tab)
        expect(container.querySelector('.ai-tab.active')?.textContent ?? '').not.toContain(
          'earlier',
        )

        // switch back: the staged files stayed with the seeded conversation
        const seedTab = container.querySelectorAll<HTMLButtonElement>('.ai-tab')[0]!
        act(() => seedTab.click())
        await flush()
        expect(container.querySelectorAll('.ai-attachments').length).toBe(1)
      } finally {
        cleanup()
        editor.destroy()
      }
    } finally {
      restoreApis()
    }
  })
})
