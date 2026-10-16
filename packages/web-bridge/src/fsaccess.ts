/**
 * File channel on the host side (plan v2.2, decision #4/#5): File System
 * Access handles. Files stay WHERE THE USER PUT THEM — open in place, save
 * in place (Word-style), handles persisted in IndexedDB so recents can
 * reopen without a picker. Chromium-only; the degrade layer gates the UI
 * elsewhere.
 */

export interface OpenedFile {
  /** host-internal id used by editor shims to address the file */
  id: string
  name: string
  /** last-known size/type for UI */
  size: number
  type: string
}

/** 一个已打开文件：FS Access 句柄（可就地写）或 input 选中的内容（只读） */
type LiveEntry =
  | { kind: 'handle'; handle: FileSystemFileHandle; name: string }
  | { kind: 'file'; file: File; name: string }

interface FsWindow extends Window {
  showOpenFilePicker?(opts?: unknown): Promise<FileSystemFileHandle[]>
  showSaveFilePicker?(opts?: unknown): Promise<FileSystemFileHandle>
}

export function fsAccessSupported(): boolean {
  return typeof window !== 'undefined' &&
    typeof (window as FsWindow).showOpenFilePicker === 'function'
}

const DB_NAME = 'chaoffice-fs'
const STORE = 'handles'

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export class FileHandleStore {
  private seq = 1
  /** in-session entries: FS Access handles (read-write) or picked File content (read-only) */
  private readonly live = new Map<string, LiveEntry>()

  async openPicker(): Promise<OpenedFile | null> {
    const w = window as FsWindow
    if (typeof w.showOpenFilePicker === 'function') {
      try {
        const [handle] = await w.showOpenFilePicker({ multiple: false })
        if (!handle) return null
        const file = await handle.getFile()
        const id = `f${this.seq++}`
        this.live.set(id, { kind: 'handle', handle, name: file.name })
        await withStore('readwrite', (s) => s.put(handle, id) as unknown as IDBRequest<IDBValidKey>)
        return { id, name: file.name, size: file.size, type: file.type }
      } catch (err) {
        // 用户在原生对话框取消
        if (err instanceof DOMException && err.name === 'AbortError') return null
        // 嵌入 iframe / 手势缺失场景：FS Access 抛 SecurityError（即使点击真实
        // 发生，激活也可能不达 iframe 内调用）——回落 <input type=file>，同一
        // 点击激活窗口内仍可弹出系统选择框；内容只读打开，另存为不受影响
        if (!(err instanceof DOMException && (err.name === 'SecurityError' || err.name === 'NotAllowedError'))) throw err
      }
    }
    return this.openInputFallback()
  }

  /** <input type=file> fallback: File objects carry CONTENT but no write
   *  handle — in-place save degrades (structured error), 另存为 still works. */
  private openInputFallback(): Promise<OpenedFile | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.style.display = 'none'
      let settled = false
      const finish = (value: OpenedFile | null) => {
        if (settled) return
        settled = true
        input.remove()
        resolve(value)
      }
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        if (!file) return finish(null)
        const id = `f${this.seq++}`
        this.live.set(id, { kind: 'file', file, name: file.name })
        finish({ id, name: file.name, size: file.size, type: file.type })
      })
      input.addEventListener('cancel', () => finish(null))
      document.body.appendChild(input)
      input.click()
      setTimeout(() => finish(null), 300000)
    })
  }

  async read(id: string): Promise<{ name: string; base64: string; text?: string }> {
    const entry = await this.resolve(id)
    const file = entry.kind === 'file' ? entry.file : await entry.handle.getFile()
    const buf = new Uint8Array(await file.arrayBuffer())
    let bin = ''
    for (const b of buf) bin += String.fromCharCode(b)
    return {
      name: file.name,
      base64: btoa(bin),
      ...(file.type.startsWith('text/') || /\.(md|markdown|txt|html?|csv)$/i.test(file.name) ? { text: await file.text() } : {}),
    }
  }

  /** In-place save: requires the handle to carry write permission. */
  async write(id: string, bytes: Uint8Array): Promise<{ name: string; size: number }> {
    const entry = await this.resolve(id)
    if (entry.kind === 'file') {
      const err = new Error('该文件以只读方式打开（浏览器限制）——请用「另存为」保存副本')
      ;(err as Error & { code: string }).code = 'readonly-open'
      throw err
    }
    const writable = await (entry.handle as FileSystemFileHandle & {
      createWritable(opts?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>
    }).createWritable()
    await writable.write(bytes as unknown as FileSystemWriteChunkType)
    await writable.close()
    return { name: entry.name, size: bytes.byteLength }
  }

  /** Save As: new picker, becomes the file's new identity (returned id). */
  async saveAsPicker(suggestedName: string, bytes: Uint8Array): Promise<{ id: string; name: string } | null> {
    const w = window as FsWindow
    if (typeof w.showSaveFilePicker === 'function') {
      try {
        const handle = await w.showSaveFilePicker({ suggestedName })
        const writable = await (handle as FileSystemFileHandle & {
          createWritable(): Promise<FileSystemWritableFileStream>
        }).createWritable()
        await writable.write(bytes as unknown as FileSystemWriteChunkType)
        await writable.close()
        const id = `f${this.seq++}`
        const name = handle.name || suggestedName
        this.live.set(id, { kind: 'handle', handle, name })
        await withStore('readwrite', (s) => s.put(handle, id) as unknown as IDBRequest<IDBValidKey>)
        return { id, name }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return null
        // 同 openPicker：手势/iframe 场景的 SecurityError 回落下载
        if (!(err instanceof DOMException && (err.name === 'SecurityError' || err.name === 'NotAllowedError'))) throw err
      }
    }
    // download fallback: Electron/Chromium 把 a[download] 落成原生保存对话框
    const file = new File([bytes as unknown as BlobPart], suggestedName)
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = suggestedName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    const id = `f${this.seq++}`
    this.live.set(id, { kind: 'file', file, name: suggestedName })
    return { id, name: suggestedName }
  }

  /** 桌面壳交付的文件内容入库（只读形态：就地写降级，另存为可用）。 */
  registerFile(file: File, name?: string): string {
    const id = `f${this.seq++}`
    this.live.set(id, { kind: 'file', file, name: name ?? file.name })
    return id
  }

  private async resolve(id: string): Promise<LiveEntry> {
    const live = this.live.get(id)
    if (live) return live
    // session restart: reopen from IndexedDB (permission may re-prompt)
    const handle = await withStore<FileSystemFileHandle>('readonly', (s) => s.get(id) as unknown as IDBRequest<FileSystemFileHandle>)
    if (!handle) throw new Error(`unknown file id: ${id}`)
    const entry: LiveEntry = { kind: 'handle', handle, name: handle.name }
    this.live.set(id, entry)
    return entry
  }

  name(id: string): string | null {
    return this.live.get(id)?.name ?? null
  }

  liveIds(): string[] {
    return [...this.live.keys()]
  }
}
