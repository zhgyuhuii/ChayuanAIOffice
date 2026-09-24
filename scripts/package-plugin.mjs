/**
 * Form ④ packaging: the chatoffice dsh plugin.
 *
 *   dsh-plugin/
 *     package.json / cordis.patch.yml   dsh 插件清单（client+host 两半）
 *     dist/host.js                      spawn/守护 BFF sidecar + /api/chatoffice/*
 *     dist/client.js                    registerDesktopApp（Dock 图标 + 窗口）
 *     vendor/chatoffice-sidecar          全离线 BFF（Node + SQLite/本地存储 + Web 包）
 *
 * Archive: dist/chatoffice-<version>.tgz (不含 node_modules；sidecar 已含自身依赖)
 * Install: dsh plugin --profile web add -w <repo>/dsh-plugin
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pluginDir = join(root, 'dsh-plugin')
const dist = join(root, 'dist')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

function run(cmd, cwd = root, env = {}) {
  console.log(`> ${cmd}${cwd !== root ? `  (cwd: ${cwd})` : ''}`)
  execSync(cmd, { stdio: 'inherit', cwd, shell: process.platform === 'win32', env: { ...process.env, ...env } })
}

console.log('step 1: web bundle (host + editors)')
run('npm run build:web')

console.log('step 2: embedded sidecar -> dsh-plugin/vendor/chatoffice-sidecar')
run('node scripts/package-embedded.mjs', root, {
  EMBEDDED_OUT: join(pluginDir, 'vendor', 'chatoffice-sidecar'),
})

console.log('step 3: plugin dist (esbuild host + client)')
run('npm install --no-audit --no-fund', pluginDir)
run('npm run build', pluginDir)

console.log('step 4: archive')
// relative archive path: Windows bsdtar chokes on absolute drive paths here
run(`tar -czf ../dist/chatoffice-${version}.tgz --exclude node_modules .`, pluginDir)

console.log(`\nplugin ready: ${pluginDir}`)
console.log(`archive:      ${join(dist, `chatoffice-${version}.tgz`)}`)
console.log(`install:      dsh plugin --profile web add -w ${pluginDir}`)
