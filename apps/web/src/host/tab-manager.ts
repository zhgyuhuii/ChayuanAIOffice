/**
 * In-page tab manager: the web reincarnation of the main-process
 * tab-manager. Owns the iframe layer covering .app-frame-content and
 * implements the TabsApi surface the (unmodified) shell renderer consumes.
 * Home stays pinned at index 0, exactly like the Electron strip.
 */

import { getHomeLayout, onHomeLayoutChange } from '../../../shell/src/renderer/src/home-layout'
import bootLogoUrl from '../assets/boot-logo.png'

export type TabKind = 'home' | 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown' | 'html'

export interface TabSummary {
  id: string
  kind: TabKind
  title: string
  closable: boolean
  active: boolean
}

export interface EditorOpenOptions {
  title?: string
  /** web-bridge file id (opened file) — forwarded to the editor via URL hash */
  fileId?: string
  newBlank?: boolean
}

type ChangedHandler = (tabs: TabSummary[]) => void

const EDITOR_KEYS: TabKind[] = ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html']

export function editorUrl(key: TabKind): string {
  const map = (window as unknown as { CHATOFFICE_EDITORS?: Record<string, string> })
    .CHATOFFICE_EDITORS
  return map?.[key] ?? `/editors/${key}/`
}

interface TabEntry {
  summary: TabSummary
  frame: HTMLIFrameElement | null
  fileId: string | null
}

export class TabManager {
  private seq = 1
  /** Home stays pinned at index 0, exactly like the Electron strip. */
  private readonly tabs: TabEntry[] = [
    {
      summary: { id: 'home', kind: 'home', title: '主页', closable: false, active: true },
      frame: null,
      fileId: null,
    },
  ]
  private readonly handlers = new Set<ChangedHandler>()
  private layer: HTMLDivElement | null = null
  private anchor: HTMLElement | null = null
  /** shell modal (settings) lifetime: the covering editor layer hides for it */
  private modalOpen = false

  /**
   * The iframe layer lives on <body> and geometrically tracks the shell's
   * content area. Staying OUT of .app-frame-content matters: the shell hides
   * that element for non-home tabs, and overriding its visibility (as an
   * earlier revision did) leaked the Home surface — its sticky filter strip
   * floated above open editors.
   */
  attach(layer: HTMLDivElement, anchor: HTMLElement): void {
    this.layer = layer
    this.anchor = anchor
    layer.style.cssText = 'position:fixed;z-index:5;background:#fff;display:none'
    document.body.appendChild(layer)
    const sync = () => {
      if (!this.layer) return
      const r = this.anchor!.getBoundingClientRect()
      // The shell's TabBar overlays the content area from the top (its rect
      // starts at 0); clamp the editor layer below it or the editor's own
      // menu strip gets buried under the tab bar.
      const bar = document.querySelector('.tab-bar')
      const barBottom = bar ? bar.getBoundingClientRect().bottom : 0
      const top = Math.max(r.top, barBottom)
      // keep the home tree strip visible beside the editor, mirroring the
      // main-process WebContentsView inset: the layer starts right of the
      // sidebar (dragging the splitter re-syncs live via onHomeLayoutChange)
      const layout = getHomeLayout()
      const inset = layout.leftCollapsed ? 0 : layout.sidebarWidth
      Object.assign(this.layer.style, {
        top: `${top}px`,
        left: `${r.left + inset}px`,
        width: `${Math.max(0, r.width - inset)}px`,
        height: `${Math.max(0, r.bottom - top)}px`,
      })
    }
    sync()
    new ResizeObserver(sync).observe(this.anchor)
    window.addEventListener('resize', sync)
    onHomeLayoutChange(sync)
  }

  list(): TabSummary[] {
    return this.tabs.map((t) => ({ ...t.summary }))
  }

