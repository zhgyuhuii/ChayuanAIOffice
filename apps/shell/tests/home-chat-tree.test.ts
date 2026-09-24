// @vitest-environment jsdom
// P2 tree sessions: scope attachment (project task / file chat), legacy
// no-scope sessions stay unattached, and the scope survives the persisted
// JSON round-trip the chatSessionsLoad/Save bridge performs.
import { createElement as h } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HomeChatSession } from '../src/shared/home-api'
import { useHomeChatStore, appendMessage } from '../src/renderer/src/home-chat/store'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function makeBridge() {
  let saved: HomeChatSession[] = []
  return {
    chatSessionsLoad: vi.fn(async () => saved),
    chatSessionsSave: vi.fn(async (sessions: HomeChatSession[]) => {
      saved = sessions
    }),
    __saved: () => saved,
  }
}

/** minimal hook harness (no @testing-library in this workspace) */
function renderStoreHook(bridge: ReturnType<typeof makeBridge>): {
  store: () => ReturnType<typeof useHomeChatStore>
  unmount: () => void
} {
  let latest: ReturnType<typeof useHomeChatStore> | undefined
  function Probe(): null {
    latest = useHomeChatStore(bridge)
    return null
  }
  let root!: Root
  act(() => {
    root = createRoot(document.createElement('div'))
    root.render(h(Probe))
  })
  return {
    store: () => latest!,
    unmount: () => {
      act(() => root.unmount())
    },
  }
}

const roots: Array<() => void> = []
afterEach(() => {
  for (const unmount of roots.splice(0)) unmount()
})

function mounted(bridge: ReturnType<typeof makeBridge>) {
  const handle = renderStoreHook(bridge)
  roots.push(handle.unmount)
  return handle
}

describe('home-chat store scope (P2 tree)', () => {
  it('createSession(scope) attaches the scope and activates the session', async () => {
    const bridge = makeBridge()
    const { store } = mounted(bridge)
    await act(async () => {
      await bridge.chatSessionsLoad()
    })
    let session!: HomeChatSession
    act(() => {
      session = store().createSession({ kind: 'project', id: 'p1' })
    })
    expect(session.scope).toEqual({ kind: 'project', id: 'p1' })
    expect(store().activeId).toBe(session.id)
    expect(store().sessions?.[0]?.scope).toEqual({ kind: 'project', id: 'p1' })
  })

  it('createSession() without scope keeps legacy sessions unattached', async () => {
    const bridge = makeBridge()
    const { store } = mounted(bridge)
    await act(async () => {
      await bridge.chatSessionsLoad()
    })
    let session!: HomeChatSession
    act(() => {
      session = store().createSession()
    })
    expect(session.scope).toBeUndefined()
    expect('scope' in session).toBe(false)
  })

  it('a file-scoped session survives the persisted JSON round-trip', async () => {
    const bridge = makeBridge()
    const first = mounted(bridge)
    await act(async () => {
      await bridge.chatSessionsLoad()
    })
    act(() => {
      first.store().createSession({ kind: 'file', id: '/tmp/report.docx' })
    })
    // flush the debounced save (400ms)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500))
    })
    expect(bridge.chatSessionsSave).toHaveBeenCalled()
    const persisted = bridge.__saved().find((s) => s.scope?.kind === 'file')
    expect(persisted?.scope).toEqual({ kind: 'file', id: '/tmp/report.docx' })
    // reload through a fresh store reading the same bridge
    const second = mounted(bridge)
    await act(async () => {
      await bridge.chatSessionsLoad()
    })
    expect(second.store().sessions?.[0]?.scope).toEqual({
      kind: 'file',
      id: '/tmp/report.docx',
    })
  })

  it('appendMessage derives the title and never clobbers the scope', () => {
    const session: HomeChatSession = {
      id: 's1',
      title: '',
      createdAt: 0,
      updatedAt: 0,
      messages: [],
      scope: { kind: 'project', id: 'p1' },
    }
    const next = appendMessage(session, {
      id: 'm1',
      role: 'user',
      text: '帮我整理季度数据',
      ts: 1,
    })
    expect(next.title).toBe('帮我整理季度数据')
    expect(next.scope).toEqual({ kind: 'project', id: 'p1' })
  })
})
