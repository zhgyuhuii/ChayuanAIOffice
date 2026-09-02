/**
 * File opening on the host side: FS Access picker → recents record → editor
 * tab. Sheets/Slides/PDF open-existing are batch 3/4 (degraded with a clear
 * message instead of silently failing).
 */

import { FileHandleStore, fsAccessSupported } from '@chatoffice/web-bridge'
import { tabManager, type TabKind } from './tab-manager.js'
import { recordRecent } from './recents.js'

export const fileStore = new FileHandleStore()

function extToKind(name: string): TabKind | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.docx')) return 'docs'
  if (lower.endsWith('.xlsx')) return 'sheets'
  if (lower.endsWith('.pptx')) return 'slides'
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown'
  return null
}

const LATER_BATCH: Partial<Record<TabKind, string>> = {}

export async function openEditorFor(kind: TabKind, fileId: string, name: string): Promise<void> {
  const later = LATER_BATCH[kind]
  if (later) throw new Error(later)
  recordRecent(fileId, name, kind as RecentKind)
  tabManager.openEditor(kind, { fileId, title: name })
}

type RecentKind = 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown'

/** Picker flow: open file → route by extension → editor tab with the handle id. */
export async function openPickedFile(): Promise<void> {
  if (!fsAccessSupported()) {
    throw new Error('当前浏览器不支持本地文件读写（需要 Chromium 内核，如 Chrome / Edge）')
  }
  const picked = await fileStore.openPicker()
  if (!picked) return // canceled
  const kind = extToKind(picked.name)
  if (!kind) throw new Error(`不支持的文件类型：${picked.name}`)
  await openEditorFor(kind, picked.id, picked.name)
}
