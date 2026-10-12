/**
 * setBackground kind tolerance: models keep dropping the required `kind` (or
 * writing it as `type`, wrong case). When the payload identifies the intended
 * kind unambiguously the validator coerces in place instead of rejecting the
 * whole atomic batch; with nothing inferrable the guided error fires unchanged.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createBlankPptx, openPptx, type OpenedPptx } from '@chatoffice/pptx-engine'
import { runTxn } from '../src/ops/executor'
import '../src/ops/index'

let opened: OpenedPptx

beforeAll(async () => {
  opened = await openPptx(await createBlankPptx())
})

const bg = (op: Record<string, unknown>) => runTxn(opened, { ops: [{ op: 'setBackground', target: { slide: 0 }, ...op }] })

describe('setBackground kind coercion', () => {
  it('infers solid from a bare color (the observed misfire: no kind at all)', () => {
    const r = bg({ color: '#8C1F28' })
    expect(r.applied).toBe(true)
    expect(r.records![0]!.after).toMatchObject({ kind: 'solid' })
    expect(r.records![0]!.op.kind).toBe('solid')
  })

  it('infers gradient from from/to', () => {
    const r = bg({ from: '#0B1F3A', to: '#1A73E8', angleDeg: 90 })
    expect(r.applied).toBe(true)
    expect(r.records![0]!.after).toMatchObject({ kind: 'gradient' })
  })

  it('accepts type as an alias and strips it', () => {
    const r = bg({ type: 'solid', color: '#0B1F3A' })
    expect(r.applied).toBe(true)
    expect(r.records![0]!.op.kind).toBe('solid')
    expect(r.records![0]!.op.type).toBeUndefined()
  })

  it('normalizes case and stray whitespace on a stated kind', () => {
    const r = bg({ kind: ' SOLID ', color: '#0B1F3A' })
    expect(r.applied).toBe(true)
    expect(r.records![0]!.op.kind).toBe('solid')
  })

  it('infers image from source and graphics from hidden', () => {
    // source without usable bytes still fails, but on the bytes — not on kind
    const img = bg({ source: { bytes: 'not-really-bytes' } })
    expect(img.applied).toBe(false)
    expect(img.failures![0]!.error).toMatch(/"source\.bytes"/)
    expect(img.failures![0]!.op.kind).toBe('image')

    const gfx = bg({ hidden: true })
    expect(gfx.applied).toBe(true)
    expect(gfx.records![0]!.after).toMatchObject({ kind: 'graphics', hidden: true })
  })

  it('keeps the guided error when nothing identifies the kind', () => {
    const r = bg({})
    expect(r.applied).toBe(false)
    expect(r.failures![0]!.error).toContain('needs "kind"')
    expect(r.failures![0]!.error).toContain('Usage: setBackground')
  })

  it('keeps the guided error for a stated kind outside the vocabulary', () => {
    const r = bg({ kind: 'color', color: '#0B1F3A' })
    expect(r.applied).toBe(false)
    expect(r.failures![0]!.error).toContain('needs "kind"')
  })

  it('still validates the color of a coerced solid', () => {
    const r = bg({ color: 'crimson' })
    expect(r.applied).toBe(false)
    expect(r.failures![0]!.error).toMatch(/"color" must be a hex color/)
  })

  it('coercion survives atomic batching with other ops', () => {
    const r = runTxn(opened, {
      ops: [
        { op: 'setBackground', target: { slide: 0 }, color: '#0B1F3A' },
        { op: 'setBackground', target: { slide: 0 }, kind: 'reset' },
      ],
    })
    expect(r.applied).toBe(true)
    expect(r.records).toHaveLength(2)
  })
})
