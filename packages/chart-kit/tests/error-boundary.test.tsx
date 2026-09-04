// @vitest-environment jsdom
// 错误边界:子组件渲染/effect 崩溃 → 显示降级占位而不是冒泡卸载整树(白屏)。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { ChartErrorBoundary } from '../src/designer/ChartErrorBoundary'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function mount(ui: React.ReactNode): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => {
    root.render(ui)
  })
  return host
}
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

function Bomb({ throwInEffect }: { throwInEffect?: boolean }): null {
  if (!throwInEffect) throw new Error('render boom')
  return null
}

// effect 阶段抛错(对应 EchartsPreview 内部故障形态)
import { useEffect } from 'react'
function EffectBomb(): null {
  useEffect(() => {
    throw new Error('effect boom')
  }, [])
  return null
}

describe('ChartErrorBoundary', () => {
  it('渲染崩溃 → 显示降级占位(含 label)', async () => {
    const host = mount(
      <ChartErrorBoundary label="旭日图">
        <Bomb />
      </ChartErrorBoundary>,
    )
    await flush()
    expect(host.textContent).toContain('旭日图')
    expect(host.textContent).toContain('图表渲染失败')
  })

  it('effect 崩溃同样被边界捕获(React 19 白屏场景)', async () => {
    const host = mount(
      <ChartErrorBoundary>
        <EffectBomb />
      </ChartErrorBoundary>,
    )
    await flush()
    expect(host.textContent).toContain('图表渲染失败')
  })

  it('无崩溃时正常渲染子树', async () => {
    const host = mount(
      <ChartErrorBoundary label="x">
        <div data-testid="ok">fine</div>
      </ChartErrorBoundary>,
    )
    await flush()
    expect(host.querySelector('[data-testid="ok"]')?.textContent).toBe('fine')
  })
})
