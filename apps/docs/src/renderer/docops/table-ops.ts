// table-ops — the 表格批量操作 family (14 items) harvested from chayuan-wps
// ribbon.js, rebuilt on ProseMirror. Algorithms follow the wps analysis
// (docs/chayuan-wps-harvest-analysis.md §3): descending edits, per-table
// AutoFit via the tblAutoFit channel, caption numbering as plain counting
// paragraphs (label + N + suffix, centered).
import type { Editor } from '@tiptap/core'
import { Fragment, type Node as PmNode } from '@tiptap/pm/model'
import {
  applyTr,
  collectTables,
  nodePlainText,
  rowCells,
  setCellText,
  tableColumnCount,
  tableRows,
  type DocOpOutcome,
} from './docops-core'

// ---- immediate operations (no dialog) --------------------------------------

/** 删除全部表格 — delete every top-level table (descending) */
export function deleteAllTables(editor: Editor): DocOpOutcome {
  const tables = collectTables(editor.state.doc)
  if (tables.length === 0) return { ok: true, count: 0 }
  applyTr(editor, (tr) => {
    for (let i = tables.length - 1; i >= 0; i--) {
      const t = tables[i]!
      tr.delete(t.pos, t.pos + t.node.nodeSize)
    }
    return true
  })
  return { ok: true, count: tables.length }
}

/** 根据内容自动行宽 — tblAutoFit='contents' (browser sizes columns to content) */
export function autoFitByContent(editor: Editor): DocOpOutcome {
  return setAutoFit(editor, 'contents')
}

/** 根据窗口自动行宽 — tblAutoFit='window' (table spans the text column) */
export function autoFitByWindow(editor: Editor): DocOpOutcome {
  return setAutoFit(editor, 'window')
}

function setAutoFit(
  editor: Editor,
  mode: 'contents' | 'window',
): DocOpOutcome {
  const tables = collectTables(editor.state.doc)
  if (tables.length === 0) return { ok: true, count: 0 }
  applyTr(editor, (tr) => {
    for (const t of tables) {
      tr.setNodeMarkup(t.pos, undefined, {
        ...t.node.attrs,
        tblAutoFit: mode,
        tblAutoFitEdited: true,
        // a stale measured grid would pin the old width (autofit-contents keeps
        // widthPx until the user explicitly chooses contents — that is here)
        ...(mode === 'contents' ? { widthPx: null } : null),
      })
    }
    return true
  })
  return { ok: true, count: tables.length }
}

/** 手动列宽度 — one fixed point width for every column of every table */
export function setManualColumnWidth(editor: Editor, widthPt: number): DocOpOutcome {
  const tables = collectTables(editor.state.doc)
  if (tables.length === 0) return { ok: true, count: 0 }
  applyTr(editor, (tr) => {
    for (const t of tables) {
      const cols = tableColumnCount(t.node)
      if (cols === 0) continue
      // every column exactly widthPt wide → table width = cols × widthPt.
      // Percentage storage: equal shares; the absolute table width rides on
      // widthPx (px = pt × 96/72).
      const widthPx = Math.round(widthPt * cols * (96 / 72))
      const pct = Number((100 / cols).toFixed(3))
      tr.setNodeMarkup(t.pos, undefined, {
        ...t.node.attrs,
        widthPx,
        colWidthsPct: Array.from({ length: cols }, () => pct),
        widthPct: null,
        tblAutoFit: 'fixed',
        tblAutoFitEdited: true,
      })
    }
    return true
  })
  return { ok: true, count: tables.length }
}

/** 首列添加序号 — insert a leading numbering column (row ordinal, centered) */
export function addFirstColumnNumbers(editor: Editor): DocOpOutcome {
  const tables = collectTables(editor.state.doc)
  if (tables.length === 0) return { ok: true, count: 0 }
  let added = 0
  applyTr(editor, (tr) => {
    // descending: inserting into table i shifts nothing before it
    for (let ti = tables.length - 1; ti >= 0; ti--) {
      const t = tables[ti]!
      const schema = editor.state.schema
      const rows = tableRows(t.node, t.pos)
      // build the new column bottom-up inside this table: compute each new cell
      // and insert right after the row's opening tag (before first cell)
      for (let ri = rows.length - 1; ri >= 0; ri--) {
        const row = rows[ri]!
        const isHeader = row.node.content.firstChild?.type.name === 'docTableHeader'
        const cellType = isHeader ? schema.nodes['docTableHeader']! : schema.nodes['docTableCell']!
        const ordinal = ri + 1
        const para = schema.nodes['docParagraph']!.createAndFill(
          { align: 'center' },
          Fragment.from(schema.text(String(ordinal))),
        )
        const cell = cellType.createAndFill({}, para ? [para] : undefined)
        if (!cell) continue
        // before the first cell (firstChild only decides the cell type above)
        const insertAt = row.pos + 1
        tr.insert(insertAt, cell)
        added++
      }
    }
    return added > 0
  })
  return { ok: added > 0, count: added }
}

