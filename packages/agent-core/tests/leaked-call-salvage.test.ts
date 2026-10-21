import { describe, expect, it } from 'vitest'
import { salvageLeakedToolCalls } from '../src/leaked-call-salvage'

const KNOWN = ['write_document', 'read_blocks']

describe('salvageLeakedToolCalls', () => {
  it('salvages a Qwen native call leaked inside an unclosed think block', () => {
    const text =
      '<think>\n{"name": "write_document", "arguments": {"title": "大美江山", "replaceDocument": false}}\n</tool_call>'
    const calls = salvageLeakedToolCalls(text, KNOWN)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.name).toBe('write_document')
    expect(calls[0]!.input).toEqual({ title: '大美江山', replaceDocument: false })
  })

  it('salvages multiple blocks and stringified arguments', () => {
    const text =
      '<tool_call>{"name":"read_blocks","arguments":"{\\"startBlockIndex\\":0}"}</tool_call>\n<tool_call>{"tool":"write_document","input":{"title":"T"}}</tool_call>'
    const calls = salvageLeakedToolCalls(text, KNOWN)
    expect(calls.map((c) => c.name)).toEqual(['read_blocks', 'write_document'])
  })

  it('drops unknown tools and plain prose', () => {
    expect(salvageLeakedToolCalls('<tool_call>{"name":"nope"}</tool_call>', KNOWN)).toEqual([])
    expect(salvageLeakedToolCalls('这是一段普通正文，没有调用。', KNOWN)).toEqual([])
    expect(salvageLeakedToolCalls('', KNOWN)).toEqual([])
  })
})
