// @vitest-environment jsdom
/**
 * DockShell ghost-drag tests: tearing adopts float geometry, the layout class
 * freezes during the drag (editor never reflows mid-gesture), the snap
 * preview stays above the carried panel, negative edge distances still arm
 * (pressing past an edge must not disarm it), and the drop commits.
 * Swallowed-release recovery is covered too: a bare pointermove (buttons=0)
 * or a window blur mid-drag commits the armed snap / carried rect instead of
 * discarding the drag, and a late pointerup never double-commits.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DockShell, type DockChrome } from '../src/DockShell'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  }
  // jsdom lacks ResizeObserver (DockShell re-clamps on shell resize)
  ;(globalThis as Record<string, unknown>).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})

const SHELL = { left: 0, top: 0, width: 1280, height: 800 }

let host: HTMLDivElement
let root: Root | null = null

function renderDock(): void {
  act(() => {
    root!.render(
      createElement(DockShell, {
        storageKey: 'test-dock-drag',
        open: true,
        onOpenChange: () => {},
        labels: {
          panelTitle: 'AI',
          dockLeft: 'left',
          dockRight: 'right',
          dockBottom: 'bottom',
          float: 'float',
          maximize: 'max',
          restore: 'restore',
          collapse: 'close',
          layoutMenu: 'layout',
        },
        renderPanel: (chrome: DockChrome) =>
          createElement('div', { ...chrome.dragProps, 'data-header': '' }, 'panel'),
        children: createElement('div', { className: 'editor-stub' }),
      }),
    )
  })
}

function realRects(): void {
  const rootEl = host.querySelector('.dockshell') as HTMLElement
  const panelEl = host.querySelector('.dockshell-panel') as HTMLElement
  rootEl.getBoundingClientRect = () =>
    ({
      left: SHELL.left,
      top: SHELL.top,
      width: SHELL.width,
      height: SHELL.height,
      right: 1280,
      bottom: 800,
      x: 0,
      y: 0,
    }) as DOMRect
  panelEl.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 360, height: 800, right: 360, bottom: 800, x: 0, y: 0 }) as DOMRect
}

function press(x: number, y: number): void {
  act(() => {
    ;(host.querySelector('[data-header]') as HTMLElement).dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y }),
    )
  })
}

function move(x: number, y: number, buttons = 1): void {
  act(() => {
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, buttons }))
  })
}

function release(): void {
  act(() => {
    window.dispatchEvent(new MouseEvent('pointerup'))
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

describe('DockShell ghost drag', () => {
  it('tears off into float geometry while the layout class freezes', () => {
    renderDock()
    realRects()
    // grab the header mid-strip and carry the panel to the shell center
    press(120, 24)
    move(640, 400)
    const rootEl = host.querySelector('.dockshell') as HTMLElement
    expect(rootEl.classList.contains('is-tearing')).toBe(true)
    // frozen at the resting position — no live relayout to pos-float/pos-snap
    expect(rootEl.classList.contains('pos-left')).toBe(true)
    expect(rootEl.classList.contains('pos-float')).toBe(false)
    // the docked strip is reserved by a placeholder so the editor holds layout
    expect(host.querySelector('.dockshell-slot')).toBeTruthy()
    // the carried rect uses FLOAT geometry (default 480×560), not the 360×800 strip
    expect(rootEl.style.getPropertyValue('--dock-w')).toBe('480px')
    expect(rootEl.style.getPropertyValue('--dock-h')).toBe('560px')
    move(640, 400)
    release()
  })

  it('arms the bottom zone near the edge and docks on release', () => {
    renderDock()
    realRects()
    press(120, 24)
    move(640, 400)
    move(640, 776) // 24px from the bottom edge
    const rootEl = host.querySelector('.dockshell') as HTMLElement
    expect(rootEl.classList.contains('is-tearing')).toBe(true)
    expect(rootEl.classList.contains('pos-left')).toBe(true) // still frozen
    expect(host.querySelector('.dockshell-snap-bottom')).toBeTruthy()
    release()
    const after = host.querySelector('.dockshell') as HTMLElement
    expect(after.classList.contains('pos-bottom')).toBe(true)
    expect(after.classList.contains('is-tearing')).toBe(false)
    expect(JSON.parse(store.get('test-dock-drag')!).position).toBe('bottom')
  })

  it('keeps the edge armed when the pointer pushes past it (negative distance)', () => {
    renderDock()
    realRects()
    press(120, 24)
    move(640, 830) // 30px BELOW the shell bottom (web form: pointer below the iframe)
    expect(host.querySelector('.dockshell-snap-bottom')).toBeTruthy()
    release()
    expect((host.querySelector('.dockshell') as HTMLElement).classList.contains('pos-bottom')).toBe(
      true,
    )
  })

  it('drops to float at the center with the carried rect persisted', () => {
    renderDock()
    realRects()
    press(120, 24)
    move(640, 400)
    expect(host.querySelector('.dockshell-snap')).toBeNull()
    release()
    const saved = JSON.parse(store.get('test-dock-drag')!)
    expect(saved.position).toBe('float')
    expect(saved.floatRect).toMatchObject({ width: 480, height: 560 })
  })

  it('commits the armed edge when the release was swallowed (bare move, buttons=0)', () => {
    renderDock()
    realRects()
    press(120, 24)
    move(640, 400)
    move(640, 776) // bottom zone armed
    expect(host.querySelector('.dockshell-snap-bottom')).toBeTruthy()
    // native chrome (resize border / taskbar) ate the pointerup; the next
    // pointermove arrives with buttons=0 — that move IS the drop
    move(640, 776, 0)
    const after = host.querySelector('.dockshell') as HTMLElement
    expect(after.classList.contains('pos-bottom')).toBe(true)
    expect(after.classList.contains('is-tearing')).toBe(false)
    expect(JSON.parse(store.get('test-dock-drag')!).position).toBe('bottom')
    // a late real pointerup must not double-commit
    release()
    expect((host.querySelector('.dockshell') as HTMLElement).classList.contains('pos-bottom')).toBe(
      true,
    )
  })

  it('commits the carried rect when the swallowed release drops mid-shell', () => {
    renderDock()
    realRects()
    press(120, 24)
    move(640, 400)
    move(640, 420, 0) // bare move = swallowed release, no snap armed
    const after = host.querySelector('.dockshell') as HTMLElement
    expect(after.classList.contains('pos-float')).toBe(true)
    const saved = JSON.parse(store.get('test-dock-drag')!)
    expect(saved.position).toBe('float')
    expect(saved.floatRect).toMatchObject({ width: 480, height: 560 })
  })

  it('commits the armed edge on window blur instead of discarding the drag', () => {
    renderDock()
    realRects()
    press(120, 24)
    move(640, 776) // bottom armed
    act(() => {
      window.dispatchEvent(new window.Event('blur'))
    })
    const after = host.querySelector('.dockshell') as HTMLElement
    expect(after.classList.contains('is-tearing')).toBe(false)
    expect(after.classList.contains('pos-bottom')).toBe(true)
    expect(JSON.parse(store.get('test-dock-drag')!).position).toBe('bottom')
    release() // late pointerup: no double-commit
    expect((host.querySelector('.dockshell') as HTMLElement).classList.contains('pos-bottom')).toBe(
      true,
    )
  })

  it('still aborts cleanly on Escape mid-drag', () => {
    renderDock()
    realRects()
    press(120, 24)
    move(640, 776) // bottom armed
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(host.querySelector('.dockshell')!.classList.contains('is-tearing')).toBe(false)
    release()
    const saved = JSON.parse(store.get('test-dock-drag')!)
    expect(saved.position).toBe('left') // aborted: nothing committed
  })
})

describe('DockShell drag out of maximized', () => {
  it('a maximized panel tears off and the drop un-maximizes into a float', () => {
    store.set('test-dock-drag', JSON.stringify({ position: 'left', maximized: true }))
    renderDock()
    realRects()
    const rootEl = host.querySelector('.dockshell') as HTMLElement
    expect(rootEl.classList.contains('is-max')).toBe(true)
    press(120, 24)
    move(640, 400)
    expect(rootEl.classList.contains('is-tearing')).toBe(true)
    // still maximized mid-gesture — the drop is what un-maximizes
    expect(rootEl.classList.contains('is-max')).toBe(true)
    // the maximized panel was never in flow: no docked-strip placeholder,
    // else the editor would shrink mid-drag
    expect(host.querySelector('.dockshell-slot')).toBeNull()
    // the ghost adopts float geometry, not the fullscreen box
    expect(rootEl.style.getPropertyValue('--dock-w')).toBe('480px')
    release()
    const after = host.querySelector('.dockshell') as HTMLElement
    expect(after.classList.contains('pos-float')).toBe(true)
    expect(after.classList.contains('is-max')).toBe(false)
    const saved = JSON.parse(store.get('test-dock-drag')!)
    expect(saved.position).toBe('float')
    expect(saved.maximized).toBe(false)
  })

  it('a maximized panel snaps into an edge slot on drop', () => {
    store.set('test-dock-drag', JSON.stringify({ position: 'left', maximized: true }))
    renderDock()
    realRects()
    press(120, 24)
    move(640, 776) // bottom zone armed
    expect(host.querySelector('.dockshell-snap-bottom')).toBeTruthy()
    release()
    const after = host.querySelector('.dockshell') as HTMLElement
    expect(after.classList.contains('pos-bottom')).toBe(true)
    expect(after.classList.contains('is-max')).toBe(false)
    expect(JSON.parse(store.get('test-dock-drag')!).maximized).toBe(false)
  })
})

describe('DockShell window-drag carve', () => {
  /**
   * Chromium composes -webkit-app-region rects in document order and the
   * window hit test ignores z-order: the body's ribbon drag row comes AFTER
   * the panel in the DOM, so wherever the panel covers that row (maximized,
   * or floating over the row) an invisible no-drag overlay must re-carve the
   * panel's rect as the root's LAST child — else every header click in the
   * band drags the window and the maximize/restore, layout and close buttons
   * go dead.
   */
  function renderCarve(state: Record<string, unknown>, open = true): void {
    // a fresh root per render: DockShell reads localStorage only in its state
    // initializer, so a reused instance would keep the previous layout
    if (root) {
      act(() => {
        root!.unmount()
      })
    }
    document.body.innerHTML = ''
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    store.set('test-dock-carve', JSON.stringify(state))
    act(() => {
      root!.render(
        createElement(DockShell, {
          storageKey: 'test-dock-carve',
          open,
          onOpenChange: () => {},
          labels: {
            panelTitle: 'AI',
            dockLeft: 'left',
            dockRight: 'right',
            dockBottom: 'bottom',
            float: 'float',
            maximize: 'max',
            restore: 'restore',
            collapse: 'close',
            layoutMenu: 'layout',
          },
          renderPanel: (chrome: DockChrome) =>
            createElement('div', { ...chrome.dragProps, 'data-header': '' }, 'panel'),
          children: createElement('div', { className: 'editor-stub' }),
        }),
      )
    })
  }

  it('maximized: the carve overlay is the root\'s last child', () => {
    renderCarve({ position: 'left', maximized: true })
    const rootEl = host.querySelector('.dockshell') as HTMLElement
    const carve = host.querySelector('.dockshell-carve') as HTMLElement
    expect(carve).toBeTruthy()
    expect(rootEl.lastElementChild).toBe(carve)
  })

  it('float: carved too; docked and closed: not carved', () => {
    renderCarve({
      position: 'float',
      floatRect: { x: 100, y: 80, width: 480, height: 560 },
    })
    expect(host.querySelector('.dockshell-carve')).toBeTruthy()
    renderCarve({ position: 'left' })
    expect(host.querySelector('.dockshell-carve')).toBeNull()
    // closed hides the panel entirely — the ribbon drag row must come back
    renderCarve({ position: 'left', maximized: true }, false)
    expect(host.querySelector('.dockshell-carve')).toBeNull()
  })
})
