/**
 * Form ④ packaging: the dsh plugin archive.
 *
 *   dist/genoffice-shell-<version>.tgz
 *     manifest.json
 *     src/client.js            thin shell (app registration)
 *     src/host-side.cjs        managed BFF sidecar lifecycle
 *     embedded/                full offline sidecar (from package:embedded)
 *
 * Install into a harness:  dsh plugin --profile web add genoffice-shell
 */

import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pluginDir = join(root, 'dsh-plugin')
const dist = join(root, 'dist')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

console.log('step 1: embedded sidecar')
execSync('node scripts/package-embedded.mjs', {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

console.log('step 2: staging plugin tree')
const stage = join(dist, 'genoffice-shell')
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
cpSync(join(pluginDir, 'manifest.json'), join(stage, 'manifest.json'))
cpSync(join(pluginDir, 'src'), join(stage, 'src'), { recursive: true })
cpSync(join(pluginDir, 'embedded'), join(stage, 'embedded'), { recursive: true })

console.log('step 3: archive')
// bsdtar (Windows 10+ / macOS / Linux) handles tgz everywhere
execSync(`tar -czf genoffice-shell-${version}.tgz genoffice-shell`, {
  cwd: dist,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

console.log(`\nplugin package ready: ${dist}/genoffice-shell-${version}.tgz`)
console.log('install: dsh plugin --profile web add <path-to>/genoffice-shell')
