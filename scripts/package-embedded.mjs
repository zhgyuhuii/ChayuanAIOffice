/**
 * Embedded BFF sidecar assembly (shared by form ③ chatop-desktop and form ④
 * dsh plugin, plan v2.1 decisions #13/#14/#15b).
 *
 * Assembles a self-contained sidecar — server sources, engine packages,
 * production node_modules, and the build:web static bundle — so a host
 * process can run:
 *
 *   node --import tsx <out>/apps/server/src/main.ts
 *   (preload <out>/apps/server/src/tsx-assets.cjs first: `?asset` imports
 *   from the slides sources need it outside a bundler)
 *
 * with HOST/PORT/CHATOFFICE_DATA_DIR/CHATOFFICE_STATIC_DIR in its environment.
 *
 *   EMBEDDED_OUT=<dir>   override the output root (default dsh-plugin/embedded)
 *   SKIP_WEB=1           skip requiring/copying dist/web (server-only sidecar)
 */

import {
  cpSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  readdirSync,
} from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(process.env.EMBEDDED_OUT ?? join(root, 'dsh-plugin', 'embedded'))

// Transitive @chatoffice/* closure of apps/server plus the shipped slides/sheets
// main sources. The synthetic workspace only links packages present here — a
// missing one makes npm install fall through to the registry and crash
// (arborist 'edgesOut' null), or the sidecar to fail on boot (ai-host/i18n/
// file-parse are phantom imports of the slides/sheets main sources).
const PACKAGES = [
  'agent-core', 'ai-host', 'ai-provider', 'ai-search', 'chart-kit', 'docx-engine',
  'electron-utils', 'file-parse', 'i18n', 'pptx-engine', 'pptx-render',
  'project-store', 'service-core', 'storage-adapter', 'ui', 'xlsx-gateway',
]

function copyIfExists(from, to) {
  if (!existsSync(from)) throw new Error(`missing: ${from}`)
  // cpSync nests when dest exists; mirror file-by-file instead
  const stat = statSync(from)
  if (stat.isDirectory()) {
    mkdirSync(to, { recursive: true })
    for (const entry of readdirSync(from)) {
      copyIfExists(join(from, entry), join(to, entry))
    }
  } else {
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to, { force: true })
  }
}

const webDist = join(root, 'dist', 'web')
if (!process.env.SKIP_WEB && !existsSync(join(webDist, 'index.html'))) {
  throw new Error(`web bundle missing (${webDist}) — run "npm run build:web" first (or SKIP_WEB=1)`)
}

console.log(`assembling embedded sidecar → ${out}`)

// OVERWRITE=1: refresh an existing bundle in place (Windows cwd-locks can
// make a clean delete impossible while a stale shell sits in the dir).
if (process.env.OVERWRITE === '1' && existsSync(out)) {
  console.log('overwrite mode: refreshing in place')
  process.env.__GO_SKIP_CLEAR__ = '1'
}
// Windows: AV/indexers briefly lock freshly-written trees; retry, then move aside.
const skipClear = process.env.__GO_SKIP_CLEAR__ === '1'
let cleared = skipClear
for (let i = 0; i < 6 && !cleared && !skipClear; i++) {
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
    throw new Error(
      `cannot clear ${out} — a process is holding it (close editors/watchers and retry)`,
    )
  }
}
mkdirSync(out, { recursive: true })

// Root manifests (workspaces subset; overrides preserved)
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'chatoffice-embedded',
      version: rootPkg.version,
      private: true,
      type: 'module',
      workspaces: ['apps/*', 'packages/*'],
      overrides: rootPkg.overrides,
      // ws is a root-level dep (server ws-gateway imports it); outside the root
      // workspace hoist it must be declared here or the sidecar crashes on boot.
      dependencies: { tsx: '^4.19.2', harfbuzzjs: '^1.5.0', ws: rootPkg.dependencies.ws },
    },
    null,
    2,
  ),
)
copyIfExists(join(root, 'tsconfig.base.json'), join(out, 'tsconfig.base.json'))

