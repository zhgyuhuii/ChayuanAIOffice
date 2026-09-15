// Integrity of the generated assistant packs (tools/gen-docs-assistants.mjs
// output): schema completeness, unique ids, manifest counts, template
// placeholders. This is the drift alarm for the migration pipeline.
import { describe, expect, it } from 'vitest'
import {
  ALL_ASSISTANT_DOMAINS,
  ALL_ASSISTANTS_TOTAL,
  DOC_ASSISTANT_DOMAINS,
  DOC_ASSISTANT_TOTAL,
  flattenByManifest,
  loadAllAssistants,
  matchAssistant,
} from '../src/renderer/ai/assistants'

describe('generated assistant packs', () => {
  it('manifest counts add up to the total', () => {
    expect(DOC_ASSISTANT_DOMAINS.length).toBeGreaterThan(200)
    const sum = DOC_ASSISTANT_DOMAINS.reduce((acc, d) => acc + d.count, 0)
    expect(sum).toBe(DOC_ASSISTANT_TOTAL)
    expect(DOC_ASSISTANT_TOTAL).toBe(4576) // 4544 wps builtin + 32 report presets
  })

  it('every assistant satisfies the unified schema', async () => {
    const byDomain = await loadAllAssistants()
    const all = flattenByManifest(byDomain)
    // the generated packs plus the pinned core pack (常用助手)
    expect(all.length).toBe(ALL_ASSISTANTS_TOTAL)

    const ids = new Set<string>()
    for (const doc of all) {
      // domain key is ASCII; the slug may legitimately keep CJK from the source id
      expect(doc.id).toMatch(/^[a-z0-9-]+\.\S+$/i)
      expect(ids.has(doc.id)).toBe(false)
      ids.add(doc.id)
      expect(doc.label.trim()).not.toBe('')
      expect(doc.description.trim()).not.toBe('')
      expect(doc.systemPrompt.trim()).not.toBe('')
      expect(doc.userPromptTemplate).toContain('{{input}}')
      expect(doc.actions.length).toBeGreaterThan(0)
      expect(doc.actions).toContain(doc.defaultAction)
      expect(['document', 'selection-preferred', 'selection-only']).toContain(doc.inputSource)
      expect(['markdown', 'json', 'plain', 'bullet-list']).toContain(doc.outputFormat)
      expect(doc.icon.trim()).not.toBe('')
    }
  })

  it('every domain in the packs is listed in the manifest and vice versa', async () => {
    const byDomain = await loadAllAssistants()
    expect([...byDomain.keys()].sort()).toEqual(
      ALL_ASSISTANT_DOMAINS.map((d) => d.key).sort(),
    )
    for (const d of ALL_ASSISTANT_DOMAINS) {
      expect(byDomain.get(d.key)?.length).toBe(d.count)
    }
  })

  it('the report domain carries the migrated report presets with templates', async () => {
    const byDomain = await loadAllAssistants()
    const reports = byDomain.get('report') ?? []
    expect(reports.length).toBe(32)
    for (const doc of reports) {
      expect(doc.report).toBeDefined()
      expect(doc.report!.typeLabel.trim()).not.toBe('')
      expect(doc.report!.template).toContain('{{reportType}}')
      expect(doc.defaultAction).toBe('none')
    }
  })

  it('search matches labels, tags and domain labels', async () => {
    const byDomain = await loadAllAssistants()
    const all = flattenByManifest(byDomain)
    const labelOf = new Map(ALL_ASSISTANT_DOMAINS.map((d) => [d.key, d.label]))
    const search = (query: string) =>
      all.filter((d) => matchAssistant(d, labelOf.get(d.domain) ?? d.domain, query))
    // every report preset is reachable via its 报告-generating purpose
    const reports = all.filter((d) => d.domain === 'report')
    expect(reports.length).toBe(32)
    expect(reports.every((d) => search('报告').includes(d))).toBe(true)
    // a distinctive tea term finds the tasting-note assistant
    const tasting = all.find((d) => d.id === 'tea.tea-tasting-note')
    expect(tasting).toBeDefined()
    expect(search('品鉴')).toContain(tasting)
    // gibberish matches nothing
    expect(search('zzz绝不存在的词').length).toBe(0)
  })
})
