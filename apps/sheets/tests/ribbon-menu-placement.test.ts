// placeDrop/placeSubmenu：右键菜单式放置——视口翻转与钳制（用户 2026-09-11
// 裁定：菜单贴哪个钮打开由位置决定左右/上下，子菜单同规则可无限级）。
import { describe, expect, it } from 'vitest'
import { placeDrop, placeSubmenu } from '../src/renderer/ribbon-menu'

const vw = 1920
const vh = 1080

describe('placeDrop（按钮下拉面板）', () => {
  it('常态：锚点下方左对齐', () => {
    const p = placeDrop({ x: 200, y: 40, w: 60, h: 56 }, { w: 168, h: 300 }, vw, vh)
    expect(p).toEqual({ left: 200, top: 100, maxHeight: null })
  })

  it('右缘出界：右对齐锚点且钳回视口内', () => {
    // 锚点右缘 1930 越过视口，右对齐后仍出界 → 再钳到 vw-8-168
    const p = placeDrop({ x: 1910, y: 40, w: 20, h: 56 }, { w: 168, h: 300 }, vw, vh)
    expect(p.left).toBe(vw - 8 - 168)
    expect(p.left + 168).toBeLessThanOrEqual(vw)
  })

  it('下缘出界：翻到锚点上方', () => {
    const p = placeDrop({ x: 200, y: vh - 200, w: 60, h: 56 }, { w: 168, h: 300 }, vw, vh)
    expect(p.top).toBe(vh - 200 - 300 - 4)
    expect(p.top).toBeGreaterThanOrEqual(8)
  })

  it('上下都放不下：钳到视口内并给出内部滚动上限', () => {
    const p = placeDrop({ x: 200, y: 500, w: 60, h: 56 }, { w: 168, h: vh }, vw, vh)
    expect(p.top).toBe(8)
    expect(p.maxHeight).toBe(vh - 16)
  })
})

describe('placeSubmenu（无限级子菜单）', () => {
  it('常态：宿主行右侧外 2px、顶对齐 -5', () => {
    const p = placeSubmenu({ x: 200, y: 300, w: 150, h: 26 }, { w: 168, h: 200 }, vw, vh)
    expect(p).toEqual({ left: 352, top: 295, maxHeight: null })
  })

  it('右缘出界：翻到宿主行左侧', () => {
    const p = placeSubmenu({ x: vw - 100, y: 300, w: 90, h: 26 }, { w: 168, h: 200 }, vw, vh)
    expect(p.left).toBe(vw - 100 - 168 - 2)
    expect(p.left + 168).toBeLessThanOrEqual(vw)
  })

  it('纵向钳制：行贴近视口底时子菜单收进视口', () => {
    const p = placeSubmenu({ x: 200, y: vh - 60, w: 150, h: 26 }, { w: 168, h: 300 }, vw, vh)
    expect(p.top).toBe(vh - 8 - 300)
    expect(p.maxHeight).toBeNull()
  })

  it('上下都放不下：钳顶并给内部滚动上限', () => {
    const p = placeSubmenu({ x: 200, y: 500, w: 150, h: 26 }, { w: 168, h: vh }, vw, vh)
    expect(p.top).toBe(8)
    expect(p.maxHeight).toBe(vh - 16)
  })
})
