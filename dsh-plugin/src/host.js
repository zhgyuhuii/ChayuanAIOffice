/**
 * chatoffice — host 半（cordis 插件），运行在 dsh web 服务进程内。
 *
 * 职责：拉起/守护 ChatOffice BFF sidecar（vendor/chatoffice-sidecar，与
 * chatop 桌面内置形态共用同一套制品：Node BFF + SQLite/本地对象目录 +
 * Web 宿主 + 五编辑器静态资源），监听 127.0.0.1 动态端口（避开 dsh 的
 * 3080），/healthz 就绪探测，卸载时回收子进程。HTTP 管理面
 * /api/chatoffice/*（loopback 围栏）向 client 半提供 sidecar origin。
 *
 * spawn 节点对齐 chatop toolchain 模式：dsh web 在 Electron 形态下以
 * ELECTRON_RUN_AS_NODE 运行于 electron 可执行文件，子进程继承同样的
 * 运行方式；纯 `dsh web` 形态下就是普通 node。
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'chatoffice'
export const inject = ['webServer']

const API_PREFIX = '/api/chatoffice'
const START_TIMEOUT_MS = 60_000
const PROBE_INTERVAL_MS = 400

function packageRoot() {
  // dist/host.js → 包根
  return join(dirname(fileURLToPath(import.meta.url)), '..')
}

/** harness 的代理设置（设置页写进 .npmrc 的 proxy/https-proxy）翻译成 sidecar
 * 可消费的标准 env。office 自身无持久化代理配置、纯 env 驱动，这是唯一传导点。 */
function readNpmrcProxy() {
  const candidates = [join(dshHomeDir(), '.npmrc')]
  try {
    const profilesDir = join(dshHomeDir(), 'profiles')
    for (const name of readdirSync(profilesDir)) {
      candidates.push(join(profilesDir, name, '.npmrc'))
    }
  } catch {
    /* 没有 profiles 目录 */
  }
  for (const file of candidates) {
    try {
      const text = readFileSync(file, 'utf8')
      const pick = (key) => {
        const m = new RegExp(`^\\s*${key}\\s*=\\s*(\\S+)\\s*$`, 'm').exec(text)
        return m?.[1]
      }
      const proxy = pick('https-proxy') ?? pick('proxy')
      if (proxy) return proxy
    } catch {
      /* 读不到就跳过 */
    }
  }
  return ''
}

