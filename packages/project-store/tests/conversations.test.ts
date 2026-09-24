// LOCAL(2026-09-21, d8201ad0): 多会话对话索引单测(播种迁移/持久化/删除/rebind/interrupted 回环)
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProjectStore } from '../src/store.js'
import { ConversationStore } from '../src/conversations.js'

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'conversations-test-'))
}

describe('ConversationStore', () => {
  let tmpDir: string
  let store: ProjectStore
  let conv: ConversationStore
  const FILE = '/docs/合同.docx'

  beforeEach(() => {
    tmpDir = makeTempDir()
    store = new ProjectStore(tmpDir)
    conv = new ConversationStore(tmpDir, store)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── seeding migration ─────────────────────────────────────

  it('first list seeds the legacy single chat: one conversation, open and active', () => {
    const { chatId: legacyId } = store.resolveChatForFile(FILE)
    const state = conv.list(FILE)
    expect(state.conversations).toHaveLength(1)
    expect(state.conversations[0]!.chatId).toBe(legacyId)
    expect(state.openIds).toEqual([legacyId])
    expect(state.activeId).toBe(legacyId)
  })

  it('seeding is idempotent: second list returns the same state without duplicating', () => {
    const first = conv.list(FILE)
    const second = conv.list(FILE)
    expect(second.conversations).toHaveLength(first.conversations.length)
    expect(second.conversations[0]!.chatId).toBe(first.conversations[0]!.chatId)
  })

  it('unsaved docs key by tempChatId without polluting fileMap; seed chatId is a fresh UUID', () => {
    const state = conv.list(null, 'unsaved-123')
    expect(state.openIds).toEqual([state.conversations[0]!.chatId])
    // the conversation id must NOT be the temp id: chatIds are immutable across the save transition
    expect(state.conversations[0]!.chatId).not.toBe('unsaved-123')
    expect(state.conversations[0]!.chatId).toMatch(/^[0-9a-f-]{36}$/)
    const index = JSON.parse(readFileSync(join(tmpDir, 'projects', 'index.json'), 'utf8'))
    expect(index.fileMap['unsaved-123']).toBeUndefined()
  })

  // ── create / meta / openSet persistence ───────────────────

  it('create appends a conversation, opens and activates it', () => {
    conv.list(FILE)
    const { chatId } = conv.create(FILE)
    const state = conv.list(FILE)
    expect(state.conversations.map((c) => c.chatId)).toContain(chatId)
    expect(state.openIds).toEqual([state.conversations[0]!.chatId, chatId])
    expect(state.activeId).toBe(chatId)
  })

  it('meta updates title and lastActiveAt and persists across instances', () => {
    conv.list(FILE)
    const { chatId } = conv.create(FILE)
    conv.meta(FILE, chatId, { title: '帮我把这份合同的风险', lastActiveAt: 1726880900000 })
    // a fresh instance reads the same index file
    const conv2 = new ConversationStore(tmpDir, store)
    const state = conv2.list(FILE)
    const found = state.conversations.find((c) => c.chatId === chatId)
    expect(found?.title).toBe('帮我把这份合同的风险')
    expect(found?.lastActiveAt).toBe(1726880900000)
  })

  it('openSet persists tab order and activeId; unknown chatIds are dropped', () => {
    const seed = conv.list(FILE)
    const { chatId: b } = conv.create(FILE)
    const { chatId: c } = conv.create(FILE)
    conv.openSet(FILE, [seed.conversations[0]!.chatId, b, c], b)
    const state = conv.list(FILE)
    expect(state.openIds).toEqual([seed.conversations[0]!.chatId, b, c])
    expect(state.activeId).toBe(b)
    conv.openSet(FILE, [seed.conversations[0]!.chatId, 'ghost-id'], null)
    expect(conv.list(FILE).openIds).toEqual([seed.conversations[0]!.chatId])
    expect(conv.list(FILE).activeId).toBeNull()
  })

  // ── delete ────────────────────────────────────────────────

  it('delete removes metadata and the jsonl file', () => {
    const seed = conv.list(FILE)
    const seedId = seed.conversations[0]!.chatId
    // materialize the jsonl (a user-only append stays buffered until the first assistant line)
    store.appendChatMessage('default', seedId, { role: 'user', text: 'hello' })
    store.appendChatMessage('default', seedId, { role: 'assistant', text: 'hi' })
    const jsonl = join(tmpDir, 'projects', 'default', 'chats', `${seedId}.jsonl`)
    expect(existsSync(jsonl)).toBe(true)

    conv.openSet(FILE, [], null)
    conv.deleteOne(FILE, seedId)
    const state = conv.list(FILE)
    expect(state.conversations).toHaveLength(0)
    expect(existsSync(jsonl)).toBe(false)
  })

  it('deleteAll removes only closed conversations; open tabs survive', () => {
    const seed = conv.list(FILE)
    const seedId = seed.conversations[0]!.chatId
    const { chatId: historic } = conv.create(FILE)
    const { chatId: open } = conv.create(FILE)
    // historic was closed back (out of openIds); seedId + open stay open
    conv.openSet(FILE, [seedId, open], seedId)
    store.appendChatMessage('default', historic, { role: 'user', text: 'bye' })
    store.appendChatMessage('default', historic, { role: 'assistant', text: 'ok' })
    const historicJsonl = join(tmpDir, 'projects', 'default', 'chats', `${historic}.jsonl`)
    expect(existsSync(historicJsonl)).toBe(true)

    conv.deleteAllExceptOpen(FILE, [seedId, open])
    const state = conv.list(FILE)
    expect(state.conversations.map((c) => c.chatId).sort()).toEqual([seedId, open].sort())
    expect(existsSync(historicJsonl)).toBe(false)
  })

  // ── rebind ────────────────────────────────────────────────

  it('rebind moves the index key keeping chatIds, openIds and titles (immutable conversation ids)', () => {
    conv.list(null, 'unsaved-777')
    const state = conv.list(null, 'unsaved-777')
    const convId = state.conversations[0]!.chatId
    conv.meta(null, convId, { title: '未保存时的标题' }, 'unsaved-777')

    conv.rebind('unsaved-777', '/docs/saved.md')
    const rebound = conv.list('/docs/saved.md')
    expect(rebound.conversations).toHaveLength(1)
    expect(rebound.conversations[0]!.chatId).toBe(convId)
    expect(rebound.conversations[0]!.title).toBe('未保存时的标题')
    expect(rebound.openIds).toEqual([convId])
    expect(rebound.activeId).toBe(convId)
    // the old temp key is gone (a later list there re-seeds fresh)
    expect(conv.list(null, 'unsaved-777').conversations[0]!.chatId).not.toBe(convId)
  })

  it('rebind honours an explicit chatIdMap when provided', () => {
    conv.list(null, 'unsaved-555')
    const state = conv.list(null, 'unsaved-555')
    const convId = state.conversations[0]!.chatId
    conv.rebind('unsaved-555', '/docs/mapped.md', { [convId]: 'stable009' })
    const rebound = conv.list('/docs/mapped.md')
    expect(rebound.conversations[0]!.chatId).toBe('stable009')
  })

  it('rebind keeps a real-path key on file rename', () => {
    conv.list('/old/path.md')
    conv.create('/old/path.md')
    conv.rebind('/old/path.md', '/new/path.md')
    const moved = conv.list('/new/path.md')
    expect(moved.conversations).toHaveLength(2)
    expect(conv.list('/old/path.md').conversations).toHaveLength(1) // fresh seed, not the moved state
  })

  // ── interrupted field round-trip (D10) ────────────────────

  it('appendChat with interrupted persists the flag and loadChat returns it', () => {
    store.appendChatMessage('default', 'chat-int', {
      role: 'assistant',
      text: '半截回答',
      interrupted: true,
    })
    const msgs = store.loadChat('default', 'chat-int', 100)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.interrupted).toBe(true)
  })

  it('legacy records without the field read as undefined (falsy)', () => {
    // hand-write a legacy JSONL line without the interrupted field
    const dir = join(tmpDir, 'projects', 'default', 'chats')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'chat-legacy.jsonl'),
      JSON.stringify({ seq: 0, ts: 't', role: 'user', text: 'hi' }) + '\n',
      'utf8',
    )
    const msgs = store.loadChat('default', 'chat-legacy', 100)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.interrupted).toBeUndefined()
  })

  // ── safe id / concurrency ─────────────────────────────────

  it('rejects unsafe chat ids in meta/delete paths', () => {
    conv.list(FILE)
    expect(() => conv.deleteOne(FILE, '../escape')).toThrow()
    expect(() => conv.meta(FILE, '../escape', { title: 'x' })).toThrow()
    // nothing escaped into the filesystem
    expect(existsSync(join(tmpDir, 'escape.jsonl'))).toBe(false)
  })

  it('interleaved writes do not lose conversations (read-modify-write per call)', () => {
    conv.list(FILE)
    const ids = new Set<string>()
    for (let i = 0; i < 20; i++) ids.add(conv.create(FILE).chatId)
    const state = conv.list(FILE)
    for (const id of ids) expect(state.conversations.map((c) => c.chatId)).toContain(id)
    expect(state.openIds).toHaveLength(21)
  })
})
