/**
 * scripts/publish-update-feed.mjs — publish the electron-updater feed files
 * (latest-mac.yml / latest.yml / latest-linux.yml) to the aidooo update
 * channel, matching the generic provider baked into resources/app-update.yml
 * (see apps/shell/electron-builder.cjs publish config).
 *
 *   node scripts/publish-update-feed.mjs [--feed-base <https url>]
 *                                        [--slot-base <https url>]
 *                                        [--host aidooo.com]
 *                                        [--remote-dir <server path>]
 *                                        [--dry-run]
 *
 * Feed layout (channel stable → latest*.yml; electron-updater appends the
 * platform suffix itself): macOS lists the zip FIRST (MacUpdater's findFile
 * picks .zip for the actual download; entry order matters) then the dmg,
 * which manualDownloadUrlFor (updater.ts) needs as the manual-install link.
 * Windows lists the NSIS exe; Linux lists the AppImage then the deb (the rpm
 * is a GitHub-Release download only and never enters a feed — same reason
 * electron-builder keeps publish: null on the rpm target).
 *
 * All urls are ABSOLUTE slot URLs (the same convention mac-release-upload
 * used upstream): electron-updater downloads straight from them, and the
 * manual-link picker only uses basenames. sha512 is base64 — that is what
 * electron-updater compares against after hashing the downloaded installer.
 *
 * Forward-only guard: the feed being pushed must not version-regress against
 * what is already live (reading the remote yml first). Same-version republish
 * (asset refresh, the 1.0.18/1.0.20 repackage precedent) is allowed.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const releaseDir = join(root, 'apps/shell/release')

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const dryRun = process.argv.includes('--dry-run')
const feedBase = arg('--feed-base', 'https://aidooo.com/downloads/office/update/')
const host = arg('--host', 'aidooo.com')
const remoteDir = arg('--remote-dir', '/data/website/deploy/docker/html/chayuan/downloads/office/update/')
const slotBase = arg('--slot-base', 'https://aidooo.com/downloads/office/installer')

const sha512B64 = (file) => createHash('sha512').update(readFileSync(file)).digest('base64')

function pick(candidates) {
  for (const { name, slot } of candidates) {
    const full = join(releaseDir, name)
    try {
      readFileSync(full)
      return { name, full, url: `${slotBase.replace(/\/+$/, '')}/${slot}/${name}` }
    } catch {
      /* try next */
    }
  }
  return null
}

// the shipped artifact names: mac zip/dmg carry -arm64, win exe is the Setup
// file, linux slot dirs split amd64/arm64
const macZip = pick([{ name: `ChaAIOffice-${version}-arm64.zip`, slot: 'mac-arm64' }])
const macDmg = pick([{ name: `ChaAIOffice-${version}-arm64.dmg`, slot: 'mac-arm64' }])
const winExe = pick([{ name: `ChaAIOffice-Setup-${version}.exe`, slot: 'windows-amd64' }])
const linuxAppImageX64 = pick([{ name: `ChaAIOffice-${version}-x86_64.AppImage`, slot: 'linux-amd64' }])
const linuxDebX64 = pick([{ name: `ChaAIOffice-${version}-amd64.deb`, slot: 'linux-amd64' }])

for (const [label, artifact] of [['mac zip', macZip], ['mac dmg', macDmg], ['win exe', winExe], ['linux AppImage', linuxAppImageX64], ['linux deb', linuxDebX64]]) {
  if (!artifact) {
    console.error(`[update-feed] missing ${label} in ${releaseDir} for ${version}`)
    process.exit(1)
  }
}

function fileEntry(artifact) {
  return {
    url: artifact.url,
    sha512: sha512B64(artifact.full),
    size: readFileSync(artifact.full).length,
  }
}

function renderYaml(version, entries) {
  const primary = entries[0]
  const lines = [
    `version: ${version}`,
    'files:',
    ...entries.flatMap((e) => [`  - url: ${e.url}`, `    sha512: ${e.sha512}`, `    size: ${e.size}`]),
    `path: ${primary.url}`,
    `sha512: ${primary.sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
  ]
  return `${lines.join('\n')}\n`
}

const feeds = {
  'latest-mac.yml': renderYaml(version, [fileEntry(macZip), fileEntry(macDmg)]),
  'latest.yml': renderYaml(version, [fileEntry(winExe)]),
  'latest-linux.yml': renderYaml(version, [fileEntry(linuxAppImageX64), fileEntry(linuxDebX64)]),
}

// ── forward-only guard: compare against the live feed before touching it
function remoteVersionOf(name) {
  try {
    const text = execFileSync(
      'ssh',
      [host, `cat ${remoteDir}${name} 2>/dev/null || true`],
      { encoding: 'utf8' },
    )
    const m = /^version:\s*(\S+)/m.exec(text)
    return m ? m[1] : null
  } catch {
    return null
  }
}

function versionParts(v) {
  return v.split(/[.+-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p))
}

for (const name of Object.keys(feeds)) {
  const live = remoteVersionOf(name)
  if (!live) continue
  if (live === version) continue // same-version asset refresh is allowed
  const a = versionParts(version)
  const b = versionParts(live)
  const regress = a.every((x, i) => (b[i] ?? 0) >= x) && b.some((x, i) => x > (a[i] ?? 0))
  if (regress) {
    console.error(`[update-feed] refusing to regress ${name}: live=${live} > push=${version}`)
    process.exit(1)
  }
}

// ── write locally, then push
const outDir = join(root, 'dist', 'update-feed')
mkdirSync(outDir, { recursive: true })
for (const [name, content] of Object.entries(feeds)) {
  writeFileSync(join(outDir, name), content)
  console.log(`[update-feed] ${name}:`)
  console.log(content)
}

if (dryRun) {
  console.log('[update-feed] dry run — nothing uploaded')
  process.exit(0)
}

execFileSync('ssh', [host, `mkdir -p ${remoteDir}`])
for (const name of Object.keys(feeds)) {
  execFileSync('scp', [join(outDir, name), `${host}:${remoteDir}${name}`])
  console.log(`[update-feed] uploaded ${name}`)
}

// verify: public URL must serve the exact pushed version
for (const name of Object.keys(feeds)) {
  const url = `${feedBase.replace(/\/+$/, '')}/${name}`
  const text = execFileSync('curl', ['-s', url], { encoding: 'utf8' })
  const m = /^version:\s*(\S+)/m.exec(text)
  if (m?.[1] !== version) {
    console.error(`[update-feed] VERIFY FAIL ${url}: got ${m?.[1] ?? 'nothing'}`)
    process.exit(1)
  }
  console.log(`[update-feed] verified ${url} → ${m[1]}`)
}
console.log(`[update-feed] OK — feed live at ${feedBase} (version ${version})`)