/** 第一列/第一行指定样式 — apply a formatting preset to the first column / first row cells */
export interface TableStylePreset {
  id: string
  bold?: boolean
  fill?: string | null
  color?: string | null
  align?: string | null
}

export function applyFirstRowColStyle(
  editor: Editor,
  target: 'column' | 'row',
  preset: TableStylePreset,
): DocOpOutcome {
  const tables = collectTables(editor.state.doc)
  if (tables.length === 0) return { ok: true, count: 0 }
  let count = 0
  applyTr(editor, (tr) => {
    for (const t of tables) {
      const rows = tableRows(t.node, t.pos)
      rows.forEach((row, ri) => {
        rowCells(row.node, row.pos).forEach((cell) => {
          const hit = target === 'column' ? cell.from === 0 : ri === 0
          if (!hit) return
          tr.setNodeMarkup(cell.pos, undefined, {
            ...cell.node.attrs,
            ...(preset.bold !== undefined ? { bold: preset.bold } : null),
            ...(preset.fill !== undefined ? { fill: preset.fill } : null),
            ...(preset.color !== undefined ? { color: preset.color } : null),
            ...(preset.align !== undefined ? { align: preset.align } : null),
          })
          count++
        })
      })
    }
    return count > 0
  })
  return { ok: count > 0, count }
}

/**
 * 根据第一表格刷新样式 — table-level look (tblStyleId/tblLook/borders/fill) plus
 * the first row / first column cell formatting of table 1 replicated onto the
 * other tables (wps copies the style + 4 banding switches + role cells).
 */
export function refreshStylesFromFirstTable(editor: Editor): DocOpOutcome {
  const tables = collectTables(editor.state.doc)
  if (tables.length < 2) return { ok: true, count: 0 }
  const first = tables[0]!
  const firstAttrs = first.node.attrs
  const firstRow = tableRows(first.node, first.pos)[0]
  const firstRowCells = firstRow
    ? rowCells(firstRow.node, firstRow.pos).map((c) => c.node.attrs)
    : []
  const firstColAttrs: Array<Record<string, unknown>> = []
  tableRows(first.node, first.pos).forEach((row) => {
    const cells = rowCells(row.node, row.pos)
    const cell = cells[0]
    if (cell) firstColAttrs.push(cell.node.attrs as Record<string, unknown>)
  })
  applyTr(editor, (tr) => {
    for (const t of tables.slice(1)) {
      // table-level look
      tr.setNodeMarkup(t.pos, undefined, {
        ...t.node.attrs,
        tblStyleId: firstAttrs.tblStyleId,
        tblLook: firstAttrs.tblLook,
        borders: firstAttrs.borders,
        tblFill: firstAttrs.tblFill,
      })
      // role cells: first row gets table 1's first-row formatting, first
      // column its per-row first-cell formatting (wps getSourceCellRole)
      tableRows(t.node, t.pos).forEach((row, ri) => {
        rowCells(row.node, row.pos).forEach((cell) => {
          if (ri === 0 && firstRowCells[0]) {
            tr.setNodeMarkup(cell.pos, undefined, {
              ...cell.node.attrs,
              bold: firstRowCells[0]!.bold,
              fill: firstRowCells[0]!.fill,
              color: firstRowCells[0]!.color,
            })
          }
          if (cell.from === 0 && firstColAttrs[ri]) {
            tr.setNodeMarkup(cell.pos, undefined, {
              ...cell.node.attrs,
              bold: firstColAttrs[ri]!.bold,
              fill: firstColAttrs[ri]!.fill,
              color: firstColAttrs[ri]!.color,
            })
          }
        })
      })
    }
    return true
  })
  return { ok: true, count: tables.length - 1 }
}

// ---- dialog-backed operations ----------------------------------------------

export interface TextHitRow {
  tableIndex: number
  rowIndex: number
  /** grid column (0-based) — only for column mode */
  colIndex?: number
}

/** scan all tables for rows (or columns) whose text contains the keyword */
export function findTextHits(
  doc: PmNode,
  keyword: string,
  mode: 'row' | 'column',
): TextHitRow[] {
  const hits: TextHitRow[] = []
  if (!keyword) return hits
  collectTables(doc).forEach((t) => {
    const rows = tableRows(t.node, t.pos)
    if (mode === 'row') {
      rows.forEach((row, ri) => {
        const text = nodePlainText(row.node)
        if (text.includes(keyword)) hits.push({ tableIndex: t.index, rowIndex: ri })
      })
    } else {
      const cols = tableColumnCount(t.node)
      for (let c = 0; c < cols; c++) {
        let hit = false
        rows.forEach((row) => {
          if (hit) return
          rowCells(row.node, row.pos).forEach((cell) => {
            if (cell.from <= c && c < cell.to && nodePlainText(cell.node).includes(keyword)) {
              hit = true
            }
          })
        })
        if (hit) hits.push({ tableIndex: t.index, rowIndex: c, colIndex: c })
      }
    }
  })
  return hits
}

