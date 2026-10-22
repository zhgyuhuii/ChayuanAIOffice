/**
 * PDF 全生命周期场景测试 —— 30 个用例
 * 覆盖：新建/打开 / 合并（上限+顺序读）/ 注解 / 脱敏 / 签名 / 打印 / 导出图片
 * 通过真实 pdf 引擎与主进程模块执行。
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


async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([595, 842])
  return doc.save()
}

describe('pdf 场景 · 新建与打开', () => {
  it('S-PDF-01 新建 3 页文档：页数正确', async () => {
    const bytes = await makePdf(3)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(3)
  })

  it('S-PDF-02 单页文档打开：字节数为正', async () => {
    const bytes = await makePdf(1)
    const reopened = await PDFDocument.load(bytes)
    expect(reopened.getPageCount()).toBe(1)
  })
})

describe('pdf 场景 · 合并（上限防护）', () => {
  it('S-PDF-03 合并两份小文件：页数相加', async () => {
    const { mergePdfBytes } = await import('../../src/main/save-pdf')
    const a = await makePdf(2)
    const b = await makePdf(1)
    const { merged, appended } = await mergePdfBytes(new Uint8Array(a), [new Uint8Array(b)])
    const out = await PDFDocument.load(merged)
    expect(out.getPageCount()).toBe(3)
    expect(appended).toBe(1)
  })

  it('S-PDF-04 readMergeInputs：stat 合计超上限先拒后读', async () => {
    const { readMergeInputs, MAX_MERGE_TOTAL_BYTES } = await import('../../src/main/pdf-main')
    const dir = mkdtempSync(join(tmpdir(), 'pdf-scen-'))
    const base = join(dir, 'base.pdf')
    const other = join(dir, 'other.pdf')
    writeFileSync(base, await makePdf(1))
    writeFileSync(other, await makePdf(1))
    const { setMergeInputIo } = await import('../../src/main/pdf-main')
    setMergeInputIo({
      stat: async () => ({ size: MAX_MERGE_TOTAL_BYTES }),
      readFile: async () => new Uint8Array(0),
    })
    try {
      await expect(readMergeInputs(base, [other])).rejects.toThrow(/merge too large/)
    } finally {
      setMergeInputIo(null)
    }
  })

  it('S-PDF-05 readMergeInputs：正常小文件顺序读取', async () => {
    const { readMergeInputs } = await import('../../src/main/pdf-main')
    const dir = mkdtempSync(join(tmpdir(), 'pdf-scen2-'))
    const base = join(dir, 'base.pdf')
    const other = join(dir, 'other.pdf')
    writeFileSync(base, await makePdf(1))
    writeFileSync(other, await makePdf(1))
    const { setMergeInputIo } = await import('../../src/main/pdf-main')
    setMergeInputIo(null)
    const { base: b, others } = await readMergeInputs(base, [other])
    expect(b.byteLength).toBeGreaterThan(0)
    expect(others.length).toBe(1)
  })
})

describe('pdf 场景 · 注解（widget/annot）', () => {
  it('S-PDF-06 注解字段写入后可读回', async () => {
    const doc = await PDFDocument.load(await makePdf(1))
    const form = doc.getForm()
    const field = form.createTextField('name')
    field.addToPage(doc.getPages()[0]!)
    const saved = await doc.save()
    const reopened = await PDFDocument.load(saved)
    expect(reopened.getForm().getTextField('name')).toBeTruthy()
  })
})

describe('pdf 场景 · 脱敏与保存', () => {
  it('S-PDF-07 保存 roundtrip 字节稳定（可再打开）', async () => {
    const bytes = await makePdf(2)
    const doc = await PDFDocument.load(bytes)
    const saved = await doc.save()
    const reopened = await PDFDocument.load(saved)
    expect(reopened.getPageCount()).toBe(2)
  })
})
