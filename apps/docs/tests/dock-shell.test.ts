// DockShell interaction tests (jsdom): layout menu, maximize/Esc, collapse,
// header tear-off drags and snap-to-edge — the behaviors the unit tests in
// packages/ui can't cover (they only exercise the pure geometry math).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DockShell, type DockChrome } from '@chatoffice/ui'

const LABELS = {
  panelTitle: 'AI 助手',
  layoutMenu: 'Panel layout',
  dockLeft: 'Dock left',
  dockRight: 'Dock right',
  dockBottom: 'Dock bottom',
  float: 'Floating',
  maximize: 'Maximize',
  restore: 'Restore',
  collapse: 'Collapse',
}

function StubPanel({ chrome }: { chrome: DockChrome }) {
  return createElement(
    'div',
    { className: 'stub-panel' },
    createElement(
      'div',
      { className: 'stub-header', ...chrome.dragProps },
      createElement('span', null, 'AI'),
      chrome.buttons,
    ),
    createElement('div', { className: 'stub-body' }, 'panel body'),
  )
}

const SHELL_RECT = {
  left: 0,
  top: 0,
  right: 1280,
  bottom: 800,
  width: 1280,
  height: 800,
  x: 0,
  y: 0,
  toJSON: () => ({}),
}

function mount(overrides: Record<string, unknown> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  const onOpenChange = vi.fn()
  act(() =>
    root.render(
      createElement(DockShell, {
        storageKey: 'test-dock-shell',
        open: true,
        onOpenChange,
        labels: LABELS,
        renderPanel: (chrome: DockChrome) => createElement(StubPanel, { chrome }),
        children: createElement('div', { className: 'editor-stub' }),
        ...overrides,
      }),
    ),
  )
  const shellEl = container.querySelector('.dockshell') as HTMLElement
  const panelEl = container.querySelector('.dockshell-panel') as HTMLElement
  // jsdom has no layout: fake a 1280×800 shell with a 360px left dock
  shellEl.getBoundingClientRect = () => SHELL_RECT as DOMRect
  panelEl.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 360,
      bottom: 800,
      width: 360,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
  return {
    container,
    shellEl,
    onOpenChange,
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function pointer(target: EventTarget, type: string, x: number, y: number) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        clientX: x,
        clientY: y,
        button: 0,
        // real drags carry buttons=1; a bare move (buttons=0) commits a
        // swallowed release — the helpers below always mean a held button
        buttons: type === 'pointerup' ? 0 : 1,
      }),
    )
  })
}

/** drag the panel header from its middle to (x, y) and release */
function tearDrag(container: HTMLElement, toX: number, toY: number) {
  const header = container.querySelector('.stub-header')!
  pointer(header, 'pointerdown', 180, 20)
  pointer(window, 'pointermove', toX, toY)
  pointer(window, 'pointerup', toX, toY)
}

beforeEach(() => {
  localStorage.clear()
  Element.prototype.scrollTo ??= () => {}
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

describe('DockShell', () => {
  it('switches layout through the header menu', () => {
    const { container, cleanup } = mount()
    expect(container.querySelector('.dockshell')!.classList.contains('pos-left')).toBe(true)

    act(() => container.querySelector<HTMLButtonElement>('.dockshell-btn')!.click())
    const items = container.querySelectorAll<HTMLButtonElement>('.dockshell-menu-item')
    expect(items.length).toBe(4)

    act(() => items[1].click()) // dock right
    expect(container.querySelector('.dockshell')!.classList.contains('pos-right')).toBe(true)
    expect(JSON.parse(localStorage.getItem('test-dock-shell')!).position).toBe('right')

    act(() => container.querySelector<HTMLButtonElement>('.dockshell-btn')!.click())
    act(() => container.querySelectorAll<HTMLButtonElement>('.dockshell-menu-item')[2].click())
    expect(container.querySelector('.dockshell')!.classList.contains('pos-bottom')).toBe(true)
    cleanup()
  })

  it('maximizes over the content and restores with Esc', () => {
    const { container, cleanup } = mount()
    const maxBtn = container.querySelectorAll<HTMLButtonElement>('.dockshell-btn')[1]
    act(() => maxBtn.click())
    expect(container.querySelector('.dockshell')!.classList.contains('is-max')).toBe(true)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(container.querySelector('.dockshell')!.classList.contains('is-max')).toBe(false)
    cleanup()
  })

  it('collapses via the header button and the divider double-click', () => {
    const { container, onOpenChange, cleanup } = mount()
    const collapseBtn = container.querySelectorAll<HTMLButtonElement>('.dockshell-btn')[2]
    act(() => collapseBtn.click())
    expect(onOpenChange).toHaveBeenCalledWith(false)

    act(() =>
      container
        .querySelector('.dockshell-resizer')!
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
    )
    expect(onOpenChange).toHaveBeenCalledTimes(2)
    cleanup()
  })

  it('hides everything when collapsed (the top-row bubble icon reopens it)', () => {
    const { container, cleanup } = mount({ open: false })
    expect(container.querySelector('.dockshell-rail')).toBeNull()
    expect(container.querySelector('.dockshell')!.classList.contains('is-closed')).toBe(true)
    expect(container.querySelector('.dockshell-panel')).not.toBeNull() // still mounted
    cleanup()
  })

  it('tears off to a floating window when dropped mid-shell', () => {
    const { container, cleanup } = mount()
    tearDrag(container, 640, 400)
    expect(container.querySelector('.dockshell')!.classList.contains('pos-float')).toBe(true)
    const saved = JSON.parse(localStorage.getItem('test-dock-shell')!)
    expect(saved.position).toBe('float')
    expect(saved.floatRect.width).toBe(480) // tear adopts float geometry (consensus A)
    cleanup()
  })

  it('snaps to the right edge', () => {
    const { container, cleanup } = mount()
    const header = container.querySelector('.stub-header')!
    pointer(header, 'pointerdown', 180, 20)
    pointer(window, 'pointermove', 1270, 400)
    expect(container.querySelector('.dockshell-snap-right')).not.toBeNull()
    pointer(window, 'pointerup', 1270, 400)
    expect(container.querySelector('.dockshell')!.classList.contains('pos-right')).toBe(true)
    cleanup()
  })

  it('snaps to the bottom edge', () => {
    const { container, cleanup } = mount()
    tearDrag(container, 640, 790)
    expect(container.querySelector('.dockshell')!.classList.contains('pos-bottom')).toBe(true)
    cleanup()
  })

  it('drops back on the same edge without changing layout', () => {
    const { container, cleanup } = mount()
    tearDrag(container, 10, 400)
    expect(container.querySelector('.dockshell')!.classList.contains('pos-left')).toBe(true)
    cleanup()
  })

  it('restores the persisted layout on remount', () => {
    localStorage.setItem(
      'test-dock-shell',
      JSON.stringify({ position: 'bottom', bottomHeight: 300, maximized: false }),
    )
    const { container, cleanup } = mount()
    expect(container.querySelector('.dockshell')!.classList.contains('pos-bottom')).toBe(true)
    expect(
      (container.querySelector('.dockshell') as HTMLElement).style.getPropertyValue('--dock-size'),
    ).toBe('300px')
    cleanup()
  })
})
