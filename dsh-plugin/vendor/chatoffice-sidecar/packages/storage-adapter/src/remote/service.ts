/**
 * Remote file service: the framework-agnostic orchestration both hosts share
 * — the BFF exposes it over /rpc/remoteStorage/*, the Electron main process
 * binds it to IPC. All arguments and results stay JSON-serializable so the
 * same calls can cross HTTP and IPC without translation.
 *
 * Semantics fixed by plan consensus (2026-09-03):
 *   - the settings file is the only credential store (plaintext, 0600, Q8)
 *   - listing goes through the per-process index cache (Q2/Q3)
 *   - writes optionally guard with the ETag seen at load time; mismatches
 *     surface as RemoteConflictError for the caller to adjudicate (Q6)
 */

import { createRemoteStorageClient, type RemoteStorageClient } from './client.js'
import { readRemoteIndexFile, scanRemoteIndex, writeRemoteIndexFile } from './file-index.js'
import {
  applyRemoteStorageEnvSeed,
  emptyRemoteStorageSettings,
  normalizeRemoteStorageSettings,
  readRemoteStorageSettingsFile,
  validateRemoteStorageConfig,
  writeRemoteStorageSettingsFile,
} from './settings.js'
import {
  RemoteConflictError,
  RemoteStorageError,
  type RemoteFileInfo,
  type RemoteStorageConfig,
  type RemoteStorageSettings,
  type TestConnectionResult,
} from './types.js'

export interface RemoteFileServiceParams {
  /** Absolute path of the settings JSON file. */
  settingsFile: string
  /** Absolute directory holding `<configId>.json` index caches. */
  indexDir: string
  /** Test seam; defaults to the real S3 client. */
  clientFactory?: (config: RemoteStorageConfig) => RemoteStorageClient
  /** Environment used for first-run seeding (defaults to process.env). */
  env?: Record<string, string | undefined>
}

export interface RemoteFileList {
  configId: string
  refreshedAtMs: number
  files: RemoteFileInfo[]
}

export interface RemoteFileService {
  getSettings(): RemoteStorageSettings
  /** Validates and persists; returns the normalized settings actually stored. */
  saveSettings(settings: RemoteStorageSettings): RemoteStorageSettings
  testConnection(config: RemoteStorageConfig): Promise<TestConnectionResult>
  /** Full listing scan; persists the index cache and returns its summary. */
  refreshIndex(configId: string): Promise<RemoteFileList>
  /** Cached listing; transparently scans first when no cache exists yet. */
  listFiles(configId: string): Promise<RemoteFileList>
  readObject(configId: string, key: string): Promise<{ base64: string; etag: string }>
  /** Puts bytes; when `expectedEtag` is given, a changed remote throws RemoteConflictError. */
  writeObject(
    configId: string,
    key: string,
    base64: string,
    expectedEtag?: string,
  ): Promise<{ etag: string }>
  deleteObject(configId: string, key: string): Promise<void>
  renameObject(configId: string, fromKey: string, toKey: string): Promise<{ etag: string }>
  uploadObject(configId: string, key: string, base64: string): Promise<{ etag: string }>
  /** Builds a client for the config; throws on unknown/disabled ids (queue reuses this). */
  resolveClient(configId: string): RemoteStorageClient
}

export function createRemoteFileService(params: RemoteFileServiceParams): RemoteFileService {
  const clientFactory = params.clientFactory ?? createRemoteStorageClient

  let settings = readRemoteStorageSettingsFile(params.settingsFile) ?? emptyRemoteStorageSettings()
  const seeded = applyRemoteStorageEnvSeed(settings, params.env)
  if (seeded !== settings && settings.configs.length === 0) {
    settings = seeded
    writeRemoteStorageSettingsFile(params.settingsFile, settings)
  }

  function resolveConfig(configId: string): RemoteStorageConfig {
    const config = settings.configs.find((entry) => entry.id === configId)
    if (!config) {
      throw new RemoteStorageError(
        `unknown storage config: ${configId}`,
        404,
        'UnknownStorageConfig',
      )
    }
    if (!config.enabled) {
      throw new RemoteStorageError(
        `storage config is disabled: ${config.name}`,
        400,
        'StorageConfigDisabled',
      )
    }
    return config
  }

  function clientFor(configId: string): RemoteStorageClient {
    return clientFactory(resolveConfig(configId))
  }

  async function listSummary(
    configId: string,
    index: Awaited<ReturnType<typeof scanRemoteIndex>>,
  ): Promise<RemoteFileList> {
    writeRemoteIndexFile(params.indexDir, index)
    return { configId, refreshedAtMs: index.refreshedAtMs, files: index.files }
  }

  return {
    resolveClient: clientFor,

    getSettings() {
      return settings
    },

    saveSettings(input: RemoteStorageSettings) {
      const normalized = normalizeRemoteStorageSettings(input)
      const failures = normalized.configs.flatMap((config) =>
        validateRemoteStorageConfig(config).map((error) => `${config.name}: ${error}`),
      )
      if (failures.length)
        throw new RemoteStorageError(failures.join('; '), 400, 'InvalidStorageConfig')
      settings = normalized
      writeRemoteStorageSettingsFile(params.settingsFile, settings)
      return settings
    },

    async testConnection(input: RemoteStorageConfig) {
      const failures = validateRemoteStorageConfig(input)
      if (failures.length) return { ok: false, error: failures.join('; ') }
      return clientFactory(input).testConnection()
    },

    async refreshIndex(configId) {
      const config = resolveConfig(configId)
      const index = await scanRemoteIndex(clientFactory(config), configId, config.prefix)
      return listSummary(configId, index)
    },

    async listFiles(configId) {
      resolveConfig(configId)
      const cached = readRemoteIndexFile(params.indexDir, configId)
      if (cached) return { configId, refreshedAtMs: cached.refreshedAtMs, files: cached.files }
      return this.refreshIndex(configId)
    },

    async readObject(configId, key) {
      const object = await clientFor(configId).getObject(key)
      return { base64: Buffer.from(object.bytes).toString('base64'), etag: object.etag }
    },

    async writeObject(configId, key, base64, expectedEtag) {
      const client = clientFor(configId)
      if (expectedEtag !== undefined) {
        const head = await client.headObject(key)
        if (head && head.etag !== expectedEtag)
          throw new RemoteConflictError(key, expectedEtag, head.etag)
      }
      return client.putObject(key, Buffer.from(base64, 'base64'))
    },

    async deleteObject(configId, key) {
      await clientFor(configId).deleteObject(key)
    },

    async renameObject(configId, fromKey, toKey) {
      const client = clientFor(configId)
      const copied = await client.copyObject(fromKey, toKey)
      await client.deleteObject(fromKey)
      return copied
    },

    async uploadObject(configId, key, base64) {
      return clientFor(configId).putObject(key, Buffer.from(base64, 'base64'))
    },
  }
}
