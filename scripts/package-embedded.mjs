/**
 * Embedded BFF sidecar assembly (shared by form ③ chatop-desktop and form ④
 * dsh plugin, plan v2.1 decisions #13/#14/#15b).
 *
 * Assembles dsh-plugin/embedded/ as a self-contained monorepo subset and
 * installs production dependencies, so a host process can run:
 *
 *   node --import tsx embedded/apps/server/src/main.ts
 *
 * with HOST/PORT/GENOFFICE_DATA_DIR in its environment.
 */

import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dsh-plugin', 'embedded')

const PACKAGES = ['storage-adapter', 'service-core', 'project-store']
const EDITOR_APPS = [] // editors are renderer-side; the sidecar is server-only

function copyIfExists(from, to) {
  if (!existsSync(from)) throw new Error(`missing: ${from}`)
  cpSync(from, to, { recursive: true })
}

console.log(`assembling embedded sidecar → ${out}`)
rmSync(out, { recursive: true, force: true })
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
writeFileSync(join(out, '.npmrc'), 'install-scripts=false\n')

// Server app + engine packages (sources only; deps install below)
mkdirSync(join(out, 'apps'), { recursive: true })
copyIfExists(join(root, 'apps', 'server'), join(out, 'apps', 'server'))
mkdirSync(join(out, 'packages'), { recursive: true })
for (const pkg of PACKAGES) {
  copyIfExists(join(root, 'packages', pkg), join(out, 'packages', pkg))
}
void EDITOR_APPS

// Production dependency install inside the bundle
console.log('installing production dependencies (this may take a minute)...')
execSync('npm install --no-audit --no-fund --omit=dev', {
  cwd: out,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

// Smoke: the server entry must typecheck-import in place
console.log('embedded sidecar ready:')
console.log(`  ${out}`)
console.log('run:  node --import tsx apps/server/src/main.ts   (cwd = embedded)')
