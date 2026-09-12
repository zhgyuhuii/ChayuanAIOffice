import { describe, expect, it } from 'vitest'

import {
  isRelayCommand,
  isRelayEvent,
  RELAY_PREVIEW_LIMIT,
  type RelayEvent,
  type RelayCommand,
} from '../src/shared/relay-protocol'

describe('isRelayEvent', () => {
  it('accepts every event shape of the signed contract', () => {
    const events: RelayEvent[] = [
      { type: 'turn-started', turnId: 't1' },
      { type: 'text', turnId: 't1', text: 'partial response' },
      {
        type: 'tool',
        turnId: 't1',
        activity: { callId: 'c1', name: 'insert_content', phase: 'start' },
      },
      {
        type: 'tool',
        turnId: 't1',
        activity: {
          callId: 'c1',
          name: 'insert_content',
          phase: 'end',
          ok: true,
          outputPreview: 'applied 2 ops',
        },
      },
      {
        type: 'confirm-request',
        turnId: 't1',
        request: { confirmId: 'cf1', kind: 'outline', payload: '# 大纲' },
      },
      { type: 'snapshot', turnId: 't1', snapshot: { turnId: 't1', snapshotId: 's1' } },
      { type: 'context', context: { text: '被选中的段落', kind: 'selection' } },
      { type: 'context', context: { text: '', kind: 'selection' } },
      { type: 'switch-request', turnId: 't1', switch: { filePath: '/p/a.docx', title: 'a' } },
      { type: 'switch-request', turnId: 't1', switch: { title: '季度表' } },
      { type: 'error', turnId: null, message: 'boom' },
      { type: 'busy', busy: true },
      { type: 'turn-finished', turnId: 't1' },
    ]
    for (const e of events) expect(isRelayEvent(e)).toBe(true)
  })

  it('rejects malformed and unknown payloads', () => {
    expect(isRelayEvent(null)).toBe(false)
    expect(isRelayEvent({ type: 'text' })).toBe(false)
    expect(isRelayEvent({ type: 'text', turnId: 3, text: 'x' })).toBe(false)
    expect(isRelayEvent({ type: 'tool', turnId: 't', activity: { callId: 'c' } })).toBe(false)
    expect(isRelayEvent({ type: 'confirm-request', turnId: 't', request: { kind: 'nope' } })).toBe(
      false,
    )
    expect(isRelayEvent({ type: 'busy', busy: 'yes' })).toBe(false)
    expect(isRelayEvent({ type: 'switch-request', turnId: 't', switch: { filePath: 7 } })).toBe(
      false,
    )
    expect(isRelayEvent({ type: 'teleport' })).toBe(false)
  })
})

describe('isRelayCommand', () => {
  it('accepts send/stop/seed/confirm shapes', () => {
    const commands: RelayCommand[] = [
      { type: 'send', text: '把第二段改短' },
      { type: 'stop' },
      {
        type: 'seed',
        messages: [
          { role: 'user', text: '帮我写报告' },
          { role: 'assistant', text: '好的,草案如下…' },
        ],
      },
      { type: 'confirm', confirmId: 'cf1', approved: false, feedback: '大纲第二节砍掉' },
      {
        type: 'sync-docs',
        docs: [
          { title: '报告.docx', filePath: '/p/报告.docx', kind: 'docs', active: true },
          { title: '空白表格', kind: 'sheets', active: false },
        ],
      },
    ]
    for (const c of commands) expect(isRelayCommand(c)).toBe(true)
  })

  it('rejects malformed seeds and unknown types', () => {
    expect(isRelayCommand({ type: 'seed', messages: [{ role: 'tool', text: 'x' }] })).toBe(false)
    expect(isRelayCommand({ type: 'seed', messages: 'history' })).toBe(false)
    expect(isRelayCommand({ type: 'confirm', confirmId: 'c' })).toBe(false)
    expect(isRelayCommand({ type: 'send' })).toBe(false)
    expect(isRelayCommand({ type: 'sync-docs', docs: [{ title: 'x', kind: 'docs' }] })).toBe(false)
    expect(isRelayCommand({ type: 'sync-docs', docs: 'list' })).toBe(false)
    expect(isRelayCommand('send')).toBe(false)
  })
})

describe('preview limit', () => {
  it('is the agreed 2000-char cap', () => {
    expect(RELAY_PREVIEW_LIMIT).toBe(2000)
  })
})
