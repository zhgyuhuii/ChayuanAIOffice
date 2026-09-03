/** Public surface of the remote object-storage extension. */

export { createRemoteFilesHost } from './host.js'
export {
  bindRemoteFilesIpc,
  createRemoteFilesClient,
  REMOTE_FILES_CHANNELS,
  reviveError,
  serializeError,
  type FlushOptions,
  type RemoteFilesClient,
  type RemoteFilesHost,
  type TransportError,
} from './ipc.js'
export {
  createPendingSyncQueue,
  type FlushOutcome,
  type PendingSyncQueue,
  type PendingSyncQueueParams,
  type QueueSlotMeta,
} from './queue.js'
export {
  createRemoteStorageClient,
  type RemoteClientDeps,
  type RemoteStorageClient,
} from './client.js'
export {
  readRemoteIndexFile,
  remoteIndexPath,
  scanRemoteIndex,
  writeRemoteIndexFile,
  type RemoteFileIndex,
} from './file-index.js'
export {
  createRemoteFileService,
  type RemoteFileList,
  type RemoteFileService,
  type RemoteFileServiceParams,
} from './service.js'
export {
  applyRemoteStorageEnvSeed,
  createRemoteStorageConfig,
  DEFAULT_REMOTE_PREFIX,
  defaultSaveKey,
  emptyRemoteStorageSettings,
  ENV_SEEDED_CONFIG_ID,
  normalizeRemoteStorageSettings,
  readRemoteStorageSettingsFile,
  REMOTE_STORAGE_SETTINGS_VERSION,
  resolveDefaultSaveTarget,
  validateRemoteStorageConfig,
  writeRemoteStorageSettingsFile,
} from './settings.js'
export {
  RemoteConflictError,
  RemoteNotFoundError,
  RemoteStorageError,
  type RemoteFileInfo,
  type RemoteObject,
  type RemoteStorageConfig,
  type RemoteStorageDefaultLocation,
  type RemoteStorageProtocol,
  type RemoteStorageSettings,
  type TestConnectionResult,
} from './types.js'
export { formatRemoteUri, isRemoteUri, parseRemoteUri } from './uri.js'
