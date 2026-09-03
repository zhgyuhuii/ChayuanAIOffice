/**
 * IPC contract for remote files (mirrors project-store's ipc.ts approach:
 * type-only, no Electron dependency). The main process binds channels via
 * `bindRemoteFilesIpc`, renderers talk through `createRemoteFilesClient` with
 * whatever `invoke` their preload exposes. Errors cross the bridge as plain
 * { name, message, status, code } objects and are re-thrown reconstructed.
 */

import type { PendingSyncQueue, FlushOutcome, QueueSlotMeta } from './queue.js'
import type { RemoteFileList, RemoteFileService } from './service.js'
import type { RemoteStorageConfig, RemoteStorageSettings, TestConnectionResult } from './types.js'

export const REMOTE_FILES_CHANNELS = {
  getSettings: 'remote-files:getSettings',
  saveSettings: 'remote-files:saveSettings',
  testConnection: 'remote-files:testConnection',
  refreshIndex: 'remote-files:refreshIndex',
  listFiles: 'remote-files:listFiles',
  readObject: 'remote-files:readObject',
  writeObject: 'remote-files:writeObject',
  uploadObject: 'remote-files:uploadObject',
  deleteObject: 'remote-files:deleteObject',
  renameObject: 'remote-files:renameObject',
  queueStatus: 'remote-files:queueStatus',
  queueEnqueue: 'remote-files:queueEnqueue',
  queueDiscard: 'remote-files:queueDiscard',
  queueFlush: 'remote-files:queueFlush',
} as const

/** What the main process needs to expose; hosts wire service + queue together. */
export interface RemoteFilesHost {
  service: RemoteFileService
  queue: PendingSyncQueue
}

export interface TransportError {
  name: string
  message: string
  status: number | null
  code: string | null
}

export function serializeError(error: unknown): TransportError {
  if (error instanceof Error) {
    const status = (error as { status?: unknown }).status
    const code = (error as { code?: unknown }).code
    return {
      name: error.name,
      message: error.message,
      status: typeof status === 'number' ? status : null,
      code: typeof code === 'string' ? code : null,
    }
  }
  return { name: 'Error', message: String(error), status: null, code: null }
}

export function reviveError(transport: TransportError): Error {
  const error = new Error(transport.message)
  error.name = transport.name
  if (transport.status !== null)
    (error as TransportError & { status: number }).status = transport.status
  if (transport.code !== null) (error as TransportError & { code: string }).code = transport.code
  return error
}

type Result<T> = { ok: true; result: T } | { ok: false; error: TransportError }

async function call<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, result: await fn() }
  } catch (error) {
    return { ok: false, error: serializeError(error) }
  }
}

/**
 * Registers every channel on the given registrar (e.g. `ipcMain.handle`
 * wrapped to strip the event argument). Returns the unsubscriber map hosts
 * can ignore.
 */
export function bindRemoteFilesIpc(
  register: (channel: string, handler: (payload: unknown) => Promise<Result<unknown>>) => void,
  host: () => RemoteFilesHost,
): void {
  register(REMOTE_FILES_CHANNELS.getSettings, () => call(async () => host().service.getSettings()))
  register(REMOTE_FILES_CHANNELS.saveSettings, (payload) =>
    call(async () =>
      host().service.saveSettings((payload as { settings: RemoteStorageSettings }).settings),
    ),
  )
  register(REMOTE_FILES_CHANNELS.testConnection, (payload) =>
    call(async () =>
      host().service.testConnection((payload as { config: RemoteStorageConfig }).config),
    ),
  )
  register(REMOTE_FILES_CHANNELS.refreshIndex, (payload) =>
    call(async () => host().service.refreshIndex((payload as { configId: string }).configId)),
  )
  register(REMOTE_FILES_CHANNELS.listFiles, (payload) =>
    call(async () => host().service.listFiles((payload as { configId: string }).configId)),
  )
  register(REMOTE_FILES_CHANNELS.readObject, (payload) =>
    call(async () => {
      const args = payload as { configId: string; key: string }
      return host().service.readObject(args.configId, args.key)
    }),
  )
  register(REMOTE_FILES_CHANNELS.writeObject, (payload) =>
    call(async () => {
      const args = payload as {
        configId: string
        key: string
        base64: string
        expectedEtag?: string
      }
      return host().service.writeObject(args.configId, args.key, args.base64, args.expectedEtag)
    }),
  )
  register(REMOTE_FILES_CHANNELS.uploadObject, (payload) =>
    call(async () => {
      const args = payload as { configId: string; key: string; base64: string }
      return host().service.uploadObject(args.configId, args.key, args.base64)
    }),
  )
  register(REMOTE_FILES_CHANNELS.deleteObject, (payload) =>
    call(async () => {
      const args = payload as { configId: string; key: string }
      return host().service.deleteObject(args.configId, args.key)
    }),
  )
  register(REMOTE_FILES_CHANNELS.renameObject, (payload) =>
    call(async () => {
      const args = payload as { configId: string; fromKey: string; toKey: string }
      return host().service.renameObject(args.configId, args.fromKey, args.toKey)
    }),
  )
  register(REMOTE_FILES_CHANNELS.queueStatus, (payload) =>
    call(async () => host().queue.status((payload as { configId?: string } | undefined)?.configId)),
  )
  register(REMOTE_FILES_CHANNELS.queueEnqueue, (payload) =>
    call(async () => {
      const args = payload as {
        configId: string
        key: string
        base64: string
        expectedEtag: string | null
      }
      host().queue.enqueue(
        args.configId,
        args.key,
        Buffer.from(args.base64, 'base64'),
        args.expectedEtag,
      )
      return { ok: true }
    }),
  )
  register(REMOTE_FILES_CHANNELS.queueDiscard, (payload) =>
    call(async () => {
      const args = payload as { configId: string; key: string }
      host().queue.discard(args.configId, args.key)
      return { ok: true }
    }),
  )
  register(REMOTE_FILES_CHANNELS.queueFlush, (payload) =>
    call(async () => {
      const args = (payload as { options?: FlushOptions } | undefined)?.options
      return host().queue.flush(args)
    }),
  )
}

