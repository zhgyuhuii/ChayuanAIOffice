// Cross-packaging sidecar staging for linux targets built on a foreign host.
//
// electron-builder's linux extraResources read the cargo host-native dev path
// (apps/sheets/native/xlsx-engine/target/release/xlsx-sidecar) — the same path
// `npm run test -w @chaoffice/sheets` and dev runs use. Packaging a foreign
// arch must swap the cross-built binary in for the pack WITHOUT destroying the
// host's copy: a linux-x64 pack on an arm64 mac used to leave the Linux ELF
// behind, and every later sidecar test/dev run failed to spawn it
// ("Exec format error"). beforePack stages (with a one-shot backup), afterPack
// restores.

const { copyFileSync, existsSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const HOST_BACKUP_SUFFIX = '.host-backup'

function sidecarPaths(shellDir, triple) {
  const target = join(shellDir, '../sheets/native/xlsx-engine/target')
  return {
    staged: join(target, 'release/xlsx-sidecar'),
    cross: join(target, `${triple}/release/xlsx-sidecar`),
    backup: join(target, `release/xlsx-sidecar${HOST_BACKUP_SUFFIX}`),
  }
}

/** Copy the cross-built sidecar over the host-native path, backing the host
 * binary up once. Throws when the cross artifact is missing (never package a
 * foreign-arch installer with the host binary silently inside). */
function stageCrossSidecar(shellDir, triple) {
  const { staged, cross, backup } = sidecarPaths(shellDir, triple)
  if (!existsSync(cross)) {
    throw new Error(
      `linux sidecar missing for ${triple}: ${cross} (cargo zigbuild --release --target ${triple}.2.28 first)`,
    )
  }
  // Back up only when no backup is in flight: a crashed earlier pack leaves
  // the backup behind, and the staged file may then be a foreign binary that
  // must not become the new "host" copy.
  if (!existsSync(backup) && existsSync(staged)) copyFileSync(staged, backup)
  copyFileSync(cross, staged)
}

/** Put the host-native sidecar back after a pack and drop the backup. */
function restoreHostSidecar(shellDir) {
  const { staged, backup } = sidecarPaths(shellDir, null)
  if (!existsSync(backup)) return
  copyFileSync(backup, staged)
  rmSync(backup)
}

module.exports = { HOST_BACKUP_SUFFIX, sidecarPaths, stageCrossSidecar, restoreHostSidecar }
