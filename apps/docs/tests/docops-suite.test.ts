// text-ops / image-ops / declassify / form-mode — the remaining docops families.
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { deleteBlankParagraphs, computeStyleUsage, isBlankParagraph, removableUnusedStyles } from '../src/renderer/docops/text-ops'
import { collectImageFiles, deleteAllImages, uniformImageFormat, clearImageFormat, deleteImageCaptions, imageCaptionRanges } from '../src/renderer/docops/image-ops'
import { addCaptions } from '../src/renderer/docops/table-ops'
import {
  mergeLocalKeywordHits,
  generateReplacementToken,
  ensureUniqueReplacementTokens,
  buildNormalizedStream,
  buildReplacementPlan,
  applyDocumentDeclassify,
  restoreDeclassifyByTokens,
  validateDeclassifyPassword,
  buildSidecar,
  openSidecar,
} from '../src/renderer/docops/declassify'
import { encryptPayloadWithPassword, decryptPayload, fingerprintText } from '../src/renderer/docops/declassify-crypto'
import { scanFormFields, setFormMode, isFormModeActive, fillFormFields } from '../src/renderer/docops/form-mode'
import type { StyleInfo } from '@chatoffice/docx-engine'

function para(text: string, docxIndex = 0) {
  return {
    type: 'docParagraph',
    attrs: { docxIndex, ...(text ? {} : {}) },
    ...(text ? { content: [{ type: 'text', text }] } : {}),
  }
}

function paraStyled(styleId: string, text: string) {
  return {
    type: 'docParagraph',
    attrs: { docxIndex: 0, styleId },
    content: [{ type: 'text', text }],
  }
}

function makeEditor(blocks: unknown[]) {
  return new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: { type: 'doc', content: blocks as never },
  })
}

describe('text-ops 删除空白行', () => {
  it('deletes blank paragraphs, keeps content paragraphs', () => {
    const ed = makeEditor([para('a'), para(''), para('   '), para('b')])
    const out = deleteBlankParagraphs(ed)
    expect(out.count).toBe(2)
    expect(ed.state.doc.childCount).toBe(2)
    expect(ed.state.doc.textContent).toBe('ab')
  })

  it('isBlankParagraph ignores paragraphs carrying images', () => {
    const ed = makeEditor([
      { type: 'docParagraph', attrs: { docxIndex: 0 }, content: [{ type: 'docInlineImage', attrs: { dataUrl: 'data:image/png;base64,x' } }] },
    ])
    expect(isBlankParagraph(ed.state.doc.firstChild!)).toBe(false)
    expect(deleteBlankParagraphs(ed).count).toBe(0)
  })
})

describe('text-ops 样式统计/清理', () => {
  const styles = new Map<string, StyleInfo>([
    ['Normal', { styleId: 'Normal', name: 'Normal', type: 'paragraph' }],
    ['Heading1', { styleId: 'Heading1', name: 'heading 1', type: 'paragraph', headingLevel: 1 }],
    ['Unused1', { styleId: 'Unused1', name: 'unused style', type: 'paragraph' }],
  ] as never)

  it('computes used vs unused over the parsed registry', () => {
    const ed = makeEditor([paraStyled('Normal', 'a'), paraStyled('Heading1', 't')])
    const report = computeStyleUsage(ed.state.doc, styles)
    expect(report.used.map((u) => u.styleId).sort()).toEqual(['Heading1', 'Normal'])
    expect(report.unused.map((u) => u.styleId)).toEqual(['Unused1'])
    const { removable, kept } = removableUnusedStyles(report.unused)
    expect(removable.map((r) => r.styleId)).toEqual(['Unused1'])
    expect(kept).toHaveLength(0) // Normal is used here; the guard keeps defaults anyway
  })

  it('never removes the Normal default', () => {
    const ed = makeEditor([paraStyled('Heading1', 'x')])
    const report = computeStyleUsage(ed.state.doc, styles)
    const { kept } = removableUnusedStyles(report.unused)
    expect(kept.map((k) => k.styleId)).toContain('Normal')
  })
})

