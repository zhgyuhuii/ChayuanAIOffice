import { describe, expect, it } from 'vitest'

import type { RelayDockDocInfo, RelayEvent } from '../../shell/src/shared/relay-protocol'
import { RelayConfirmGate } from '../src/renderer/ai/relay-confirm'
import { createRelayExtrasSkill } from '../src/renderer/ai/relay-extras'

describe('RelayConfirmGate', () => {
  it('request emits the confirm-request via onCreated and resolves on confirm', async () => {
    const gate = new RelayConfirmGate()
    const emitted: RelayEvent[] = []
    const decision = gate.request('t1', 'outline', '# 大纲', (request) => {
      emitted.push({ type: 'confirm-request', turnId: 't1', request })
    })
    const request = emitted[0]
    expect(request?.type === 'confirm-request' && request.request.kind).toBe('outline')

    expect(gate.resolve('cf-wrong', { approved: true })).toBe(false) // stale id is a no-op
    expect(
      gate.resolve(emitted[0]!.type === 'confirm-request' ? emitted[0]!.request.confirmId : '', {
        approved: true,
        feedback: '第二节展开',
      }),
    ).toBe(true)
    await expect(decision).resolves.toEqual({ approved: true, feedback: '第二节展开' })
    expect(gate.current).toBeNull()
  })

  it('rejectAll lands a pending gate as interrupted-rejected (stop/seed/dispose path)', async () => {
    const gate = new RelayConfirmGate()
    const first = gate.request('t1', 'plan', '1. 步骤', () => {})
    gate.rejectAll('stopped by the user')
    await expect(first).resolves.toEqual({
      approved: false,
      feedback: '(interrupted: stopped by the user)',
    })
  })

  it('a second request supersedes the first (single pending confirm)', async () => {
    const gate = new RelayConfirmGate()
    const first = gate.request('t1', 'outline', 'v1', () => {})
    gate.request('t1', 'outline', 'v2', () => {})
    await expect(first).resolves.toMatchObject({ approved: false })
    expect(gate.current?.payload).toBe('v2')
  })
})

describe('createRelayExtrasSkill', () => {
  function harness(
    turnId: string | null,
    docs = [{ title: '报告.docx', kind: 'docs', active: true }],
  ) {
    const gate = new RelayConfirmGate()
    const emitted: RelayEvent[] = []
    const skill = createRelayExtrasSkill({
      gate,
      emit: (e) => emitted.push(e),
      turnId: () => turnId,
      docsListing: () => docs,
    })
    return { gate, emitted, skill }
  }

  it('propose_outline outside a relay turn fails fast without emitting', async () => {
    const h = harness(null)
    const out = await h.skill.executeTool(
      { id: 'c1', name: 'propose_outline', input: { payload: '# x' } },
      undefined,
    )
    expect(out.isError).toBe(true)
    expect(h.emitted).toHaveLength(0)
  })

  it('propose_outline with empty payload is rejected before any event', async () => {
    const h = harness('t1')
    const out = await h.skill.executeTool(
      { id: 'c1', name: 'propose_outline', input: { payload: '  ' } },
      undefined,
    )
    expect(out.isError).toBe(true)
    expect(h.emitted).toHaveLength(0)
  })

  it('propose_outline emits confirm-request; rejection feeds the feedback back to the model', async () => {
    const h = harness('t1')
    const pending = h.skill.executeTool(
      { id: 'c1', name: 'propose_outline', input: { payload: '# 大纲' } },
      undefined,
    )
    expect(h.emitted[0]?.type).toBe('confirm-request')
    const request = (h.emitted[0] as Extract<RelayEvent, { type: 'confirm-request' }>).request
    h.gate.resolve(request.confirmId, { approved: false, feedback: '加一节风险' })
    const out = await pending
    expect(out.isError).toBeUndefined()
    expect(out.output).toContain('REJECTED')
    expect(out.output).toContain('加一节风险')
  })

  it('activate_document matches by path, then title, then substring; unknown targets error', async () => {
    const h = harness('t1', [
      { title: '季度报告.docx', filePath: '/p/q.docx', kind: 'docs', active: true },
      { title: '数据表.xlsx', kind: 'sheets', active: false },
    ] as RelayDockDocInfo[])
    const byPath = await h.skill.executeTool(
      { id: 'c1', name: 'activate_document', input: { document: '/p/q.docx' } },
      undefined,
    )
    expect(byPath.isError).toBeUndefined()
    expect(h.emitted[0]).toMatchObject({
      type: 'switch-request',
      switch: { filePath: '/p/q.docx', title: '季度报告.docx' },
    })

    const byTitle = await h.skill.executeTool(
      { id: 'c2', name: 'activate_document', input: { document: '数据表.xlsx' } },
      undefined,
    )
    expect(byTitle.isError).toBeUndefined()

    const miss = await h.skill.executeTool(
      { id: 'c3', name: 'activate_document', input: { document: '不存在' } },
      undefined,
    )
    expect(miss.isError).toBe(true)
  })

  it('buildContext lists the docked documents for the model', () => {
    const h = harness('t1')
    const ctx = h.skill.buildContext?.() ?? ''
    expect(ctx).toContain('报告.docx')
    expect(ctx).toContain('(active)')
    const empty = harness('t1', [])
    expect(empty.skill.buildContext?.() ?? '').toBe('')
  })
})
