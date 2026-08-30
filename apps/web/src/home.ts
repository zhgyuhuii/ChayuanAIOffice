/**
 * Home view (mirrors the Electron shell home): five create tiles + open file.
 * Pure DOM so the host stays dependency-free; theming follows the shell's
 * dark-chrome token look.
 */

import type { EditorKey } from './editors'

export interface HomeActions {
  onCreate(key: EditorKey): void
  onOpenFile(file: File): void
}

const TILE_META: Record<EditorKey, { label: string; glyph: string; accent: string }> = {
  docs: { label: 'Docs', glyph: 'W', accent: '#2b579a' },
  sheets: { label: 'Sheets', glyph: 'X', accent: '#217346' },
  slides: { label: 'Slides', glyph: 'P', accent: '#c43e1c' },
  pdf: { label: 'PDF', glyph: 'A', accent: '#b30b00' },
  markdown: { label: 'Markdown', glyph: 'M', accent: '#5c4b7d' },
}

/** Maps a picked file to the editor that owns it; null = unsupported. */
export function editorForFile(name: string): EditorKey | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.docx')) return 'docs'
  if (lower.endsWith('.xlsx')) return 'sheets'
  if (lower.endsWith('.pptx')) return 'slides'
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown'
  return null
}

export function createHome(actions: HomeActions): HTMLElement {
  const root = document.createElement('div')
  root.className = 'home'
  root.style.cssText = [
    'position:absolute', 'inset:0', 'overflow:auto',
    'background:var(--surface,#1e1f22)', 'color:var(--text,#e6e6e6)',
    'font:14px/1.5 system-ui,sans-serif',
  ].join(';')

  const wrap = document.createElement('div')
  wrap.style.cssText = 'max-width:760px;margin:0 auto;padding:72px 24px 48px;text-align:center'
  root.appendChild(wrap)

  const title = document.createElement('h1')
  title.textContent = 'GenOffice'
  title.style.cssText = 'font-size:34px;font-weight:600;margin:0 0 6px;letter-spacing:-0.5px'
  wrap.appendChild(title)

  const subtitle = document.createElement('p')
  subtitle.textContent = '开始新文档，或打开一个文件'
  subtitle.style.cssText = 'color:#9a9a9a;margin:0 0 44px'
  wrap.appendChild(subtitle)

  const grid = document.createElement('div')
  grid.style.cssText =
    'display:grid;grid-template-columns:repeat(5,1fr);gap:16px;margin-bottom:44px'
  wrap.appendChild(grid)

  const order: EditorKey[] = ['docs', 'sheets', 'slides', 'pdf', 'markdown']
  for (const key of order) {
    const meta = TILE_META[key]
    const tile = document.createElement('button')
    tile.className = 'home-tile'
    tile.setAttribute('aria-label', `新建 ${meta.label}`)
    tile.style.cssText = [
      'display:flex', 'flex-direction:column', 'align-items:center', 'gap:10px',
      'padding:18px 8px 14px', 'border:none', 'border-radius:10px', 'cursor:pointer',
      'background:transparent', 'color:inherit', 'font:inherit',
    ].join(';')
    tile.addEventListener('mouseenter', () => (tile.style.background = 'rgba(255,255,255,0.06)'))
    tile.addEventListener('mouseleave', () => (tile.style.background = 'transparent'))

    const badge = document.createElement('span')
    badge.textContent = meta.glyph
    badge.style.cssText = [
      'display:grid', 'place-items:center', 'width:56px', 'height:56px',
      'border-radius:12px', `background:${meta.accent}`, 'color:#fff',
      'font-size:24px', 'font-weight:600',
    ].join(';')
    const label = document.createElement('span')
    label.textContent = meta.label
    label.style.cssText = 'font-size:13px;color:#cfcfcf'

    tile.append(badge, label)
    tile.addEventListener('click', () => actions.onCreate(key))
    grid.appendChild(tile)
  }

  // ── 打开文件 ──
  const openBtn = document.createElement('button')
  openBtn.textContent = '打开文件…'
  openBtn.setAttribute('aria-label', '打开文件')
  openBtn.style.cssText = [
    'padding:10px 28px', 'border-radius:8px', 'cursor:pointer', 'font:inherit',
    'border:1px solid #4a4c4f', 'background:#2b2d30', 'color:#e6e6e6',
  ].join(';')
  wrap.appendChild(openBtn)

  const hint = document.createElement('p')
  hint.textContent = '支持 .docx / .xlsx / .pptx / .pdf / .md'
  hint.style.cssText = 'color:#777;font-size:12px;margin:14px 0 0'
  wrap.appendChild(hint)

  const unsupported = document.createElement('p')
  unsupported.setAttribute('role', 'alert')
  unsupported.style.cssText = 'color:#e06c75;font-size:13px;margin:10px 0 0;min-height:18px'
  wrap.appendChild(unsupported)

  const picker = document.createElement('input')
  picker.type = 'file'
  picker.accept = '.docx,.xlsx,.pptx,.pdf,.md,.markdown'
  picker.style.display = 'none'
  wrap.appendChild(picker)

  openBtn.addEventListener('click', () => picker.click())
  picker.addEventListener('change', () => {
    const file = picker.files?.[0]
    picker.value = ''
    if (!file) return
    if (editorForFile(file.name)) {
      unsupported.textContent = ''
      actions.onOpenFile(file)
    } else {
      unsupported.textContent = `不支持的文件类型：${file.name}`
    }
  })

  return root
}
