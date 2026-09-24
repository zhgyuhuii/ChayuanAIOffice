// @vitest-environment jsdom
// LOCAL(2026-09-21, d8201ad0): 多会话对话池 hook 单测(状态机/仲裁四序/圆点/标题/空态/降级)
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useAiConversations, type ConversationsApi } from '../src/useAiConversations'
import { PanelTabs, type PanelTabItem } from '../src/PanelTabs'

beforeEach(() => {
  localStorage.clear()
})

function makeApi(over: Partial<ConversationsApi> = {}): ConversationsApi {
  return {
    conversationsList: vi.fn(async () => ({
      projectId: 'default',
      conversations: [],
      openIds: [],
      activeId: null,
    })),
    conversationCreate: vi.fn(async () => ({ projectId: 'default', chatId: 'new-1' })),
    conversationMeta: vi.fn(async () => {}),
    conversationsOpenSet: vi.fn(async () => {}),
    conversationDelete: vi.fn(async () => {}),
    conversationsDeleteAll: vi.fn(async () => {}),
    conversationsRebind: vi.fn(async () => {}),
    ...over,
  }
}

type Hook = ReturnType<typeof useAiConversations>

function mountHook(api: ConversationsApi | null, persistKey = 'aidocs.aiTab'): {
  container: HTMLElement
  root: Root
  get: () => Hook
} {
  let latest: Hook | null = null
  function Harness() {
    latest = useAiConversations({ filePath: '/docs/x.docx' }, { persistKey })
    return null
  }
  ;(window as unknown as { projectApi?: unknown }).projectApi = api ?? undefined
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(createElement(Harness)))
  return { container, root, get: () => latest! }
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 400)) // debounce (300ms) + microtasks
  })
}

describe('useAiConversations — loading arbitration (activeTab 四序)', () => {
  it('① server activeId ∈ openIds wins', async () => {
    const api = makeApi({
      conversationsList: vi.fn(async () => ({
        projectId: 'default',
        conversations: [{ chatId: 'a', title: 'A', createdAt: 1, lastActiveAt: 1 }],
        openIds: ['a'],
        activeId: 'a',
      })),
    })
    const h = mountHook(api)
    await flush()
    expect(h.get().activeTab).toBe('a')
    h.root.unmount()
  })

  it("② legacy localStorage 'chat' residue is invalid → falls to openIds[0]", async () => {
    localStorage.setItem('aidocs.aiTab', 'chat')
    const api = makeApi({
      conversationsList: vi.fn(async () => ({
        projectId: 'default',
        conversations: [{ chatId: 'a', title: '', createdAt: 1, lastActiveAt: 1 }],
        openIds: ['a'],
        activeId: null,
      })),
    })
    const h = mountHook(api)
    await flush()
    expect(h.get().activeTab).toBe('a')
    h.root.unmount()
  })

  it("② valid localStorage 'assistant' memory wins over openIds[0]", async () => {
    localStorage.setItem('aidocs.aiTab', 'assistant')
    const api = makeApi({
      conversationsList: vi.fn(async () => ({
        projectId: 'default',
        conversations: [{ chatId: 'a', title: '', createdAt: 1, lastActiveAt: 1 }],
        openIds: ['a'],
        activeId: null,
      })),
    })
    const h = mountHook(api)
    await flush()
    expect(h.get().activeTab).toBe('assistant')
    h.root.unmount()
  })

  it("② legacy 'history' residue is invalid too (D13: history is no longer a tab)", async () => {
    localStorage.setItem('aidocs.aiTab', 'history')
    const api = makeApi({
      conversationsList: vi.fn(async () => ({
        projectId: 'default',
        conversations: [{ chatId: 'a', title: 'A', createdAt: 1, lastActiveAt: 1 }],
        openIds: ['a'],
        activeId: null,
      })),
    })
    const h = mountHook(api)
    await flush()
    expect(h.get().activeTab).toBe('a')
    h.root.unmount()
  })

  it('④ empty openIds → empty state', async () => {
    const api = makeApi({
      conversationsList: vi.fn(async () => ({
        projectId: 'default',
        conversations: [{ chatId: 'a', title: 'A', createdAt: 1, lastActiveAt: 1 }],
        openIds: [],
        activeId: null,
      })),
    })
    const h = mountHook(api)
    await flush()
    expect(h.get().activeTab).toBe('empty')
    // history still lists the closed conversation
    expect(h.get().closed.map((c) => c.chatId)).toEqual(['a'])
    h.root.unmount()
  })
})