export interface FlushOptions {
  configId?: string
  key?: string
  force?: boolean
}

export interface RemoteFilesClient {
  getSettings(): Promise<RemoteStorageSettings>
  saveSettings(settings: RemoteStorageSettings): Promise<RemoteStorageSettings>
  testConnection(config: RemoteStorageConfig): Promise<TestConnectionResult>
  refreshIndex(configId: string): Promise<RemoteFileList>
  listFiles(configId: string): Promise<RemoteFileList>
  readObject(configId: string, key: string): Promise<{ base64: string; etag: string }>
  writeObject(
    configId: string,
    key: string,
    base64: string,
    expectedEtag?: string,
  ): Promise<{ etag: string }>
  uploadObject(configId: string, key: string, base64: string): Promise<{ etag: string }>
  deleteObject(configId: string, key: string): Promise<void>
  renameObject(configId: string, fromKey: string, toKey: string): Promise<{ etag: string }>
  queueStatus(configId?: string): Promise<QueueSlotMeta[]>
  queueEnqueue(
    configId: string,
    key: string,
    base64: string,
    expectedEtag: string | null,
  ): Promise<void>
  queueDiscard(configId: string, key: string): Promise<void>
  queueFlush(options?: FlushOptions): Promise<FlushOutcome[]>
}

/** Renderer-side client over a preload-provided invoke. */
export function createRemoteFilesClient(
  invoke: (channel: string, payload?: unknown) => Promise<Result<unknown>>,
): RemoteFilesClient {
  async function unwrap<T>(promise: Promise<Result<unknown>>): Promise<T> {
    const outcome = await promise
    if (outcome.ok) return outcome.result as T
    throw reviveError(outcome.error)
  }
  return {
    getSettings: () => unwrap(invoke(REMOTE_FILES_CHANNELS.getSettings)),
    saveSettings: (settings) => unwrap(invoke(REMOTE_FILES_CHANNELS.saveSettings, { settings })),
    testConnection: (config) => unwrap(invoke(REMOTE_FILES_CHANNELS.testConnection, { config })),
    refreshIndex: (configId) => unwrap(invoke(REMOTE_FILES_CHANNELS.refreshIndex, { configId })),
    listFiles: (configId) => unwrap(invoke(REMOTE_FILES_CHANNELS.listFiles, { configId })),
    readObject: (configId, key) =>
      unwrap(invoke(REMOTE_FILES_CHANNELS.readObject, { configId, key })),
    writeObject: (configId, key, base64, expectedEtag) =>
      unwrap(invoke(REMOTE_FILES_CHANNELS.writeObject, { configId, key, base64, expectedEtag })),
    uploadObject: (configId, key, base64) =>
      unwrap(invoke(REMOTE_FILES_CHANNELS.uploadObject, { configId, key, base64 })),
    deleteObject: (configId, key) =>
      unwrap(invoke(REMOTE_FILES_CHANNELS.deleteObject, { configId, key })),
    renameObject: (configId, fromKey, toKey) =>
      unwrap(invoke(REMOTE_FILES_CHANNELS.renameObject, { configId, fromKey, toKey })),
    queueStatus: (configId) => unwrap(invoke(REMOTE_FILES_CHANNELS.queueStatus, { configId })),
    queueEnqueue: (configId, key, base64, expectedEtag) =>
      unwrap(invoke(REMOTE_FILES_CHANNELS.queueEnqueue, { configId, key, base64, expectedEtag })),
    queueDiscard: (configId, key) =>
      unwrap(invoke(REMOTE_FILES_CHANNELS.queueDiscard, { configId, key })),
    queueFlush: (options) => unwrap(invoke(REMOTE_FILES_CHANNELS.queueFlush, { options })),
  }
}
