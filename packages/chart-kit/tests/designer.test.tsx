// @vitest-environment jsdom
// 设计器模态:分组树/示例画廊/代码沙箱试跑/插入路由(ooxml vs echarts)。
// echarts 在 jsdom 无 canvas,mock 掉渲染层;代码执行走真实 Worker 沙箱。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChartDesignerModal, type ChartDesignerInsert } from '../src/designer/ChartDesignerModal'

vi.mock('echarts', () => {
  const instance = {
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    getDataURL: () => 'data:image/png;base64,ZmFrZQ==',
  }
  return { init: vi.fn(() => instance) }
})

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// jsdom 无 ResizeObserver(EchartsPreview 使用);桩掉,断言不涉及尺寸
;(globalThis as Record<string, unknown>).ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn()
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function mount(props: Parameters<typeof ChartDesignerModal>[0]): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  cleanups.push(() => root.unmount())
  act(() => {
    root.render(<ChartDesignerModal {...props} />)
  })
  return host
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('ChartDesignerModal', () => {
  it('双击回显(initial 带代码):自动试跑出预览,插入可用,编辑不丢', async () => {
    const code = "option = { series: [{ type: 'sunburst', data: [{ name: 'a', value: 1 }] }] };"
    const host = mount({
      onClose: () => {},
      onInsert: () => {},
      initial: { groupId: 'sunburst', code, title: '基础旭日图' },
    })
    await act(async () => {
      await sleep(400)
    })
    // 代码页带着原代码
    const codeArea = host.querySelector<HTMLTextAreaElement>('.ck-designer-code')
    expect(codeArea?.value).toContain('sunburst')
    // 预览自动出图(不点运行)→ 插入按钮亮
    const insertBtn = host.querySelector<HTMLButtonElement>('.ck-designer-footer .is-primary')
    expect(insertBtn?.disabled).toBe(false)
    // 画廊为竖向单列卡片布局
    const gallery = host.querySelector('.ck-designer-gallery')
    expect(gallery).toBeTruthy()
  })

  it('渲染 39 个分组,默认选中第一组且示例非空', async () => {
    const host = mount({ onClose: () => {}, onInsert: () => {} })
    const groups = host.querySelectorAll('.ck-designer-group')
    expect(groups.length).toBe(39)
    expect(host.querySelector('.ck-designer-group.is-active')?.textContent).toContain('折线图')
    // 默认组(line)示例自动试跑后画廊非空
    await act(async () => {
      await sleep(300)
    })
    expect(host.querySelectorAll('.ck-designer-card').length).toBeGreaterThan(0)
  })

  it('扩展组代码模式插入 → engine=echarts,带 optionJson 与快照', async () => {
    const inserts: ChartDesignerInsert[] = []
    const host = mount({ onClose: () => {}, onInsert: (p) => inserts.push(p) })
    // 切到旭日图组
    const sunburst = Array.from(host.querySelectorAll('.ck-designer-group')).find((b) =>
      b.textContent?.includes('旭日图'),
    )!
    await click(sunburst)
    await act(async () => {
      await sleep(400)
    })
    // 示例自动选中并试跑;切到代码页确保 insert 走 echarts 分支
    const codeTab = Array.from(host.querySelectorAll('.ck-designer-tabs > button')).find(
      (b) => b.textContent === '代码',
    )!
    await click(codeTab)
    const insertBtn = host.querySelector<HTMLButtonElement>('.ck-designer-footer .is-primary')!
    expect(insertBtn.disabled).toBe(false)
    await act(async () => {
      insertBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(200)
    })
    expect(inserts).toHaveLength(1)
    expect(inserts[0].engine).toBe('echarts')
    expect(inserts[0].groupId).toBe('sunburst')
    expect(inserts[0].optionJson).toContain('series')
    expect(inserts[0].snapshotPng).toMatch(/^data:image\/png/)
    expect(inserts[0].code).toBeTruthy()
  })

  it('标准组(bar)数据模式插入 → engine=ooxml,带受限 ChartSpec', async () => {
    const inserts: ChartDesignerInsert[] = []
    const host = mount({ onClose: () => {}, onInsert: (p) => inserts.push(p) })
    const bar = Array.from(host.querySelectorAll('.ck-designer-group')).find((b) =>
      b.textContent?.includes('柱状图'),
    )!
    await click(bar)
    await act(async () => {
      await sleep(400)
    })
    // bar-simple 可提取表格;组切换默认落在数据页
    const rows = host.querySelectorAll('.ck-designer-table tbody tr')
    expect(rows.length).toBeGreaterThan(0)
    const insertBtn = host.querySelector<HTMLButtonElement>('.ck-designer-footer .is-primary')!
    expect(insertBtn.disabled).toBe(false)
    await act(async () => {
      insertBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(100)
    })
    expect(inserts).toHaveLength(1)
    expect(inserts[0].engine).toBe('ooxml')
    expect(inserts[0].spec?.type).toBe('bar')
    expect(inserts[0].spec?.data?.series.length).toBeGreaterThan(0)
    expect(inserts[0].snapshotPng).toBeUndefined()
  })
})
