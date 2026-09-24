/**
 * Local-track StorageArea: direct node:fs delegation over a rooted directory.
 * Paths are validated (relative, no traversal) before reaching node:fs.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, normalize, sep } from 'node:path'
import type { LocalAreaOptions, StorageArea, SyncFs } from './types.js'

/** Asserts a relative, traversal-free path and returns it joined onto root. Empty string means the root itself. */
export function resolveWithin(root: string, path: string): string {
  if (path === '') return root
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('storage path must be a non-empty string')
  }
  if (isAbsolute(path) || path.split(/[\\/]/).includes('..')) {
    throw new Error(`storage path escapes the area root: ${path}`)
  }
  const full = join(root, path)
  const normalized = normalize(full)
  if (normalized !== full && normalized + sep !== full) {
    // On Windows `join` may produce mixed separators; compare loosely.
    if (normalized.replace(/\\/g, '/') !== full.replace(/\\/g, '/')) {
      throw new Error(`storage path is not canonical: ${path}`)
    }
  }
  return full
}

function createLocalFs(root: string): SyncFs {
  return {
    appendFileSync: (path, data) => void appendFileSync(resolveWithin(root, path), data, 'utf8'),
    existsSync: (path) => existsSync(resolveWithin(root, path)),
    mkdirSync: (path) => mkdirSync(resolveWithin(root, path), { recursive: true }),
    readFileSync: (path) => readFileSync(resolveWithin(root, path), 'utf8'),
    readdirSync: (path) => readdirSync(resolveWithin(root, path)),
    renameSync: (from, to) => renameSync(resolveWithin(root, from), resolveWithin(root, to)),
    statSync: (path) => {
      const s = statSync(resolveWithin(root, path))
      return { mtimeMs: s.mtimeMs, size: s.size }
    },
    unlinkSync: (path) => unlinkSync(resolveWithin(root, path)),
    writeFileSync: (path, data) => void writeFileSync(resolveWithin(root, path), data, 'utf8'),
  }
}

export function openLocalArea(options: LocalAreaOptions): StorageArea {
  if (!options.rootDir || !isAbsolute(options.rootDir)) {
    throw new Error(`local storage area needs an absolute rootDir, got: ${options.rootDir}`)
  }
  return { track: 'local', rootDir: options.rootDir, fs: createLocalFs(options.rootDir) }
}
