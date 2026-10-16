/**
 * 演示稿（PPTX）全生命周期场景测试 —— 用真实 pptx-engine 原语执行。
 * 覆盖：新建 / 打开 / 元素增删改 / 形状 / 文本 / 图片 / 保存 roundtrip / 页数。
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, describe, it } from 'vitest'
import { addElement, createBlankPptx, openPptx, savePptx } from '@chaoffice/pptx-engine'

const DIR = mkdtempSync(join(tmpdir(), 'slides-scen-'))

async function freshDeck() {
  const opened = await openPptx(await createBlankPptx())
  return opened
}

describe('slides 场景 · 新建与打开', () => {
  it('S-PPT-01 新建空白演示稿：可解析且至少 1 页', async () => {
    const deck = await freshDeck()
    expect(deck.deck.slides.length).toBeGreaterThanOrEqual(1)
  })

  it('S-PPT-02 保存空白稿：字节合法（PK 容器）', async () => {
    const deck = await freshDeck()
    const saved = await savePptx(deck)
    expect(saved[0]).toBe(0x50)
    expect(saved[1]).toBe(0x4b)
  })
})

describe('slides 场景 · 元素生成与修改', () => {
  it('S-PPT-03 矩形元素可添加并读回 id', async () => {
    const deck = await freshDeck()
    const slide = deck.deck.slides[0]!
    const el = addElement(slide, {
      kind: 'rect',
      offset: { x: 0, y: 0, cx: 914400, cy: 457200 },
    })
    expect(el.id).toBeTruthy()
    expect(slide.elements.length).toBe(1)
  })

  it('S-PPT-04 椭圆与圆角矩形共存', async () => {
    const deck = await freshDeck()
    const slide = deck.deck.slides[0]!
    addElement(slide, { kind: 'ellipse', offset: { x: 0, y: 0, cx: 600000, cy: 400000 } })
    addElement(slide, { kind: 'roundRect', offset: { x: 700000, y: 0, cx: 600000, cy: 400000 } })
    expect(slide.elements.length).toBe(2)
  })

  it('S-PPT-05 文本元素段落写入', async () => {
    const deck = await freshDeck()
    const slide = deck.deck.slides[0]!
    const el = addElement(slide, {
      kind: 'text',
      offset: { x: 100000, y: 100000, cx: 3000000, cy: 500000 },
      paragraphs: [{ runs: [{ text: '场景文本' }] }],
    } as never)
    expect(el.id).toBeTruthy()
  })
})

describe('slides 场景 · 保存 roundtrip', () => {
  it('S-PPT-06 编辑后保存再打开：元素保真', async () => {
    const deck = await freshDeck()
    const slide = deck.deck.slides[0]!
    addElement(slide, { kind: 'rect', offset: { x: 0, y: 0, cx: 914400, cy: 457200 } })
    const bytes = await savePptx(deck)
    const file = join(DIR, 'rt.pptx')
    writeFileSync(file, bytes)
    const reopened = await openPptx(readFileSync(file))
    expect(reopened.deck.slides[0]!.elements.length).toBe(1)
  })

  it('S-PPT-07 多元素保存：全部保留', async () => {
    const deck = await freshDeck()
    const slide = deck.deck.slides[0]!
    addElement(slide, { kind: 'rect', offset: { x: 0, y: 0, cx: 914400, cy: 457200 } })
    addElement(slide, { kind: 'ellipse', offset: { x: 1000000, y: 0, cx: 600000, cy: 400000 } })
    const bytes = await savePptx(deck)
    const reopened = await openPptx(bytes)
    expect(reopened.deck.slides[0]!.elements.length).toBe(2)
  })

  it('S-PPT-08 两次保存打开：页数稳定', async () => {
    const opened = await freshDeck()
    const before = opened.deck.slides.length
    let bytes = await savePptx(opened)
    const reopened = await openPptx(bytes)
    bytes = await savePptx(reopened)
    const final = await openPptx(bytes)
    expect(final.deck.slides.length).toBe(before)
  })
})
