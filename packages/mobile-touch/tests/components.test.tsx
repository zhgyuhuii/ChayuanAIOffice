// @vitest-environment jsdom
// The overlay/handle components: selection handle dragging reports absolute
// positions and ends cleanly; the floating toolbar clamps into the viewport
// after measuring itself; the editor overlay commits on Enter/blur, cancels
// on Escape, and never double-settles.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectionHandles } from '../src/handles/selection-handles'
import { EditorOverlay } from '../src/overlay/editor-overlay'
import { FloatingToolbar } from '../src/overlay/floating-toolbar'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn()
})

function mount(element: ReturnType<typeof createElement>): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  cleanups.push(() => root.unmount())
  act(() => {
    root.render(element)
  })
  return host
}

function pointerEvent(type: string, x: number, y: number): Event {
  // bubbles: React delegates synthetic handlers at the root container
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { pointerId: 1, clientX: x, clientY: y })
  return event
}

describe('SelectionHandles', () => {
  const base = { start: { x: 20, y: 30 }, end: { x: 200, y: 40 } }

  it('hides entirely when not visible', () => {
    const host = mount(
      createElement(SelectionHandles, { ...base, visible: false, onDragHandle: () => {} }),
    )
    expect(host.querySelector('.mth-handles')).toBeNull()
  })

  it('renders both handles at their anchor points', () => {
    const host = mount(
      createElement(SelectionHandles, { ...base, visible: true, onDragHandle: () => {} }),
    )
    const start = host.querySelector<HTMLElement>('.mth-handle-start')!
    const end = host.querySelector<HTMLElement>('.mth-handle-end')!
    expect(start.style.left).toBe('20px')
    expect(end.style.top).toBe('40px')
  })

  it('reports drag positions for the grabbed handle and fires dragEnd on lift', () => {
    const onDragHandle = vi.fn()
    const onDragEnd = vi.fn()
    const host = mount(
      createElement(SelectionHandles, { ...base, visible: true, onDragHandle, onDragEnd }),
    )
    const end = host.querySelector<HTMLElement>('.mth-handle-end')!
    act(() => {
      end.dispatchEvent(pointerEvent('pointerdown', 200, 40))
      end.dispatchEvent(pointerEvent('pointermove', 220, 55))
      end.dispatchEvent(pointerEvent('pointerup', 220, 55))
      end.dispatchEvent(pointerEvent('pointermove', 300, 300)) // after lift: ignored
    })
    expect(onDragHandle).toHaveBeenCalledWith('end', { x: 220, y: 55 })
    expect(onDragHandle).toHaveBeenCalledTimes(1)
    expect(onDragEnd).toHaveBeenCalledTimes(1)
  })
})

describe('FloatingToolbar', () => {
  it('hides on a null anchor', () => {
    const host = mount(createElement(FloatingToolbar, { anchor: null }, 'x'))
    expect(host.querySelector('.mth-toolbar')).toBeNull()
  })

  it('renders children anchored above the point, clamped into the viewport', () => {
    // jsdom viewport is 1024x768 and the toolbar measures 0px, so the clamp
    // margins are what the assertions observe
    const host = mount(
      createElement(FloatingToolbar, { anchor: { x: 2, y: 40 }, placement: 'above' }, 'tools'),
    )
    const toolbar = host.querySelector<HTMLElement>('.mth-toolbar-above')!
    expect(toolbar.textContent).toBe('tools')
    expect(toolbar.style.left).toBe('8px') // 2 - 0 clamped to the margin
    expect(toolbar.style.top).toBe('40px') // above: y - height(0)
  })

  it('places below when asked and clamps a far-out anchor', () => {
    const host = mount(
      createElement(FloatingToolbar, { anchor: { x: 5000, y: 5000 }, placement: 'below' }, 'x'),
    )
    const toolbar = host.querySelector<HTMLElement>('.mth-toolbar-below')!
    expect(toolbar.style.left).toBe('1016px') // 1024 - margin(8)
    expect(toolbar.style.top).toBe('760px') // 768 - margin(8)
  })
})

describe('EditorOverlay', () => {
  function typeInto(textarea: HTMLTextAreaElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )!.set!
    setter.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function key(textarea: HTMLTextAreaElement, key: string, shift = false): void {
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true }),
    )
  }

  it('mirrors the target rect and starts with the initial value', () => {
    const host = mount(
      createElement(EditorOverlay, {
        rect: { x: 12, y: 34, width: 100, height: 24 },
        initialValue: 'cell',
        onCommit: () => {},
        onCancel: () => {},
      }),
    )
    const area = host.querySelector<HTMLTextAreaElement>('.mth-editor-overlay')!
    expect(area.value).toBe('cell')
    expect(area.style.left).toBe('12px')
    expect(area.style.width).toBe('100px')
  })

  it('commits on Enter for single-line targets and never double-settles', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    const host = mount(
      createElement(EditorOverlay, {
        rect: { x: 0, y: 0, width: 10, height: 10 },
        initialValue: 'a',
        onCommit,
        onCancel,
      }),
    )
    const area = host.querySelector<HTMLTextAreaElement>('.mth-editor-overlay')!
    act(() => {
      typeInto(area, 'edited')
      key(area, 'Enter')
    })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('edited')
    act(() => {
      area.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) // blur after Enter
    })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('keeps Enter as a newline for multiline targets and commits on click-away', () => {
    const onCommit = vi.fn()
    const host = mount(
      createElement(EditorOverlay, {
        rect: { x: 0, y: 0, width: 10, height: 10 },
        initialValue: '',
        multiline: true,
        onCommit,
        onCancel: () => {},
      }),
    )
    const area = host.querySelector<HTMLTextAreaElement>('.mth-editor-overlay')!
    act(() => {
      key(area, 'Enter')
    })
    expect(onCommit).not.toHaveBeenCalled()
    act(() => {
      typeInto(area, 'line')
      area.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(onCommit).toHaveBeenCalledWith('line')
  })

  it('cancels on Escape', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    const host = mount(
      createElement(EditorOverlay, {
        rect: { x: 0, y: 0, width: 10, height: 10 },
        initialValue: 'x',
        onCommit,
        onCancel,
      }),
    )
    const area = host.querySelector<HTMLTextAreaElement>('.mth-editor-overlay')!
    act(() => {
      key(area, 'Escape')
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })
})