describe('useAiConversations — create / close / restore state machine', () => {
  it('create appends a tab and activates it (persisted through the api)', async () => {
    const api = makeApi()
    const h = mountHook(api)
    await flush()
    act(() => h.get().create())
    await flush()
    expect(h.get().open).toHaveLength(1)
    expect(h.get().activeTab).toBe('new-1')
    expect(api.conversationCreate).toHaveBeenCalled()
    expect(api.conversationsOpenSet).toHaveBeenCalledWith(
      expect.objectContaining({ openIds: ['new-1'], activeId: 'new-1' }),
    )
    h.root.unmount()
  })

  it('closing the active tab falls to a sibling; closing the last tab enters empty', async () => {
    const api = makeApi({
      conversationsList: vi.fn(async () => ({
        projectId: 'default',
        conversations: [
          { chatId: 'a', title: 'A', createdAt: 1, lastActiveAt: 2 },
          { chatId: 'b', title: 'B', createdAt: 1, lastActiveAt: 1 },
        ],
        openIds: ['a', 'b'],
        activeId: 'a',
      })),
    })
    const h = mountHook(api)
    await flush()
    act(() => h.get().close('a'))
    expect(h.get().activeTab).toBe('b')
    act(() => h.get().close('b'))
    expect(h.get().activeTab).toBe('empty')
    // closed conversations become history (most recently active first)
    expect(h.get().closed.map((c) => c.chatId)).toEqual(['a', 'b'])
    await flush()
    expect(api.conversationsOpenSet).toHaveBeenLastCalledWith(
      expect.objectContaining({ openIds: [], activeId: null }),
    )
    h.root.unmount()
  })

  it('restore moves a history entry back to a tab and activates it', async () => {
    const api = makeApi({
      conversationsList: vi.fn(async () => ({
        projectId: 'default',
        conversations: [{ chatId: 'a', title: 'A', createdAt: 1, lastActiveAt: 1 }],
        openIds: [],
        activeId: null,
      })),
    })
    const h = mountHook(api)
    await flush()
    act(() => h.get().restore('a'))
    expect(h.get().open.map((c) => c.chatId)).toEqual(['a'])
    expect(h.get().activeTab).toBe('a')
    expect(h.get().closed).toHaveLength(0)
    h.root.unmount()
  })
})

describe('useAiConversations — running dot / titles / delete', () => {
  it('runningIds propagate to the tab dot through PanelTabs', async () => {
    const api = makeApi({
      conversationsList: vi.fn(async () => ({
        projectId: 'default',
        conversations: [{ chatId: 'a', title: 'A', createdAt: 1, lastActiveAt: 1 }],
        openIds: ['a'],
        activeId: 'a',
      })),
    })
    const h = mountHook(api)
    await flush()
    act(() => h.get().setRunning('a', true))

    const tabs: PanelTabItem[] = h.get().open.map((c) => ({
      id: c.chatId,
      label: c.title,
      running: h.get().runningIds.has(c.chatId),
    }))
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() =>
      root.render(
        createElement(PanelTabs, {
          tabs,
          activeId: 'a',
          onTabChange: () => {},
        }),
      ),
    )
    expect(container.querySelector('.ai-tab-dot')).toBeTruthy()
    act(() => h.get().setRunning('a', false))
    act(() =>
      root.render(
        createElement(PanelTabs, {
          tabs: h.get().open.map((c) => ({
            id: c.chatId,
            label: c.title,
            running: h.get().runningIds.has(c.chatId),
          })),
          activeId: 'a',
          onTabChange: () => {},
        }),
      ),
    )
    expect(container.querySelector('.ai-tab-dot')).toBeNull()
    h.root.unmount()
    act(() => root.unmount())
  })

  it('reportTitle sets a ~14-char title of an untitled conversation and persists it', async () => {
    const api = makeApi({
      conversationsList: vi.fn(async () => ({
        projectId: 'default',
        conversations: [{ chatId: 'a', title: '', createdAt: 1, lastActiveAt: 1 }],
        openIds: ['a'],
        activeId: 'a',
      })),
    })
    const h = mountHook(api)
    await flush()
    // plan §4.7: title = first user message head, whitespace-collapsed, ~14 chars
    act(() => h.get().reportTitle('a', '帮我把这份合同的风险条款理一遍'))
    expect(h.get().open[0]!.title).toBe('帮我把这份合同的风险条款理一')
    await flush()
    expect(api.conversationMeta).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'a', title: '帮我把这份合同的风险条款理一' }),
    )
    h.root.unmount()
  })

  it('lazy-load refill only fills empty titles (never overwrites)', async () => {
    const api = makeApi({
      conversationsList: vi.fn(async () => ({
        projectId: 'default',
        conversations: [{ chatId: 'a', title: '已有标题', createdAt: 1, lastActiveAt: 1 }],
        openIds: ['a'],
        activeId: 'a',
      })),
    })
    const h = mountHook(api)
    await flush()
    act(() => h.get().reportTitle('a', '新标题'))
    expect(h.get().open[0]!.title).toBe('已有标题')
    h.root.unmount()
  })

  it('removeClosed deletes history only; removeAllClosed spares open tabs', async () => {
    const api = makeApi({
      conversationsList: vi.fn(async () => ({
        projectId: 'default',
        conversations: [
          { chatId: 'open1', title: 'A', createdAt: 1, lastActiveAt: 3 },
          { chatId: 'old1', title: 'B', createdAt: 1, lastActiveAt: 2 },
          { chatId: 'old2', title: 'C', createdAt: 1, lastActiveAt: 1 },
        ],
        openIds: ['open1'],
        activeId: 'open1',
      })),
    })
    const h = mountHook(api)
    await flush()
    act(() => h.get().removeClosed('old1'))
    expect(h.get().closed.map((c) => c.chatId)).toEqual(['old2'])
    expect(h.get().open.map((c) => c.chatId)).toEqual(['open1'])
    await flush()
    expect(api.conversationDelete).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'old1' }))
    act(() => h.get().removeAllClosed())
    expect(h.get().closed).toHaveLength(0)
    expect(h.get().open.map((c) => c.chatId)).toEqual(['open1'])
    await flush()
    expect(api.conversationsDeleteAll).toHaveBeenCalledWith(
      expect.objectContaining({ openIds: ['open1'] }),
    )
    h.root.unmount()
  })
})