/** 删除文字所在行/列 — delete the hit rows (or columns), descending */
export function deleteHitRowsColumns(
  editor: Editor,
  hits: TextHitRow[],
  mode: 'row' | 'column',
): DocOpOutcome {
  if (hits.length === 0) return { ok: true, count: 0 }
  const tables = collectTables(editor.state.doc)
  let removed = 0
  applyTr(editor, (tr) => {
    // group by table, descending table index; inside a table descending row/col
    const byTable = new Map<number, TextHitRow[]>()
    for (const h of hits) {
      const list = byTable.get(h.tableIndex) ?? []
      list.push(h)
      byTable.set(h.tableIndex, list)
    }
    const tableIndexes = [...byTable.keys()].sort((a, b) => b - a)
    for (const ti of tableIndexes) {
      const t = tables[ti - 1]
      if (!t) continue
      const rows = tableRows(t.node, t.pos)
      const list = byTable.get(ti) ?? []
      if (mode === 'row') {
        const rowIdx = new Set(list.map((h) => h.rowIndex))
        const ordered = [...rowIdx].sort((a, b) => b - a)
        for (const ri of ordered) {
          const row = rows[ri]
          if (!row) continue
          tr.delete(tr.mapping.map(row.pos), tr.mapping.map(row.pos + row.node.nodeSize))
          removed++
        }
      } else {
        const colIdx = [...new Set(list.map((h) => h.colIndex ?? 0))].sort((a, b) => b - a)
        for (const c of colIdx) {
          const cells = columnCellPositions(t.node, t.pos, c)
          // delete cell-by-cell inside this table; rows are independent but
          // earlier deletions in the same column shift later rows, so map
          for (const cellPos of cells) {
            const mapped = tr.mapping.map(cellPos.pos)
            tr.delete(mapped, mapped + cellPos.size)
            removed++
          }
        }
      }
    }
    return removed > 0
  })
  return { ok: removed > 0, count: removed }
}

/** every cell that starts exactly at grid column `col` in this table */
function columnCellPositions(
  table: PmNode,
  tablePos: number,
  col: number,
): Array<{ pos: number; size: number }> {
  const out: Array<{ pos: number; size: number }> = []
  tableRows(table, tablePos).forEach((row) => {
    rowCells(row.node, row.pos).forEach((cell) => {
      if (cell.from === col) out.push({ pos: cell.pos, size: cell.node.nodeSize })
    })
  })
  return out
}

/** 追加替换文字 — replace or append inside every cell whose text contains find */
export function appendReplaceCellText(
  editor: Editor,
  find: string,
  content: string,
  mode: 'replace' | 'append',
): DocOpOutcome {
  const tables = collectTables(editor.state.doc)
  if (!find || tables.length === 0) return { ok: true, count: 0 }
  const schema = editor.state.schema
  let touched = 0
  applyTr(editor, (tr) => {
    // descending over tables; within a table, descending over cells so the
    // replaceWith ranges stay valid without mapping
    for (let ti = tables.length - 1; ti >= 0; ti--) {
      const t = tables[ti]!
      const cells: Array<{ node: PmNode; pos: number }> = []
      tableRows(t.node, t.pos).forEach((row) =>
        rowCells(row.node, row.pos).forEach((cell) => cells.push(cell)),
      )
      for (let ci = cells.length - 1; ci >= 0; ci--) {
        const cell = cells[ci]!
        const raw = nodePlainText(cell.node)
        if (!raw.includes(find)) continue
        const next =
          mode === 'replace'
            ? raw.split(find).join(content)
            : raw.split(find).join(find + content)
        setCellText(tr, cell, schema, next)
        touched++
      }
    }
    return touched > 0
  })
  return { ok: touched > 0, count: touched }
}

// ---- captions (shared with image-ops) --------------------------------------

export interface CaptionOptions {
  /** label before the ordinal, e.g. 表 / 图 */
  label: string
  /** suffix after the ordinal */
  suffix?: string
  position: 'above' | 'below'
}

/**
 * 添加题注 — caption = label + ordinal + suffix as a centered paragraph
 * adjacent to each target. Targets are given as absolute ranges; a reusable
 * blank neighbour paragraph is overwritten, otherwise a new one is inserted.
 */
