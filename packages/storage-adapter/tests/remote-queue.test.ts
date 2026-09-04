import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPendingSyncQueue, RemoteNotFoundError } from '../src/index.js'
import type { RemoteStorageClient } from '../src/index.js'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'chatoffice-remote-queue-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

interface FakeObject {
  bytes: Uint8Array
  etag: string
}

function fakeClient(
  bucket: Map<string, FakeObject>,
  broken?: { failHead?: boolean; failPut?: boolean },
): RemoteStorageClient {
  return {
    async putObject(key, bytes) {
      if (broken?.failPut) throw new Error('network down')
      const etag = `etag-${bucket.size + 1}`
      bucket.set(key, { bytes, etag })
      return { etag }
    },
    async getObject(key) {
      const entry = bucket.get(key)
      if (!entry) throw new RemoteNotFoundError()
      return { bytes: entry.bytes, etag: entry.etag }
    },
    async headObject(key) {
      if (broken?.failHead) throw new Error('network down')
      const entry = bucket.get(key)
      if (!entry) return null
      return { key, size: entry.bytes.length, lastModifiedMs: 0, etag: entry.etag }
    },
    async deleteObject(key) {
      bucket.delete(key)
    },
    async copyObject(fromKey, toKey) {
      const entry = bucket.get(fromKey)
      if (!entry) throw new RemoteNotFoundError()
      bucket.set(toKey, entry)
      return { etag: entry.etag }
    },
    async *listObjects() {},
    async testConnection() {
      return { ok: true, versioningEnabled: null }
    },
  }
}

