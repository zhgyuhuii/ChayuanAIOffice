/**
 * Storage track abstraction (plan v2.1, decision #2 / #14).
 *
 * Business logic (packages/service-core) must never touch a concrete storage
 * product. It talks to a StorageArea, and the hosting process decides which
 * track the area lives on:
 *
 *   local    — files on the user's machine (Electron fs / browser FS Access API)
 *   cloud    — SaaS BFF backing (Postgres + S3),  phase 1
 *   embedded — bundled sidecar backing (SQLite + local object dir), phase 2
 *
 * The sync fs surface below mirrors exactly the node:fs calls ProjectStore
 * needs today, so the local implementation is a direct delegation and the
 * embedded/cloud implementations can substitute a driver later.
 */

export type StorageTrack = 'local' | 'cloud' | 'embedded'

/**
 * Synchronous file-shaped operations over a rooted area. Paths passed to these
 * methods are relative to the area root; implementations must reject absolute
 * paths and `..` traversal.
 */
export interface SyncFs {
  appendFileSync(path: string, data: string): void
  existsSync(path: string): boolean
  mkdirSync(path: string): void
  readFileSync(path: string): string
  readdirSync(path: string): string[]
  renameSync(from: string, to: string): void
  statSync(path: string): { mtimeMs: number; size: number }
  unlinkSync(path: string): void
  writeFileSync(path: string, data: string): void
}

/** A rooted storage area: a track plus the fs-like operations inside it. */
export interface StorageArea {
  readonly track: StorageTrack
  /** Absolute root for diagnostics only; relative paths are the API. */
  readonly rootDir: string
  readonly fs: SyncFs
}

export interface LocalAreaOptions {
  /** Absolute directory acting as the area root. */
  rootDir: string
}
