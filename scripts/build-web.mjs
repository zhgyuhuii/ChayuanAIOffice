/**
 * Form ② production build: assemble dist/web
 *
 *   dist/web/index.html            the UNMODIFIED shell renderer (harvested:
 *                                   TabBar + Home + onboarding, original code)
 *   dist/web/assets/               shell renderer bundle
 *   dist/web/editors/<key>/        the five editor renderer builds
 *   dist/web/bridge-shim.js        preload-shaped shims injected into editors
 *   dist/web/config.js             same-origin editor map (fallback)
 *
 * Served by the sidecar (CHATOFFICE_STATIC_DIR) or `npm run preview:web`.
 */

import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist', 'web')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const EDITORS = ['docs', 'sheets', 'slides', 'pdf', 'markdown']

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`)
  execSync(cmd, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32', ...opts })
}

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

// 1. Editor renderer builds (browser needs no main/preload/Rust sidecar, so
// build the renderer directly with the same config the dev servers use).
for (const key of EDITORS) {
  run(
    `${npm} exec -w @chatoffice/${key} -- vite build --config vite.renderer.config.ts --base ./ --outDir ../../out/renderer --emptyOutDir`,
  )
  const from = join(root, 'apps', key, 'out', 'renderer')
  if (!existsSync(from)) throw new Error(`missing renderer build: ${from}`)
  cpSync(from, join(dist, 'editors', key), { recursive: true })
}

// 2. Web host build = the harvested shell renderer (zero source changes)
run(`${npm} run build -w @chatoffice/web`)
cpSync(join(root, 'apps', 'web', 'dist'), dist, { recursive: true })

// 3. Editor bridge shim: preload-shaped shims served same-origin and injected
//    into every editor page BEFORE its module script.
await build({
  entryPoints: [join(root, 'packages', 'web-bridge', 'src', 'editor-shim.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  outfile: join(dist, 'bridge-shim.js'),
})

for (const key of EDITORS) {
  const htmlPath = join(dist, 'editors', key, 'index.html')
  if (!existsSync(htmlPath)) continue
  let html = readFileSync(htmlPath, 'utf8')
  const shimHash = createHash('sha256').update(readFileSync(join(dist, 'bridge-shim.js'))).digest('hex').slice(0, 12)
  if (!html.includes('bridge-shim.js')) {
    html = html.replace('<head>', '<head>' + String.fromCharCode(10) + '    <script src="../../bridge-shim.js?v=' + shimHash + '"></script>')
    writeFileSync(htmlPath, html)
  }
}

// 4. Same-origin editor map fallback (the host index.html already carries
//    defaults; config.js remains for tooling/debugging).
writeFileSync(
  join(dist, 'config.js'),
  `window.CHATOFFICE_EDITORS = {\n${EDITORS.map((k) => `  ${k}: 'editors/${k}/',`).join('\n')}\n}\n`,
)

console.log(`\nweb bundle ready: ${dist}`)
console.log('serve with: npm run preview:web   (plus: npm run start:server)')
