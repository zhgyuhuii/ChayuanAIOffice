import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createRemoteFileService,
  RemoteConflictError,
  RemoteNotFoundError,
  RemoteStorageError,
  type RemoteFileInfo,
  type RemoteStorageClient,
  type RemoteStorageConfig,
  type RemoteStorageSettings,
} from '../src/index.js'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'chatoffice-remote-service-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** In-memory bucket standing in for the real S3 client. */
function fakeClient(
  bucket: Map<string, { bytes: Uint8Array; etag: string; lastModifiedMs: number }>,
): RemoteStorageClient {
  async function nextEtag(): Promise<string> {
    return `etag-${bucket.size + 1}`
  }
  return {
    async putObject(key, bytes) {
      const etag = await nextEtag()
      bucket.set(key, { bytes, etag, lastModifiedMs: Date.now() })
      return { etag }
    },
    async getObject(key) {
      const entry = bucket.get(key)
      if (!entry) throw new RemoteNotFoundError()
      return { bytes: entry.bytes, etag: entry.etag }
    },
    async headObject(key) {
      const entry = bucket.get(key)
      if (!entry) return null
      return {
        key,
        size: entry.bytes.length,
        lastModifiedMs: entry.lastModifiedMs,
        etag: entry.etag,
      }
    },
    async deleteObject(key) {
      bucket.delete(key)
    },
    async copyObject(fromKey, toKey) {
      const entry = bucket.get(fromKey)
      if (!entry) throw new RemoteNotFoundError()
      const etag = await nextEtag()
      bucket.set(toKey, { ...entry, etag })
      return { etag }
    },
    async *listObjects(prefix) {
      for (const [key, entry] of bucket) {
        if (!key.startsWith(prefix)) continue
        const info: RemoteFileInfo = {
          key,
          size: entry.bytes.length,
          lastModifiedMs: entry.lastModifiedMs,
          etag: entry.etag,
        }
        yield info
      }
    },
    async testConnection() {
      return { ok: true, versioningEnabled: false }
    },
  }
}

const CONFIG: RemoteStorageConfig = {
  id: 'cfg-1',
  name: 'MinIO',
  protocol: 's3',
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1',
  bucket: 'docs',
  accessKeyId: 'AK',
  secretAccessKey: 'SK',
  prefix: 'chatoffice/',
  pathStyle: true,
  enabled: true,
}

function settingsWith(configs: RemoteStorageConfig[] = [CONFIG]): RemoteStorageSettings {
  return {
    version: 1,
    configs,
    defaultLocation: configs.length ? { configId: configs[0].id } : null,
  }
}

function buildService(bucket = new Map(), configs: RemoteStorageConfig[] = [CONFIG]) {
  const settingsFile = join(tempDir(), 'storage-settings.json')
  const indexDir = tempDir()
  const service = createRemoteFileService({
    settingsFile,
    indexDir,
    clientFactory: (_config) => fakeClient(bucket),
    env: {},
  })
  service.saveSettings(settingsWith(configs))
  return { service, settingsFile, indexDir }
}