// Server app + engine packages (sources only; deps install below).
// slides/sheets main sources ship too: the server's pptx + save pipelines
// import them (render-build / save-pipeline / gateway modules are pure node).
mkdirSync(join(out, 'apps'), { recursive: true })
copyIfExists(join(root, 'apps', 'server'), join(out, 'apps', 'server'))
copyIfExists(join(root, 'apps', 'slides', 'src'), join(out, 'apps', 'slides', 'src'))
copyIfExists(join(root, 'apps', 'sheets', 'src'), join(out, 'apps', 'sheets', 'src'))
// The sidecar root manifest is type:module, but slides/sheets main sources are
// CJS in the repo (their app manifests carry no type field). Without this
// marker tsx compiles them as ESM, and the `?asset` wasm/font imports would go
// through the ESM loader (which parses the wasm as a module and fails) instead
// of CJS require, where tsx-assets.cjs handles them.
//
// The synthetic manifest also declares the node-side deps the shipped sources
// import at runtime (tiff-decode → pngjs/utif2, fonts → harfbuzzjs): the real
// app manifests are not installed here, so without these the server's pptx
// render pipeline dies on `Cannot find module 'pngjs'` at first import.
const slidesPkg = JSON.parse(readFileSync(join(root, 'apps', 'slides', 'package.json'), 'utf8'))
const slidesNodeDeps = {}
for (const name of ['pngjs', 'utif2', 'harfbuzzjs']) {
  if (slidesPkg.dependencies?.[name]) slidesNodeDeps[name] = slidesPkg.dependencies[name]
}
for (const app of ['slides', 'sheets']) {
  writeFileSync(
    join(out, 'apps', app, 'package.json'),
    JSON.stringify(
      {
        name: `@chatoffice/${app}-src`,
        version: rootPkg.version,
        private: true,
        type: 'commonjs',
        ...(app === 'slides' ? { dependencies: slidesNodeDeps } : {}),
      },
      null,
      2,
    ),
  )
}
mkdirSync(join(out, 'packages'), { recursive: true })
for (const pkg of PACKAGES) {
  copyIfExists(join(root, 'packages', pkg), join(out, 'packages', pkg))
}

// Production dependency install inside the bundle. --legacy-peer-deps: npm's
// loadPeerSet crashes on this synthetic workspace (vitest→jsdom→canvas chain,
// arborist 'edgesOut' null); legacy mode skips peer-set solving entirely.
console.log('installing production dependencies (this may take a minute)...')
execSync('npm install --no-audit --no-fund --omit=dev --legacy-peer-deps', {
  cwd: out,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

// Static web bundle (host + editors) served by the sidecar on the same port
if (!process.env.SKIP_WEB) {
  copyIfExists(webDist, join(out, 'dist', 'web'))
}

// Rust xlsx sidecar (prebuilt release binaries; platforms land as they are built)
const exe = process.platform === 'win32' ? 'xlsx-sidecar.exe' : 'xlsx-sidecar'
const nativeSrc = join(root, 'apps', 'sheets', 'native', 'xlsx-engine', 'target', 'release', exe)
if (existsSync(nativeSrc)) {
  mkdirSync(join(out, 'native', 'xlsx-sidecar'), { recursive: true })
  copyIfExists(nativeSrc, join(out, 'native', 'xlsx-sidecar', exe))
  console.log(`native: ${exe} bundled`)
} else {
  console.warn(`native: ${exe} not found at ${nativeSrc} — xlsx open will degrade`)
}

console.log('embedded sidecar ready:')
console.log(`  ${out}`)
console.log(
  'run:  node --import tsx --import ./apps/server/src/tsx-assets.cjs apps/server/src/main.ts   (cwd = sidecar root)',
)
