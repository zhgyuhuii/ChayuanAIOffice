// docops-core — shared primitives for the 察元 AI document batch operations
// (harvested from chayuan-wps; see docs/chayuan-wps-harvest-analysis.md §3-§5).
//
// Everything here is pure ProseMirror: collect top-level targets, then mutate
// through one transaction with the wps iron rule — **descending positions** so
// earlier edits never shift later targets.
import type { Editor } from '@tiptap/core'
import { Fragment, type Node as PmNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

/** a top-level table with its document position and 1-based ordinal */
export interface TableTarget {
  node: PmNode
  pos: number
  index: number // 1-based, document order
}

export interface ImageTarget {
  node: PmNode
  pos: number
  index: number // 1-based, document order (inline order)
}

/** Collect the document's top-level tables (Word's doc.Tables: nested tables belong to their parent cell). */
export function collectTables(doc: PmNode): TableTarget[] {
  const out: TableTarget[] = []
  let index = 0
  doc.forEach((node, offset) => {
    if (node.type.name === 'docTable') {
      index += 1
      out.push({ node, pos: offset, index })
    }
  })
  return out
}

/** Collect every image: inline images in text flow (floating anchors included). */
export function collectImages(doc: PmNode): ImageTarget[] {
  const out: ImageTarget[] = []
  let index = 0
  doc.descendants((node, pos) => {
    if (node.type.name === 'docInlineImage' && !node.attrs.rule) {
      index += 1
      out.push({ node, pos, index })
    }
    return true
  })
  return out
}

/** rows of a table as {node, pos} in document space (absolute positions) */
export function tableRows(table: PmNode, tablePos: number): Array<{ node: PmNode; pos: number }> {
  const rows: Array<{ node: PmNode; pos: number }> = []
  table.forEach((row, offset) => {
    if (row.type.name === 'docTableRow') rows.push({ node: row, pos: tablePos + 1 + offset })
  })
  return rows
}

/** grid cells of one row: {node, pos, colStart..colEnd} with colspan awareness */
export function rowCells(
  row: PmNode,
  rowPos: number,
  colStart = 0,
): Array<{ node: PmNode; pos: number; from: number; to: number }> {
  const cells: Array<{ node: PmNode; pos: number; from: number; to: number }> = []
  let col = colStart
  row.forEach((cell, offset) => {
    const span = Math.max(1, Number(cell.attrs.colspan) || 1)
    cells.push({ node: cell, pos: rowPos + 1 + offset, from: col, to: col + span })
    col += span
  })
  return cells
}

/** number of grid columns of a table (first row wins; falls back to max) */
export function tableColumnCount(table: PmNode): number {
  const firstRow = table.content.firstChild
  if (!firstRow) return 0
  const width = (row: PmNode): number => {
    let acc = 0
    row.content.forEach((c) => {
      acc += Math.max(1, Number(c.attrs.colspan) || 1)
    })
    return acc
  }
  let max = width(firstRow)
  table.forEach((row) => {
    if (row.type.name === 'docTableRow') max = Math.max(max, width(row))
  })
  return max
}

/** plain text of a node (cell content etc.), like wps cell .Range.Text cleanup */
export function nodePlainText(node: PmNode): string {
  return node.textContent.replace(/[\r\n\u0007]+/gu, '')  // eslint-disable-line no-control-regex
}

/** replace a cell's whole content with a single paragraph of text (keeps cell attrs) */
export function setCellText(
  tr: Transaction,
  cell: { node: PmNode; pos: number },
  schema: {
    nodes: Record<string, { createAndFill: (attrs?: Record<string, unknown>, content?: Fragment) => PmNode | null }>
    text: (text: string) => PmNode
  },
  text: string,
  align?: string | null,
): void {
  const attrs = align ? ({ align } as Record<string, unknown>) : undefined
  const paragraph =
    schema.nodes['docParagraph']!.createAndFill(attrs, text ? Fragment.from(schema.text(text)) : undefined) ??
    schema.nodes['docParagraph']!.createAndFill(attrs)
  if (!paragraph) return
  const from = cell.pos + 1
  const to = cell.pos + cell.node.nodeSize - 1
  tr.replaceWith(from, to, paragraph)
}

export interface DocOpOutcome {
  ok: boolean
  /** how many tables/rows/images/etc. the operation touched */
  count: number
  /** human-oriented extras (skipped merged cells etc.) */
  skipped?: number
  error?: string
}

/** run one transaction over the editor; returns false when nothing changed */
export function applyTr(editor: Editor, build: (tr: Transaction) => boolean): boolean {
  const tr = editor.state.tr
  if (!build(tr)) return false
  editor.view.dispatch(tr.scrollIntoView())
  return true
}
