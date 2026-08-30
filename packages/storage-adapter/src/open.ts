/**
 * Area factory: resolves a track to a concrete StorageArea. cloud and
 * embedded backends arrive with the BFF phases (plan v2.1, decision #14).
 */

import { openLocalArea } from './local-fs.js'
import type { LocalAreaOptions, StorageArea, StorageTrack } from './types.js'

export function openStorageArea(track: StorageTrack, options: LocalAreaOptions): StorageArea {
  switch (track) {
    case 'local':
      return openLocalArea(options)
    case 'cloud':
    case 'embedded':
      throw new Error(`Storage track "${track}" is not implemented yet (planned in a later phase)`)
  }
}
