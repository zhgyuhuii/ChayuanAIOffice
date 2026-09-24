import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const discoverMock = vi.fn()
vi.mock('@chatoffice/ai-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@chatoffice/ai-provider')>()),
  discoverHarnessKb: (...args: unknown[]) => discoverMock(...args),
}))

import { KB_CHANNELS } from '../src/kb-channels'
import { registerSharedKbIpc, type SharedKbIpcDeps } from '../src/kb-ipc'

type Handler = (event: unknown, ...args: never[]) => unknown

function fakeIpcMain(): { handlers: Map<string, Handler>; deps: SharedKbIpcDeps } {
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: (channel: string, listener: Handler) => {
      handlers.set(channel, listener)
    },
  }
  return { handlers, deps: { ipcMain, statePath: '' } }
}

const STATUS = { ok: true, kbs: [{ kbId: 'default', docs: [] }] }

describe('registerSharedKbIpc', () => {
  let dir: string
  let statePath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kb-ipc-'))
    statePath = join(dir, 'kb-source.json')
    discoverMock.mockReset()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('registers all channels', () => {
    const { handlers, deps } = fakeIpcMain()
    registerSharedKbIpc({ ...deps, statePath })
    for (const channel of Object.values(KB_CHANNELS)) {
      expect(handlers.has(channel)).toBe(true)
    }
  })

  it('discover returns ok:false when nothing is found', async () => {
    discoverMock.mockResolvedValue(null)
    const { handlers, deps } = fakeIpcMain()
    registerSharedKbIpc({ ...deps, statePath })
    const payload = (await handlers.get(KB_CHANNELS.discover)!(null as never)) as { ok: boolean }
    expect(payload).toEqual({ ok: false, reason: 'kb-unavailable' })
  })

  it('search returns per-KB groups and caches the discovered origin', async () => {
    discoverMock.mockResolvedValue({
      origin: 'http://127.0.0.1:3080',
      source: 'probe',
      status: STATUS,
    })
    const { handlers, deps } = fakeIpcMain()
    registerSharedKbIpc({ ...deps, statePath })
    // replace the upstream client with a stubbed one by pointing discovery at
    // a URL whose fetch we stub through the global
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/chatop-kb/search')) {
        return new Response(JSON.stringify({ ok: true, hits: [{ chunkId: 'c1' }] }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(STATUS), {
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    try {
      const payload = (await handlers.get(KB_CHANNELS.search)!(
        null as never,
        {
          kbIds: ['a', 'b'],
          q: '问题',
        } as never,
      )) as { ok: boolean; groups?: unknown[][] }
      expect(payload.ok).toBe(true)
      expect(payload.groups).toHaveLength(2)
      // origin persisted for the next start's cached level
      const state = JSON.parse(await readFile(statePath, 'utf8')) as { cachedOrigin?: string }
      expect(state.cachedOrigin).toBe('http://127.0.0.1:3080')
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('setOrigin persists a manual override and rejects non-http values', async () => {
    const { handlers, deps } = fakeIpcMain()
    registerSharedKbIpc({ ...deps, statePath })
    const set = handlers.get(KB_CHANNELS.setOrigin)!
    const state = (await set(null as never, 'http://127.0.0.1:3200' as never)) as {
      manualOrigin?: string
    }
    expect(state.manualOrigin).toBe('http://127.0.0.1:3200')
    await expect(set(null as never, 'ftp://x' as never)).rejects.toThrow()
    const cleared = (await set(null as never, null as never)) as { manualOrigin?: string }
    expect(cleared.manualOrigin).toBeUndefined()
    const persisted = JSON.parse(await readFile(statePath, 'utf8'))
    expect(persisted.manualOrigin).toBeUndefined()
  })

  it('writes state next to the settings file', async () => {
    const { handlers, deps } = fakeIpcMain()
    registerSharedKbIpc({ ...deps, statePath })
    await handlers.get(KB_CHANNELS.setOrigin)!(null as never, 'http://127.0.0.1:9' as never)
    const raw = await readFile(statePath, 'utf8')
    expect(JSON.parse(raw)).toMatchObject({ manualOrigin: 'http://127.0.0.1:9' })
    void writeFile
  })

  it('file downloads bytes into the downloads dir and reveals the result', async () => {
    discoverMock.mockResolvedValue({
      origin: 'http://127.0.0.1:3080',
      source: 'probe',
      status: STATUS,
    })
    const { handlers, deps } = fakeIpcMain()
    const downloads = join(dir, 'downloads')
    const revealed: string[] = []
    registerSharedKbIpc({
      ...deps,
      statePath,
      downloadsDir: () => downloads,
      reveal: (p) => revealed.push(p),
    })
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/chatop-kb/file')) {
        return new Response(new Uint8Array([7, 8, 9]), {
          headers: {
            'content-type': 'text/markdown',
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent('差旅报销制度.md')}`,
          },
        })
      }
      return new Response(JSON.stringify(STATUS), {
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    try {
      const payload = (await handlers.get(KB_CHANNELS.file)!(
        null as never,
        { kbId: '公司制度库', docId: 'd1' } as never,
      )) as { ok: boolean; savedPath?: string }
      expect(payload.ok).toBe(true)
      expect(payload.savedPath).toBe(join(downloads, '差旅报销制度.md'))
      expect(await readFile(payload.savedPath!)).toEqual(Buffer.from([7, 8, 9]))
      expect(revealed).toEqual([payload.savedPath])
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('file dedupes collisions and answers unsupported without a dir', async () => {
    const { handlers, deps } = fakeIpcMain()
    registerSharedKbIpc({ ...deps, statePath })
    const missing = (await handlers.get(KB_CHANNELS.file)!(
      null as never,
      { kbId: 'k', docId: 'd' } as never,
    )) as { ok: boolean; reason?: string }
    expect(missing).toEqual({ ok: false, reason: 'kb-download-unsupported' })

    discoverMock.mockResolvedValue({
      origin: 'http://127.0.0.1:3080',
      source: 'probe',
      status: STATUS,
    })
    const downloads = join(dir, 'downloads')
    const { handlers: h2, deps: d2 } = fakeIpcMain()
    registerSharedKbIpc({ ...d2, statePath, downloadsDir: () => downloads })
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/chatop-kb/file')) {
        return new Response('x', {
          headers: { 'content-disposition': 'attachment; filename="dup.txt"' },
        })
      }
      return new Response(JSON.stringify(STATUS), {
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    try {
      const first = (await h2.get(KB_CHANNELS.file)!(
        null as never,
        { kbId: 'k', docId: 'd1' } as never,
      )) as { savedPath?: string }
      const second = (await h2.get(KB_CHANNELS.file)!(
        null as never,
        { kbId: 'k', docId: 'd1' } as never,
      )) as { savedPath?: string }
      expect(first.savedPath).toBe(join(downloads, 'dup.txt'))
      expect(second.savedPath).toBe(join(downloads, 'dup (1).txt'))
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