describe('createRemoteFileService', () => {
  it('persists and returns settings', () => {
    const { service } = buildService()
    expect(service.getSettings().configs.map((config) => config.id)).toEqual(['cfg-1'])
  })

  it('rejects invalid configs on save and keeps the old state', () => {
    const { service } = buildService()
    const broken = settingsWith([{ ...CONFIG, accessKeyId: '' }])
    expect(() => service.saveSettings(broken)).toThrowError(/accessKeyId is required/)
    expect(service.getSettings().configs).toHaveLength(1)
  })

  it('writes and reads object bytes via base64', async () => {
    const { service } = buildService()
    const put = await service.writeObject(
      'cfg-1',
      'chatoffice/a.docx',
      Buffer.from('PK\u0003\u0004doc').toString('base64'),
    )
    expect(put.etag).toBe('etag-1')
    const read = await service.readObject('cfg-1', 'chatoffice/a.docx')
    expect(Buffer.from(read.base64, 'base64').toString('utf8')).toBe('PK\u0003\u0004doc')
    expect(read.etag).toBe('etag-1')
  })

  it('guards writes with the ETag seen at load (consensus Q6)', async () => {
    const bucket = new Map<string, { bytes: Uint8Array; etag: string; lastModifiedMs: number }>()
    const { service } = buildService(bucket)
    const first = await service.writeObject(
      'cfg-1',
      'chatoffice/a.docx',
      Buffer.from('v1').toString('base64'),
    )

    // a racing writer lands between load and save
    bucket.set('chatoffice/a.docx', {
      bytes: Buffer.from('v2'),
      etag: 'etag-other',
      lastModifiedMs: 2,
    })
    await expect(
      service.writeObject(
        'cfg-1',
        'chatoffice/a.docx',
        Buffer.from('v3').toString('base64'),
        first.etag,
      ),
    ).rejects.toBeInstanceOf(RemoteConflictError)

    // matching ETag passes, absent guard stays a blind put
    bucket.set('chatoffice/a.docx', {
      bytes: Buffer.from('v2'),
      etag: first.etag,
      lastModifiedMs: 2,
    })
    await expect(
      service.writeObject(
        'cfg-1',
        'chatoffice/a.docx',
        Buffer.from('v3').toString('base64'),
        first.etag,
      ),
    ).resolves.toEqual({ etag: expect.any(String) })
    await expect(
      service.writeObject('cfg-1', 'chatoffice/new.docx', Buffer.from('v1').toString('base64')),
    ).resolves.toEqual({ etag: expect.any(String) })
  })

  it('renames via copy+delete and refuses unknown or disabled configs', async () => {
    const bucket = new Map<string, { bytes: Uint8Array; etag: string; lastModifiedMs: number }>()
    const { service } = buildService(bucket)
    await service.writeObject('cfg-1', 'chatoffice/old.docx', Buffer.from('x').toString('base64'))
    await service.renameObject('cfg-1', 'chatoffice/old.docx', 'chatoffice/new.docx')
    expect([...bucket.keys()]).toEqual(['chatoffice/new.docx'])

    await expect(service.writeObject('missing', 'k', '')).rejects.toBeInstanceOf(RemoteStorageError)
    const disabled = settingsWith([{ ...CONFIG, enabled: false }])
    service.saveSettings(disabled)
    await expect(service.listFiles('cfg-1')).rejects.toThrowError(/disabled/)
  })

  it('refreshes the index, caches it, and lists from cache afterwards', async () => {
    const bucket = new Map<string, { bytes: Uint8Array; etag: string; lastModifiedMs: number }>()
    bucket.set('chatoffice/a.docx', { bytes: Buffer.from('a'), etag: 'e1', lastModifiedMs: 1 })
    bucket.set('chatoffice/b.docx', { bytes: Buffer.from('b'), etag: 'e2', lastModifiedMs: 2 })
    bucket.set('other/c.txt', { bytes: Buffer.from('c'), etag: 'e3', lastModifiedMs: 3 })
    const { service } = buildService(bucket)

    const refreshed = await service.refreshIndex('cfg-1')
    expect(refreshed.files.map((file) => file.key)).toEqual([
      'chatoffice/a.docx',
      'chatoffice/b.docx',
    ])

    // cache hit: even after the bucket changes, listing stays until refresh
    bucket.set('chatoffice/c.docx', { bytes: Buffer.from('c'), etag: 'e4', lastModifiedMs: 4 })
    const cached = await service.listFiles('cfg-1')
    expect(cached.files).toHaveLength(2)
    expect(cached.refreshedAtMs).toBe(refreshed.refreshedAtMs)

    const rescanned = await service.refreshIndex('cfg-1')
    expect(rescanned.files).toHaveLength(3)
  })

  it('auto-scans once when listing with no cached index', async () => {
    const bucket = new Map<string, { bytes: Uint8Array; etag: string; lastModifiedMs: number }>()
    bucket.set('chatoffice/solo.docx', { bytes: Buffer.from('s'), etag: 'e1', lastModifiedMs: 1 })
    const { service } = buildService(bucket)
    const list = await service.listFiles('cfg-1')
    expect(list.files.map((file) => file.key)).toEqual(['chatoffice/solo.docx'])
    expect(list.refreshedAtMs).toBeGreaterThan(0)
  })

  it('deletes objects and reports testConnection verbatim', async () => {
    const bucket = new Map<string, { bytes: Uint8Array; etag: string; lastModifiedMs: number }>()
    const { service } = buildService(bucket)
    await service.writeObject('cfg-1', 'chatoffice/temp.docx', Buffer.from('x').toString('base64'))
    await service.deleteObject('cfg-1', 'chatoffice/temp.docx')
    await expect(service.readObject('cfg-1', 'chatoffice/temp.docx')).rejects.toBeInstanceOf(
      RemoteNotFoundError,
    )
    expect(await service.testConnection(CONFIG)).toEqual({ ok: true, versioningEnabled: false })
    expect((await service.testConnection({ ...CONFIG, accessKeyId: '' })).ok).toBe(false)
  })
})
