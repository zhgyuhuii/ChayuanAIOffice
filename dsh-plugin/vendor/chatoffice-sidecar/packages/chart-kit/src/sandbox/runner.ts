import { parseOptionSmart } from '../render/revive'
// canonical Worker 源是同目录 bootstrap.worker.js:
// - 浏览器:new Worker(new URL(...)) 真实资源,不继承文档 meta CSP(见该文件头注释)
// - Node(采集/vitest):从磁盘读入源码,worker_threads eval 执行

/**
 * 图表沙箱运行器(主线程侧,环境自适应):
 * - 浏览器:Vite 发出的真实 URL Worker(文档 CSP 禁 unsafe-eval 会拦死 blob Worker)
 * - Node(vitest / 采集管线):worker_threads eval worker
 * 沙箱边界与 option 捕获逻辑见 bootstrap.worker.js;死循环由 timeoutMs terminate 硬杀(Q6)。
 */

export interface SandboxRunResult {
  ok: boolean
  /** ok 时为捕获并复活函数后的 option */
  option?: unknown
  error?: string
  durationMs: number
}

export interface SandboxRunOptions {
  /** 超时毫秒数,默认 2000(Q6 签定 ~2s 熔断) */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 2000

type MinimalWorker = {
  postMessage(msg: unknown): void
  terminate(): void
  addEventListener(type: string, fn: (ev: { data: unknown }) => void): void
}

/** Node 侧 Worker 源:vite/vitest 下经 ?raw 转换;纯 Node(tsx/采集)退回磁盘读取 */
let bootstrapSourceCache: string | null = null
async function loadBootstrapSource(): Promise<string> {
  if (bootstrapSourceCache !== null) return bootstrapSourceCache
  try {
    const mod = (await import('./bootstrap.worker.js?raw')) as { default: string }
    if (typeof mod.default === 'string') {
      bootstrapSourceCache = mod.default
      return bootstrapSourceCache
    }
  } catch {
    /* 非 vite 上下文:走磁盘 */
  }
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  bootstrapSourceCache = await readFile(
    fileURLToPath(new URL('./bootstrap.worker.js', import.meta.url)),
    'utf8',
  )
  return bootstrapSourceCache
}

async function spawnWorker(): Promise<MinimalWorker> {
  if (typeof Worker !== 'undefined') {
    // Vite 静态分析此模式,把 worker 作为独立资源发出(dev 由 dev server 服务、
    // build 落 assets);网络 Worker 的 CSP 只来自自身响应,文档 meta 不再生效
    return new Worker(new URL('./bootstrap.worker.js', import.meta.url)) as unknown as MinimalWorker
  }
  if (typeof process !== 'undefined' && process.versions?.node) {
    // 变量说明符避免浏览器打包器静态分析;仅 Node 环境走到这里
    const nodeWorkerModuleId = 'node:worker_threads'
    const mod = (await import(
      /* @vite-ignore */ nodeWorkerModuleId
    )) as typeof import('node:worker_threads')
    const w = new mod.Worker(await loadBootstrapSource(), { eval: true })
    // worker_threads 是 EventEmitter(.on),适配成统一 addEventListener 形态
    return {
      postMessage: (msg: unknown) => w.postMessage(msg),
      terminate: () => void w.terminate(),
      addEventListener: (_type: string, fn: (ev: { data: unknown }) => void) => {
        w.on('message', (data: unknown) => fn({ data }))
      },
    }
  }
  throw new Error('chart sandbox: no Worker implementation in this environment')
}

export async function runOptionCode(
  code: string,
  opts: SandboxRunOptions = {},
): Promise<SandboxRunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const started = Date.now()
  let worker: MinimalWorker
  try {
    worker = await spawnWorker()
  } catch (e) {
    return {
      ok: false,
      error: `spawn failed: ${String((e as Error)?.message ?? e)}`,
      durationMs: 0,
    }
  }

  return new Promise<SandboxRunResult>((resolve) => {
    let settled = false
    const finish = (r: SandboxRunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        worker.terminate()
      } catch {
        /* terminate 幂等 */
      }
      resolve(r)
    }
    const timer = setTimeout(() => {
      finish({
        ok: false,
        error: `timeout after ${timeoutMs}ms (possible infinite loop)`,
        durationMs: Date.now() - started,
      })
    }, timeoutMs)

    worker.addEventListener('message', (ev: { data: unknown }) => {
      const msg = ev.data as {
        __chartkit_sandbox__?: boolean
        ok?: boolean
        optionJson?: string
        error?: string
      }
      if (!msg || msg.__chartkit_sandbox__ !== true) return
      if (msg.ok && typeof msg.optionJson === 'string') {
        // 沙箱执行成功:先解除执行超时(超时只约束沙箱内代码),再进入
        // 复活阶段——首次 revive 会在 eval 帧加载 echarts(数 MB),耗时
        // 可能超过执行超时,不应误判(真机实证:曾把成功执行报成超时)
        clearTimeout(timer)
        void (async () => {
          try {
            const option = await parseOptionSmart(msg.optionJson as string)
            finish({ ok: true, option, durationMs: Date.now() - started })
          } catch (e) {
            finish({
              ok: false,
              error: `option revive failed: ${String((e as Error)?.message ?? e)}`,
              durationMs: Date.now() - started,
            })
          }
        })()
      } else {
        finish({
          ok: false,
          error: msg.error ?? 'unknown sandbox error',
          durationMs: Date.now() - started,
        })
      }
    })

    worker.postMessage({ __chartkit_sandbox__: true, code })
  })
}

/** 并发映射辅助(采集管线用:示例逐个跑,受限并发避免进程被 worker 打满) */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      const item = items[i] as T
      results[i] = await fn(item, i)
    }
  })
  await Promise.all(workers)
  return results
}
