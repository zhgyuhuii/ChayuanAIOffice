/**
 * genoffice — host 半（cordis 插件），运行在 dsh web 服务进程内。
 *
 * 职责：拉起/守护 GenOffice BFF sidecar（vendor/genoffice-sidecar，与
 * chatop 桌面内置形态共用同一套制品：Node BFF + SQLite/本地对象目录 +
 * Web 宿主 + 五编辑器静态资源），监听 127.0.0.1 动态端口（避开 dsh 的
 * 3080），/healthz 就绪探测，卸载时回收子进程。HTTP 管理面
 * /api/genoffice/*（loopback 围栏）向 client 半提供 sidecar origin。
 *
 * spawn 节点对齐 chatop toolchain 模式：dsh web 在 Electron 形态下以
 * ELECTRON_RUN_AS_NODE 运行于 electron 可执行文件，子进程继承同样的
 * 运行方式；纯 `dsh web` 形态下就是普通 node。
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'genoffice'
export const inject = ['webServer']

const API_PREFIX = '/api/genoffice'
const START_TIMEOUT_MS = 60_000
const PROBE_INTERVAL_MS = 400

function packageRoot() {
  // dist/host.js → 包根
  return join(dirname(fileURLToPath(import.meta.url)), '..')
}

function dshHomeDir() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(process.env.HOME ?? '/', '.dsh')
  return home
}

function dataDir() {
  return join(dshHomeDir(), 'storages', 'genoffice')
}

function pidFile() {
  return join(dataDir(), 'sidecar.pid')
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function isLoopback(req) {
  const addr = req.socket?.remoteAddress ?? ''
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

function probe(port) {
  return new Promise((resolve) => {
    const req = fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2000) })
      .then((res) => resolve(res.status === 200))
      .catch(() => resolve(false))
    void req
  })
}

/** 杀掉上次会话遗留的孤儿 sidecar（pidfile 记录）。 */
function reapOrphan() {
  try {
    const pid = Number(readFileSync(pidFile(), 'utf8').trim())
    if (Number.isInteger(pid) && pid > 0) {
      process.kill(pid, 0) // throws if dead
      process.kill(pid, 'SIGTERM')
    }
  } catch {
    /* 没有孤儿 */
  }
  try {
    writeFileSync(pidFile(), '')
  } catch {
    /* 数据目录尚未建立 */
  }
}

