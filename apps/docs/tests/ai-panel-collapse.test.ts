// The AI panel stays mounted while collapsed (DockShell hides the slot
// entirely — the top-row bubble icon reopens), so the conversation, draft,
// and in-flight runs survive collapse/expand — and also layout switches
// (left/right/bottom/float).
import { beforeAll, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { DockShell, type DockChrome } from '@chatoffice/ui'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import { defaultSettingsV2, type AiSettingsV2 } from '@chatoffice/ai-provider'

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

function createEditor(): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'docParagraph',
          attrs: { docxIndex: 0 },
          content: [{ type: 'text', text: 'EVs market research' }],
        },
      ],
    },
  })
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

function shellProps(editor: Editor, overrides: Record<string, unknown> = {}) {
  const open = (overrides.open as boolean | undefined) ?? true
  return {
    storageKey: 'test-dock',
    open,
    onOpenChange: () => {},
    labels: LABELS,
    renderPanel: (chrome: DockChrome) =>
      createElement(AiPanel, {
        editor,
        blocks: [],
        settings,
        open,
        dockChrome: chrome,
      }),
    children: createElement('div', { className: 'editor-stub' }),
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

describe('AiPanel collapse', () => {
  it('keeps the draft input across a collapse/expand cycle', () => {
    const editor = createEditor()
    const { container, root, cleanup } = mount(createElement(DockShell, shellProps(editor)))

    const textarea = container.querySelector<HTMLTextAreaElement>('.ai-input-box textarea')
    expect(textarea).not.toBeNull()
    typeInto(textarea!, 'unsent draft')
    expect(textarea!.value).toBe('unsent draft')

    // collapse: the panel slot is hidden (CSS) but stays mounted
    act(() => root.render(createElement(DockShell, shellProps(editor, { open: false }))))
    expect(container.querySelector('.dockshell')?.classList.contains('is-closed')).toBe(true)
    expect(container.querySelector('.dockshell-rail')).toBeNull()
    expect(container.querySelector('.ai-input-box textarea')).not.toBeNull()

    // expand: the draft is still there
    act(() => root.render(createElement(DockShell, shellProps(editor))))
    const restored = container.querySelector<HTMLTextAreaElement>('.ai-input-box textarea')
    expect(restored).not.toBeNull()
    expect(restored!.value).toBe('unsent draft')

    cleanup()
    editor.destroy()
  })
})
