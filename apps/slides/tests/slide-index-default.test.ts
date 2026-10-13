/** slideIndex 缺省契约：元素/表格/批注等工具不再要求必传，缺省落到当前活动页。 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSlidesSkill, type DeckAccess } from '../src/renderer/ai/slides-skill'
import type { RenderSlide } from '@chatoffice/pptx-render'
import type { AgentToolCall } from '../src/shared/ipc'

// 带已有元素的页——空页会触发 blockScratchBuild 的 generate_deck 引导拦截（设计内）
// 带 3 个有文字的元素——blockScratchBuild 要求全稿带文字未锁定元素 >2 才放行
// 手工插入类工具（空稿会被引导去 generate_deck，设计内拦截）
const mkNode = (id: string, i: number) => ({
  id,
  sourceId: id,
  type: 'text',
  box: { x: 0, y: i * 20, w: 100, h: 20 },
  // 结构化文本模型（nodeText→textForModel 读 lines[].runs[]，非扁平字符串）；
  // text/shape 节点还须带 fill（nodeColors 读 fill.kind）
  text: { lines: [{ runs: [{ text: `既有内容 ${id}` }] }] },
  fill: { kind: 'none' },
})
const deck = {
  widthPx: 1280,
  heightPx: 720,
  nodes: [mkNode('tb0', 0), mkNode('tb1', 1), mkNode('tb2', 2)],
} as unknown as RenderSlide

function mkAccess(current: number): DeckAccess {
  return {
    getSlides: () => [deck, deck],
    getCurrent: () => current,
    getSelectedIds: () => [],
    applySlide: () => {},
    applyDeck: () => {},
    fitWidthPx: 1280,
    retryBackoffMs: 0,
  } as unknown as DeckAccess
}

const call = (name: string, input: Record<string, unknown>): AgentToolCall => ({
  id: 't',
  name,
  input,
})

beforeEach(() => {
  ;(window as unknown as { slidesApi: unknown }).slidesApi = {
    addElement: vi.fn(async () => ({ slide: deck, sourceId: 'new1' })),
  }
})
const api = () =>
  (window as unknown as { slidesApi: Record<string, ReturnType<typeof vi.fn>> }).slidesApi

describe('slideIndex 缺省 = 当前活动页', () => {
  it('add_text_box 不传 slideIndex 时落到当前页（getCurrent=1 → 第 2 页）', async () => {
    const r = await createSlidesSkill(mkAccess(1)).executeTool!(
      call('add_text_box', {
        x: 100,
        y: 100,
        w: 400,
        h: 80,
        paragraphs: [{ text: '验收' }],
      }),
    )
    expect(r.isError).toBeFalsy()
    expect(api().addElement).toHaveBeenCalledWith(
      expect.objectContaining({ slideIndex: 1 }),
    )
    expect(r.output).toContain('page 2')
  })

  it('显式传 slideIndex 行为不变（0 → 第 1 页）', async () => {
    await createSlidesSkill(mkAccess(1)).executeTool!(
      call('add_text_box', {
        slideIndex: 0,
        x: 100,
        y: 100,
        w: 400,
        h: 80,
        paragraphs: [{ text: '验收' }],
      }),
    )
    expect(api().addElement).toHaveBeenCalledWith(
      expect.objectContaining({ slideIndex: 0 }),
    )
  })

  it('所有原先必填 slideIndex 的工具 schema 均已放开', () => {
    const skill = createSlidesSkill(mkAccess(0))
    const tools = skill.tools as Array<{
      name: string
      inputSchema: { properties?: Record<string, unknown>; required?: string[] }
    }>
    const offenders = tools.filter(
      (t) =>
        t.inputSchema?.properties &&
        'slideIndex' in t.inputSchema.properties &&
        (t.inputSchema.required ?? []).includes('slideIndex'),
    )
    expect(offenders.map((t) => t.name)).toEqual([])
  })
})
