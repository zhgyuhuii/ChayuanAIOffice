import { spawn, execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LocalToolStatus, LocalToolOpResult } from '@chatoffice/ai-provider'

/**
 * 本地与自建厂商的一键安装/探测/启动 —— ai:local-tool-* 通道的实现。
 *
 * Renderer 只发 vendorId；命令永远从本文件的静态 spec 表构造，不接受任意
 * 参数。安装走各平台官方渠道（ollama 官方包 / Homebrew / winget / npm），
 * 过程行通过 onLine 回调透出（IPC 侧映射到 ai:local-tool-progress 事件）。
 * 探测=固定 localhost 端点 + PATH/常见路径二进制查找，全部短超时。
 */

export interface LocalToolDeps {
  platform: NodeJS.Platform
  /** GET a probe URL, resolve body text; reject when unreachable (short timeout) */
  probe(url: string, timeoutMs?: number): Promise<string>
  /** lookup a binary on PATH; null when absent */
  which(binary: string): Promise<string | null>
  /** filesystem existence check for app/binary paths */
  exists(path: string): boolean
  /** run a command, streaming trimmed stdout/stderr lines; rejects on non-zero exit */
  run(cmd: string, args: string[], onLine?: (line: string) => void): Promise<void>
  /** fire-and-forget detached spawn (long-running servers) */
  spawnDetached(cmd: string, args: string[]): void
  /** write installers to a temp dir; returns the absolute file path */
  writeTemp(fileName: string, data: Uint8Array): Promise<string>
  fetch: typeof globalThis.fetch
  /** pause between start-polling attempts (injectable for tests) */
  sleep(ms: number): Promise<void>
}

const OLLAMA_VERSION_URL = 'http://127.0.0.1:11434/api/version'
const OLLAMA_MAC_ZIP = 'https://ollama.com/download/ollama-macos.zip'
const OLLAMA_WIN_SETUP = 'https://ollama.com/download/OllamaSetup.exe'

interface LocalToolSpec {
  /** endpoint that answers once the local server runs */
  probeUrl?: string
  /** version JSON/text parsing off the probe body */
  parseVersion?: (body: string) => string | undefined
  binary?: string
  /** filesystem candidates checked when the binary is not on PATH (per platform) */
  paths?: Partial<Record<NodeJS.Platform, string[]>>
  install?: (deps: LocalToolDeps, onLine?: (line: string) => void) => Promise<string>
  start?: (deps: LocalToolDeps) => Promise<string>
  /** startable per platform (default: start exists → true) */
  startableOn?: (platform: NodeJS.Platform) => boolean
  installableOn?: (platform: NodeJS.Platform) => boolean
  /** 官方手动下载页：安装失败时拼进失败信息（国内网络直连失败的用户兜底） */
  manualUrl?: string
}

const expandWin = (p: string): string =>
  p.replace(/%LOCALAPPDATA%/g, process.env.LOCALAPPDATA ?? '')

async function pollRunning(deps: LocalToolDeps, url: string, attempts = 20): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      await deps.probe(url, 1200)
      return true
    } catch {
      await deps.sleep(1000)
    }
  }
  return false
}

