/**
 * Embedded BFF sidecar assembly (shared by form ③ chatop-desktop and form ④
 * dsh plugin, plan v2.1 decisions #13/#14/#15b).
 *
 * Assembles a self-contained sidecar — server sources, engine packages,
 * production node_modules, and the build:web static bundle — so a host
 * process can run:
 *
 *   node --import tsx <out>/apps/server/src/main.ts
 *
 * with HOST/PORT/GENOFFICE_DATA_DIR/GENOFFICE_STATIC_DIR in its environment.
 *
 *   EMBEDDED_OUT=<dir>   override the output root (default dsh-plugin/embedded)
 *   SKIP_WEB=1           skip requiring/copying dist/web (server-only sidecar)
 */

import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, renameSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(process.env.EMBEDDED_OUT ?? join(root, 'dsh-plugin', 'embedded'))

const PACKAGES = ['storage-adapter', 'service-core', 'project-store']

function copyIfExists(from, to) {
  if (!existsSync(from)) throw new Error(`missing: ${from}`)
  cpSync(from, to, { recursive: true })
}

const webDist = join(root, 'dist', 'web')
if (!process.env.SKIP_WEB && !existsSync(join(webDist, 'index.html'))) {
  throw new Error(`web bundle missing (${webDist}) — run "npm run build:web" first (or SKIP_WEB=1)`)
}

console.log(`assembling embedded sidecar → ${out}`)
// Windows: AV/indexers briefly lock freshly-written trees; retry, then move aside.
let cleared = false
for (let i = 0; i < 6 && !cleared; i++) {
  try {
    rmSync(out, { recursive: true, force: true })
    cleared = true
  } catch {
    await new Promise((r) => setTimeout(r, 1000))
  }
}
if (!cleared) {
  rmSync(`${out}-stale`, { recursive: true, force: true })
  try {
    renameSync(out, `${out}-stale`)
  } catch {
    throw new Error(`cannot clear ${out} — a process is holding it (close editors/watchers and retry)`)
  }
}
mkdirSync(out, { recursive: true })

// Root manifests (workspaces subset; overrides preserved)
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'genoffice-embedded',
      version: rootPkg.version,
      private: true,
      type: 'module',
      workspaces: ['apps/*', 'packages/*'],
      overrides: rootPkg.overrides,
      dependencies: { tsx: '^4.19.2' },
    },
    null,
    2,
  )
)
copyIfExists(join(root, 'tsconfig.base.json'), join(out, 'tsconfig.base.json'))

// Server app + engine packages (sources only; deps install below)
mkdirSync(join(out, 'apps'), { recursive: true })
copyIfExists(join(root, 'apps', 'server'), join(out, 'apps', 'server'))
mkdirSync(join(out, 'packages'), { recursive: true })
for (const pkg of PACKAGES) {
  copyIfExists(join(root, 'packages', pkg), join(out, 'packages', pkg))
}

// Production dependency install inside the bundle
console.log('installing production dependencies (this may take a minute)...')
execSync('npm install --no-audit --no-fund --omit=dev', {
  cwd: out,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

// Static web bundle (host + editors) served by the sidecar on the same port
if (!process.env.SKIP_WEB) {
  cpSync(webDist, join(out, 'dist', 'web'), { recursive: true })
}

console.log('embedded sidecar ready:')
console.log(`  ${out}`)
console.log('run:  node --import tsx apps/server/src/main.ts   (cwd = sidecar root)')
