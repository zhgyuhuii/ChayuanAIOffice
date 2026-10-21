import { describe, expect, it } from 'vitest'
import { createThinkRouter, splitThinkContent } from '../src/protocols/think-routing'

describe('splitThinkContent (non-stream)', () => {
  it('splits a closed think block into reasoning and clean content', () => {
    const r = splitThinkContent('<think>内部推理</think>最终答案')
    expect(r.reasoning).toBe('内部推理')
    expect(r.content).toBe('最终答案')
  })
  it('routes an unclosed think block entirely to reasoning', () => {
    const r = splitThinkContent('<think>\n推理没写完')
    expect(r.reasoning).toBe('推理没写完')
    expect(r.content).toBe('')
  })
  it('leaves plain content untouched', () => {
    expect(splitThinkContent('普通回答')).toEqual({ reasoning: '', content: '普通回答' })
  })
})

describe('createThinkRouter (streaming, tag split across chunks)', () => {
  it('routes a think open split across three deltas and recovers content after close', () => {
    const r = createThinkRouter()
    const out: Array<{ kind: string; text: string }> = []
    for (const d of ['<th', 'ink>内心', '戏</th', 'ink>答案', '在此']) out.push(...r.route(d))
    out.push(...r.flush())
    const reasoning = out
      .filter((p) => p.kind === 'reasoning')
      .map((p) => p.text)
      .join('')
    const content = out
      .filter((p) => p.kind === 'content')
      .map((p) => p.text)
      .join('')
    expect(reasoning).toBe('内心戏')
    expect(content).toBe('答案在此')
  })
  it('passes plain content through byte-for-byte from the first delta', () => {
    const r = createThinkRouter()
    const out = [...r.route('普'), ...r.route('通内容')]
    expect(out.every((p) => p.kind === 'content')).toBe(true)
    expect(out.map((p) => p.text).join('')).toBe('普通内容')
  })
})