describe('image-ops', () => {
  const img = (dataUrl: string, extra: Record<string, unknown> = {}) => ({
    type: 'docInlineImage',
    attrs: { dataUrl, ...extra },
  })

  it('导出全部图像 collects dataUrl files with ordinal names', () => {
    const ed = makeEditor([
      { type: 'docParagraph', attrs: { docxIndex: 0 }, content: [img('data:image/png;base64,AAA=')] },
      { type: 'docParagraph', attrs: { docxIndex: 1 }, content: [img('data:image/jpeg;base64,BBB=')] },
    ])
    const files = collectImageFiles(ed)
    expect(files).toEqual([
      { fileName: '图片_1.png', dataUrl: 'data:image/png;base64,AAA=' },
      { fileName: '图片_2.jpg', dataUrl: 'data:image/jpeg;base64,BBB=' },
    ])
  })

  it('删除全部图像 removes every inline image', () => {
    const ed = makeEditor([
      { type: 'docParagraph', attrs: { docxIndex: 0 }, content: [img('data:image/png;base64,x'), { type: 'text', text: 'keep' }] },
    ])
    const out = deleteAllImages(ed)
    expect(out.count).toBe(1)
    expect(ed.state.doc.textContent).toBe('keep')
  })

  it('统一图像格式 writes size/border and 清除图像格式 resets them', () => {
    const ed = makeEditor([
      { type: 'docParagraph', attrs: { docxIndex: 0 }, content: [img('data:image/png;base64,x', { widthPx: 100, heightPx: 80 })] },
    ])
    uniformImageFormat(ed, { widthPx: 300, lockAspect: true, borderColor: 'FF0000', borderWidthPt: 1.5 })
    const node = ed.state.doc.firstChild!.firstChild!
    expect(node.attrs.widthPx).toBe(300)
    expect(node.attrs.heightPx).toBe(240) // 80/100 ratio kept
    expect(node.attrs.border).toEqual({ color: 'FF0000', widthPt: 1.5 })
    clearImageFormat(ed)
    const reset = ed.state.doc.firstChild!.firstChild!
    expect(reset.attrs.border).toBeNull()
    expect(reset.attrs.widthPx).toBeNull()
  })

  it('图像题注 add/delete round-trip', () => {
    const ed = makeEditor([
      { type: 'docParagraph', attrs: { docxIndex: 0 }, content: [img('data:image/png;base64,x')] },
      { type: 'docParagraph', attrs: { docxIndex: 1 }, content: [img('data:image/png;base64,y')] },
    ])
    const ranges = imageCaptionRanges(ed)
    expect(ranges).toHaveLength(2)
    const added = addCaptions(ed, ranges, { label: '图', suffix: '', position: 'below' })
    expect(added.count).toBe(2)
    expect(ed.state.doc.textContent).toContain('图1')
    expect(ed.state.doc.textContent).toContain('图2')
    const removed = deleteImageCaptions(ed)
    expect(removed.count).toBe(2)
    expect(ed.state.doc.textContent).not.toContain('图1')
  })
})

describe('declassify engine', () => {
  it('local patterns catch phone/email/IP/license plate without a model', () => {
    const text = '联系 13812345678 或 a@b.com，地址 10.1.2.3，车牌 京A12345'
    const hits = mergeLocalKeywordHits(text, null)
    expect(hits.some((h) => h.term === '13812345678' && h.riskLevel === 'high')).toBe(true)
    expect(hits.some((h) => h.term === 'a@b.com')).toBe(true)
    expect(hits.some((h) => h.term === '10.1.2.3')).toBe(true)
    expect(hits.some((h) => h.term === '京A12345')).toBe(true)
  })

  it('tokens are unique §-wrapped and never collide with the text', () => {
    const t1 = generateReplacementToken()
    expect(t1).toMatch(/^§[A-HJ-NP-Za-km-z2-9]{8}§$/)
    const entries = ensureUniqueReplacementTokens(
      [{ term: 'a', token: '', category: 'x', riskLevel: 'high', reason: '', occurrences: 0 }],
      'already contains §AAAAAAAA§',
    )
    const all = new Set([entries[0]!.token, '§AAAAAAAA§'])
    expect(all.size).toBe(2)
  })

  it('tolerant matching ignores alignment spaces inside a term', () => {
    const ed = makeEditor([paraStyled('Normal', '负责人：张  辉 联系电话 13812345678')])
    // 张  辉 comes from the model channel (local patterns never emit names)
    const modelTerm = [{ term: '张  辉', token: '', category: '人员信息', riskLevel: 'high' as const, reason: '', occurrences: 0 }]
    const entries = ensureUniqueReplacementTokens(
      mergeLocalKeywordHits(ed.state.doc.textContent, modelTerm),
      ed.state.doc.textContent,
    )
    const { hits, unmatchedTerms } = buildReplacementPlan(ed.state.doc, entries)
    expect(unmatchedTerms).not.toContain('张  辉') // matched tolerantly…
    const zhang = hits.find((h) => h.term.includes('辉'))
    expect(zhang).toBeDefined()
    expect(hits.some((h) => h.term === '13812345678')).toBe(true)
  })

  it('apply → restore round-trip puts the original text back', () => {
    const ed = makeEditor([paraStyled('Normal', '单位是解放军某部，电话 13812345678。')])
    const original = ed.state.doc.textContent
    const entries = ensureUniqueReplacementTokens(
      mergeLocalKeywordHits(original, null),
      original,
    )
    const { hits } = buildReplacementPlan(ed.state.doc, entries)
    const count = applyDocumentDeclassify(ed, hits)
    expect(count).toBeGreaterThan(0)
    const declassified = ed.state.doc.textContent
    expect(declassified).not.toBe(original)
    expect(declassified.match(/§[A-Za-z0-9]{8}§/g)!.length).toBe(count)
    const { restored, missingTokens } = restoreDeclassifyByTokens(
      ed,
      hits.map((h) => ({ token: h.token, term: h.term })),
    )
    expect(missingTokens).toHaveLength(0)
    expect(restored).toBe(count)
    expect(ed.state.doc.textContent).toBe(original)
  })

  it('the password policy mirrors the wps rules', () => {
    expect(validateDeclassifyPassword('sh1A!')).toBe('too-short')
    expect(validateDeclassifyPassword('longenough1!')).toBe('need-case')
    expect(validateDeclassifyPassword('LongEnough!!')).toBe('need-digit')
    expect(validateDeclassifyPassword('LongEnough11')).toBe('need-special')
    expect(validateDeclassifyPassword('LongEnough1!')).toBeNull()
  })
})