/** 下载体读流的卡死/首包超时（真实计时器；测试里响应即时返回不会触发） */
function raceTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)}MB`

/** 流式下载到临时文件：百分比进度经 onLine 透出，首包 30s/读流卡死 60s 超时 */
async function downloadTo(
  deps: LocalToolDeps,
  url: string,
  fileName: string,
  onLine?: (line: string) => void,
): Promise<string> {
  let resp: Response
  try {
    resp = await raceTimeout(deps.fetch(url), 30_000, '连接超时：无法连上下载源')
  } catch (err) {
    throw err instanceof Error && err.message.includes('超时') ? err : new Error(`下载失败：${url}`)
  }
  if (!resp.ok) throw new Error(`下载失败：HTTP ${resp.status} ${url}`)
  const total = Number(resp.headers.get('content-length') ?? 0)
  if (!resp.body) {
    const buf = new Uint8Array(await resp.arrayBuffer())
    return deps.writeTemp(fileName, buf)
  }
  const reader = resp.body.getReader()
  const chunks: Uint8Array[] = []
  let got = 0
  let lastPct = -100
  let lastTick = 0
  for (;;) {
    const { done, value } = await raceTimeout(reader.read(), 60_000, '下载超时：数据流中断')
    if (done) break
    if (value) {
      chunks.push(value)
      got += value.length
    }
    const now = Date.now()
    const pct = total ? Math.floor((got / total) * 100) : 0
    if ((total && pct !== lastPct && now - lastTick > 1500) || (!total && now - lastTick > 3000)) {
      lastPct = pct
      lastTick = now
      onLine?.(total ? `下载中 ${pct}%（${mb(got)}/${mb(total)}）` : `已下载 ${mb(got)}`)
    }
  }
  const buf = new Uint8Array(got)
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.length
  }
  return deps.writeTemp(fileName, buf)
}

async function brewOn(deps: LocalToolDeps): Promise<boolean> {
  return (await deps.which('brew')) !== null
}

const OLLAMA_BIN_PATHS: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: [
    '/usr/local/bin/ollama',
    '/opt/homebrew/bin/ollama',
    '/Applications/Ollama.app/Contents/Resources/ollama',
  ],
  win32: ['%LOCALAPPDATA%\\Programs\\Ollama\\ollama.exe'],
  linux: ['/usr/local/bin/ollama'],
}

const SPECS: Record<string, LocalToolSpec> = {
  ollama: {
    probeUrl: OLLAMA_VERSION_URL,
    parseVersion: (body) => {
      try {
        return (JSON.parse(body) as { version?: string }).version
      } catch {
        return undefined
      }
    },
    binary: 'ollama',
    paths: OLLAMA_BIN_PATHS,
    async install(deps, onLine) {
      if (deps.platform === 'darwin' && (await brewOn(deps))) {
        await deps.run('brew', ['install', 'ollama'], onLine)
        return '已通过 Homebrew 安装 Ollama'
      }
      if (deps.platform === 'darwin') {
        onLine?.('未检测到 Homebrew，改为下载官方 Ollama.app…')
        const zip = await downloadTo(deps, OLLAMA_MAC_ZIP, 'ollama-macos.zip', onLine)
        await deps.run('ditto', ['-x', '-k', zip, '/Applications/'], onLine)
        return '已安装 Ollama.app 到 /Applications'
      }
      if (deps.platform === 'win32') {
        onLine?.('下载官方安装包（OllamaSetup.exe）…')
        const exe = await downloadTo(deps, OLLAMA_WIN_SETUP, 'OllamaSetup.exe', onLine)
        await deps.run(exe, ['/silent'], onLine)
        return '已运行官方安装包完成安装'
      }
      await deps.run('sh', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], onLine)
      return '已通过官方脚本安装 Ollama'
    },
    async start(deps) {
      const ollama =
        (await deps.which('ollama')) ??
        (OLLAMA_BIN_PATHS[deps.platform] ?? []).map(expandWin).find(deps.exists) ??
        null
      if (deps.platform === 'darwin' && deps.exists('/Applications/Ollama.app')) {
        deps.run('open', ['-a', 'Ollama'])
      } else if (ollama) {
        deps.spawnDetached(ollama, ['serve'])
      } else {
        throw new Error('ollama 可执行文件未找到，请先安装')
      }
      return (await pollRunning(deps, OLLAMA_VERSION_URL))
        ? 'Ollama 服务已启动'
        : '启动超时：服务未在 20 秒内应答'
    },
    manualUrl: 'https://ollama.com/download',
  },

  'lm-studio': {
    probeUrl: 'http://127.0.0.1:1234/v1/models',
    binary: 'lms',
    paths: {
      darwin: ['/Applications/LM Studio.app'],
      win32: ['%LOCALAPPDATA%\\LM-Studio\\LM Studio.exe'],
    },
    installableOn: (p) => p === 'darwin' || p === 'win32',
    async install(deps, onLine) {
      if (deps.platform === 'darwin') {
        if (!(await brewOn(deps)))
          throw new Error('macOS 需要 Homebrew：请先安装 brew，或到 lmstudio.ai 下载')
        await deps.run('brew', ['install', '--cask', 'lm-studio'], onLine)
        return '已通过 Homebrew Cask 安装 LM Studio'
      }
      await deps.run(
        'winget',
        [
          'install',
          '-e',
          '--id',
          'LM-Studio.LM-Studio',
          '--accept-source-agreements',
          '--accept-package-agreements',
        ],
        onLine,
      )
      return '已通过 winget 安装 LM Studio'
    },
    manualUrl: 'https://lmstudio.ai',
  },

  codex: {
    binary: 'codex',
    installableOn: () => true,
    async install(deps, onLine) {
      if (!(await deps.which('npm')))
        throw new Error('安装 Codex CLI 需要 Node.js/npm：请先安装 Node.js')
      try {
        await deps.run('npm', ['install', '-g', '@openai/codex'], onLine)
      } catch {
        // 默认源失败（国内网络常见）：换 npmmirror 镜像重试一次
        onLine?.('默认 npm 源安装失败，改用国内镜像 registry.npmmirror.com 重试…')
        await deps.run(
          'npm',
          ['install', '-g', '@openai/codex', '--registry=https://registry.npmmirror.com'],
          onLine,
        )
      }
      return '已通过 npm 全局安装 Codex CLI'
    },
  },

  // 探测-only：有固定默认端口的自托管服务，卡片只显示「服务运行中」
  xinference: { probeUrl: 'http://127.0.0.1:9997/v1/models' },
  fastchat: { probeUrl: 'http://127.0.0.1:8000/v1/models' },
}

const noop = () => {}

export function createLocalTools(deps: LocalToolDeps) {
  const expand = (p: string) => (deps.platform === 'win32' ? expandWin(p) : p)

  async function status(vendorId: string): Promise<LocalToolStatus> {
    const spec = SPECS[vendorId]
    if (!spec) {
      return {
        vendorId,
        supported: false,
        installed: false,
        running: false,
        installable: false,
        startable: false,
      }
    }
    let running = false
    let version: string | undefined
    if (spec.probeUrl) {
      try {
        const body = await deps.probe(spec.probeUrl)
        running = true
        version = spec.parseVersion?.(body)
      } catch {
        running = false
      }
    }
    let installed = running
    let detail: string | undefined
    if (!installed && spec.binary) {
      const onPath = await deps.which(spec.binary)
      if (onPath) {
        installed = true
        detail = onPath
      } else {
        const hit = (spec.paths?.[deps.platform] ?? []).map(expand).find((p) => deps.exists(p))
        if (hit) {
          installed = true
          detail = hit
        }
      }
    }
    if (!installed && !spec.binary) {
      installed = (spec.paths?.[deps.platform] ?? []).map(expand).some((p) => deps.exists(p))
    }
    return {
      vendorId,
      supported: true,
      installed,
      running,
      ...(version ? { version } : {}),
      installable: spec.install ? (spec.installableOn?.(deps.platform) ?? true) : false,
      startable: spec.start ? (spec.startableOn?.(deps.platform) ?? true) : false,
      ...(detail ? { detail } : {}),
    }
  }

  async function install(
    vendorId: string,
    onLine?: (line: string) => void,
  ): Promise<LocalToolOpResult> {
    const spec = SPECS[vendorId]
    if (!spec?.install) return { ok: false, message: `不支持一键安装：${vendorId}` }
    try {
      const message = await spec.install(deps, onLine)
      return { ok: true, message }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      // 国内网络直连失败的用户兜底：给出官方手动下载页，装完「重新检测」即可接管
      const manual = spec.manualUrl
        ? `（可手动下载安装：${spec.manualUrl} ，装完点「重新检测」）`
        : ''
      return { ok: false, message: `${raw}${manual}` }
    }
  }

  async function start(vendorId: string): Promise<LocalToolOpResult> {
    const spec = SPECS[vendorId]
    if (!spec?.start) return { ok: false, message: `不支持一键启动：${vendorId}` }
    try {
      const message = await spec.start(deps)
      return { ok: !message.includes('超时'), message }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  return { status, install, start }
}

/** 默认真实依赖：真实网络探测/子进程/文件系统。 */
export const defaultLocalToolDeps: LocalToolDeps = {
  platform: process.platform,
  probe(url, timeoutMs = 1200) {
    const timer = new AbortController()
    const t = setTimeout(() => timer.abort(), timeoutMs)
    return fetch(url, { signal: timer.signal }).then(async (r) => {
      clearTimeout(t)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.text()
    })
  },
  which(binary) {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    return new Promise((resolve) => {
      execFile(cmd, [binary], (err, stdout) => {
        if (err) return resolve(null)
        const first = String(stdout).trim().split(/\r?\n/)[0]
        resolve(first || null)
      })
    })
  },
  exists: (p) => existsSync(p),
  run(cmd, args, onLine = noop) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      const feed = (chunk: Buffer) => {
        for (const line of chunk.toString().split(/\r?\n/)) {
          const s = line.trim()
          if (s) onLine(s)
        }
      }
      child.stdout.on('data', feed)
      child.stderr.on('data', feed)
      child.on('error', reject)
      child.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`${cmd} 退出码 ${code}`))
      })
    })
  },
  spawnDetached(cmd, args) {
    try {
      spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
    } catch {
      // best effort — status polling decides the outcome
    }
  },
  async writeTemp(fileName, data) {
    const { writeFile } = await import('node:fs/promises')
    const p = join(tmpdir(), fileName)
    await writeFile(p, data)
    return p
  },
  async fetch(...args) {
    // Electron 主进程里优先走 net.fetch（Chromium 网络栈，跟随系统/应用代理）；
    // 纯 Node 环境（单测）或取不到时退回全局 fetch。
    try {
      const electron = (await import('electron')) as unknown as {
        net?: { fetch?: typeof globalThis.fetch }
      }
      if (electron.net?.fetch) return electron.net.fetch(...args)
    } catch {
      // not in an electron main process
    }
    return fetch(...args)
  },
  sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
}

/** 单实例安装锁：同一时刻只跑一个安装/启动，避免双击并发。 */
let installInFlight = false

export const localTools = createLocalTools(defaultLocalToolDeps)

export function localToolStatus(vendorId: string): Promise<LocalToolStatus> {
  return localTools.status(String(vendorId))
}

export async function localToolInstall(
  vendorId: string,
  onLine?: (line: string) => void,
): Promise<LocalToolOpResult> {
  if (installInFlight) return { ok: false, message: '已有安装任务进行中，请稍候' }
  installInFlight = true
  try {
    return await localTools.install(String(vendorId), onLine)
  } finally {
    installInFlight = false
  }
}

export async function localToolStart(vendorId: string): Promise<LocalToolOpResult> {
  if (installInFlight) return { ok: false, message: '已有安装任务进行中，请稍候' }
  installInFlight = true
  try {
    return await localTools.start(String(vendorId))
  } finally {
    installInFlight = false
  }
}
