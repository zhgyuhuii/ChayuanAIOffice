/**
 * Form ② production build: assemble dist/web/
 *
 *   dist/web/index.html            web host (tab shell)
 *   dist/web/editors/<key>/        the five editor renderer builds
 *   dist/web/config.js             editor origin map (same-origin paths)
 *
 * Served by `npm run preview:web` (node scripts/serve-web.mjs) or any static
 * server; pair with the BFF (`npm run start:server` / Docker image).
 */

import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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
    `${npm} exec -w @genoffice/${key} -- vite build --config vite.renderer.config.ts --outDir ../../out/renderer --emptyOutDir`,
  )
  const from = join(root, 'apps', key, 'out', 'renderer')
  if (!existsSync(from)) throw new Error(`missing renderer build: ${from}`)
  cpSync(from, join(dist, 'editors', key), { recursive: true })
}

// 2. Web host build
run(`${npm} run build -w @genoffice/web`)
cpSync(join(root, 'apps', 'web', 'dist'), dist, { recursive: true })

// 3. Same-origin editor map, loaded before the host bundle
writeFileSync(
  join(dist, 'config.js'),
  `window.GENOFFICE_EDITORS = {\n${EDITORS.map((k) => `  ${k}: 'editors/${k}/',`).join('\n')}\n}\n`,
)
const htmlPath = join(dist, 'index.html')
let html = readFileSync(htmlPath, 'utf8')
html = html.replace('<head>', '<head>\n    <script src="/config.js"></script>')
writeFileSync(htmlPath, html)

console.log(`\nweb bundle ready: ${dist}`)
console.log('serve with: npm run preview:web   (plus: npm run start:server)')
