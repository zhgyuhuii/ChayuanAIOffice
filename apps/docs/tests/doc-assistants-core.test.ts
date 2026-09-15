// The harvested core pack: chayuan-wps builtin helpers (spell-check, summary,
// the text-analysis family, security check, declassify extraction, media) as a
// pinned 常用助手 domain. Prompts are verbatim from the wps registry — the
// assertions below pin both the harvest integrity and the verbatim wording.
import { describe, expect, it } from 'vitest'
import { CORE_ASSISTANTS } from '../src/renderer/ai/assistants/core-builtin'
import {
  ALL_ASSISTANT_DOMAINS,
  ALL_ASSISTANTS_TOTAL,
  CORE_DOMAIN,
  DOC_ASSISTANT_TOTAL,
  findCoreAssistant,
  getDomainAssistants,
} from '../src/renderer/ai/assistants'
import { buildAssistantInstruction } from '../src/renderer/ai/assistants/build-instruction'

describe('core pack integrity', () => {
  it('carries the curated 24 helpers with unique core.* ids', () => {
    expect(CORE_ASSISTANTS).toHaveLength(24)
    const ids = CORE_ASSISTANTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of CORE_ASSISTANTS) {
      expect(a.domain).toBe('core')
      expect(a.id.startsWith('core.')).toBe(true)
      expect(a.systemPrompt.length).toBeGreaterThan(0)
      expect(a.userPromptTemplate).toContain('{{input}}')
      expect(a.actions).toContain(a.defaultAction)
    }
  })

  it('harvests the wps prompts verbatim (spot checks)', () => {
    const spell = findCoreAssistant('core.spell-check')
    expect(spell?.userPromptTemplate).toContain('"issues":[{"text":"","suggestion":"","reason":"","sentence":"","prefix":"","suffix":""}')
    expect(spell?.userPromptTemplate).toContain('只返回 JSON，不要 markdown、不要解释、不要额外文字')
    expect(spell?.defaultAction).toBe('comment')
    expect(spell?.outputFormat).toBe('json')

    const security = findCoreAssistant('core.security-check')
    expect(security?.userPromptTemplate).toContain('保密检查')
    expect(security?.userPromptTemplate).toContain('## 高风险项')
    expect(security?.userPromptTemplate).toContain('命中片段')

    const trace = findCoreAssistant('core.ai-trace-check')
    expect(trace?.userPromptTemplate).toContain('AI 生成痕迹')
    expect(trace?.userPromptTemplate).toContain('命中片段')

    const secret = findCoreAssistant('core.secret-keyword-extract')
    expect(secret?.userPromptTemplate).toContain('replacementToken')
    expect(secret?.outputFormat).toBe('json')

    const summary = findCoreAssistant('core.summary')
    expect(summary?.label).toBe('生成摘要') // settings-label override
    expect(summary?.defaultAction).toBe('none')
  })

  it('media assistants carry mediaKind with the runner defaults baked in', () => {
    const image = findCoreAssistant('core.text-to-image')
    expect(image?.mediaKind).toBe('image')
    expect(image?.userPromptTemplate).not.toContain('{{aspectRatio}}')
    expect(image?.userPromptTemplate).toContain('16:9')
    const video = findCoreAssistant('core.text-to-video')
    expect(video?.mediaKind).toBe('video')
    expect(video?.userPromptTemplate).toContain('8s')
  })

  it('spell-check runs as a comment plan over a selection', () => {
    const plan = buildAssistantInstruction(
      findCoreAssistant('core.spell-check')!,
      '再接再励的同学们取得了好成积。',
    )
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.inputScope).toBe('selection')
    expect(plan.instruction).toContain('add_comment')
    expect(plan.instruction).toContain('再接再励')
  })
})

describe('core domain merge', () => {
  it('pins 常用助手 as the first browse group with the merged total', async () => {
    expect(CORE_DOMAIN.key).toBe('core')
    expect(ALL_ASSISTANT_DOMAINS[0]?.key).toBe('core')
    expect(ALL_ASSISTANTS_TOTAL).toBe(DOC_ASSISTANT_TOTAL + CORE_ASSISTANTS.length)
    await expect(getDomainAssistants('core')).resolves.toBe(CORE_ASSISTANTS)
  })
})