export function apply(ctx) {
  const root = packageRoot()
  const sidecarDir = join(root, 'vendor', 'genoffice-sidecar')
  const entry = join(sidecarDir, 'apps', 'server', 'src', 'main.ts')
  const bundled = existsSync(entry)

  /** sidecar 状态：starting → ready | failed | missing */
  const state = {
    status: bundled ? 'starting' : 'missing',
    origin: null,
    port: null,
    pid: null,
    startedAt: null,
    error: null,
  }

  let child = null
  let restarts = 0

  async function start() {
    if (!bundled) {
      state.error = `sidecar bundle missing: ${sidecarDir}（在 genoffice 仓库运行 npm run package:plugin 打包）`
      return
    }
    reapOrphan()
    mkdirSync(dataDir(), { recursive: true })
    const port = await freePort()
    const env = {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      GENOFFICE_DATA_DIR: dataDir(),
      GENOFFICE_AUTH: 'off', // 内嵌形态无账号（总体计划 v2.1 决策 #3）
      GENOFFICE_STATIC_DIR: join(sidecarDir, 'dist', 'web'),
    }
    // dsh web 以 ELECTRON_RUN_AS_NODE 跑在 electron 可执行文件下时，子进程需要同样的标记
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1'

    child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
      cwd: sidecarDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    state.port = port
    state.pid = child.pid
    try {
      writeFileSync(pidFile(), String(child.pid))
    } catch {
      /* 诊断信息，可缺 */
    }
    child.stdout.on('data', (d) => { if (String(d).includes('listening')) console.log(`[genoffice] ${String(d).trim()}`) })
    child.stderr.on('data', (d) => {
      const line = String(d).trim()
      if (line) console.warn(`[genoffice:sidecar] ${line}`)
    })
    child.on('exit', (code) => {
      console.warn(`[genoffice] sidecar exited (${code})`)
      child = null
      // 意外退出（曾就绪）→ 有限次自动重启，桌面窗口下次取 status 即恢复
      if (state.status === 'ready' && restarts < 3) {
        restarts += 1
        state.status = 'starting'
        state.error = null
        console.log(`[genoffice] restarting sidecar (attempt ${restarts}/3)`)
        start()
      } else {
        state.status = 'failed'
        state.error = state.error ?? `sidecar exited with ${code}`
      }
    })

    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      if (await probe(port)) {
        state.status = 'ready'
        state.origin = `http://127.0.0.1:${port}`
        state.startedAt = new Date().toISOString()
        console.log(`[genoffice] sidecar ready at ${state.origin}`)
        return
      }
      if (!child) {
        state.error = state.error ?? 'sidecar exited during startup'
        return
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, PROBE_INTERVAL_MS))
    }
    state.status = 'failed'
    state.error = `sidecar not healthy after ${START_TIMEOUT_MS}ms`
    child?.kill()
  }

  const starting = start()

  const route = {
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req, res) => {
      if (!isLoopback(req)) return send(res, 403, { ok: false, error: 'loopback-only' })
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const path = url.pathname.slice(API_PREFIX.length)
      if (req.method === 'GET' && path === '/status') {
        return send(res, 200, { ok: true, ...state, appOrigin: '/genoffice-app/' })
      }
      return send(res, 404, { ok: false, error: `unknown ${req.method} ${path}` })
    },
  }
  const disposeRoute = ctx.webServer.register(route)

  // Reverse proxy: the GenOffice window lives on the STABLE dsh web origin
  // (/genoffice-app/*), so a sidecar restart (new dynamic port) never kills
  // an open window — the app re-fetches /api/genoffice/status and the proxy
  // follows the new origin.
  const APP_PREFIX = '/genoffice-app'
  const proxyRoute = {
    kind: 'prefix',
    path: APP_PREFIX,
    handler: async (req, res) => {
      if (!isLoopback(req)) return send(res, 403, { ok: false, error: 'loopback-only' })
      if (!state.origin) return send(res, 503, { ok: false, error: 'sidecar not ready' })
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const sub = url.pathname.slice(APP_PREFIX.length) || '/'
      const target = new URL(sub, state.origin)
      target.search = url.search
      try {
        const headers = { ...req.headers }
        delete headers.host
        delete headers.connection
        const upstream = await fetch(target, {
          method: req.method,
          headers,
          ...(req.method === 'GET' || req.method === 'HEAD'
            ? {}
            : { body: req, duplex: 'half' }),
        })
        const h = {}
        upstream.headers.forEach((v, k) => { h[k] = v })
        // entry files (html / bridge shim) must never come from a stale cache
        if (target.pathname === '/' || /\.html?$/.test(target.pathname) || target.pathname.endsWith('bridge-shim.js')) {
          h['cache-control'] = 'no-cache'
        }
        res.writeHead(upstream.status, h)
        if (upstream.body) {
          const reader = upstream.body.getReader()
          for (;;) {
            const r = await reader.read()
            if (r.done) break
            res.write(r.value)
          }
        }
        res.end()
      } catch (err) {
        send(res, 502, { ok: false, error: 'proxy: ' + String(err) })
      }
    },
  }
  const disposeProxy = ctx.webServer.register(proxyRoute)

  ctx.effect(() => () => {
    if (child) {
      child.kill()
      const pid = child.pid
      // 宽限后强杀（对齐 chatop-models 的回收纪律）
      setTimeout(() => {
        try {
          if (pid) process.kill(pid, 'SIGKILL')
        } catch {
          /* 已退出 */
        }
      }, 3000).unref?.()
    }
    disposeRoute()
    disposeProxy()
  }, 'genoffice: dispose sidecar & route')

  return starting
}
