/**
 * LOCAL(2026-09-21, d8201ad0): 多会话对话索引——AI 面板多会话(多 tab)功能的持久层。
 * 独立索引文件 <projectDir>/chats/conversations.json,与上游 index.json 的
 * chatIdByPath(一文件↔一 chatId)互不干涉;jsonl 复用 store 的 chats 目录与
 * 命名(assertSafeId 同款校验)。上游暂无同类实现;若上游原生实现多会话索引,
 * 评估取上游并删除此文件(收敛条件)。
 *
 * Storage layout:
 *   <userData>/projects/<projectId>/chats/conversations.json
 *     { version: 1, byFile: { "<filePath>": { conversations, openIds, activeId } } }
 *   <userData>/projects/<projectId>/chats/<chatId>.jsonl   (existing store layout)
 *
 * Index key: the resolved absolute file path; unsaved documents use their
 * `unsaved-<ts>` temp chatId as a transient key. The temp → real-path move is
 * performed by the main process right after rebindChatToFile resolves the
 * first save (see registerConversationsIpc wiring), so titles/open sets follow
 * the file like the jsonl does.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ProjectStore } from './store.js'

export interface ConversationMeta {
  chatId: string
  /** First user message head (~14 chars); '' = not spoken yet (renders as "新对话") */
  title: string
  createdAt: number
  lastActiveAt: number
}

/** Per-file conversation state: the tab model's persisted half (openIds + activeId) */
export interface ConversationsState {
  conversations: ConversationMeta[]
  /** chatIds of currently open tabs, in tab order */
  openIds: string[]
  /** active tab's chatId; null = closed to zero (the empty state) */
  activeId: string | null
}

interface ConversationsFile {
  version: 1
  byFile: Record<string, ConversationsState>
}

// Same allowlist as store.ts — one local copy so store.ts stays untouched
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/

function assertSafeId(value: string, kind: 'chatId'): void {
  if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) {
    throw new Error(`Invalid ${kind} "${value}": must match ${String(SAFE_ID_PATTERN)}`)
  }
}

function nowMs(): number {
  return Date.now()
}

export class ConversationStore {
  private readonly baseDir: string
  private readonly store: ProjectStore

  constructor(userDataPath: string, store: ProjectStore) {
    this.baseDir = join(userDataPath, 'projects')
    this.store = store
  }

  // ── path helpers ──────────────────────────────────────────

  private convIndexPath(projectId: string): string {
    return join(this.baseDir, projectId, 'chats', 'conversations.json')
  }

  private chatJsonlPath(projectId: string, chatId: string): string {
    assertSafeId(chatId, 'chatId')
    return join(this.baseDir, projectId, 'chats', `${chatId}.jsonl`)
  }

  // ── index read/write ──────────────────────────────────────

  private readIndex(projectId: string): ConversationsFile {
    try {
      const path = this.convIndexPath(projectId)
      if (!existsSync(path)) return { version: 1, byFile: {} }
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as ConversationsFile
      if (!parsed || typeof parsed !== 'object' || !parsed.byFile) return { version: 1, byFile: {} }
      return parsed
    } catch {
      return { version: 1, byFile: {} }
    }
  }

