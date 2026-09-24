/**
 * Recents store (batch 1 = browser-local, plan v2.2 decision #1): the same
 * page-shape as the Electron recent-files store, backed by localStorage.
 * Entries reference web-bridge file ids (FS Access handles in IndexedDB), so
 * a recent can reopen without a picker after permission is re-granted.
 */

const KEY = 'chatoffice.recents.v1'
const MAX = 200

export interface RecentEntry {
  fileId: string
  name: string
  kind: 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown'
  starred: boolean
  lastOpened: number // epoch ms
}

interface RecentsShape {
  entries: RecentEntry[]
  starred: RecentEntry[]
  total: number
}

function read(): RecentEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as RecentEntry[]
  } catch {
    return []
  }
}

function write(entries: RecentEntry[]): void {
  localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX)))
}

export function recordRecent(fileId: string, name: string, kind: RecentEntry['kind']): void {
  const entries = read().filter((e) => e.fileId !== fileId)
  entries.unshift({ fileId, name, kind, starred: false, lastOpened: Date.now() })
  write(entries)
}

/** Electron shape: page(query) → { items, total } — batch 1 returns ids as paths. */
export function pageRecents(query: { starred?: boolean; search?: string } = {}): RecentsShape {
  let entries = read()
  if (query.starred) entries = entries.filter((e) => e.starred)
  if (query.search) {
    const q = query.search.toLowerCase()
    entries = entries.filter((e) => e.name.toLowerCase().includes(q))
  }
  const sorted = [...entries].sort((a, b) => Number(b.starred) - Number(a.starred) || b.lastOpened - a.lastOpened)
  return { entries: sorted, starred: sorted.filter((e) => e.starred), total: sorted.length }
}

export function toggleStar(fileId: string): void {
  const entries = read()
  const e = entries.find((x) => x.fileId === fileId)
  if (e) {
    e.starred = !e.starred
    write(entries)
  }
}

export function removeRecents(fileIds: string[]): void {
  write(read().filter((e) => !fileIds.includes(e.fileId)))
}

export function entryFor(fileId: string): RecentEntry | null {
  return read().find((e) => e.fileId === fileId) ?? null
}

export function renameRecent(fileId: string, name: string): void {
  const entries = read()
  const e = entries.find((x) => x.fileId === fileId)
  if (e) {
    e.name = name
    write(entries)
  }
}
