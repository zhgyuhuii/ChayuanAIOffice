import { describe, expect, it } from 'vitest'

import type { HomeChatMessage } from '../src/shared/home-api'
import {
  applyRelayEvent,
  expirePendingConfirms,
  RelaySessionLink,
  relaySeedCommand,
  resolveRelayConfirm,
} from '../src/renderer/src/home-chat/relay-client'

function user(text: string): HomeChatMessage {
  return { id: `u-${text}`, role: 'user', text, ts: 1 }
}

describe('applyRelayEvent', () => {
  it('turn-started appends a relay placeholder; text patches it in place', () => {
    let msgs = applyRelayEvent([user('帮我改文档')], { type: 'turn-started', turnId: 't1' }, 2)
    expect(msgs).toHaveLength(2)
    expect(msgs[1]).toMatchObject({ role: 'assistant', text: '', relayTurnId: 't1' })

    msgs = applyRelayEvent(msgs, { type: 'text', turnId: 't1', text: '正在改' }, 3)
    expect(msgs[1]).toMatchObject({ text: '正在改', relayTurnId: 't1' })

    msgs = applyRelayEvent(msgs, { type: 'text', turnId: 't1', text: '改好了,已应用两处' }, 4)
    expect(msgs[1]?.text).toBe('改好了,已应用两处')
  })

  it('tool events merge by callId: start then end replaces in place', () => {
    let msgs = applyRelayEvent([], { type: 'turn-started', turnId: 't1' }, 1)
    msgs = applyRelayEvent(
      msgs,
      {
        type: 'tool',
        turnId: 't1',
        activity: {
          callId: 'c1',
          name: 'insert_content',
          summary: 'insert content',
          phase: 'start',
        },
      },
      2,
    )
    expect(msgs[0]?.relayTools).toEqual([
      { callId: 'c1', name: 'insert_content', summary: 'insert content', running: true },
    ])
    msgs = applyRelayEvent(
      msgs,
      {
        type: 'tool',
        turnId: 't1',
        activity: {
          callId: 'c1',
          name: 'insert_content',
          summary: 'insert content',
          phase: 'end',
          ok: true,
          outputPreview: 'applied 2 ops',
        },
      },
      3,
    )
    expect(msgs[0]?.relayTools?.[0]).toMatchObject({
      running: false,
      ok: true,
      outputPreview: 'applied 2 ops',
    })
  })

  it('error marks the relay message without clobbering existing text', () => {
    let msgs = applyRelayEvent([], { type: 'turn-started', turnId: 't1' }, 1)
    msgs = applyRelayEvent(msgs, { type: 'text', turnId: 't1', text: '部分内容' }, 2)
    msgs = applyRelayEvent(msgs, { type: 'error', turnId: 't1', message: '模型断流' }, 3)
    expect(msgs[0]).toMatchObject({ text: '部分内容', error: true })

    // error before any text lands
    let msgs2 = applyRelayEvent([], { type: 'turn-started', turnId: 't2' }, 1)
    msgs2 = applyRelayEvent(msgs2, { type: 'error', turnId: 't2', message: 'boom' }, 2)
    expect(msgs2[0]).toMatchObject({ text: 'boom', error: true })
  })

  it('events for unknown turns are dropped; passive events are ignored', () => {
    const msgs: HomeChatMessage[] = [user('x')]
    expect(applyRelayEvent(msgs, { type: 'text', turnId: 'ghost', text: 'y' }, 2)).toBe(msgs)
    expect(applyRelayEvent(msgs, { type: 'busy', busy: true }, 2)).toBe(msgs)
    expect(
      applyRelayEvent(
        msgs,
        { type: 'snapshot', turnId: 't', snapshot: { turnId: 't', snapshotId: 's' } },
        2,
      ),
    ).toBe(msgs)
  })

  it('confirm-request attaches a pending confirmation card to the streaming mirror', () => {
    let msgs = applyRelayEvent([], { type: 'turn-started', turnId: 't1' }, 1)
    msgs = applyRelayEvent(
      msgs,
      {
        type: 'confirm-request',
        turnId: 't1',
        request: { confirmId: 'cf-1', kind: 'outline', payload: '# 大纲\n- 引言' },
      },
      2,
    )
    expect(msgs[0]?.relayConfirm).toEqual({
      confirmId: 'cf-1',
      kind: 'outline',
      payload: '# 大纲\n- 引言',
      state: 'pending',
    })
  })

  it('turn-finished expires an unresolved confirmation; resolved cards keep their state', () => {
    let msgs = applyRelayEvent([], { type: 'turn-started', turnId: 't1' }, 1)
    msgs = applyRelayEvent(
      msgs,
      {
        type: 'confirm-request',
        turnId: 't1',
        request: { confirmId: 'cf-1', kind: 'plan', payload: '1. 步骤一' },
      },
      2,
    )
    msgs = applyRelayEvent(msgs, { type: 'turn-finished', turnId: 't1' }, 3)
    expect(msgs[0]?.relayConfirm?.state).toBe('expired')

    let msgs2 = applyRelayEvent([], { type: 'turn-started', turnId: 't2' }, 1)
    msgs2 = applyRelayEvent(
      msgs2,
      {
        type: 'confirm-request',
        turnId: 't2',
        request: { confirmId: 'cf-2', kind: 'outline', payload: 'x' },
      },
      2,
    )
    msgs2 = resolveRelayConfirm(msgs2, 'cf-2', true)
    msgs2 = applyRelayEvent(msgs2, { type: 'turn-finished', turnId: 't2' }, 3)
    expect(msgs2[0]?.relayConfirm?.state).toBe('approved')
  })

  it('resolveRelayConfirm marks the decision in place with feedback; unknown ids untouched', () => {
    let msgs = applyRelayEvent([], { type: 'turn-started', turnId: 't1' }, 1)
    msgs = applyRelayEvent(
      msgs,
      {
        type: 'confirm-request',
        turnId: 't1',
        request: { confirmId: 'cf-1', kind: 'outline', payload: 'x' },
      },
      2,
    )
    msgs = resolveRelayConfirm(msgs, 'cf-9', false, 'nope')
    expect(msgs[0]?.relayConfirm?.state).toBe('pending')
    msgs = resolveRelayConfirm(msgs, 'cf-1', false, '第三点展开')
    expect(msgs[0]?.relayConfirm).toMatchObject({ state: 'rejected', feedback: '第三点展开' })
  })

  it('expirePendingConfirms closes every pending card in one pass', () => {
    let msgs = applyRelayEvent([], { type: 'turn-started', turnId: 't1' }, 1)
    msgs = applyRelayEvent(
      msgs,
      {
        type: 'confirm-request',
        turnId: 't1',
        request: { confirmId: 'cf-1', kind: 'outline', payload: 'x' },
      },
      2,
    )
    const expired = expirePendingConfirms([...msgs, user('q')])
    expect(expired[0]?.relayConfirm?.state).toBe('expired')
    // no pending cards → same reference (cheap path)
    expect(expirePendingConfirms([user('q')])).toHaveLength(1)
  })
})

