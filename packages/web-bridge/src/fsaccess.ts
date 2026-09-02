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

interface FsWindow extends Window {
  showOpenFilePicker?(opts?: unknown): Promise<FileSystemFileHandle[]>
  showSaveFilePicker?(opts?: unknown): Promise<FileSystemFileHandle>
}

export function fsAccessSupported(): boolean {
  return typeof window !== 'undefined' &&
    typeof (window as FsWindow).showOpenFilePicker === 'function'
}

const DB_NAME = 'chatoffice-fs'
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
  /** in-session handles: id → { handle, name } */
  private readonly live = new Map<string, { handle: FileSystemFileHandle; name: string }>()

  async openPicker(): Promise<OpenedFile | null> {
    const w = window as FsWindow
    if (!w.showOpenFilePicker) throw new Error('File System Access API not available')
    const [handle] = await w.showOpenFilePicker({ multiple: false })
    if (!handle) return null
    const file = await handle.getFile()
    const id = `f${this.seq++}`
    this.live.set(id, { handle, name: file.name })
    await withStore('readwrite', (s) => s.put(handle, id) as unknown as IDBRequest<IDBValidKey>)
    return { id, name: file.name, size: file.size, type: file.type }
  }

  async read(id: string): Promise<{ name: string; base64: string; text?: string }> {
    const entry = await this.resolve(id)
    const file = await entry.handle.getFile()
    const buf = new Uint8Array(await file.arrayBuffer())
    let bin = ''
    for (const b of buf) bin += String.fromCharCode(b)
    return {
      name: file.name,
      base64: btoa(bin),
      ...(file.type.startsWith('text/') || /\.(md|markdown|txt)$/i.test(file.name) ? { text: await file.text() } : {}),
    }
  }

  /** In-place save: requires the handle to carry write permission. */
  async write(id: string, bytes: Uint8Array): Promise<{ name: string; size: number }> {
    const entry = await this.resolve(id)
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
    if (!w.showSaveFilePicker) throw new Error('File System Access API not available')
    const handle = await w.showSaveFilePicker({ suggestedName })
    const writable = await (handle as FileSystemFileHandle & {
      createWritable(): Promise<FileSystemWritableFileStream>
    }).createWritable()
    await writable.write(bytes as unknown as FileSystemWriteChunkType)
    await writable.close()
    const id = `f${this.seq++}`
    const name = handle.name || suggestedName
    this.live.set(id, { handle, name })
    await withStore('readwrite', (s) => s.put(handle, id) as unknown as IDBRequest<IDBValidKey>)
    return { id, name }
  }

  private async resolve(id: string): Promise<{ handle: FileSystemFileHandle; name: string }> {
    const live = this.live.get(id)
    if (live) return live
    // session restart: reopen from IndexedDB (permission may re-prompt)
    const handle = await withStore<FileSystemFileHandle>('readonly', (s) => s.get(id) as unknown as IDBRequest<FileSystemFileHandle>)
    if (!handle) throw new Error(`unknown file id: ${id}`)
    const entry = { handle, name: handle.name }
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
