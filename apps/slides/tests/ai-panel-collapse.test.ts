// Slides: the AI panel stays mounted while collapsed (DockShell hides the slot
// entirely — the top-row bubble icon reopens), so the conversation, draft, and
// in-flight runs survive collapse/expand — and also layout switches
// (left/right/bottom/float).
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// react-konva's node entry requires the native 'canvas' package; nothing here draws
vi.mock('react-konva', () => {
  const stub = () => null
  return {
    Stage: stub,
    Layer: stub,
    Rect: stub,
    Group: stub,
    Transformer: stub,
    Line: stub,
    Arrow: stub,
    Text: stub,
    Ellipse: stub,
    Image: stub,
    Path: stub,
    Circle: stub,
    Arc: stub,
  }
})

import { DockShell, type DockChrome } from '@chatoffice/ui'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import { defaultSettingsV2, type AiSettingsV2 } from '@chatoffice/ai-provider'
import { applyAiPanelPrefs } from '@chatoffice/ui'

const settings: AiSettingsV2 = defaultSettingsV2()

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

function panelProps(overrides: Record<string, unknown> = {}) {
  return {
    slides: [],
    current: 0,
    selectedIds: [],
    images: new Map<string, HTMLImageElement>(),
    applySlide: () => {},
    applyDeck: () => {},
    fitWidthPx: 960,
    settings,
    open: true,
    onExpand: () => {},
    onCollapse: () => {},
    ...overrides,
  }
}

function mount(element: React.ReactElement): {
  container: HTMLElement
  root: Root
  cleanup: () => void
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function shellProps(overrides: Record<string, unknown> = {}) {
  const open = (overrides.open as boolean | undefined) ?? true
  return {
    storageKey: 'test-dock-slides',
    open,
    onOpenChange: () => {},
    labels: LABELS,
    renderPanel: (chrome: DockChrome) =>
      createElement(AiPanel, {
        slides: [],
        current: 0,
        selectedIds: [],
        images: new Map<string, HTMLImageElement>(),
        applySlide: () => {},
        applyDeck: () => {},
        fitWidthPx: 960,
        settings,
        open,
        dockChrome: chrome,
      }),
    children: createElement('div', { className: 'stage-stub' }),
    ...overrides,
  }
}

/** Simulate typing into React's controlled textarea */
function typeInto(textarea: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeAll(() => {
  // jsdom has no scrollTo / ResizeObserver; the panel auto-scrolls its chat
  // log and the shell measures itself
  Element.prototype.scrollTo ??= () => {}
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  localStorage.clear()
})

describe('AiPanel collapse (slides)', () => {
  it('keeps the draft input across a collapse/expand cycle', () => {
    const { container, root, cleanup } = mount(createElement(DockShell, shellProps()))

    const textarea = container.querySelector<HTMLTextAreaElement>('.ai-input-box textarea')
    expect(textarea).not.toBeNull()
    typeInto(textarea!, 'unsent draft')
    expect(textarea!.value).toBe('unsent draft')

    // collapse: the panel slot is hidden (CSS) but stays mounted
    act(() => root.render(createElement(DockShell, shellProps({ open: false }))))
    expect(container.querySelector('.dockshell')?.classList.contains('is-closed')).toBe(true)
    expect(container.querySelector('.dockshell-rail')).toBeNull()
    expect(container.querySelector('.ai-input-box textarea')).not.toBeNull()

    // expand: the draft is still there
    act(() => root.render(createElement(DockShell, shellProps())))
    const restored = container.querySelector<HTMLTextAreaElement>('.ai-input-box textarea')
    expect(restored).not.toBeNull()
    expect(restored!.value).toBe('unsent draft')

    cleanup()
  })


  it('reflects the shared spellcheck pref on the composer (issue #249)', () => {
    applyAiPanelPrefs({ fontSize: 'default', customFontSize: 14, spellcheck: false })
    try {
      const { container, cleanup } = mount(createElement(AiPanel, panelProps()))
      const textarea = container.querySelector<HTMLTextAreaElement>(
        'textarea[data-slides-ai-input]',
      )
      expect(textarea).not.toBeNull()
      // jsdom does not reflect the spellcheck IDL property; assert the attribute
      expect(textarea!.getAttribute('spellcheck')).toBe('false')
      cleanup()
    } finally {
      applyAiPanelPrefs({ fontSize: 'default', customFontSize: 14, spellcheck: true })
    }
  })
})