  private writeIndex(projectId: string, file: ConversationsFile): void {
    // Atomic write via tmp+rename (same recipe as store.writeJson); failures
    // warn instead of throwing — the tab model degrades to in-memory state
    const path = this.convIndexPath(projectId)
    const tmpPath = `${path}.tmp`
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(tmpPath, JSON.stringify(file, null, 2), 'utf8')
      renameSync(tmpPath, path)
    } catch (err) {
      console.warn('[project-store] conversations write failed:', err)
    }
  }

  /**
   * Resolves the index key + projectId for a conversations API call.
   * Real files register through resolveChatForFile (seeding needs the stable
   * legacy chatId anyway); unsaved docs key by their temp id and live in the
   * default project without polluting fileMap. A conversation's chatId is a
   * fresh UUID minted once and never renamed (multi-conversation: several
   * jsonls share one file, so the legacy path-hash rebind cannot apply) —
   * only the index key moves on first save / rename.
   */
  private resolveKey(
    filePath: string | null,
    tempChatId?: string,
  ): { projectId: string; key: string; seedChatId: string } {
    if (filePath) {
      const { projectId, chatId } = this.store.resolveChatForFile(filePath)
      return { projectId, key: filePath, seedChatId: chatId }
    }
    this.store.ensureDefaultProject()
    // No legacy history exists behind a per-session temp id: seed with a fresh
    // immutable UUID so the save transition rebinds the key only, never chatIds
    return { projectId: 'default', key: tempChatId ?? `unsaved-${nowMs()}`, seedChatId: randomUUID() }
  }

  private deleteJsonl(projectId: string, chatId: string): void {
    try {
      const path = this.chatJsonlPath(projectId, chatId)
      if (existsSync(path)) unlinkSync(path)
    } catch (err) {
      console.warn('[project-store] conversations jsonl delete failed:', err)
    }
  }

  // ── public API (main-process side, exposed through project:conversations*) ──

  /**
   * Lists the conversation state for a file. First miss seeds the legacy
   * single-chat model in (one conversation = the file's existing chatId, open
   * and active) so pre-multi-conversation users keep their history verbatim.
   */
  list(filePath: string | null, tempChatId?: string): ConversationsState & { projectId: string } {
    const { projectId, key, seedChatId } = this.resolveKey(filePath, tempChatId)
    const file = this.readIndex(projectId)
    const existing = file.byFile[key]
    if (existing) {
      // Defensive repair: a wiped/never-written open set still lists its history
      if (!existing.openIds) existing.openIds = []
      if (!existing.conversations) existing.conversations = []
      return { ...existing, projectId }
    }
    const seeded: ConversationsState = {
      conversations: [
        { chatId: seedChatId, title: '', createdAt: nowMs(), lastActiveAt: nowMs() },
      ],
      openIds: [seedChatId],
      activeId: seedChatId,
    }
    file.byFile[key] = seeded
    this.writeIndex(projectId, file)
    return { ...seeded, projectId }
  }

  /** Creates a conversation (new chatId, lazily-backed jsonl) and activates it. */
  create(filePath: string | null, tempChatId?: string): { projectId: string; chatId: string } {
    const { projectId, key } = this.resolveKey(filePath, tempChatId)
    const chatId = randomUUID()
    assertSafeId(chatId, 'chatId')
    const file = this.readIndex(projectId)
    const state = file.byFile[key] ?? { conversations: [], openIds: [], activeId: null }
    const now = nowMs()
    state.conversations.push({ chatId, title: '', createdAt: now, lastActiveAt: now })
    state.openIds.push(chatId)
    state.activeId = chatId
    file.byFile[key] = state
    this.writeIndex(projectId, file)
    return { projectId, chatId }
  }

  /** Updates one conversation's title / last-active timestamp (no-op if unknown). */
  meta(
    filePath: string | null,
    chatId: string,
    patch: { title?: string; lastActiveAt?: number },
    tempChatId?: string,
  ): void {
    assertSafeId(chatId, 'chatId')
    const { projectId, key } = this.resolveKey(filePath, tempChatId)
    const file = this.readIndex(projectId)
    const state = file.byFile[key]
    const conv = state?.conversations.find((c) => c.chatId === chatId)
    if (!conv) return
    if (patch.title !== undefined) conv.title = patch.title
    if (patch.lastActiveAt !== undefined) conv.lastActiveAt = patch.lastActiveAt
    this.writeIndex(projectId, file)
  }

  /** Persists the open-tab set + active tab (the tab model's other half). */
  openSet(
    filePath: string | null,
    openIds: string[],
    activeId: string | null,
    tempChatId?: string,
  ): void {
    const { projectId, key } = this.resolveKey(filePath, tempChatId)
    const file = this.readIndex(projectId)
    const state = file.byFile[key] ?? { conversations: [], openIds: [], activeId: null }
    // Keep only known chatIds, preserving the caller's tab order
    const known = new Set(state.conversations.map((c) => c.chatId))
    state.openIds = openIds.filter((id) => known.has(id))
    state.activeId = activeId !== null && state.openIds.includes(activeId) ? activeId : null
    file.byFile[key] = state
    this.writeIndex(projectId, file)
  }

  /** Deletes one conversation: metadata + its jsonl. Only reachable for closed (historic) conversations. */
  deleteOne(filePath: string | null, chatId: string, tempChatId?: string): void {
    assertSafeId(chatId, 'chatId')
    const { projectId, key } = this.resolveKey(filePath, tempChatId)
    const file = this.readIndex(projectId)
    const state = file.byFile[key]
    if (!state) return
    const before = state.conversations.length
    state.conversations = state.conversations.filter((c) => c.chatId !== chatId)
    if (state.conversations.length === before) return
    state.openIds = state.openIds.filter((id) => id !== chatId)
    if (state.activeId === chatId) {
      state.activeId = state.openIds[0] ?? null
    }
    file.byFile[key] = state
    this.writeIndex(projectId, file)
    this.deleteJsonl(projectId, chatId)
  }

  /** Deletes every conversation NOT in openIds (the history list), metadata + jsonl each. */
  deleteAllExceptOpen(filePath: string | null, openIds: string[], tempChatId?: string): void {
    const { projectId, key } = this.resolveKey(filePath, tempChatId)
    const file = this.readIndex(projectId)
    const state = file.byFile[key]
    if (!state) return
    const keep = new Set(openIds)
    const doomed = state.conversations.filter((c) => !keep.has(c.chatId))
    if (doomed.length === 0) return
    state.conversations = state.conversations.filter((c) => keep.has(c.chatId))
    state.openIds = state.openIds.filter((id) => keep.has(id))
    if (state.activeId !== null && !keep.has(state.activeId)) {
      state.activeId = state.openIds[0] ?? null
    }
    file.byFile[key] = state
    this.writeIndex(projectId, file)
    for (const c of doomed) this.deleteJsonl(projectId, c.chatId)
  }

  /**
   * Moves a file's conversation state to a new key (unsaved → first save, file
   * rename/move). The source entry wins over any destination. Conversation
   * chatIds are immutable; when the entry crosses into another project the
   * conversation jsonls move with it so loadChat keeps finding them.
   */
  rebind(oldKey: string, newKey: string, chatIdMap?: Record<string, string>): void {
    if (oldKey === newKey) return
    // The destination resolves through the store (registers the mapping, returns its project)
    const { projectId } = this.resolveKey(newKey)
    const file = this.readIndex(projectId)
    // The temp key may live in the default project while the new path lives elsewhere
    const oldProjectId = oldKey.startsWith('unsaved-') ? 'default' : projectId
    const oldFile = oldProjectId === projectId ? file : this.readIndex(oldProjectId)
    const source = oldFile.byFile[oldKey]
    if (!source) return
    if (chatIdMap) {
      const remap = (id: string): string => chatIdMap[id] ?? id
      source.conversations = source.conversations.map((c) => ({ ...c, chatId: remap(c.chatId) }))
      source.openIds = source.openIds.map(remap)
      if (source.activeId !== null) source.activeId = remap(source.activeId)
    }
    delete oldFile.byFile[oldKey]
    if (oldProjectId !== projectId) this.writeIndex(oldProjectId, oldFile)
    file.byFile[newKey] = source
    this.writeIndex(projectId, file)
    // Cross-project move: bring the conversation jsonls along (rename fails silently → data stays readable in the old project)
    if (oldProjectId !== projectId) {
      for (const c of source.conversations) {
        try {
          const src = this.chatJsonlPath(oldProjectId, c.chatId)
          const dst = this.chatJsonlPath(projectId, c.chatId)
          if (existsSync(src) && !existsSync(dst)) renameSync(src, dst)
        } catch (err) {
          console.warn('[project-store] conversations jsonl move failed:', err)
        }
      }
    }
  }
}
