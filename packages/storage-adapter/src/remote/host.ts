/**
 * Desktop host assembly: one RemoteFilesHost per Electron main process, all
 * state rooted under the app's userData directory. Both the shell (home/file
 * manager) and the editor mains (docs/sheets/slides) build this so every
 * process sees the same settings file, index cache and pending queue.
 */

import { join } from 'node:path'
import type { RemoteFilesHost } from './ipc.js'
import { createPendingSyncQueue } from './queue.js'
import { createRemoteFileService } from './service.js'

export function createRemoteFilesHost(userDataDir: string): RemoteFilesHost {
  const service = createRemoteFileService({
    settingsFile: join(userDataDir, 'storage-settings.json'),
    indexDir: join(userDataDir, 'remote-index'),
  })
  const queue = createPendingSyncQueue({
    dir: join(userDataDir, 'remote-sync-queue'),
    resolveClient: (configId) => service.resolveClient(configId),
  })
  return { service, queue }
}
