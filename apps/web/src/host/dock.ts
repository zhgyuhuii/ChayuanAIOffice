/**
 * Home 右栏停靠的 web 宿主(P1 契约的 iframe 实现):镜像 Electron
 * TabManager 的停靠语义——dock iframes 画在独立 dock 层(定位到渲染器
 * setRect 镜像来的 .dock-area 矩形),仅 Home 激活时可见;undock=把该
 * 文档转成全幅 tab 层的 iframe。LRU 上限与 Electron 侧一致(3)。
 */

import { tabManager, editorUrl } from './tab-manager.js'

export type DockKind = 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown' | 'html'

export interface DockTabSummary {
  id: string
  kind: DockKind
  title: string
  filePath?: string
  active: boolean
}

export interface DockRect {
  x: number
  y: number
  width: number
  height: number
}

const DOCK_TAB_CAP = 3

interface DockEntry {
  summary: DockTabSummary
  frame: HTMLIFrameElement
  /** web-bridge file id (web 的「文件」= FS-Access 句柄 id) */
  fileId: string | null
}

type DockChangedHandler = (tabs: DockTabSummary[]) => void

export class DockHost {
  private seq = 1
  private readonly entries: DockEntry[] = []
  private readonly handlers = new Set<DockChangedHandler>()
  private layer: HTMLDivElement | null = null
  private rect: DockRect | null = null

  /** dock 层挂在 body(与编辑器 iframe 层同级);矩形由渲染器镜像。
   *  可见性与 Electron 侧同语义:仅 Home 激活时显示(订阅全幅 tab 层的
   *  激活流),模态期间 shell-boot 的编辑层逻辑不涉及 dock(设置弹窗由
   *  shell 自身 DOM 承载,在 dock 层之下——dock 层随 setShellModalOpen
   *  的 tab 联动自然被 tabManager 的模态隐藏逻辑盖住)。 */
  attach(layer: HTMLDivElement): void {
    this.layer = layer
    layer.style.cssText = 'position:fixed;z-index:1;background:#fff;display:none'
    document.body.appendChild(layer)
    tabManager.onChanged(() => this.applyRect())
    this.applyRect()
  }

  private applyRect(): void {
    if (!this.layer) return
    const homeActive = tabManager.list()[0]?.active !== false
    if (!this.rect || this.entries.length === 0 || !homeActive) {
      this.layer.style.display = 'none'
      return
    }
    Object.assign(this.layer.style, {
      display: 'block',
      left: `${this.rect.x}px`,
      top: `${this.rect.y}px`,
      width: `${Math.max(0, this.rect.width)}px`,
      height: `${Math.max(0, this.rect.height)}px`,
    })
    for (const e of this.entries) {
      e.frame.style.display = e.summary.active ? 'block' : 'none'
    }
  }

  setRect(rect: DockRect): void {
    this.rect = rect
    this.applyRect()
  }

  list(): DockTabSummary[] {
    return this.entries.map((e) => ({ ...e.summary }))
  }

  onChanged(handler: DockChangedHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  private notify(): void {
    const snapshot = this.list()
    for (const h of [...this.handlers]) h(snapshot)
    this.applyRect()
  }

  /** open/dedupe:同一 fileId(或同为空白)复用已停靠 tab;种子文档免复用 */
  open(
    kind: DockKind,
    opts: { fileId?: string; title?: string; newBlank?: boolean } = {},
  ): DockTabSummary | null {
    const wantsFresh = opts.newBlank
    if (!wantsFresh) {
      const existing = this.entries.find(
        (e) => e.summary.kind === kind && (opts.fileId ? e.fileId === opts.fileId : !e.fileId),
      )
      if (existing) {
        this.activate(existing.summary.id)
        return { ...existing.summary }
      }
    }
    const id = `dock-${this.seq++}`
    const title = opts.title ?? kind[0].toUpperCase() + kind.slice(1)
    const frame = document.createElement('iframe')
    const hash = opts.fileId
      ? `#gofile=${encodeURIComponent(opts.fileId)}&name=${encodeURIComponent(title)}`
      : ''
    frame.src = `${editorUrl(kind)}?mode=tab&panel=0${hash}`
    frame.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;border:none;background:#fff;display:none'
    this.layer?.appendChild(frame)
    const activeId = this.entries.find((e) => e.summary.active)?.summary.id ?? null
    this.entries.push({
      summary: { id, kind, title, active: true },
      frame,
      fileId: opts.fileId ?? null,
    })
    // LRU:超限真关最旧的其他 dock
    const others = this.entries.filter((e) => e.summary.id !== id).map((e) => e.summary.id)
    const overflow = others.length - (DOCK_TAB_CAP - 1)
    for (let i = 0; i < overflow; i++) this.close(others[i]!)
    void activeId
    this.notify()
    return {
      ...(this.entries.find((e) => e.summary.id === id)?.summary ?? {
        id,
        kind,
        title,
        active: true,
      }),
    }
  }

  activate(id: string): void {
    if (!this.entries.some((e) => e.summary.id === id)) return
    for (const e of this.entries) e.summary.active = e.summary.id === id
    this.notify()
  }

  close(id: string): void {
    const idx = this.entries.findIndex((e) => e.summary.id === id)
    if (idx < 0) return
    const [removed] = this.entries.splice(idx, 1)
    removed.frame.remove()
    if (removed.summary.active) {
      const next = this.entries[idx] ?? this.entries[idx - 1]
      if (next) next.summary.active = true
    }
    this.notify()
  }

  /** 弹出为全幅 tab:全幅层开同一文件,dock 副本关闭 */
  undock(id: string): void {
    const entry = this.entries.find((e) => e.summary.id === id)
    if (!entry) return
    tabManager.openEditor(entry.summary.kind, {
      ...(entry.fileId ? { fileId: entry.fileId } : {}),
      ...(entry.summary.title ? { title: entry.summary.title } : {}),
    })
    this.close(id)
  }

  /** 编辑器层可见性(全幅 tab 打开时 dock 层让位)由 z-index 约定保证 */
}

export const dockHost = new DockHost()