  onChanged(handler: ChangedHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  private notify(): void {
    const snapshot = this.list()
    for (const h of [...this.handlers]) h(snapshot)
    this.syncVisibility()
  }

  /** Editor iframes hide when Home (index 0) is active — Home paints itself.
   * The shell hides .app-frame-content for non-home tabs (Electron editors
   * paint over it natively); on the web the layer must undo that so iframes
   * show — it is opaque, so the Home DOM behind it stays covered. A shell
   * modal (settings) needs the whole window, so the layer hides for its
   * lifetime — the DOM-level mirror of the main process hiding the view. */
  private syncVisibility(): void {
    const homeActive = this.tabs[0]?.summary.active === true
    // anchor visibility stays under the shell's own control (hidden for
    // non-home tabs — exactly what we want now that the layer is on body)
    if (this.anchor) this.anchor.style.visibility = ''
    if (this.layer) this.layer.style.display = homeActive || this.modalOpen ? 'none' : 'block'
    for (const t of this.tabs) {
      if (t.frame) t.frame.style.display = t.summary.active ? 'block' : 'none'
    }
  }

  /** shell modal lifetime relayed from the chatOfficeTabs shim */
  setModalOpen(open: boolean): void {
    this.modalOpen = open
    this.syncVisibility()
  }

  /** Loading veil over a freshly opened editor until its iframe finishes. */
  private addLoadingVeil(frame: HTMLIFrameElement): void {
    const veil = document.createElement('div')
    veil.className = 'go-editor-veil'
    veil.style.cssText = [
      'position:absolute',
      'inset:0',
      'z-index:2',
      'display:grid',
      'place-items:center',
      'background:#fafafa',
      'font:13px/1.6 system-ui,sans-serif',
      'color:#666',
      'transition:opacity .25s',
    ].join(';')
    const box = document.createElement('div')
    box.style.cssText = 'text-align:center'
    const logo = document.createElement('img')
    logo.src = bootLogoUrl
    logo.alt = ''
    logo.style.cssText = [
      'width:56px',
      'height:56px',
      'margin:0 auto 14px',
      'display:block',
      'animation:go-boot-pulse 1.4s ease-in-out infinite',
    ].join(';')
    const text = document.createElement('div')
    text.textContent = '正在打开编辑器…'
    box.append(logo, text)
    veil.appendChild(box)
    const style = document.createElement('style')
    style.textContent =
      '@keyframes go-boot-pulse{0%,100%{opacity:.45;transform:scale(.94)}50%{opacity:1;transform:scale(1)}}'
    veil.appendChild(style)
    frame.insertAdjacentElement('afterend', veil)
    const drop = () => {
      veil.style.opacity = '0'
      setTimeout(() => veil.remove(), 300)
    }
    frame.addEventListener('load', drop, { once: true })
    setTimeout(drop, 30_000) // safety net
  }

  activate(id: string): void {
    for (const t of this.tabs) t.summary.active = t.summary.id === id
    this.notify()
  }

  activateHome(): void {
    this.activate(this.tabs[0]?.summary.id ?? 'home')
  }

  close(id: string): void {
    const idx = this.tabs.findIndex((t) => t.summary.id === id)
    if (idx <= 0) return // home is not closable
    const [removed] = this.tabs.splice(idx, 1)
    removed.frame?.remove()
    if (removed.summary.active) {
      const next = this.tabs[Math.max(0, idx - 1)]
      if (next) next.summary.active = true
    }
    this.notify()
  }

  reorder(id: string, toIndex: number): void {
    const idx = this.tabs.findIndex((t) => t.summary.id === id)
    if (idx <= 0) return
    const clamped = Math.max(1, Math.min(this.tabs.length - 1, toIndex))
    const [entry] = this.tabs.splice(idx, 1)
    this.tabs.splice(clamped, 0, entry)
    this.notify()
  }

  /** Opens (or focuses) an editor tab; dedupes by fileId when given. */
  openEditor(kind: TabKind, opts: EditorOpenOptions = {}): string {
    if (!EDITOR_KEYS.includes(kind)) throw new Error(`not an editor kind: ${kind}`)
    if (opts.fileId) {
      const existing = this.tabs.find((t) => t.summary.kind === kind && t.fileId === opts.fileId)
      if (existing) {
        this.activate(existing.summary.id)
        return existing.summary.id
      }
    }
    const id = `tab-${this.seq++}`
    const title = opts.title ?? kind[0].toUpperCase() + kind.slice(1)
    const frame = document.createElement('iframe')
    const hash = opts.fileId
      ? `#gofile=${encodeURIComponent(opts.fileId)}&name=${encodeURIComponent(title)}`
      : ''
    frame.src = editorUrl(kind) + hash
    frame.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;border:none;background:#fff;display:none'
    this.layer?.appendChild(frame)
    this.addLoadingVeil(frame)
    for (const t of this.tabs) t.summary.active = false
    this.tabs.push({
      summary: { id, kind, title, closable: true, active: true },
      frame,
      fileId: opts.fileId ?? null,
    })
    this.notify()
    return id
  }

  /** Title sync from an editor (e.g. after save-as produced a new name). */
  setTitleByFile(fileId: string, title: string): void {
    const t = this.tabs.find((x) => x.fileId === fileId)
    if (t && t.summary.title !== title) {
      t.summary.title = title
      this.notify()
    }
  }

  activeFileId(): string | null {
    return this.tabs.find((t) => t.summary.active)?.fileId ?? null
  }

  frameForFile(fileId: string): HTMLIFrameElement | null {
    return this.tabs.find((t) => t.fileId === fileId)?.frame ?? null
  }
}

export const tabManager = new TabManager()