describe('RelaySessionLink', () => {
  it('binds docks to sessions, switches the active relay target, forgets cleanly', () => {
    const link = new RelaySessionLink()
    link.setSessionDocks('s1', ['d1', 'd2'])
    expect(link.sessionOfDock('d1')).toBe('s1')
    expect(link.activeDockOf('s1')).toBe('d2') // last registered fills the pane

    link.setActiveDock('d1')
    expect(link.activeDockOf('s1')).toBe('d1')

    link.setSessionDocks('s1', ['d1']) // d2 closed
    expect(link.sessionOfDock('d2')).toBeUndefined()

    link.forgetSession('s1')
    expect(link.sessionOfDock('d1')).toBeUndefined()
    expect(link.activeDockOf('s1')).toBeUndefined()
  })

  it('a dock reopening keeps its original session binding', () => {
    const link = new RelaySessionLink()
    link.setSessionDocks('s1', ['d1'])
    link.setSessionDocks('s2', ['d1']) // same dock id under another session → ignored
    expect(link.sessionOfDock('d1')).toBe('s1')
  })

  it('busy-flag + append queue: FIFO one-per-idle, cleared on stop/switch/close', () => {
    const link = new RelaySessionLink()
    link.setSessionDocks('s1', ['d1'])

    // idle → enqueue refuses, markBusy(true) arms the busy flag
    expect(link.enqueue('d1', 'first')).toBe(false)
    link.markBusy('d1', true)
    expect(link.enqueue('d1', '排队A')).toBe(true)
    expect(link.enqueue('d1', '排队B')).toBe(true)

    // busy→idle hands back exactly the queue head, one at a time
    expect(link.markBusy('d1', false)).toBe('排队A')
    link.markBusy('d1', true)
    expect(link.markBusy('d1', false)).toBe('排队B')
    expect(link.markBusy('d1', false)).toBeUndefined()

    // switching the active target drops the old target's pending queue
    link.setSessionDocks('s1', ['d1', 'd2'])
    link.markBusy('d1', true)
    link.enqueue('d1', 'stale')
    link.setActiveDock('d2')
    expect(link.markBusy('d1', false)).toBeUndefined()

    // closing the dock tab drops its queue too
    link.markBusy('d2', true)
    link.enqueue('d2', 'gone')
    link.setSessionDocks('s1', ['d1'])
    expect(link.isBusy('d2')).toBe(false)

    // stop: queue discarded, busy flag cleared
    link.markBusy('d1', true)
    link.enqueue('d1', 'cancelled')
    link.clearQueue('d1')
    expect(link.markBusy('d1', false)).toBeUndefined()
  })
})

describe('relaySeedCommand', () => {
  it('distills the mainline transcript into role+text seeds, dropping errors', () => {
    const cmd = relaySeedCommand([
      user('帮我写报告'),
      { id: 'a1', role: 'assistant', text: '草案如下…', ts: 2 },
      { id: 'a2', role: 'assistant', text: '模型断流', error: true, ts: 3 },
      { id: 'a3', role: 'assistant', text: '  ', ts: 4 },
    ])
    expect(cmd).toEqual({
      type: 'seed',
      messages: [
        { role: 'user', text: '帮我写报告' },
        { role: 'assistant', text: '草案如下…' },
      ],
    })
  })
})
