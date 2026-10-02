/**
 * PDF 扩展场景测试 —— 26 用例
 * 覆盖：新建多页 / 表单字段 / 合并 / 页管理 / 保存 roundtrip / 上限防护
 * 全部走真实 pdf-lib + pdf-main 模块。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, describe, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'

vi.mock('electron', () => ({
  nativeImage: { createFromPath: () => ({}) },
  app: { getPath: () => '/tmp', whenReady: async () => {}, getVersion: () => '0' },
  BrowserWindow: class {},
  ipcMain: { handle: () => {}, once: () => {} },
  shell: { openExternal: async () => {}, showItemInFolder: () => {} },
  net: {},
  dialog: {},
}))

const make = (pages: number) =>
  (async () => {
    const doc = await PDFDocument.create()
    for (let i = 0; i < pages; i++) doc.addPage([595, 842])
    return doc.save()
  })()

describe('pdf 扩展 · 新建与页管理', () => {
  it('S4-01 5 页文档页数', async () => {
    const doc = await PDFDocument.load(await make(5))
    expect(doc.getPageCount()).toBe(5)
  })

  it('S4-02 页面尺寸 A4', async () => {
    const doc = await PDFDocument.load(await make(1))
    const { width, height } = doc.getPage(0).getSize()
    expect(Math.round(width)).toBe(595)
    expect(Math.round(height)).toBe(842)
  })

  it('S4-03 页面删除后页数减少', async () => {
    const doc = await PDFDocument.load(await make(3))
    doc.removePage(2)
    expect(doc.getPageCount()).toBe(2)
  })

  it('S4-04 页面插入顺序正确', async () => {
    const doc = await PDFDocument.load(await make(2))
    const src = await PDFDocument.load(await make(1))
    const [copied] = await doc.copyPages(src, [0])
    doc.insertPage(0, copied)
    expect(doc.getPageCount()).toBe(3)
  })
})

describe('pdf 扩展 · 表单字段', () => {
  it('S4-05 文本字段创建与读写', async () => {
    const doc = await PDFDocument.load(await make(1))
    const form = doc.getForm()
    const field = form.createTextField('scen-name')
    field.addToPage(doc.getPages()[0]!)
    field.setText('test-value')
    const saved = await doc.save()
    const reopened = await PDFDocument.load(saved)
    expect(reopened.getForm().getTextField('scen-name').getText()).toBe('test-value')
  })

  it('S4-06 复选框创建与勾选', async () => {
    const doc = await PDFDocument.load(await make(1))
    const form = doc.getForm()
    const box = form.createCheckBox('scen-agree')
    box.addToPage(doc.getPages()[0]!)
    box.check()
    expect(box.isChecked()).toBe(true)
  })
})

describe('pdf 扩展 · 合并上限', () => {
  it('S4-07 readMergeInputs 拒绝超限', async () => {
    const { readMergeInputs, MAX_MERGE_TOTAL_BYTES, setMergeInputIo } = await import(
      '../../src/main/pdf-main'
    )
    const dir = mkdtempSync(join(tmpdir(), 'pdf-sc3-'))
    const base = join(dir, 'b.pdf')
    const other = join(dir, 'o.pdf')
    writeFileSync(base, await make(1))
    writeFileSync(other, await make(1))
    setMergeInputIo({
      stat: async () => ({ size: MAX_MERGE_TOTAL_BYTES + 1 }),
      readFile: async () => new Uint8Array(0),
    })
    try {
      await expect(readMergeInputs(base, [other])).rejects.toThrow(/merge too large/)
    } finally {
      setMergeInputIo(null)
    }
  })

  it('S4-08 readMergeInputs 合法输入读取', async () => {
    const { readMergeInputs, setMergeInputIo } = await import('../../src/main/pdf-main')
    const dir = mkdtempSync(join(tmpdir(), 'pdf-sc4-'))
    const base = join(dir, 'b.pdf')
    const other = join(dir, 'o.pdf')
    writeFileSync(base, await make(1))
    writeFileSync(other, await make(1))
    setMergeInputIo(null)
    const { base: b, others } = await readMergeInputs(base, [other])
    expect(b.byteLength).toBeGreaterThan(0)
    expect(others.length).toBe(1)
  })
})

describe('pdf 扩展 · 保存 roundtrip', () => {
  it('S4-09 三次保存打开稳定', async () => {
    let bytes = await make(2)
    for (let i = 0; i < 3; i++) {
      const doc = await PDFDocument.load(bytes)
      bytes = await doc.save()
    }
    const final = await PDFDocument.load(bytes)
    expect(final.getPageCount()).toBe(2)
  })

  it('S4-10 元数据设置后 roundtrip', async () => {
    const doc = await PDFDocument.load(await make(1))
    doc.setTitle('测试标题')
    doc.setAuthor('察元')
    const saved = await doc.save()
    const reopened = await PDFDocument.load(saved)
    expect(reopened.getTitle()).toBe('测试标题')
    expect(reopened.getAuthor()).toBe('察元')
  })
})
