/**
 * Web host main (plan v2.1, form ②): a tab strip plus one iframe per editor,
 * mirroring the Electron shell's WebContentsView tab model. Editor origins
 * come from a runtime config so dev (5173–5177) and production (packaged
 * editor builds) share this code.
 */

import { resolveEditors, type EditorSpec } from './editors'

interface Tab {
  id: number
  editor: EditorSpec
  frame: HTMLIFrameElement
  button: HTMLButtonElement
}

const tabsEl = document.getElementById('tabs') as HTMLDivElement
const viewsEl = document.getElementById('views') as HTMLDivElement

const editors = resolveEditors(
  (window as unknown as { GENOFFICE_EDITORS?: Partial<Record<string, string>> }).GENOFFICE_EDITORS,
)

let nextId = 1
let active: Tab | null = null

function newTabButton(): HTMLButtonElement {
  let btn = tabsEl.querySelector('#new-tab') as HTMLButtonElement | null
  if (!btn) {
    btn = document.createElement('button')
    btn.id = 'new-tab'
    btn.textContent = '+'
    btn.title = 'Open editor'
    tabsEl.appendChild(btn)
  }
  return btn
}

function createTab(editor: EditorSpec): Tab {
  const id = nextId++
  const frame = document.createElement('iframe')
  frame.src = editor.url
  viewsEl.appendChild(frame)

  const button = document.createElement('button')
  button.className = 'tab'
  button.dataset.tabId = String(id)
  button.textContent = editor.label
  button.addEventListener('click', () => activate(tab))

  const close = document.createElement('span')
  close.textContent = ' ×'
  close.addEventListener('click', (e) => {
    e.stopPropagation()
    closeTab(tab)
  })
  button.appendChild(close)
  tabsEl.insertBefore(button, newTabButton())

  const tab: Tab = { id, editor, frame, button }
  newTabButton().addEventListener('click', () => activate(tab))
  return tab
}

function activate(tab: Tab): void {
  active = tab
  for (const el of [...tabsEl.querySelectorAll('.tab')]) el.classList.remove('active')
  for (const el of [...viewsEl.querySelectorAll('iframe')]) el.classList.remove('active')
  tab.button.classList.add('active')
  tab.frame.classList.add('active')
}

function closeTab(tab: Tab): void {
  tab.frame.remove()
  tab.button.remove()
  if (active === tab) {
    const frames = [...viewsEl.querySelectorAll('iframe')] as HTMLIFrameElement[]
    const buttons = [...tabsEl.querySelectorAll('.tab')] as HTMLButtonElement[]
    const lastFrame = frames.at(-1)
    const lastBtn = buttons.at(-1)
    if (lastFrame && lastBtn) {
      lastFrame.classList.add('active')
      lastBtn.classList.add('active')
      active = null
    }
  }
}

// Boot: one tab per editor, docs first (mirrors the shell home default).
for (const editor of editors) {
  const tab = createTab(editor)
  if (!active) activate(tab)
}
void active
