/**
 * Remote file index (plan consensus Q2/Q3): a per-process cache of the remote
 * listing, refreshed on startup and on demand. The index is disposable — the
 * bucket is always the source of truth, so a stale index only costs a refresh.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { RemoteStorageClient } from './client.js'
import type { RemoteFileInfo } from './types.js'

export interface RemoteFileIndex {
  configId: string
  refreshedAtMs: number
  files: RemoteFileInfo[]
}

export function remoteIndexPath(indexDir: string, configId: string): string {
  // config ids are safe path segments by construction (uri.ts enforces no '/')
  return join(indexDir, `${configId}.json`)
}

/** Reads a cached index; null when missing or corrupt. */
export function readRemoteIndexFile(indexDir: string, configId: string): RemoteFileIndex | null {
  try {
    const raw = JSON.parse(
      readFileSync(remoteIndexPath(indexDir, configId), 'utf8'),
    ) as Partial<RemoteFileIndex>
    if (!Array.isArray(raw.files) || typeof raw.refreshedAtMs !== 'number') return null
    return { configId, refreshedAtMs: raw.refreshedAtMs, files: raw.files }
  } catch {
    return null
  }
}

export function writeRemoteIndexFile(indexDir: string, index: RemoteFileIndex): void {
  const file = remoteIndexPath(indexDir, index.configId)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

/** Full listing scan under the prefix; replaces whatever the index held. */
export async function scanRemoteIndex(
  client: RemoteStorageClient,
  configId: string,
  prefix: string,
): Promise<RemoteFileIndex> {
  const files: RemoteFileInfo[] = []
  for await (const info of client.listObjects(prefix)) files.push(info)
  return { configId, refreshedAtMs: Date.now(), files }
}
