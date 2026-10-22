import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
// Plain unit tests for the cross-packaging sidecar staging helpers: a linux
// x64 pack on an arm64 host used to leave the Linux ELF in the host-native
// dev path (target/release/xlsx-sidecar), permanently breaking sidecar tests
// and dev runs ("Exec format error"). These pin the backup/restore contract.
const {
  HOST_BACKUP_SUFFIX,
  sidecarPaths,
  stageCrossSidecar,
  restoreHostSidecar,
} = require('../build/linux-sidecar-staging.cjs')

// Everything lives under ONE mkdtemp root (<root>/shell + <root>/sheets) so
// cleanup removes exactly the tree this test created.
function fakeTree() {
  const root = mkdtempSync(join(tmpdir(), 'chaoffice-pkg-'))
  const shellDir = join(root, 'shell')
  const target = join(root, 'sheets/native/xlsx-engine/target')
  mkdirSync(join(target, 'release'), { recursive: true })
  mkdirSync(join(target, 'x86_64-unknown-linux-gnu/release'), { recursive: true })
  writeFileSync(join(target, 'release/xlsx-sidecar'), 'HOST-BIN')
  writeFileSync(join(target, 'x86_64-unknown-linux-gnu/release/xlsx-sidecar'), 'CROSS-BIN')
  return { root, shellDir, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

describe('linux sidecar staging', () => {
  it('stages the cross binary over the host path and keeps a one-shot backup', () => {
    const t = fakeTree()
    try {
      stageCrossSidecar(t.shellDir, 'x86_64-unknown-linux-gnu')
      const { staged, backup } = sidecarPaths(t.shellDir, 'x86_64-unknown-linux-gnu')
      expect(readFileSync(staged, 'utf8')).toBe('CROSS-BIN')
      expect(readFileSync(backup, 'utf8')).toBe('HOST-BIN')
      expect(backup).toContain(HOST_BACKUP_SUFFIX)
    } finally {
      t.cleanup()
    }
  })

  it('restore puts the host binary back and drops the backup', () => {
    const t = fakeTree()
    try {
      stageCrossSidecar(t.shellDir, 'x86_64-unknown-linux-gnu')
      restoreHostSidecar(t.shellDir)
      const { staged, backup } = sidecarPaths(t.shellDir, 'x86_64-unknown-linux-gnu')
      expect(readFileSync(staged, 'utf8')).toBe('HOST-BIN')
      expect(existsSync(backup)).toBe(false)
    } finally {
      t.cleanup()
    }
  })

  it('never promotes a staged foreign binary to the host backup', () => {
    const t = fakeTree()
    try {
      stageCrossSidecar(t.shellDir, 'x86_64-unknown-linux-gnu')
      // simulate a crashed pack: backup exists, staged holds the cross binary;
      // a second stage call must keep the ORIGINAL host backup
      stageCrossSidecar(t.shellDir, 'x86_64-unknown-linux-gnu')
      const { backup } = sidecarPaths(t.shellDir, 'x86_64-unknown-linux-gnu')
      expect(readFileSync(backup, 'utf8')).toBe('HOST-BIN')
    } finally {
      t.cleanup()
    }
  })

  it('throws when the cross artifact is missing instead of packaging the host binary', () => {
    const t = fakeTree()
    try {
      expect(() => stageCrossSidecar(t.shellDir, 'aarch64-unknown-linux-gnu')).toThrow(
        /linux sidecar missing/,
      )
    } finally {
      t.cleanup()
    }
  })

  it('restore is a no-op without a backup (native host packs)', () => {
    const t = fakeTree()
    try {
      expect(() => restoreHostSidecar(t.shellDir)).not.toThrow()
      const { staged } = sidecarPaths(t.shellDir, 'x86_64-unknown-linux-gnu')
      expect(readFileSync(staged, 'utf8')).toBe('HOST-BIN')
    } finally {
      t.cleanup()
    }
  })
})