export function addCaptions(
  editor: Editor,
  targets: Array<{ from: number; to: number }>,
  opts: CaptionOptions,
): DocOpOutcome {
  if (targets.length === 0) return { ok: true, count: 0 }
  const schema = editor.state.schema
  let added = 0
  applyTr(editor, (tr) => {
    for (let i = targets.length - 1; i >= 0; i--) {
      const t = targets[i]!
      const text = `${opts.label}${i + 1}${opts.suffix ?? ''}`
      const para = schema.nodes['docParagraph']!.createAndFill(
        { align: 'center' },
        Fragment.from(schema.text(text)),
      )
      if (!para) continue
      const anchorPos = opts.position === 'above' ? t.from : t.to
      const pos = tr.mapping.map(anchorPos)
      const doc = tr.doc
      const $pos = doc.resolve(pos)
      const index = $pos.index(0)
      const neighbour =
        opts.position === 'above' ? doc.maybeChild(index - 1) : doc.maybeChild(index)
      const neighbourBlank =
        neighbour && neighbour.type.name === 'docParagraph' && neighbour.content.size === 0
      if (neighbourBlank) {
        const nPos =
          opts.position === 'above' ? pos - neighbour!.nodeSize : pos
        const mapped = tr.mapping.map(nPos)
        tr.replaceWith(mapped, mapped + neighbour!.nodeSize, para)
      } else {
        tr.insert(pos, para)
      }
      added++
    }
    return added > 0
  })
  return { ok: added > 0, count: added }
}

const TABLE_CAPTION_RE = /^(表|Table|附表)\s*\d+(?:[-.]\d+)?/

/** 删除表格题注 — two-tier detection (adjacent paragraph, then whole-document fallback) */
export function deleteTableCaptions(editor: Editor): DocOpOutcome {
  return deleteCaptionsGeneric(editor, (text, ordinal) => {
    if (!TABLE_CAPTION_RE.test(text.trim())) return false
    return captionOrdinalMatches(text, ordinal)
  })
}

function captionOrdinalMatches(text: string, ordinal: number): boolean {
  if (ordinal < 0) return true // fallback tier: pattern only
  const m = text.trim().match(/\d+/)
  return m ? Number(m[0]) === ordinal : true
}

/**
 * Shared caption deletion: adjacent blank-or-caption paragraph around each
 * target (the wps 1..80 gap is unnecessary — PM positions are exact), falling
 * back to a whole-document sweep of caption-like short paragraphs.
 */
function deleteCaptionsGeneric(
  editor: Editor,
  looksLikeCaption: (text: string, ordinal: number) => boolean,
): DocOpOutcome {
  const doc = editor.state.doc
  const ranges: Array<{ pos: number; size: number }> = []
  let tableOrdinal = 0
  doc.forEach((node, offset) => {
    if (node.type.name !== 'docTable') return
    tableOrdinal += 1
    const before = doc.resolve(offset).nodeBefore
    if (
      before &&
      before.type.name === 'docParagraph' &&
      looksLikeCaption(before.textContent, tableOrdinal)
    ) {
      ranges.push({ pos: offset - before.nodeSize, size: before.nodeSize })
      return
    }
    const afterPos = offset + node.nodeSize
    const after = doc.resolve(afterPos).nodeAfter
    if (
      after &&
      after.type.name === 'docParagraph' &&
      looksLikeCaption(after.textContent, tableOrdinal)
    ) {
      ranges.push({ pos: afterPos, size: after.nodeSize })
    }
  })
  if (ranges.length === 0) {
    // whole-document fallback: any short caption-like paragraph outside tables
    // (ordinal check relaxed — the wps fallback accepts any caption pattern)
    doc.forEach((node, offset) => {
      if (node.type.name !== 'docParagraph') return
      const text = node.textContent.trim()
      if (text.length === 0 || text.length > 120) return
      if (looksLikeCaption(text, -1)) ranges.push({ pos: offset, size: node.nodeSize })
    })
  }
  if (ranges.length === 0) return { ok: true, count: 0 }
  applyTr(editor, (tr) => {
    const sorted = [...ranges].sort((a, b) => b.pos - a.pos)
    for (const r of sorted) {
      const pos = tr.mapping.map(r.pos)
      tr.delete(pos, pos + r.size)
    }
    return true
  })
  return { ok: true, count: ranges.length }
}

/** 导出全部表格 — collect table text matrices for file export */
export function collectTableMatrices(doc: PmNode): string[][][] {
  return collectTables(doc).map((t) =>
    tableRows(t.node, t.pos).map((row) =>
      rowCells(row.node, row.pos).map((cell) => nodePlainText(cell.node)),
    ),
  )
}

/** helper for dialog confirm text: total hit count preview */
export function previewTextHits(editor: Editor, keyword: string, mode: 'row' | 'column'): TextHitRow[] {
  return findTextHits(editor.state.doc, keyword, mode)
}
