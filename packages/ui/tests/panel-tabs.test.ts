// @vitest-environment jsdom
/**
 * PanelTabs + AiPanelToggle tests: tab switching, persisted tab memory and
 * the top-row toggle button's open/closed states.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AiPanelToggle } from '../src/AiPanelToggle'
import { PanelTabs, usePanelTab, type PanelTabItem } from '../src/PanelTabs'

const TABS: PanelTabItem[] = [
  { id: 'chat', label: '对话' },
  { id: 'assistant', label: '助手' },
]

beforeEach(() => {
  localStorage.clear()
})

function mount(element: React.ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return { container, root }
}

describe('usePanelTab', () => {
  function Harness() {
    const [tab, select] = usePanelTab('test-tab', TABS)
    return createElement('button', { onClick: () => select('assistant') }, tab)
  }

  it('defaults to the first tab', () => {
    const { container, root } = mount(createElement(Harness))
    expect(container.querySelector('button')!.textContent).toBe('chat')
    act(() => root.unmount())
  })

  it('restores the persisted tab and persists changes', () => {
    localStorage.setItem('test-tab', 'assistant')
    const { container, root } = mount(createElement(Harness))
    expect(container.querySelector('button')!.textContent).toBe('assistant')

    localStorage.setItem('test-tab', 'chat')
    const { container: c2, root: r2 } = mount(createElement(Harness))
    act(() => c2.querySelector('button')!.click())
    expect(localStorage.getItem('test-tab')).toBe('assistant')
    act(() => r2.unmount())
    act(() => root.unmount())
  })

  it('falls back to the first tab when the stored id is unknown', () => {
    localStorage.setItem('test-tab', 'gone')
    const { container, root } = mount(createElement(Harness))
    expect(container.querySelector('button')!.textContent).toBe('chat')
    act(() => root.unmount())
  })
})

describe('PanelTabs', () => {
  it('renders the tabs and marks the active one', () => {
    const { container, root } = mount(
      createElement(PanelTabs, { tabs: TABS, activeId: 'assistant', onTabChange: () => {} }),
    )
    const tabs = container.querySelectorAll<HTMLButtonElement>('.ai-tab')
    expect(tabs.length).toBe(2)
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('false')
    expect(tabs[1]!.classList.contains('active')).toBe(true)
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true')
    expect(tabs[1]!.textContent).toBe('助手')
    act(() => root.unmount())
  })

  it('reports tab clicks', () => {
    const onTabChange = vi.fn()
    const { container, root } = mount(
      createElement(PanelTabs, { tabs: TABS, activeId: 'chat', onTabChange }),
    )
    act(() => container.querySelectorAll<HTMLButtonElement>('.ai-tab')[1]!.click())
    expect(onTabChange).toHaveBeenCalledWith('assistant')
    act(() => root.unmount())
  })

  it('places actions and chrome actions on the right and spreads dragProps', () => {
    const onPointerDown = vi.fn()
    const { container, root } = mount(
      createElement(PanelTabs, {
        tabs: TABS,
        activeId: 'chat',
        onTabChange: () => {},
        actions: createElement('span', { className: 'app-action' }),
        chromeActions: createElement('span', { className: 'chrome-action' }),
        dragProps: { onPointerDown },
      }),
    )
    const actions = container.querySelector('.ai-tab-header-actions')!
    expect(actions.querySelector('.app-action')).not.toBeNull()
    expect(actions.querySelector('.chrome-action')).not.toBeNull()

    const header = container.querySelector('.ai-tab-header') as HTMLElement
    act(() => {
      header.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    })
    expect(onPointerDown).toHaveBeenCalled()
    act(() => root.unmount())
  })
})

describe('AiPanelToggle', () => {
  it('toggles and reflects the open state', () => {
    const onToggle = vi.fn()
    const { container, root } = mount(
      createElement(AiPanelToggle, { open: false, onToggle, label: 'AI 助手' }),
    )
    const btn = container.querySelector<HTMLButtonElement>('.ai-panel-toggle')!
    expect(btn.classList.contains('active')).toBe(false)
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(btn.getAttribute('aria-label')).toBe('AI 助手')

    act(() => btn.click())
    expect(onToggle).toHaveBeenCalledTimes(1)

    act(() => root.render(createElement(AiPanelToggle, { open: true, onToggle, label: 'AI 助手' })))
    const active = container.querySelector<HTMLButtonElement>('.ai-panel-toggle')!
    expect(active.classList.contains('active')).toBe(true)
    expect(active.getAttribute('aria-pressed')).toBe('true')
    act(() => root.unmount())
  })
})

// ── LOCAL(2026-09-21, d8201ad0): 多会话扩展——✕ 不切 tab、running 圆点、onClose 行为 ──

describe('PanelTabs conversation extensions', () => {
  it('clicking ✕ does not switch the tab and calls onClose', () => {
    const onClose = vi.fn()
    const onTabChange = vi.fn()
    const { container, root } = mount(
      createElement(PanelTabs, {
        tabs: [
          { id: 'conv1', label: '会话', onClose },
          { id: 'assistant', label: '助手' },
        ],
        activeId: 'conv1',
        onTabChange,
      }),
    )
    const closeBtn = container.querySelector('.ai-tab-close') as HTMLElement
    expect(closeBtn).toBeTruthy()
    act(() => closeBtn.click())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onTabChange).not.toHaveBeenCalled()
    act(() => root.unmount())
  })

  it('renders a running dot only for running tabs', () => {
    const { container, root } = mount(
      createElement(PanelTabs, {
        tabs: [
          { id: 'conv1', label: '会话', running: true },
          { id: 'conv2', label: '会话2' },
        ],
        activeId: 'conv2',
        onTabChange: () => {},
      }),
    )
    expect(container.querySelectorAll('.ai-tab-dot')).toHaveLength(1)
    expect(container.querySelector('.ai-tab-running')).toBeTruthy()
    act(() => root.unmount())
  })

  it('a tab without onClose renders no ✕', () => {
    const { container, root } = mount(
      createElement(PanelTabs, {
        tabs: [{ id: 'assistant', label: '助手' }],
        activeId: 'assistant',
        onTabChange: () => {},
      }),
    )
    expect(container.querySelector('.ai-tab-close')).toBeNull()
    act(() => root.unmount())
  })
})