describe('createPendingSyncQueue', () => {
  it('flushes a pending save and removes the slot', async () => {
    const dir = tempDir()
    const bucket = new Map<string, FakeObject>()
    const queue = createPendingSyncQueue({ dir, resolveClient: () => fakeClient(bucket) })
    queue.enqueue('cfg-1', 'chatoffice/a.docx', Buffer.from('pending-bytes'), 'e-load')
    expect(queue.status()).toHaveLength(1)

    bucket.set('chatoffice/a.docx', { bytes: Buffer.from('old'), etag: 'e-load' })
    const outcomes = await queue.flush()
    expect(outcomes).toEqual([
      {
        slot: expect.objectContaining({ key: 'chatoffice/a.docx' }),
        outcome: 'synced',
        etag: expect.any(String),
      },
    ])
    expect(Buffer.from(bucket.get('chatoffice/a.docx')!.bytes).toString()).toBe('pending-bytes')
    expect(queue.status()).toHaveLength(0)
  })

  it('keeps conflicting slots queued and reports them (consensus Q6)', async () => {
    const dir = tempDir()
    const bucket = new Map<string, FakeObject>([
      ['chatoffice/a.docx', { bytes: Buffer.from('theirs'), etag: 'e-theirs' }],
    ])
    const queue = createPendingSyncQueue({ dir, resolveClient: () => fakeClient(bucket) })
    queue.enqueue('cfg-1', 'chatoffice/a.docx', Buffer.from('mine'), 'e-mine')

    const outcomes = await queue.flush()
    expect(outcomes).toEqual([
      { slot: expect.anything(), outcome: 'conflict', currentEtag: 'e-theirs' },
    ])
    expect(queue.status()).toHaveLength(1)

    // adjudication: overwrite pushes the local bytes anyway
    const forced = await queue.flush({ force: true })
    expect(forced[0].outcome).toBe('synced')
    expect(Buffer.from(bucket.get('chatoffice/a.docx')!.bytes).toString()).toBe('mine')
    expect(queue.status()).toHaveLength(0)
  })

  it('treats a remotely deleted file as a conflict unless the slot is a new file', async () => {
    const dir = tempDir()
    const bucket = new Map<string, FakeObject>()
    const queue = createPendingSyncQueue({ dir, resolveClient: () => fakeClient(bucket) })

    queue.enqueue('cfg-1', 'chatoffice/gone.docx', Buffer.from('x'), 'e-was-there')
    expect((await queue.flush())[0]).toMatchObject({ outcome: 'conflict', currentEtag: null })

    queue.enqueue('cfg-1', 'chatoffice/brand-new.docx', Buffer.from('x'), null)
    // The conflicted gone.docx slot stays queued and is retried on every
    // flush, so the outcome array also carries it — key the assertion on the
    // brand-new slot instead of array position (order is not contractual).
    const second = await queue.flush()
    expect(
      second.find((outcome) => outcome.slot.key === 'chatoffice/brand-new.docx'),
    ).toMatchObject({ outcome: 'synced' })
    expect(bucket.has('chatoffice/brand-new.docx')).toBe(true)
  })

  it('reports network errors without dropping the slot', async () => {
    const dir = tempDir()
    const bucket = new Map<string, FakeObject>()
    const queue = createPendingSyncQueue({
      dir,
      resolveClient: () => fakeClient(bucket, { failPut: true }),
    })
    queue.enqueue('cfg-1', 'chatoffice/a.docx', Buffer.from('x'), null)

    const outcomes = await queue.flush()
    expect(outcomes).toEqual([
      { slot: expect.anything(), outcome: 'error', message: 'network down' },
    ])
    expect(queue.status()).toHaveLength(1)
  })

  it('recovers slots from disk on a fresh instance and filters by config', async () => {
    const dir = tempDir()
    const bucket = new Map<string, FakeObject>()
    const first = createPendingSyncQueue({ dir, resolveClient: () => fakeClient(bucket) })
    first.enqueue('cfg-1', 'chatoffice/a.docx', Buffer.from('one'), null)
    first.enqueue('cfg-2', 'chatoffice/b.docx', Buffer.from('two'), null)

    const second = createPendingSyncQueue({ dir, resolveClient: () => fakeClient(bucket) })
    expect(second.status('cfg-1').map((slot) => slot.key)).toEqual(['chatoffice/a.docx'])
    expect(second.status()).toHaveLength(2)

    const outcomes = await second.flush({ configId: 'cfg-2' })
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].slot.configId).toBe('cfg-2')
    expect(second.status()).toHaveLength(1)
  })

  it('discards slots and overwrites with the latest bytes on re-enqueue', async () => {
    const dir = tempDir()
    const bucket = new Map<string, FakeObject>()
    const queue = createPendingSyncQueue({ dir, resolveClient: () => fakeClient(bucket) })
    queue.enqueue('cfg-1', 'chatoffice/a.docx', Buffer.from('draft-1'), null)
    queue.enqueue('cfg-1', 'chatoffice/a.docx', Buffer.from('draft-2-latest'), null)
    expect(queue.status()[0].sizeBytes).toBe(Buffer.from('draft-2-latest').length)

    queue.discard('cfg-1', 'chatoffice/a.docx')
    expect(queue.status()).toHaveLength(0)
    expect(await queue.flush()).toEqual([])
  })

  it('writes slot files atomically (no tmp leftovers) and skips junk files', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'junk.json'), 'not json')
    writeFileSync(join(dir, 'half.json.tmp-123'), 'partial')
    const bucket = new Map<string, FakeObject>()
    const queue = createPendingSyncQueue({ dir, resolveClient: () => fakeClient(bucket) })
    queue.enqueue('cfg-1', 'chatoffice/a.docx', Buffer.from('x'), null)
    expect(queue.status()).toHaveLength(1)
    expect(
      readFileSync(
        join(
          dir,
          readdirSync(dir).find((name) => name.endsWith('.json'))!,
        ),
        'utf8',
      ),
    ).toContain('chatoffice/a.docx')
    expect(readdirSync(dir).filter((name) => name.includes('.tmp-'))).toEqual(['half.json.tmp-123'])
  })
})