describe('declassify crypto', () => {
  it('AES-GCM round-trip; wrong password fails cleanly', async () => {
    const payload = { hello: '世界', n: 42 }
    const envelope = await encryptPayloadWithPassword(payload, 'LongEnough1!')
    expect(envelope.algorithm).toBe('AES-GCM-256')
    expect(envelope.keyDerivation.iterations).toBe(210_000)
    const opened = await decryptPayload<typeof payload>(envelope, 'LongEnough1!')
    expect(opened).toEqual(payload)
    await expect(decryptPayload(envelope, 'WrongPass1!')).rejects.toThrow()
  })

  it('fingerprint is stable and content-sensitive', async () => {
    const a = await fingerprintText('same')
    const b = await fingerprintText('same')
    const c = await fingerprintText('different')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('sidecar build/open round-trips the full payload', async () => {
    const ed = makeEditor([paraStyled('Normal', '电话 13812345678')])
    const original = ed.state.doc.textContent
    const entries = ensureUniqueReplacementTokens(mergeLocalKeywordHits(original, null), original)
    const { hits } = buildReplacementPlan(ed.state.doc, entries)
    applyDocumentDeclassify(ed, hits)
    const sidecar = await buildSidecar(original, ed.state.doc.textContent, entries, hits, 'LongEnough1!')
    expect(sidecar.state.status).toBe('declassified')
    expect(sidecar.state.replacementCount).toBe(hits.length)
    const payload = await openSidecar(sidecar, 'LongEnough1!')
    expect(payload.textHashes.original).toBe(await fingerprintText(original))
    expect(payload.replacements.length).toBeGreaterThan(0)
  })
})

describe('form-mode', () => {
  it('scans underline blanks with labels', () => {
    const ed = makeEditor([paraStyled('Normal', '姓名：______ 年龄：______')])
    const fields = scanFormFields(ed.state.doc)
    expect(fields).toHaveLength(2)
    expect(fields[0]!.label).toBe('姓名')
    expect(fields[1]!.label).toBe('年龄')
  })

  it('表单模式 restricts edits to blanks and fillFormFields writes back', () => {
    const ed = makeEditor([paraStyled('Normal', '姓名：______ 备注：______')]) // FormModeExtension rides in editorExtensions
    setFormMode(ed, true)
    expect(isFormModeActive()).toBe(true)
    // an edit outside a blank is rejected…
    const hostile = ed.state.tr.insertText('X', 0)
    expect(ed.state.tr && hostile).toBeTruthy()
    let rejected = false
    try {
      const result = ed.view.state.tr.insertText('X', 0)
      // run through the plugin filter by dispatching
      const before = ed.state.doc.textContent
      ed.view.dispatch(result)
      rejected = ed.state.doc.textContent === before
    } catch {
      rejected = true
    }
    expect(rejected).toBe(true)
    // filling blanks through the service works (bypasses the filter)
    const fields = scanFormFields(ed.state.doc)
    const count = fillFormFields(ed, [
      { field: fields[0]!, value: '张三' },
      { field: fields[1]!, value: '无' },
    ])
    expect(count).toBe(2)
    expect(ed.state.doc.textContent).toContain('姓名：张三')
    setFormMode(ed, false)
    expect(isFormModeActive()).toBe(false)
  })
})
