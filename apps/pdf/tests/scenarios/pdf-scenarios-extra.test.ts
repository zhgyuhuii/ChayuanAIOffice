/**
 * PDF 扩展场景补充包
 */
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

const make = async (pages: number): Promise<Uint8Array> => {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([595, 842])
  return doc.save()
}

describe('pdf 扩展 · 场景补充包', () => {
  const pageCounts = [1, 2, 5, 10]
  pageCounts.forEach((n) => {
    it(`SC-pages-${n} ${n} 页创建打开`, async () => {
      const doc = await PDFDocument.load(await make(n))
      expect(doc.getPageCount()).toBe(n)
    })
  })

  it('SC-form-text 文本字段 roundtrip', async () => {
    const doc = await PDFDocument.load(await make(1))
    const form = doc.getForm()
    const f = form.createTextField('sc-f1')
    f.addToPage(doc.getPages()[0]!)
    f.setText('hello')
    const saved = await doc.save()
    const r = await PDFDocument.load(saved)
    expect(r.getForm().getTextField('sc-f1').getText()).toBe('hello')
  })

  it('SC-meta-author 作者元数据可设置', async () => {
    const doc = await PDFDocument.create()
    doc.setProducer('ChaAI Office')
    doc.setAuthor('察元')
    const bytes = await doc.save()
    const r = await PDFDocument.load(bytes)
    // pdf-lib 底层可能自带 producer；仅断言非空
    expect(typeof r.getProducer()).toBe('string')
    expect(r.getAuthor()).toBe('察元')
  })
})
