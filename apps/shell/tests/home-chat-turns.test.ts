// @vitest-environment jsdom
// ZCode-parity composer + tick rail: turn-nav entry derivation (pairing,
// previews, states), the navigator DOM (aria, tick count, hidden below 2),
// the session-scoped model/mode send path (override reaches the wire request,
// plan suffix appended), the mode/model session write-back, and the history
// dropdown's tree grouping (project → file → unattached).
import { createElement as h } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HomeChatSession } from '../src/shared/home-api'
import { useHomeChatStore } from '../src/renderer/src/home-chat/store'
import { TurnNavigator, deriveTurnNavEntries } from '../src/renderer/src/home-chat/TurnNavigator'
import { groupSessionsByTree, groupNameOf } from '../src/renderer/src/home-chat/tree-groups'
import { HomeChatController } from '../src/renderer/src/home-chat/controller'
import type { HomeAgentBridge, HomeAgentTexts } from '../src/renderer/src/home-chat/agent'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const roots: Array<() => void> = []
afterEach(() => {
  for (const unmount of roots.splice(0)) unmount()
})

function msg(role: 'user' | 'assistant', text: string, error = false) {
  return {
    id: `${role}-${Math.random().toString(36).slice(2)}`,
    role,
    text,
    ...(error ? { error } : {}),
    ts: 1,
  }
}

describe('deriveTurnNavEntries', () => {
  it('pairs each user message with its assistant reply and truncates previews', () => {
    const long = 'a'.repeat(300)
    const entries = deriveTurnNavEntries(
      [
        msg('user', long),
        msg('assistant', '第一段\n\n第二段'),
        msg('user', '第二个问题'),
        msg('assistant', '回答正文'),
      ],
      false,
      '用户输入',
    )
    expect(entries).toHaveLength(2)
    expect(entries[0]!.userPreview).toHaveLength(220)
    expect(entries[0]!.userPreview.endsWith('...')).toBe(true)
    expect(entries[0]!.assistantPreview).toBe('第一段\n第二段')
    expect(entries[0]!.assistantState).toBe('text')
    expect(entries[1]!.userPreview).toBe('第二个问题')
    expect(entries[1]!.assistantState).toBe('text')
  })

  it('marks a still-streaming last turn running and an errored reply empty', () => {
    const running = deriveTurnNavEntries(
      [msg('user', 'q1'), msg('assistant', '')],
      true,
      '用户输入',
    )
    expect(running[0]!.assistantState).toBe('running')

    const failed = deriveTurnNavEntries(
      [msg('user', 'q1'), msg('assistant', '出错了', true)],
      false,
      '用户输入',
    )
    expect(failed[0]!.assistantState).toBe('empty')
  })

  it('falls back to the user label for empty queries and drops assistant-only tails', () => {
    const entries = deriveTurnNavEntries(
      [msg('user', '   '), msg('assistant', '回答'), msg('assistant', '多余')],
      false,
      '用户输入',
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]!.userPreview).toBe('用户输入')
  })
})

describe('TurnNavigator DOM', () => {
  it('renders one tick per query with nav aria and hides below 2 entries', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    let root!: Root
    const entries = [
      { key: 'a', userPreview: 'q1', assistantPreview: 'a1', assistantState: 'text' as const },
      { key: 'b', userPreview: 'q2', assistantPreview: '', assistantState: 'running' as const },
      { key: 'c', userPreview: 'q3', assistantPreview: '', assistantState: 'empty' as const },
    ]
    act(() => {
      root = createRoot(host)
      root.render(h(TurnNavigator, { entries, listEl: null }))
    })
    roots.push(() => act(() => root.unmount()))
    const nav = host.querySelector('nav.chat-turn-nav')
    expect(nav).not.toBeNull()
    expect(nav!.getAttribute('aria-label')).toBe('对话问题导航')
    const ticks = host.querySelectorAll('button.chat-turn-tick')
    expect(ticks).toHaveLength(3)
    expect(ticks[2]!.getAttribute('aria-label')).toBe('跳转到第 3 条问题')

    act(() => {
      root.render(h(TurnNavigator, { entries: entries.slice(0, 1), listEl: null }))
    })
    expect(host.querySelector('nav.chat-turn-nav')).toBeNull()
  })
})

