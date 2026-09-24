import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openLocalArea } from '@chatoffice/storage-adapter'
import { chatHistoryService, createCore, ServiceEmitter } from '../src/index.js'

const dirs: string[] = []

function tempArea() {
  const dir = mkdtempSync(join(tmpdir(), 'chatoffice-core-'))
  dirs.push(dir)
  return openLocalArea({ rootDir: dir })
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function makeCore() {
  const area = tempArea()
  return createCore(
    { chatHistory: chatHistoryService() },
    { storage: { defaultArea: () => area } },
  )
}

describe('createCore', () => {
  it('exposes each service API under its name', () => {
    const core = makeCore()
    expect(core.api.chatHistory).toBeTruthy()
    expect(typeof core.api.chatHistory.resolveChat).toBe('function')
  })

  it('emits to subscribers and unsubscribe is idempotent', () => {
    const seen: string[] = []
    const emitter = new ServiceEmitter()
    const off = emitter.on('ai:stream-chunk', (p: { id: string }) => seen.push(p.id))
    emitter.emit('ai:stream-chunk', { id: 'c1' })
    emitter.emit('ai:stream-chunk', { id: 'c2' })
    off()
    off()
    emitter.emit('ai:stream-chunk', { id: 'c3' })
    expect(seen).toEqual(['c1', 'c2'])
  })
})

describe('chatHistory service', () => {
  it('resolves, appends, and loads a chat for a file path', async () => {
    const core = makeCore()
    const api = core.api.chatHistory
    const { projectId, chatId } = await api.resolveChat({ filePath: '/tmp/doc.md' })
    expect(projectId).toBe('default')
    await api.appendChat({ projectId, chatId, role: 'user', text: 'hello' })
    const msgs = await api.loadChat({ projectId, chatId })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].text).toBe('hello')
    expect(msgs[0].seq).toBe(0)
  })

  it('resolves unsaved files to the temp chat id', async () => {
    const core = makeCore()
    const res = await core.api.chatHistory.resolveChat({ filePath: null, tempChatId: 'unsaved-1' })
    expect(res).toEqual({ projectId: 'default', chatId: 'unsaved-1' })
  })

  it('rebinds a temp chat to a real file path, keeping the messages', async () => {
    const core = makeCore()
    const api = core.api.chatHistory
    await api.appendChat({ projectId: 'default', chatId: 'unsaved-1', role: 'assistant', text: 'answer' })
    const res = await api.rebindChat({
      projectId: 'default',
      tempChatId: 'unsaved-1',
      newFilePath: '/tmp/real.md',
    })
    expect(res.projectId).toBe('default')
    const msgs = await api.loadChat({ projectId: res.projectId, chatId: res.chatId })
    expect(msgs.map((m) => m.text)).toEqual(['answer'])
  })

  it('creates, renames, and lists projects', async () => {
    const core = makeCore()
    const api = core.api.chatHistory
    const created = await api.createProject({ name: 'Research' })
    expect(created.name).toBe('Research')
    await api.renameProject({ id: created.id, name: 'Research 2' })
    const list = await api.listProjects()
    expect(list.some((p) => p.name === 'Research 2')).toBe(true)
  })
})