/** 本地端点（ollama 等本地模型服务、sidecar 回环 RPC）永远直连，NO_PROXY 必须盖住。 */
function withLocalNoProxy(existing) {
  const parts = new Set(
    String(existing ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  parts.add('127.0.0.1')
  parts.add('localhost')
  return [...parts].join(',')
}

function dshHomeDir() {
  const home =
    process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
      ? process.env.DSH_HOME.trim()
      : join(process.env.HOME ?? '/', '.dsh')
  return home
}

function dataDir() {
  return join(dshHomeDir(), 'storages', 'chatoffice')
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
  const sidecarDir = join(root, 'vendor', 'chatoffice-sidecar')
  const entry = join(sidecarDir, 'apps', 'server', 'src', 'main.ts')
  const bundled = existsSync(entry)

  /**
   * 模型设置真融合（共识 #8）：sidecar 的 AI 设置源指向 harness 的
   * llm-pi-ai（与 chatop 同一份）。写操作走 harness loopback RPC
   * （settings.mutate / credentials.set），其 origin 在首个请求到达时才能
   * 从 Host 头确认 —— 记到 dataDir/dsh-rpc-origin，sidecar 每次 RPC 调用
   * 前读取（带缓存），避免与启动顺序耦合。
   */
  const rpcOriginFile = join(dataDir(), 'dsh-rpc-origin')
  let rpcOriginWritten = false
  function rememberRpcOrigin(req) {
    if (rpcOriginWritten) return
    const host = req.headers?.host
    if (!host) return
    rpcOriginWritten = true
    try {
      writeFileSync(rpcOriginFile, `http://${host}`)
      console.log(`[chatoffice] harness rpc origin: http://${host}`)
    } catch {
      /* 融合退化为本地文件模式（读侧不受影响） */
    }
  }

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
      state.error = `sidecar bundle missing: ${sidecarDir}（在 chatoffice 仓库运行 npm run package:plugin 打包）`
      return
    }
    reapOrphan()
    mkdirSync(dataDir(), { recursive: true })
    const port = await freePort()
    const env = {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      CHATOFFICE_DATA_DIR: dataDir(),
      CHATOFFICE_AUTH: 'off', // 内嵌形态无账号（总体计划 v2.1 决策 #3）
      CHATOFFICE_STATIC_DIR: join(sidecarDir, 'dist', 'web'),
      // 模型设置真融合：供应商档案/密钥读写 harness 的 llm-pi-ai（与 chatop 同源）
      CHATOFFICE_DSH_HOME: dshHomeDir(),
      CHATOFFICE_DSH_RPC_ORIGIN_FILE: rpcOriginFile,
    }
    // 代理传导：harness .npmrc 里的代理翻译成标准 env（宿主进程已有代理 env 时
    // 以宿主为准）；NO_PROXY 盖住回环，保证本地模型服务与 RPC 永远直连
    const npmrcProxy = readNpmrcProxy()
    if (npmrcProxy && !env.HTTPS_PROXY && !env.https_proxy) {
      env.HTTPS_PROXY = npmrcProxy
      env.https_proxy = npmrcProxy
      if (!env.HTTP_PROXY && !env.http_proxy) env.HTTP_PROXY = npmrcProxy
    }
    env.NO_PROXY = withLocalNoProxy(env.NO_PROXY ?? env.no_proxy)
    env.no_proxy = env.NO_PROXY
    // dsh web 以 ELECTRON_RUN_AS_NODE 跑在 electron 可执行文件下时，子进程需要同样的标记
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1'

    // tsx-assets.cjs 先于 tsx 注册 `?asset` 资源扩展（slides 主进程源码的
    // harfbuzz.wasm / Carlito .ttf 导入在无打包器的 Node 下需要它）
    child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '--import',
        './apps/server/src/tsx-assets.cjs',
        'apps/server/src/main.ts',
      ],
      {
        cwd: sidecarDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    state.port = port
    state.pid = child.pid
    try {
      writeFileSync(pidFile(), String(child.pid))
    } catch {
      /* 诊断信息，可缺 */
    }
    child.stdout.on('data', (d) => {
      if (String(d).includes('listening')) console.log(`[chatoffice] ${String(d).trim()}`)
    })
    child.stderr.on('data', (d) => {
      const line = String(d).trim()
      if (line) console.warn(`[chatoffice:sidecar] ${line}`)
    })
    child.on('exit', (code) => {
      console.warn(`[chatoffice] sidecar exited (${code})`)
      child = null
      // 意外退出（曾就绪）→ 有限次自动重启，桌面窗口下次取 status 即恢复
      if (state.status === 'ready' && restarts < 3) {
        restarts += 1
        state.status = 'starting'
        state.error = null
        console.log(`[chatoffice] restarting sidecar (attempt ${restarts}/3)`)
        start()
      } else {
        state.status = 'failed'
        state.error = state.error ?? `sidecar exited with ${code}`
      }
    })

    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (await probe(port)) {
        state.status = 'ready'
        state.origin = `http://127.0.0.1:${port}`
        state.startedAt = new Date().toISOString()
        console.log(`[chatoffice] sidecar ready at ${state.origin}`)
        return
      }
      if (!child) {
        state.error = state.error ?? 'sidecar exited during startup'
        return
      }
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
      rememberRpcOrigin(req)
      if (!isLoopback(req)) return send(res, 403, { ok: false, error: 'loopback-only' })
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const path = url.pathname.slice(API_PREFIX.length)
      if (req.method === 'GET' && path === '/status') {
        return send(res, 200, { ok: true, ...state, appOrigin: '/chatoffice-app/' })
      }
      return send(res, 404, { ok: false, error: `unknown ${req.method} ${path}` })
    },
  }
  const disposeRoute = ctx.webServer.register(route)

  // Reverse proxy: the ChatOffice window lives on the STABLE dsh web origin
  // (/chatoffice-app/*), so a sidecar restart (new dynamic port) never kills
  // an open window — the app re-fetches /api/chatoffice/status and the proxy
  // follows the new origin.
  const APP_PREFIX = '/chatoffice-app'
  const proxyRoute = {
    kind: 'prefix',
    path: APP_PREFIX,
    handler: async (req, res) => {
      rememberRpcOrigin(req)
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
          ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: req, duplex: 'half' }),
        })
        const h = {}
        upstream.headers.forEach((v, k) => {
          h[k] = v
        })
        // entry files (html / bridge shim) must never come from a stale cache
        if (
          target.pathname === '/' ||
          /\.html?$/.test(target.pathname) ||
          target.pathname.endsWith('bridge-shim.js')
        ) {
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

  ctx.effect(
    () => () => {
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
    },
    'chatoffice: dispose sidecar & route',
  )

  return starting
}
