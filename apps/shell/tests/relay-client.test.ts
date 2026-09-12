import { describe, expect, it } from 'vitest'

import type { HomeChatMessage } from '../src/shared/home-api'
import {
  applyRelayEvent,
  RelaySessionLink,
  relaySeedCommand,
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
