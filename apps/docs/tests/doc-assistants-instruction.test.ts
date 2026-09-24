// The unified run rules: DocAssistant + current selection → agent instruction.
import { describe, expect, it } from 'vitest'
import { buildAssistantInstruction, resolveInputScope } from '../src/renderer/ai/assistants/build-instruction'
import type { DocAssistant } from '../src/renderer/ai/assistants/types'

function makeDoc(overrides: Partial<DocAssistant> = {}): DocAssistant {
  return {
    id: 'tea.tasting-note',
    domain: 'tea',
    label: '茶叶品鉴描述',
    shortLabel: '品鉴描述',
    icon: '👃',
    tags: ['品鉴'],
    description: '整理成分维度的品鉴描述',
    systemPrompt: '你是一位有评茶师经验的审评人员。',
    userPromptTemplate: '请根据下面的信息整理品鉴描述：\n---\n{{input}}\n---',
    actions: ['insert', 'none'],
    defaultAction: 'none',
    inputSource: 'document',
    outputFormat: 'markdown',
    ...overrides,
  }
}

describe('resolveInputScope', () => {
  it('a meaningful selection wins for document / selection-preferred sources', () => {
    expect(resolveInputScope(makeDoc(), '')).toBe('document')
    expect(resolveInputScope(makeDoc(), '好')).toBe('document') // below the 2-char threshold
    expect(resolveInputScope(makeDoc(), '汤色金黄')).toBe('selection')
    expect(resolveInputScope(makeDoc({ inputSource: 'selection-preferred' }), '汤色金黄')).toBe(
      'selection',
    )
  })

  it('selection-only demands a selection', () => {
    expect(resolveInputScope(makeDoc({ inputSource: 'selection-only' }), '')).toBe('need-selection')
    expect(resolveInputScope(makeDoc({ inputSource: 'selection-only' }), '香气持久')).toBe(
      'selection',
    )
  })
})

describe('buildAssistantInstruction', () => {
  it('document scope: persona + template with tool-based input pointer + action directive', () => {
    const plan = buildAssistantInstruction(makeDoc(), '')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.instruction).toContain('【角色设定】\n你是一位有评茶师经验的审评人员。')
    expect(plan.instruction).toContain('read_blocks')
    expect(plan.instruction).not.toContain('{{input}}')
    expect(plan.instruction).toContain('仅在对话中输出结果，不要修改文档')
    expect(plan.display).toBe('👃 茶叶品鉴描述 · 全文')
  })

  it('selection scope embeds the selection text verbatim', () => {
    const plan = buildAssistantInstruction(makeDoc({ inputSource: 'selection-preferred' }), '干茶紧结，汤色金黄。')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.instruction).toContain('【以下为用户当前选中的内容】')
    expect(plan.instruction).toContain('干茶紧结，汤色金黄。')
    expect(plan.display).toBe('👃 茶叶品鉴描述 · 选区')
  })

  it('selection-only without selection is rejected', () => {
    const plan = buildAssistantInstruction(makeDoc({ inputSource: 'selection-only' }), '')
    expect(plan).toEqual({ ok: false, error: 'need-selection' })
  })

  it('json output format adds the JSON-only directive', () => {
    const plan = buildAssistantInstruction(makeDoc({ outputFormat: 'json' }), '')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.instruction).toContain('仅输出合法的 JSON')
  })

  it('the replace action directs an in-place rewrite', () => {
    const plan = buildAssistantInstruction(makeDoc({ defaultAction: 'replace', actions: ['replace', 'none'] }), '')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.instruction).toContain('改写进文档对应位置')
  })

  it('comment actions anchor real comments via the add_comment tool', () => {
    const plan = buildAssistantInstruction(
      makeDoc({ defaultAction: 'comment', actions: ['comment', 'none'] }),
      '',
    )
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.instruction).toContain('不要直接改写原文')
    expect(plan.instruction).toContain('add_comment')
    expect(plan.instruction).toContain('anchorText')
  })

  it('media assistants route to the image channel / storyboard fallback', () => {
    const image = buildAssistantInstruction(
      makeDoc({ defaultAction: 'insert', actions: ['insert', 'none'], mediaKind: 'image' }),
      '',
    )
    expect(image.ok).toBe(true)
    if (image.ok) expect(image.instruction).toContain('generate_image')
    const video = buildAssistantInstruction(
      makeDoc({ defaultAction: 'none', actions: ['none'], mediaKind: 'video' }),
      '',
    )
    expect(video.ok).toBe(true)
    if (video.ok) {
      expect(video.instruction).toContain('分镜脚本')
      expect(video.instruction).toContain('generate_image')
    }
  })

  it('report assistants render the type label into the template and carry the emphasis prompt', () => {
    const doc = makeDoc({
      id: 'report.engineering-audit',
      domain: 'report',
      label: '工程审计报告助手',
      report: {
        type: 'engineering-audit-report',
        typeLabel: '工程审计报告',
        template: '# {{reportType}}\n\n## 一、执行摘要',
        prompt: '重点识别项目立项、预算中的缺口。',
      },
    })
    const plan = buildAssistantInstruction(doc, '')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.instruction).toContain('# 工程审计报告')
    expect(plan.instruction).not.toContain('{{reportType}}')
    expect(plan.instruction).toContain('重点识别项目立项、预算中的缺口。')
  })
})
