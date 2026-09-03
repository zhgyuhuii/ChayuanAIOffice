/**
 * Remote storage service: exposes the shared RemoteFileService (provider
 * configs, index cache, object byte transfer) as a service-core resident, so
 * the BFF serves it at /rpc/remoteStorage/* while the Electron main process
 * binds the same logic to IPC (plan consensus Q3/Q8: credentials and index
 * live with whichever host holds them).
 */

import { join } from 'node:path'
import { createRemoteFileService, type RemoteFileService } from '@chatoffice/storage-adapter'
import type { ServiceContext } from '../runtime.js'
import { defineService } from '../runtime.js'

export function remoteStorageService() {
  return defineService<RemoteFileService>({
    name: 'remoteStorage',
    create(context: ServiceContext): RemoteFileService {
      const root = context.storage.defaultArea().rootDir
      return createRemoteFileService({
        settingsFile: join(root, 'storage-settings.json'),
        indexDir: join(root, 'remote-index'),
      })
    },
  })
}
