/**
 * Web host main (plan v2.1, form ②): home screen + tab strip + one iframe per
 * open editor, mirroring the Electron shell's home-tab model. Editor origins
 * come from a runtime config so dev (5173–5177) and production (packaged
 * editor builds) share this code.
 */

import { resolveEditors, type EditorKey, type EditorSpec } from './editors'
import { createHome, editorForFile } from './home'

interface Tab {
  id: number
  editor: EditorSpec
  title: string
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
let home: HTMLElement | null = null

function editorByKey(key: EditorKey): EditorSpec {
  const spec = editors.find((e) => e.key === key)
  if (!spec) throw new Error(`unknown editor: ${key}`)
  return spec
}

function newTabButton(): HTMLButtonElement {
  let btn = tabsEl.querySelector('#new-tab') as HTMLButtonElement | null
  if (!btn) {
    btn = document.createElement('button')
    btn.id = 'new-tab'
    btn.textContent = '+'
    btn.title = '回到主页'
    tabsEl.appendChild(btn)
  }
  return btn
}

function showHome(): void {
  if (!home) {
    home = createHome({
      onCreate: (key) => createTab(editorByKey(key), key.toUpperCase()),
      onOpenFile: (file) => {
        const key = editorForFile(file.name)
        if (key) createTab(editorByKey(key), file.name)
      },
    })
    viewsEl.appendChild(home)
  }
  home.style.display = 'block'
}

function hideHome(): void {
  if (home) home.style.display = 'none'
}

function createTab(editor: EditorSpec, title: string): Tab {
  hideHome()
  const id = nextId++
  const frame = document.createElement('iframe')
  frame.src = editor.url
  viewsEl.appendChild(frame)

  const button = document.createElement('button')
  button.className = 'tab'
  button.dataset.tabId = String(id)
  button.textContent = title
  button.addEventListener('click', () => activate(tab))

  const close = document.createElement('span')
  close.textContent = ' ×'
  close.addEventListener('click', (e) => {
    e.stopPropagation()
    closeTab(tab)
  })
  button.appendChild(close)
  tabsEl.insertBefore(button, newTabButton())

  const tab: Tab = { id, editor, title, frame, button }
  tabsEl.insertBefore(button, newTabButton())
  activate(tab)
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
    active = null
    const frames = [...viewsEl.querySelectorAll('iframe')] as HTMLIFrameElement[]
    const buttons = [...tabsEl.querySelectorAll('.tab')] as HTMLButtonElement[]
    const lastFrame = frames.at(-1)
    const lastBtn = buttons.at(-1)
    if (lastFrame && lastBtn) {
      lastFrame.classList.add('active')
      lastBtn.classList.add('active')
    } else {
      showHome() // last tab closed → back to the home screen
    }
  }
}

// Boot: home screen first (mirrors the shell home tab). '+' with open tabs
// focuses the latest one; with none it stays on / returns to home.
newTabButton().addEventListener('click', () => {
  const frames = [...viewsEl.querySelectorAll('iframe')] as HTMLIFrameElement[]
  const buttons = [...tabsEl.querySelectorAll('.tab')] as HTMLButtonElement[]
  const lastFrame = frames.at(-1)
  const lastBtn = buttons.at(-1)
  if (lastFrame && lastBtn) {
    hideHome()
    lastFrame.classList.add('active')
    lastBtn.classList.add('active')
    active = null
  } else {
    showHome()
  }
})
showHome()
void active
