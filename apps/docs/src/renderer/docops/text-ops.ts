// text-ops — 正文批量 from chayuan-wps: 删除空白行 (blank-line sweep) plus the
// style statistics/cleanup engine (统计已使用的样式 / 清理未使用的样式).
// The wps versions walk doc.Paragraphs/doc.Styles over the WPS object model;
// here the document model is ProseMirror and the style registry is
// docx-engine's parsed styles Map (styles.xml truth), threaded to save via
// SaveOptions.styleDeletes.
import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import type { StyleInfo } from '@chatoffice/docx-engine'
import { applyTr, type DocOpOutcome } from './docops-core'

/** a paragraph is blank when it has no text AND no non-text inline content (images/rules) */
export function isBlankParagraph(node: PmNode): boolean {
  if (node.type.name !== 'docParagraph') return false
  if (node.content.size === 0) return true
  let blank = true
  node.forEach((child) => {
    if (child.type.name === 'text') {
      if (child.text && child.text.trim().length > 0) blank = false
    } else {
      blank = false
    }
  })
  return blank
}

/** 删除空白行 — delete blank top-level paragraphs (outside tables), descending */
export function deleteBlankParagraphs(editor: Editor): DocOpOutcome {
  const doc = editor.state.doc
  const targets: Array<{ pos: number; size: number }> = []
  doc.forEach((node, offset) => {
    if (isBlankParagraph(node)) targets.push({ pos: offset, size: node.nodeSize })
  })
  // keep at least one paragraph so the document stays valid
  if (targets.length >= doc.childCount) targets.shift()
  if (targets.length === 0) return { ok: true, count: 0 }
  applyTr(editor, (tr) => {
    for (let i = targets.length - 1; i >= 0; i--) {
      const t = targets[i]!
      tr.delete(t.pos, t.pos + t.size)
    }
    return true
  })
  return { ok: true, count: targets.length }
}

// ---- style statistics -------------------------------------------------------

export interface StyleUsage {
  styleId: string
  name: string
  type: StyleInfo['type']
  /** how many top-level blocks reference this style (paragraph pStyle / table tblStyle) */
  uses: number
  /** top-level block index (0-based) of the first use, for jump-to */
  firstUseBlock?: number
  /** semiHidden styles are hidden from Word's own galleries */
  visible: boolean
}

/**
 * 统计已使用的样式 — usage report over the parsed style registry: which styles
 * the document body actually references (paragraph/heading pStyle + table
 * tblStyle), and which registry entries are unreferenced.
 */
export function computeStyleUsage(
  doc: PmNode,
  styles: Map<string, StyleInfo>,
): { used: StyleUsage[]; unused: StyleUsage[] } {
  const usedIds = new Map<string, { uses: number; firstBlock: number }>()
  let blockIndex = 0
  doc.forEach((node) => {
    const styleId = node.type.name === 'docTable' ? node.attrs.tblStyleId : node.attrs.styleId
    if (typeof styleId === 'string' && styleId.length > 0) {
      const entry = usedIds.get(styleId)
      if (entry) entry.uses++
      else usedIds.set(styleId, { uses: 1, firstBlock: blockIndex })
    }
    blockIndex++
  })
  const used: StyleUsage[] = []
  const unused: StyleUsage[] = []
  for (const [styleId, info] of styles) {
    if (info.linkedCharShell) continue // Word never lists these separately
    const entry = usedIds.get(styleId)
    const row: StyleUsage = {
      styleId,
      name: info.name,
      type: info.type,
      uses: entry?.uses ?? 0,
      firstUseBlock: entry?.firstBlock,
      visible: !info.semiHidden,
    }
    ;(entry ? used : unused).push(row)
  }
  used.sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name))
  unused.sort((a, b) => a.name.localeCompare(b.name))
  return { used, unused }
}

/** default paragraph styles that must survive cleanup (they carry document formatting weight) */
const UNDELETABLE_STYLE_IDS = new Set(['Normal'])

/** 清理未使用的样式 — classify which unused styles are safe to remove */
export function removableUnusedStyles(unused: StyleUsage[]): {
  removable: StyleUsage[]
  kept: StyleUsage[]
} {
  const removable: StyleUsage[] = []
  const kept: StyleUsage[] = []
  for (const row of unused) {
    if (UNDELETABLE_STYLE_IDS.has(row.styleId)) kept.push(row)
    else removable.push(row)
  }
  return { removable, kept }
}
