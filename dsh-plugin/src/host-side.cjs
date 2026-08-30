/**
 * genoffice-shell host half: managed BFF sidecar lifecycle.
 *
 * Contract with the dsh runtime:
 *   module.exports = { start(ctx) -> { port, stop() }, probe(port) }
 *
 *   ctx = {
 *     pluginDir:  absolute path of this plugin's install directory
 *     runtimeDir: writable scratch dir owned by this plugin instance
 *     log:        (msg) => void
 *   }
 *
 * Design (plan v2.1, decisions #13/#14/#15b): the sidecar is the SAME artifact
 * the chatop desktop bundle embeds (apps/server build + Rust xlsx sidecar +
 * SQLite + local object dir). Loopback-only, random port, dies with us.
 */

'use strict'

const { spawn } = require('node:child_process')
const { createServer } = require('node:http')
const net = require('node:net')
const path = require('node:path')
const fs = require('node:fs')

const EMBEDDED_DIRNAME = 'embedded' // filled by the phase-2 packaging step
const ENTRY = 'apps/server/src/main.ts'
const START_TIMEOUT_MS = 30_000
const PROBE_INTERVAL_MS = 400

/** Picks a free loopback port by binding :0. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

/** GET /healthz until it answers or the timeout lapses. */
async function waitHealthy(port, timeoutMs = START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probe(port)) return true
    await new Promise((r) => setTimeout(r, PROBE_INTERVAL_MS))
  }
  return false
}

function probe(port) {
  return new Promise((resolve) => {
    const req = require('node:http').get(
      { host: '127.0.0.1', port, path: '/healthz', timeout: 2000 },
      (res) => {
        resolve(res.statusCode === 200)
        res.resume()
      },
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function start(ctx) {
  const pluginDir = ctx.pluginDir
  const runtimeDir = ctx.runtimeDir
  fs.mkdirSync(runtimeDir, { recursive: true })

  const sidecarRoot = path.join(pluginDir, EMBEDDED_DIRNAME)
  if (!fs.existsSync(path.join(sidecarRoot, ENTRY))) {
    throw new Error(
      `[genoffice-shell] embedded sidecar missing at ${sidecarRoot} — run the phase-2 packaging step`,
    )
  }

  const port = await freePort()
  const child = spawn(process.execPath, ['--import', 'tsx', ENTRY], {
    cwd: sidecarRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      GENOFFICE_DATA_DIR: path.join(runtimeDir, 'data'),
      GENOFFICE_AUTH: 'off', // embedded form: no account required (decision #3)
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (d) => ctx.log(`[sidecar] ${d}`))
  child.stderr.on('data', (d) => ctx.log(`[sidecar:err] ${d}`))

  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)))

  const healthy = await waitHealthy(port)
  if (!healthy) {
    child.kill()
    throw new Error('[genoffice-shell] sidecar failed to become healthy in time')
  }

  let stopped = false
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    async stop() {
      if (stopped) return
      stopped = true
      child.kill()
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))])
    },
  }
}

// Standalone smoke: `node src/host-side.cjs` boots and probes a scratch server.
if (require.main === module) {
  const srv = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, JSON_HEADERS)
      res.end('{"ok":true}')
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  const JSON_HEADERS = { 'content-type': 'application/json' }
  srv.listen(0, '127.0.0.1', async () => {
    const { port } = srv.address()
    console.log('probe self:', await probe(port))
    srv.close()
  })
}

module.exports = { start, probe, waitHealthy, freePort }
