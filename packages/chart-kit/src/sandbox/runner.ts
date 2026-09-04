import { SANDBOX_BOOTSTRAP_SRC } from './bootstrap'
import { parseOption } from './serialize'

/**
 * 图表沙箱运行器(主线程侧,环境自适应):
 * - 浏览器:new Worker(blob) + Web Worker
 * - Node(vitest / 采集管线):worker_threads eval worker
 * 沙箱边界与 option 捕获逻辑见 bootstrap.ts;死循环由 timeoutMs terminate 硬杀(Q6)。
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

const nodeWorkerModuleId = 'node:worker_threads'

type MinimalWorker = {
  postMessage(msg: unknown): void
  terminate(): void
  addEventListener(type: string, fn: (ev: { data: unknown }) => void): void
}

async function spawnWorker(): Promise<MinimalWorker> {
  if (typeof Worker !== 'undefined') {
    const blob = new Blob([SANDBOX_BOOTSTRAP_SRC], { type: 'text/javascript' })
    const url = URL.createObjectURL(blob)
    return new Worker(url) as unknown as MinimalWorker
  }
  if (typeof process !== 'undefined' && process.versions?.node) {
    // 变量说明符避免浏览器打包器静态分析;仅 Node 环境走到这里
    const mod = (await import(
      /* @vite-ignore */ nodeWorkerModuleId
    )) as typeof import('node:worker_threads')
    const w = new mod.Worker(SANDBOX_BOOTSTRAP_SRC, { eval: true })
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
        try {
          finish({
            ok: true,
            option: parseOption(msg.optionJson),
            durationMs: Date.now() - started,
          })
        } catch (e) {
          finish({
            ok: false,
            error: `option revive failed: ${String((e as Error)?.message ?? e)}`,
            durationMs: Date.now() - started,
          })
        }
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
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}
