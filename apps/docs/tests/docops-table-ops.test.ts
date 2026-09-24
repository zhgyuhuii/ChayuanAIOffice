// table-ops — the 14-item 表格批量操作 family over real ProseMirror documents.
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import {
  addCaptions,
  addFirstColumnNumbers,
  appendReplaceCellText,
  autoFitByContent,
  autoFitByWindow,
  collectTableMatrices,
  deleteAllTables,
  deleteHitRowsColumns,
  deleteTableCaptions,
  findTextHits,
  refreshStylesFromFirstTable,
  setManualColumnWidth,
  applyFirstRowColStyle,
} from '../src/renderer/docops/table-ops'
import { collectTables } from '../src/renderer/docops/docops-core'

function cell(text: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'docTableCell',
    attrs: { docxIndex: 0, ...extra },
    content: text
      ? [{ type: 'docParagraph', attrs: { docxIndex: 0 }, content: [{ type: 'text', text }] }]
      : [{ type: 'docParagraph', attrs: { docxIndex: 0 } }],
  }
}

function table(rows: string[][]) {
  return {
    type: 'docTable',
    attrs: { docxIndex: 0 },
    content: rows.map((cells) => ({
      type: 'docTableRow',
      content: cells.map((c) => cell(c)),
    })),
  }
}

function makeEditor(...blocks: unknown[]) {
  return new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: { type: 'doc', content: blocks as never },
  })
}

describe('table batch ops', () => {
  it('删除全部表格 removes every top-level table', () => {
    const ed = makeEditor(table([['a']]), { type: 'docParagraph', attrs: { docxIndex: 1 }, content: [{ type: 'text', text: '中' }] }, table([['b']]))
    const out = deleteAllTables(ed)
    expect(out.count).toBe(2)
    expect(collectTables(ed.state.doc).length).toBe(0)
    expect(ed.state.doc.textContent).toContain('中')
  })

  it('AutoFit content/window flips the tblAutoFit channel', () => {
    const ed = makeEditor(table([['x']]))
    autoFitByContent(ed)
    expect(ed.state.doc.firstChild?.attrs.tblAutoFit).toBe('contents')
    autoFitByWindow(ed)
    expect(ed.state.doc.firstChild?.attrs.tblAutoFit).toBe('window')
  })

  it('手动列宽度 writes equal percentage shares and a fixed layout', () => {
    const ed = makeEditor(table([['a', 'b', 'c']]))
    setManualColumnWidth(ed, 72)
    const t = ed.state.doc.firstChild!
    expect(t.attrs.tblAutoFit).toBe('fixed')
    expect(t.attrs.colWidthsPct).toHaveLength(3)
    expect(t.attrs.colWidthsPct![0]).toBeCloseTo(33.333, 2)
    expect(t.attrs.widthPx).toBe(Math.round(72 * 3 * (96 / 72)))
  })

  it('首列添加序号 inserts a leading numbering column with centered ordinals', () => {
    const ed = makeEditor(table([['姓名', '年龄'], ['张三', '20']]))
    const out = addFirstColumnNumbers(ed)
    expect(out.count).toBe(2)
    const rows = ed.state.doc.firstChild!.content
    const firstRowFirstCell = rows.firstChild!.firstChild!
    expect(firstRowFirstCell.textContent).toBe('1')
    const secondRow = rows.child(1)!
    expect(secondRow.firstChild!.textContent).toBe('2')
    expect(secondRow.childCount).toBe(3)
  })

  it('追加替换文字 replaces matches inside cells only', () => {
    const ed = makeEditor(table([['苹果价格'], ['苹果数量']]))
    const out = appendReplaceCellText(ed, '苹果', '梨', 'replace')
    expect(out.count).toBe(2)
    expect(ed.state.doc.textContent).not.toContain('苹果')
    expect(ed.state.doc.textContent).toContain('梨价格')
    const ed2 = makeEditor(table([['编号A']]))
    appendReplaceCellText(ed2, 'A', 'B', 'append')
    expect(ed2.state.doc.textContent).toContain('编号AB')
  })

  it('删除文字所在行 finds hits and deletes descending', () => {
    const ed = makeEditor(
      table([
        ['keep', 'x'],
        ['delete-me', 'y'],
        ['also delete-me', 'z'],
      ]),
    )
    const hits = findTextHits(ed.state.doc, 'delete-me', 'row')
    expect(hits).toHaveLength(2)
    const out = deleteHitRowsColumns(ed, hits, 'row')
    expect(out.count).toBe(2)
    const t = ed.state.doc.firstChild!
    expect(t.childCount).toBe(1)
    expect(t.textContent).toContain('keep')
  })

  it('删除文字所在列 deletes the hit grid column', () => {
    const ed = makeEditor(table([['a', 'secret'], ['b', 'secret2']]))
    const hits = findTextHits(ed.state.doc, 'secret', 'column')
    expect(hits).toHaveLength(1)
    const out = deleteHitRowsColumns(ed, hits, 'column')
    expect(out.count).toBe(2) // one cell per row
    const t = ed.state.doc.firstChild!
    expect(t.firstChild!.childCount).toBe(1)
    expect(t.textContent).not.toContain('secret')
  })

  it('添加/删除表格题注 round-trips counting captions', () => {
    const ed = makeEditor(table([['a']]), table([['b']]))
    const targets: Array<{ from: number; to: number }> = []
    ed.state.doc.forEach((n, o) => {
      if (n.type.name === 'docTable') targets.push({ from: o, to: o + n.nodeSize })
    })
    const out = addCaptions(ed, targets, { label: '表', suffix: '数据', position: 'above' })
    expect(out.count).toBe(2)
    expect(ed.state.doc.textContent).toContain('表1数据')
    expect(ed.state.doc.textContent).toContain('表2数据')
    const removed = deleteTableCaptions(ed)
    expect(removed.count).toBe(2)
    expect(ed.state.doc.textContent).not.toContain('表1')
  })

  it('根据第一表格刷新样式 copies first-table look onto the rest', () => {
    const ed = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: {
        type: 'doc',
        content: [
          { ...table([['h']]), attrs: { docxIndex: 0, tblStyleId: 'Grid1', tblFill: 'EEEEEE' } },
          table([['h2']]),
        ] as never,
      },
    })
    const out = refreshStylesFromFirstTable(ed)
    expect(out.count).toBe(1)
    const second = collectTables(ed.state.doc)[1]!
    expect(second.node.attrs.tblStyleId).toBe('Grid1')
    expect(second.node.attrs.tblFill).toBe('EEEEEE')
  })

  it('第一列指定样式 applies the preset to first-column cells', () => {
    const ed = makeEditor(table([['a', 'b'], ['c', 'd']]))
    const out = applyFirstRowColStyle(ed, 'column', { id: 'gray', bold: true, fill: 'D9D9D9' })
    expect(out.count).toBe(2)
    const t = ed.state.doc.firstChild!
    expect(t.firstChild!.firstChild!.attrs.bold).toBe(true)
    expect(t.firstChild!.firstChild!.attrs.fill).toBe('D9D9D9')
    expect(t.firstChild!.child(1)!.attrs.bold).not.toBe(true)
  })
})

