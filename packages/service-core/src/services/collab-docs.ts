/**
 * Collaborative documents service (plan v2.1, decision #4/5 — phase 3,
 * Markdown first). Yjs update log per document, persisted into the storage
 * area as base64 frames (one per line). This mirrors the production shape:
 * update stream in the transactional store (Postgres/SQLite), compaction
 * snapshots to blob storage later; here both live in the area so the
 * skeleton is testable end-to-end without a database.
 */

import * as Y from 'yjs'
import { join } from 'node:path'
import type { StorageArea } from '@chatoffice/storage-adapter'
import { openLocalArea } from '@chatoffice/storage-adapter'
import type { ServiceContext } from '../runtime.js'
import { defineService, ServiceEmitter } from '../runtime.js'

const COLLAB_DIR = 'collab'
const LOG_SUFFIX = '.ylog'

function logPath(docId: string): string {
  return `${COLLAB_DIR}/${docId}${LOG_SUFFIX}`
}

export interface CollabDocsApi {
  /** Applies a client update (Y.encodeStateAsUpdate delta) and persists it. */
  applyUpdate(docId: string, update: Uint8Array): void
  /** Full document state as a single update (for late joiners). */
  getState(docId: string): Uint8Array
  /** Server-computed diff a client needs given its current state vector. */
  getDiff(docId: string, stateVector: Uint8Array): Uint8Array
  /** The update log length in frames (diagnostics / compaction planning). */
  frameCount(docId: string): number
}

export function collabDocsService() {
  return defineService<CollabDocsApi>({
    name: 'collabDocs',
    create(context: ServiceContext): CollabDocsApi {
      const fs = context.storage.defaultArea().fs
      const docs = new Map<string, Y.Doc>()

      function doc(docId: string): Y.Doc {
        let d = docs.get(docId)
        if (!d) {
          d = new Y.Doc()
          replay(docId, d)
          docs.set(docId, d)
        }
        return d
      }

      function replay(docId: string, d: Y.Doc): void {
        const path = logPath(docId)
        if (!fs.existsSync(path)) return
        for (const line of fs.readFileSync(path).split('\n')) {
          if (!line) continue
          try {
            Y.applyUpdate(d, Uint8Array.from(Buffer.from(line, 'base64')))
          } catch {
            // skip corrupt frame; Yjs merges around it
          }
        }
      }

      function appendFrame(docId: string, update: Uint8Array): void {
        const path = logPath(docId)
        if (!fs.existsSync(COLLAB_DIR)) fs.mkdirSync(COLLAB_DIR)
        fs.appendFileSync(path, Buffer.from(update).toString('base64') + '\n')
      }

      return {
        applyUpdate(docId, update) {
          Y.applyUpdate(doc(docId), update)
          appendFrame(docId, update)
        },
        getState(docId) {
          return Y.encodeStateAsUpdate(doc(docId))
        },
        getDiff(docId, stateVector) {
          return Y.encodeStateAsUpdate(doc(docId), stateVector)
        },
        frameCount(docId) {
          const path = logPath(docId)
          if (!fs.existsSync(path)) return 0
          return fs.readFileSync(path).split('\n').filter(Boolean).length
        },
      }
    },
  })
}

/** Standalone convenience (mirrors createChatHistoryApi). */
export function createCollabDocsApi(params: {
  userDataPath?: string
  area?: StorageArea
}): CollabDocsApi {
  const area =
    params.area ?? openLocalArea({ rootDir: join(params.userDataPath ?? '.', 'collab') })
  const context: ServiceContext = {
    events: new ServiceEmitter(),
    storage: { defaultArea: () => area },
  }
  return collabDocsService().create(context)
}
