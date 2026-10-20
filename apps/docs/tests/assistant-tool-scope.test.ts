import { describe, expect, it } from 'vitest'
import {
  isWritingIntent,
  scopeToolsForIntent,
  slimToolDefs,
  WRITING_CORE_TOOL_NAMES,
} from '../src/renderer/ai/assistant-tool-scope'
import { DOCS_SYSTEM_PROMPT_SLIM } from '../src/renderer/ai/docs-system-prompt-slim'
import { AGENT_SYSTEM_PROMPT, HTML_RULES, OPS_GUIDE } from '../src/renderer/ai/protocol'
import { AGENT_TOOLS } from '../src/renderer/ai/tools'

const wire = (tools: typeof AGENT_TOOLS) =>
  JSON.stringify(
    tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    })),
  )

describe('isWritingIntent', () => {
  it('matches pure writing passes in zh and en', () => {
    expect(isWritingIntent('扩写这段内容')).toBe(true)
    expect(isWritingIntent('请对下面内容进行润色')).toBe(true)
    expect(isWritingIntent('续写这句话')).toBe(true)
    expect(isWritingIntent('polish this paragraph')).toBe(true)
    expect(isWritingIntent('翻译成英文')).toBe(true)
  })

  it('a media/structure ask is never scoped, even when it contains a writing verb', () => {
    expect(isWritingIntent('扩写并生成一张配图')).toBe(false)
    expect(isWritingIntent('润色后在下面插入图表')).toBe(false)
    expect(isWritingIntent('新建一个文档写周报')).toBe(false)
    expect(isWritingIntent('给文档加个封面和目录')).toBe(false)
  })

  it('empty/unknown instructions are not scoped', () => {
    expect(isWritingIntent('')).toBe(false)
    expect(isWritingIntent('今天天气怎么样')).toBe(false)
  })
})

describe('scopeToolsForIntent (A)', () => {
  it('a writing run carries only the core read/write tools, in skill order', () => {
    const scoped = scopeToolsForIntent('扩写这段内容', AGENT_TOOLS)
    expect(scoped.length).toBeGreaterThanOrEqual(6)
    expect(scoped.length).toBeLessThanOrEqual(WRITING_CORE_TOOL_NAMES.length)
    for (const t of scoped) expect(WRITING_CORE_TOOL_NAMES).toContain(t.name)
    // order preserved from the skill's own list
    const indexes = scoped.map((t) => AGENT_TOOLS.indexOf(t))
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes)
  })

  it('media/chart/revision tools stay off a writing run', () => {
    const names = scopeToolsForIntent('扩写这段内容', AGENT_TOOLS).map((t) => t.name)
    expect(names).not.toContain('generate_image')
    expect(names).not.toContain('insert_chart')
    expect(names).not.toContain('accept_changes')
    expect(names).not.toContain('create_document')
  })

  it('any other instruction keeps the full toolset (same array, no re-filter)', () => {
    expect(scopeToolsForIntent('帮我看看文档结构', AGENT_TOOLS)).toBe(AGENT_TOOLS)
    expect(scopeToolsForIntent('', AGENT_TOOLS)).toBe(AGENT_TOOLS)
  })
})

describe('slimToolDefs (B)', () => {
  it('shrinks the wire payload without dropping tools or contracts', () => {
    const before = wire(AGENT_TOOLS)
    const slimmed = slimToolDefs(AGENT_TOOLS)
    expect(slimmed.length).toBe(AGENT_TOOLS.length)
    expect(
      JSON.parse(wire(slimmed)).map((t: { function: { name: string } }) => t.function.name),
    ).toEqual(AGENT_TOOLS.map((t) => t.name))
    expect(wire(slimmed).length).toBeLessThan(before.length)
  })

  it('tightened schemas keep their required lists and property sets', () => {
    const slimmed = slimToolDefs(AGENT_TOOLS)
    const before = Object.fromEntries(AGENT_TOOLS.map((t) => [t.name, t]))
    for (const t of slimmed) {
      const orig = before[t.name]!
      const origRequired = JSON.stringify(
        (orig.inputSchema as { required?: unknown }).required ?? null,
      )
      const slimRequired = JSON.stringify(
        (t.inputSchema as { required?: unknown }).required ?? null,
      )
      expect(slimRequired).toBe(origRequired)
      const origProps = Object.keys((orig.inputSchema as { properties?: object }).properties ?? {})
      const slimProps = Object.keys((t.inputSchema as { properties?: object }).properties ?? {})
      expect(slimProps).toEqual(origProps)
    }
  })

  it('leaves tools without overrides untouched (upstream stays source of truth)', () => {
    const slimmed = slimToolDefs(AGENT_TOOLS)
    const byName = Object.fromEntries(slimmed.map((t) => [t.name, t]))
    expect(byName['get_document_context']).toBe(beforeByName())
  })
  function beforeByName() {
    return AGENT_TOOLS.find((t) => t.name === 'get_document_context')
  }
})

describe('DOCS_SYSTEM_PROMPT_SLIM (C)', () => {
  const fullAssembly = [
    AGENT_SYSTEM_PROMPT,
    '',
    '# HTML fragment rules',
    HTML_RULES,
    '',
    '# apply_ops guide',
    OPS_GUIDE,
  ].join('\n')

  it('is materially smaller than the upstream assembly', () => {
    expect(DOCS_SYSTEM_PROMPT_SLIM.length).toBeLessThan(fullAssembly.length * 0.75)
  })

  it('keeps every section and the load-bearing wire contracts', () => {
    for (const section of [
      '# Intent',
      '# Tool usage',
      '# Comments',
      '# Template filling',
      '# Fields, footnotes & endnotes',
      '# Headers & footers',
      '# Answer citations',
      '# Tracked revisions',
      '# Mind map',
      '# HTML fragment rules',
      '# apply_ops guide',
    ]) {
      expect(DOCS_SYSTEM_PROMPT_SLIM).toContain(section)
    }
    for (const contract of [
      'write_document',
      'replace_blocks',
      'replace_selection',
      'apply_ops',
      'insertCover',
      'insertToc',
      'create_document',
      '{PAGE} / {NUMPAGES}',
      'docnav://block/N',
      '<sel>',
      'read_revisions',
      'generate_mindmap',
      'doc:B.I',
    ]) {
      expect(DOCS_SYSTEM_PROMPT_SLIM).toContain(contract)
    }
  })
})
