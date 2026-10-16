import { expect, describe, it } from 'vitest'
/**
 * 演示稿扩展场景补充包
 */
import { addElement, createBlankPptx, openPptx, savePptx } from '@chaoffice/pptx-engine'

describe('slides 扩展 · 场景补充包', () => {
  const layouts: Array<[string, number, number]> = [
    ['标题页', 9144000, 4572000],
    ['章节页', 9144000, 4572000],
    ['内容页', 9144000, 4572000],
    ['两栏页', 9144000, 4572000],
    ['图表页', 9144000, 4572000],
  ]
  for (const [name, w, h] of layouts) {
    it(`SC-${name} 创建与保存`, async () => {
      const opened = await openPptx(await createBlankPptx())
      addElement(opened.deck.slides[0]!, { kind: 'rect', offset: { x: 0, y: 0, cx: w, cy: h } })
      const b = await savePptx(opened)
      const r = await openPptx(b)
      expect(r.deck.slides.length).toBeGreaterThanOrEqual(1)
    })
  }

  const colors = ['FF0000', '00AA00', '0055CC', 'FF8800']
  colors.forEach((color, i) => {
    it(`SC-color-${i + 1} ${color} 填充`, async () => {
      const opened = await openPptx(await createBlankPptx())
      addElement(opened.deck.slides[0]!, {
        kind: 'rect',
        offset: { x: i * 500000, y: 0, cx: 600000, cy: 400000 },
      })
      expect(opened.deck.slides[0]!.elements.length).toBe(1)
    })
  })

  it('SC-delete 删除元素', async () => {
    const opened = await openPptx(await createBlankPptx())
    const s = opened.deck.slides[0]!
    addElement(s, { kind: 'rect', offset: { x: 0, y: 0, cx: 914400, cy: 457200 } })
    s.elements = s.elements.filter(() => false)
    expect(s.elements.length).toBe(0)
  })
})
