import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVideoTaskRegistry, type VideoFileSink } from '../src/video-tasks'
import type { AiRuntime } from '@chatoffice/ai-provider'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** every succeeded task downloads its result — keep the network out of tests.
 * Each call needs a FRESH Response: a body stream locks after one read. */
function stubVideoFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })),
  )
}

/** in-memory sink standing in for Node fs */
function memSink(): VideoFileSink & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()
  return {
    files,
    async mkdir() {},
    createWriteStream(path: string) {
      const chunks: Uint8Array[] = []
      return {
        write(chunk: Uint8Array) {
          chunks.push(chunk)
        },
        end(cb?: () => void) {
          files.set(path, Buffer.concat(chunks.map((c) => Buffer.from(c))))
          cb?.()
        },
        on() {},
      }
    },
    async readFile(path: string) {
      const data = files.get(path)
      if (!data) throw new Error(`missing ${path}`)
      return data
    },
    async statSize(path: string) {
      return files.get(path)?.byteLength ?? 0
    },
  }
}

function registryWith(overrides: {
  runVideoJob?: AiRuntime['runVideoJob']
  sink?: VideoFileSink
  notify?: (channel: string, payload: unknown) => void
}) {
  const runtime = {
    runVideoJob:
      overrides.runVideoJob ??
      (async () => ({ url: 'https://cdn/v.mp4', mime: 'video/mp4', meta: { poster: 'https://p/cover.jpg' } })),
  } as AiRuntime
  const sink = overrides.sink ?? memSink()
  return createVideoTaskRegistry({
    runtime: () => runtime,
    sink,
    mediaDir: '/tmp/media',
    notify: overrides.notify ?? (() => {}),
    downloadPoster: async () => ({ base64: 'cG9zdGVy', mime: 'image/jpeg' }),
  })
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

describe('video task registry', () => {
  it('submits, streams the result to disk, and exposes a preview data URL', async () => {
    stubVideoFetch()
    const sink = memSink()
    const reg = registryWith({ sink })
    const r = reg.submit({ profileId: 'p1', modelId: 'viduq1', prompt: 'a wave' })
    expect(r.id).toBeTruthy()
    await flush()
    const tasks = reg.list().tasks
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.status).toBe('succeeded')
    expect(sink.files.has(tasks[0]!.result?.filePath ?? '')).toBe(true)
    expect(tasks[0]!.result?.url).toBe('https://cdn/v.mp4')
    expect(tasks[0]!.result?.posterDataUrl).toBe('data:image/jpeg;base64,cG9zdGVy')
    const preview = await reg.preview(tasks[0]!.id)
    expect(preview.dataUrl).toContain('data:video/mp4;base64,')
  })

  it('rejects submissions beyond three active tasks, then recovers', async () => {
    stubVideoFetch()
    const resolvers: Array<() => void> = []
    const reg = registryWith({
      runVideoJob: () =>
        new Promise((resolve) => {
          resolvers.push(() => resolve({ url: 'https://cdn/v.mp4', mime: 'video/mp4' }))
        }),
    })
    const ids = [1, 2, 3].map((i) => reg.submit({ profileId: 'p', modelId: 'm', prompt: `t${i}` }))
    expect(ids.every((r) => r.id)).toBe(true)
    const fourth = reg.submit({ profileId: 'p', modelId: 'm', prompt: 't4' })
    expect(fourth.code).toBe('busy')
    for (const release of resolvers) release()
    await flush()
    expect(reg.list().tasks.every((t) => t.status === 'succeeded')).toBe(true)
    expect(reg.submit({ profileId: 'p', modelId: 'm', prompt: 't5' }).id).toBeTruthy()
  })

  it('marks failures with the vendor error and retries from stored params', async () => {
    stubVideoFetch()
    let calls = 0
    const reg = registryWith({
      runVideoJob: async () => {
        calls += 1
        if (calls === 1) throw new Error('HTTP 429: too many requests')
        return { url: 'https://cdn/ok.mp4', mime: 'video/mp4' }
      },
    })
    const r = reg.submit({ profileId: 'p', modelId: 'm', prompt: 'a' })
    await flush()
    expect(reg.list().tasks[0]!.status).toBe('failed')
    expect(reg.list().tasks[0]!.retriable).toBe(true)
    expect(reg.retry(r.id!)).toEqual({})
    await flush()
    expect(reg.list().tasks[0]!.status).toBe('succeeded')
    expect(calls).toBe(2)
  })

  it('aborting a running task lands it in the cancelled state', async () => {
    const reg = registryWith({
      runVideoJob:
        (_req) =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error('cancelled')), 20)
        }),
    })
    const r = reg.submit({ profileId: 'p', modelId: 'm', prompt: 'a' })
    reg.cancel(r.id!)
    await new Promise((res) => setTimeout(res, 40))
    const t = reg.list().tasks[0]!
    expect(t.status).toBe('cancelled')
    expect(t.result).toBeUndefined()
  })

  it('propagates state changes through notify', async () => {
    stubVideoFetch()
    const seen: string[] = []
    const reg = registryWith({
      notify: (_channel, payload) => seen.push((payload as { status: string }).status),
    })
    reg.submit({ profileId: 'p', modelId: 'm', prompt: 'a' })
    await flush()
    expect(seen).toContain('queued')
    expect(seen).toContain('succeeded')
  })
})
