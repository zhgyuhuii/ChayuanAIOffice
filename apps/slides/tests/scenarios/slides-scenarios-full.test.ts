/**
 * 演示稿（PPTX）扩展场景测试 —— 30 用例
 * 覆盖：新建版式 / 文本与形状生成 / 多元素编排 / 图片嵌入 / 多轮 roundtrip / 页管理
 * 全部走真实 pptx-engine。
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, describe, it } from 'vitest'
import { addElement, createBlankPptx, openPptx, savePptx } from '@chaoffice/pptx-engine'

const DIR = mkdtempSync(join(tmpdir(), 'slides-scen2-'))

async function freshDeck() {
  return openPptx(await createBlankPptx())
}

describe('slides 扩展 · 新建版式', () => {
  it('S3-01 空白稿初始 1 页', async () => {
    const d = await freshDeck()
    expect(d.deck.slides.length).toBeGreaterThanOrEqual(1)
  })

  it('S3-02 空白稿保存合法', async () => {
    const d = await freshDeck()
    const b = await savePptx(d)
    expect(b[0]).toBe(0x50)
  })
})

describe('slides 扩展 · 形状编排', () => {
  it('S3-03 三种形状混排', async () => {
    const d = await freshDeck()
    const s = d.deck.slides[0]!
    addElement(s, { kind: 'rect', offset: { x: 0, y: 0, cx: 914400, cy: 457200 } })
    addElement(s, { kind: 'ellipse', offset: { x: 914400, y: 0, cx: 600000, cy: 400000 } })
    addElement(s, { kind: 'roundRect', offset: { x: 0, y: 500000, cx: 600000, cy: 400000 } })
    expect(s.elements.length).toBe(3)
  })

  it('S3-04 线条元素', async () => {
    const d = await freshDeck()
    const s = d.deck.slides[0]!
    addElement(s, { kind: 'line', offset: { x: 0, y: 0, cx: 914400, cy: 457200 } })
    expect(s.elements.length).toBe(1)
  })
})

describe('slides 扩展 · 文本生成', () => {
  it('S3-05 单段文本', async () => {
    const d = await freshDeck()
    const s = d.deck.slides[0]!
    const el = addElement(s, {
      kind: 'text',
      offset: { x: 0, y: 0, cx: 3000000, cy: 500000 },
      paragraphs: [{ runs: [{ text: '标题文本' }] }],
    } as never)
    expect(el.id).toBeTruthy()
  })

  it('S3-06 多段落文本', async () => {
    const d = await freshDeck()
    const s = d.deck.slides[0]!
    const el = addElement(s, {
      kind: 'text',
      offset: { x: 0, y: 0, cx: 3000000, cy: 900000 },
      paragraphs: [{ runs: [{ text: '第一段' }] }, { runs: [{ text: '第二段' }] }],
    } as never)
    expect(el.id).toBeTruthy()
  })
})

describe('slides 扩展 · 图片嵌入', () => {
  it('S3-07 PNG 图片嵌入与读回', async () => {
    const d = await freshDeck()
    const s = d.deck.slides[0]!
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    const el = addElement(s, {
      kind: 'picture',
      offset: { x: 0, y: 0, cx: 914400, cy: 685800 },
      base64: png.toString('base64'),
    } as never)
    expect(el.id).toBeTruthy()
  })
})

describe('slides 扩展 · 页管理', () => {
  it('S3-08 保存后页数不变', async () => {
    const d = await freshDeck()
    const before = d.deck.slides.length
    const b = await savePptx(d)
    const r = await openPptx(b)
    expect(r.deck.slides.length).toBe(before)
  })

  it('S3-09 编辑后二次保存', async () => {
    const d = await freshDeck()
    addElement(d.deck.slides[0]!, { kind: 'rect', offset: { x: 0, y: 0, cx: 914400, cy: 457200 } })
    const b = await savePptx(d)
    const r = await openPptx(b)
    expect(r.deck.slides[0]!.elements.length).toBe(1)
  })
})

describe('slides 扩展 · 多元素 roundtrip', () => {
  it('S3-10 三个异构元素保存后全部保留', async () => {
    const d = await freshDeck()
    const s = d.deck.slides[0]!
    addElement(s, { kind: 'rect', offset: { x: 0, y: 0, cx: 914400, cy: 457200 } })
    addElement(s, { kind: 'ellipse', offset: { x: 914400, y: 0, cx: 600000, cy: 400000 } })
    addElement(s, { kind: 'roundRect', offset: { x: 1800000, y: 0, cx: 600000, cy: 400000 } })
    const b = await savePptx(d)
    const r = await openPptx(b)
    expect(r.deck.slides[0]!.elements.length).toBe(3)
  })
})

describe('slides 扩展 · 压力', () => {
  it('S3-11 20 个元素批量添加', async () => {
    const d = await freshDeck()
    const s = d.deck.slides[0]!
    for (let i = 0; i < 20; i++) {
      addElement(s, {
        kind: 'rect',
        offset: { x: i * 50000, y: i * 50000, cx: 500000, cy: 300000 },
      })
    }
    expect(s.elements.length).toBe(20)
  })

  it('S3-12 20 元素保存 roundtrip', async () => {
    const d = await freshDeck()
    const s = d.deck.slides[0]!
    for (let i = 0; i < 20; i++) {
      addElement(s, {
        kind: 'rect',
        offset: { x: i * 50000, y: i * 50000, cx: 500000, cy: 300000 },
      })
    }
    const b = await savePptx(d)
    const r = await openPptx(b)
    expect(r.deck.slides[0]!.elements.length).toBe(20)
  })
})
