import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bindRemoteFilesIpc,
  createPendingSyncQueue,
  createRemoteFileService,
  createRemoteFilesClient,
  REMOTE_FILES_CHANNELS,
  RemoteNotFoundError,
  serializeError,
} from '../src/index.js'
import type { RemoteStorageClient } from '../src/index.js'

const CONFIG = {
  id: 'cfg-1',
  name: 'MinIO',
  protocol: 's3' as const,
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1',
  bucket: 'docs',
  accessKeyId: 'AK',
  secretAccessKey: 'SK',
  prefix: 'chatoffice/',
  pathStyle: true,
  enabled: true,
}

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function fakeClient(): RemoteStorageClient {
  const bucket = new Map<string, { bytes: Uint8Array; etag: string }>()
  return {
    async putObject(key, bytes) {
      const etag = `e-${bucket.size + 1}`
      bucket.set(key, { bytes, etag })
      return { etag }
    },
    async getObject(key) {
      const entry = bucket.get(key)
      if (!entry) throw new RemoteNotFoundError()
      return { bytes: entry.bytes, etag: entry.etag }
    },
    async headObject(key) {
      const entry = bucket.get(key)
      return entry ? { key, size: entry.bytes.length, lastModifiedMs: 0, etag: entry.etag } : null
    },
    async deleteObject(key) {
      bucket.delete(key)
    },
    async copyObject() {
      return { etag: 'e-copy' }
    },
    async *listObjects() {},
    async testConnection() {
      return { ok: true, versioningEnabled: true }
    },
  }
}

/** Wires host + client through in-memory transports, like ipcMain/ipcRenderer would. */
function wiredPair() {
  const root = mkdtempSync(join(tmpdir(), 'chatoffice-remote-ipc-'))
  roots.push(root)
  const remote = fakeClient()
  const channels = new Map<
    string,
    (
      payload: unknown,
    ) => Promise<
      | { ok: true; result: unknown }
      | {
          ok: false
          error: { name: string; message: string; status: number | null; code: string | null }
        }
    >
  >()
  bindRemoteFilesIpc(
    (channel, handler) => channels.set(channel, handler),
    () => ({
      service: createRemoteFileService({
        settingsFile: join(root, 'storage-settings.json'),
        indexDir: join(root, 'remote-index'),
        clientFactory: () => remote,
        env: {
          CHATOFFICE_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
          CHATOFFICE_STORAGE_BUCKET: 'docs',
          CHATOFFICE_STORAGE_ACCESS_KEY_ID: 'AK',
          CHATOFFICE_STORAGE_SECRET_ACCESS_KEY: 'SK',
        },
      }),
      queue: createPendingSyncQueue({ dir: join(root, 'queue'), resolveClient: () => remote }),
    }),
  )
  const client = createRemoteFilesClient(async (channel, payload) => {
    const handler = channels.get(channel)
    if (!handler) throw new Error(`no handler for ${channel}`)
    return handler(payload)
  })
  return { channels, client }
}

describe('remote files IPC bridge', () => {
  it('round-trips settings through the transport', async () => {
    const { channels, client } = wiredPair()
    expect(channels.size).toBe(Object.keys(REMOTE_FILES_CHANNELS).length)
    const settings = await client.getSettings()
    expect(settings.configs.map((config) => config.id)).toEqual(['env-default'])
    await expect(client.listFiles('cfg-unknown')).rejects.toThrowError(/unknown storage config/)
  })

  it('carries object bytes and queue operations end to end', async () => {
    const { client } = wiredPair()
    const saved = await client.saveSettings({
      version: 1,
      configs: [CONFIG],
      defaultLocation: { configId: 'cfg-1' },
    })
    expect(saved.configs).toHaveLength(1)

    const put = await client.uploadObject(
      'cfg-1',
      'chatoffice/a.docx',
      Buffer.from('bytes').toString('base64'),
    )
    expect(put.etag).toBe('e-1')
    const read = await client.readObject('cfg-1', 'chatoffice/a.docx')
    expect(Buffer.from(read.base64, 'base64').toString()).toBe('bytes')

    await client.queueEnqueue(
      'cfg-1',
      'chatoffice/a.docx',
      Buffer.from('queued').toString('base64'),
      null,
    )
    expect(await client.queueStatus()).toHaveLength(1)
    const outcomes = await client.queueFlush({ force: true })
    expect(outcomes[0].outcome).toBe('synced')
    expect(await client.queueStatus()).toHaveLength(0)

    await client.queueDiscard('cfg-1', 'chatoffice/never.docx')
    expect((await client.testConnection(CONFIG)).versioningEnabled).toBe(true)
  })

  it('serializes and revives error names across the bridge', () => {
    const error = serializeError(
      Object.assign(new Error('boom'), {
        name: 'RemoteConflictError',
        status: 409,
        code: 'EtagMismatch',
      }),
    )
    expect(error).toEqual({
      name: 'RemoteConflictError',
      message: 'boom',
      status: 409,
      code: 'EtagMismatch',
    })
    const revived = serializeError(new RemoteNotFoundError())
    expect(revived.status).toBe(404)
    expect(revived.code).toBe('NotFound')
  })
})
