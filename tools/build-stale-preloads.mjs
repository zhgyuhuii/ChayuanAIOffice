/**
 * Rebuild app preloads whose sources are newer than the built artifact.
 *
 * In dev mode the shell loads each app's preload from apps/<app>/out/preload/
 * straight off disk; `npm run dev` only starts renderer vite servers and never
 * rebuilds preloads, so after a pull the artifact can silently miss newly added
 * preload APIs (calls fail with "... is not a function" in the renderer console
 * only). Runs as the root `predev` hook: a fresh tree is a fast no-op, a stale
 * app gets a full `electron-vite build` (the only entry point that emits the
 * preload bundle).
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const APPS = ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html']

/** Newest mtime (ms) under dir, 0 when missing. */
function newestMtime(dir) {
  if (!existsSync(dir)) return 0
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs)
  }
  return newest
}

// Workspace package sources feed every app preload's bundle graph
// (electron-utils, storage-adapter, …). A preload-only fix landing in
// packages/ never touches apps/<app>/src, so without this term the artifact
// stays "fresh" and dev keeps serving a preload that no longer matches the
// source — 0def8031 shipped exactly such a fix and docs kept a broken
// preload until a manual rebuild.
function newestPackageSourceMtime() {
  const root = join('packages')
  if (!existsSync(root)) return 0
  let newest = 0
  for (const pkg of readdirSync(root, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue
    newest = Math.max(newest, newestMtime(join(root, pkg.name, 'src')))
  }
  return newest
}
const packageSources = newestPackageSourceMtime()

const stale = APPS.filter((app) => {
  const artifact = join('apps', app, 'out', 'preload', 'index.js')
  const built = existsSync(artifact) ? statSync(artifact).mtimeMs : 0
  // shared/ is included: preloads import IPC channel/type modules from there
  const src = Math.max(
    newestMtime(join('apps', app, 'src', 'preload')),
    newestMtime(join('apps', app, 'src', 'shared')),
    packageSources,
  )
  return src > built
})

if (stale.length) {
  console.log(`Rebuilding stale preloads: ${stale.join(', ')}`)
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  for (const app of stale) {
    const r = spawnSync(npm, ['run', 'build', '-w', `@chatoffice/${app}`], {
      stdio: 'inherit',
      shell: process.platform === 'win32', // .cmd shims need a shell on Windows
    })
    if (r.error) {
      console.error(`Failed to launch ${npm}:`, r.error)
      process.exit(1)
    }
    if (r.status !== 0) process.exit(r.status ?? 1)
  }
}