// ── controller send path: session-scoped model + plan mode ──

const texts: HomeAgentTexts & { docOpenedInTab(t: string): string } = {
  docBodyMissing: 'missing',
  createFailed: () => 'fail',
  openFailed: () => 'fail',
  unsupportedHandoff: 'no handoff',
  fileNotFound: 'none',
  unknownError: '出错了',
  docOpenedInTab: (t) => t,
}

function makeBridge(): { bridge: HomeAgentBridge; wireRequests: unknown[] } {
  let listener: ((chunk: { requestId: string; type: string; text?: string }) => void) | null = null
  const wireRequests: unknown[] = []
  const bridge: HomeAgentBridge = {
    aiStream: async (request) => {
      wireRequests.push(request)
      listener?.({ requestId: request.requestId, type: 'delta', text: '好的' })
      listener?.({ requestId: request.requestId, type: 'done' })
    },
    aiStreamCancel: async () => {},
    onAiStream: (l) => {
      listener = l as typeof listener
      return () => {
        listener = null
      }
    },
    createDocument: async () => ({ ok: true, path: '/tmp/x.docx' }) as never,
    readAttachment: async () => ({ ok: true, name: '', totalChars: 0, text: '' }) as never,
    readAttachmentImage: async () => ({ ok: false }),
    recents: async () => ({ entries: [] }) as never,
    starred: async () => ({ entries: [] }) as never,
    listProjectFiles: async () => [],
    openWithHandoff: async () => {},
    getCurrentModel: () => {
      throw new Error('no usable model configured')
    },
  }
  return { bridge, wireRequests }
}

async function until(fn: () => boolean, what = 'condition'): Promise<void> {
  for (let i = 0; i < 100 && !fn(); i++) {
    await new Promise((r) => setTimeout(r, 10))
  }
  if (!fn()) throw new Error(`timed out waiting for: ${what}`)
}

describe('controller session-scoped model + mode', () => {
  it('sends the picked model and the plan suffix in the wire request', async () => {
    const { bridge, wireRequests } = makeBridge()
    let session: HomeChatSession = { id: 's1', title: '', createdAt: 0, updatedAt: 0, messages: [] }
    const controller = new HomeChatController(bridge, texts, (_id, mutate) => {
      session = mutate(session)
    })
    controller.send('s1', [], '帮我做计划', [], {
      model: { profileId: 'prof1', modelId: 'glm-4.7' },
      mode: 'plan',
    })
    await until(() => session.messages.at(-1)?.text === '好的')
    expect(wireRequests).toHaveLength(1)
    const wire = wireRequests[0] as { settings: unknown; system: string }
    expect(wire.settings).toEqual({ profileId: 'prof1', modelId: 'glm-4.7' })
    expect(wire.system).toContain('Plan mode')
    expect(session.messages.at(-1)!.card).toBeUndefined()
  })

  it('appends the setup-required card when no model resolves', () => {
    const { bridge } = makeBridge()
    let session: HomeChatSession = { id: 's1', title: '', createdAt: 0, updatedAt: 0, messages: [] }
    const controller = new HomeChatController(bridge, texts, (_id, mutate) => {
      session = mutate(session)
    })
    controller.send('s1', [], 'hello', [])
    expect(session.messages.at(-1)!.card).toEqual({ kind: 'setup-required' })
  })

  it('the second turn on the same session carries the first exchange as context', async () => {
    const { bridge, wireRequests } = makeBridge()
    let session: HomeChatSession = { id: 's1', title: '', createdAt: 0, updatedAt: 0, messages: [] }
    const controller = new HomeChatController(bridge, texts, (_id, mutate) => {
      session = mutate(session)
    })
    controller.send('s1', [], '第一问', [], { model: { profileId: 'p', modelId: 'm' } })
    await until(() => session.messages.at(-1)?.text === '好的')
    // follow-up on the same session: the wire request replays the prior turns
    controller.send(
      's1',
      session.messages.filter((m) => m.text),
      '第二问',
      [],
      { model: { profileId: 'p', modelId: 'm' } },
    )
    await until(() => (wireRequests as unknown[]).length === 2, 'second wire request')
    const second = wireRequests[1] as { messages: Array<{ role: string; text: string }> }
    const wireTexts = second.messages.map((m) => m.text)
    expect(wireTexts).toContain('第一问')
    expect(wireTexts).toContain('好的')
    expect(wireTexts[second.messages.length - 1]).toBe('第二问')
  })
})