describe('useAiConversations — degraded in-memory mode (no projectApi)', () => {
  it('opens one in-memory conversation, create/close work, nothing persists', async () => {
    const h = mountHook(null)
    await flush()
    expect(h.get().ready).toBe(true)
    expect(h.get().open).toHaveLength(1)
    expect(h.get().activeTab).toBe(h.get().open[0]!.chatId)
    act(() => h.get().create())
    expect(h.get().open).toHaveLength(2)
    const spokenId = h.get().open[1]!.chatId
    // D12: the spoken one goes to history on close…
    act(() => h.get().reportTitle(spokenId, '第二个会话'))
    act(() => h.get().close(spokenId))
    expect(h.get().closed).toHaveLength(1)
    // …while the untouched seed (never spoken) is discarded outright
    const seedId = h.get().open[0]!.chatId
    act(() => h.get().close(seedId))
    expect(h.get().closed).toHaveLength(1)
    expect(h.get().open).toHaveLength(0)
    h.root.unmount()
  })
})

// LOCAL(2026-09-22, d8201ad0): D12 空会话不进历史(计划 §10 增量)
describe('useAiConversations — D12 empty conversations never enter history', () => {
  it('closing a never-spoken conversation discards it: no history entry, metadata deleted', async () => {
    const api = makeApi()
    const h = mountHook(api)
    await flush()
    act(() => h.get().create())
    await flush()
    const id = 'new-1'
    expect(h.get().open.map((c) => c.chatId)).toEqual([id])
    act(() => h.get().close(id))
    expect(h.get().open).toHaveLength(0)
    expect(h.get().closed).toHaveLength(0)
    expect(h.get().activeTab).toBe('empty')
    await flush()
    expect(api.conversationDelete).toHaveBeenCalledWith(expect.objectContaining({ chatId: id }))
    h.root.unmount()
  })

  it('a conversation that spoke goes to history on close (reportTitle marks it spoken)', async () => {
    const api = makeApi()
    const h = mountHook(api)
    await flush()
    act(() => h.get().create())
    await flush()
    act(() => h.get().reportTitle('new-1', '帮我把这份合同'))
    act(() => h.get().close('new-1'))
    expect(h.get().closed.map((c) => c.chatId)).toEqual(['new-1'])
    await flush()
    expect(api.conversationDelete).not.toHaveBeenCalled()
    h.root.unmount()
  })

  it('a running or completed turn marks the conversation spoken (setRunning / touch)', async () => {
    const api = makeApi()
    const h = mountHook(api)
    await flush()
    act(() => h.get().create())
    await flush()
    // a started run persists its interrupted half-turn (D10) ⇒ keep on close
    act(() => h.get().setRunning('new-1', true))
    act(() => h.get().close('new-1'))
    expect(h.get().closed.map((c) => c.chatId)).toEqual(['new-1'])

    // back open: a completed turn also proves the conversation non-empty
    act(() => h.get().restore('new-1'))
    act(() => h.get().touch('new-1'))
    act(() => h.get().close('new-1'))
    expect(h.get().closed.map((c) => c.chatId)).toEqual(['new-1'])
    h.root.unmount()
  })

  it('legacy closed conversations with empty titles stay hidden from history (D12 迁移规则)', async () => {
    const api = makeApi({
      conversationsList: vi.fn(async () => ({
        projectId: 'default',
        conversations: [
          { chatId: 'legacy-empty', title: '', createdAt: 1, lastActiveAt: 2 },
          { chatId: 'legacy-real', title: '有内容', createdAt: 1, lastActiveAt: 1 },
        ],
        openIds: [],
        activeId: null,
      })),
    })
    const h = mountHook(api)
    await flush()
    expect(h.get().closed.map((c) => c.chatId)).toEqual(['legacy-real'])
    h.root.unmount()
  })

  it('restore marks a conversation spoken: close returns it to history (never dropped)', async () => {
    const api = makeApi({
      conversationsList: vi.fn(async () => ({
        projectId: 'default',
        conversations: [{ chatId: 'a', title: 'A', createdAt: 1, lastActiveAt: 1 }],
        openIds: [],
        activeId: null,
      })),
    })
    const h = mountHook(api)
    await flush()
    act(() => h.get().restore('a'))
    act(() => h.get().close('a'))
    expect(h.get().closed.map((c) => c.chatId)).toEqual(['a'])
    h.root.unmount()
  })
})