describe('session mode/model write-back', () => {
  it('plan stores the mode key, default drops it (clean persisted JSON)', () => {
    const bridge = {
      chatSessionsLoad: vi.fn(async () => [] as HomeChatSession[]),
      chatSessionsSave: vi.fn(async () => {}),
    }
    const host = document.createElement('div')
    let latest!: ReturnType<typeof useHomeChatStore>
    function Probe(): null {
      latest = useHomeChatStore(bridge)
      return null
    }
    let root!: Root
    act(() => {
      root = createRoot(host)
      root.render(h(Probe))
    })
    roots.push(() => act(() => root.unmount()))
    let session!: HomeChatSession
    act(() => {
      session = latest.createSession()
    })
    act(() => {
      latest.updateSession(session.id, (s) => ({ ...s, mode: 'plan' }))
    })
    expect(latest.active!.mode).toBe('plan')
    act(() => {
      latest.updateSession(session.id, (s) => {
        const { mode: _drop, ...rest } = s
        return rest
      })
    })
    expect('mode' in latest.active!).toBe(false)
  })
})

describe('history dropdown tree grouping', () => {
  const mk = (id: string, scope?: HomeChatSession['scope']): HomeChatSession => ({
    id,
    title: id,
    createdAt: 0,
    updatedAt: 0,
    messages: [{ id: `${id}-m`, role: 'user', text: 'q', ts: 1 }],
    ...(scope ? { scope } : {}),
  })

  it('groups project → file → unattached, merging same-scope sessions in order', () => {
    const groups = groupSessionsByTree([
      mk('u1'),
      mk('f1', { kind: 'file', id: '/docs/report.docx' }),
      mk('p1', { kind: 'project', id: 'proj1' }),
      mk('p2', { kind: 'project', id: 'proj1' }),
      mk('f2', { kind: 'file', id: '/docs/notes.md' }),
      mk('u2'),
    ])
    expect(groups.map((g) => g.key)).toEqual([
      'project:proj1',
      'file:/docs/report.docx',
      'file:/docs/notes.md',
      'unattached',
    ])
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual(['p1', 'p2'])
    expect(groups[3]!.sessions.map((s) => s.id)).toEqual(['u1', 'u2'])
  })

  it('names groups by project name, file basename, and the standalone label', () => {
    const groups = groupSessionsByTree([
      mk('p1', { kind: 'project', id: 'proj1' }),
      mk('f1', { kind: 'file', id: '/Users/x/一季度总结.docx' }),
      mk('u1'),
    ])
    const projects = [{ id: 'proj1', name: '季度报告' }]
    expect(groupNameOf(groups[0]!, projects, '独立会话')).toBe('季度报告')
    expect(groupNameOf(groups[1]!, projects, '独立会话')).toBe('一季度总结.docx')
    expect(groupNameOf(groups[2]!, projects, '独立会话')).toBe('独立会话')
    // a deleted project falls back to its id rather than vanishing
    expect(groupNameOf(groups[0]!, [], '独立会话')).toBe('proj1')
  })
})
