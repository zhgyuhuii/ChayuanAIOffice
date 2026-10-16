/**
 * 崩溃复现：agnes 式自定义 profile 提交视频任务。假 vendor 以 404 拒绝
 * /videos 提交 → 任务应转为 failed，进程存活、无 unhandledRejection；另一条
 * accepted→poll→failed 形态覆盖轮询失败路径。这是用户「生成视频把应用整崩溃」
 * 的两个服务端形态。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVideoTaskRegistry, type VideoFileSink } from '../src/video-tasks'
import { createAiRuntime, createFileSource } from '@chaoffice/ai-provider'
import * as nodeFs from 'node:fs'

type Mode = '404' | 'accepted-failed'

function startFakeAgnes(mode: Mode): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url?.includes('/videos') && req.method === 'POST') {
        if (mode === '404') {
          res.writeHead(404, { 'content-type': 'text/html' })
          res.end('<html>Not Found</html>')
        } else {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ id: 'job-1' }))
        }
        return
      }
      if (req.url?.includes('/videos/job-1') && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ status: 'failed', error: { message: 'vendor refused' } }))
        return
      }
      res.writeHead(404)
      res.end()
    })
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as { port: number }).port }),
    )
  })
}

const sink: VideoFileSink = {
  mkdir: (p, o) => nodeFs.promises.mkdir(p, o),
  createWriteStream: (p) => nodeFs.createWriteStream(p),
  readFile: (p) => nodeFs.promises.readFile(p),
  statSize: async (p) => (await nodeFs.promises.stat(p)).size,
}

function makeRuntime(baseUrl: string): ReturnType<typeof createAiRuntime> {
  const dir = mkdtempSync(join(tmpdir(), 'vid-crash-'))
  const settingsPath = join(dir, 'ai-settings.json')
  nodeFs.writeFileSync(
    settingsPath,
    JSON.stringify({
      version: 2,
      profiles: [
        {
          id: 'custom-repro',
          vendorId: 'custom-repro',
          displayName: 'Agnes repro',
          protocol: 'openai-completions',
          baseUrl,
          apiKey: 'sk-test',
          auth: 'api-key',
          enabled: true,
          models: [{ id: 'agnes-video-2.5-flash' }],
        },
      ],
    }),
  )
  return createAiRuntime({
    source: createFileSource(settingsPath, {
      readFile: (p) => nodeFs.promises.readFile(p, 'utf8'),
      writeFile: (p, c) => nodeFs.promises.writeFile(p, c),
    }),
    chaoffice: { apiKey: () => '', hasAuth: () => false, status: async () => ({ loggedIn: false }) },
    translate: (k) => k,
  })
}

describe('notify throwing (destroyed window) must not kill the process', () => {
  it('swallows the notify error and still reaches the failed terminal state', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (err: unknown): void => {
      unhandled.push(err)
    }
    process.on('unhandledRejection', onUnhandled)
    const { server, port } = await startFakeAgnes('404')
    try {
      let boom = true
      const registry = createVideoTaskRegistry({
        runtime: () => makeRuntime(`http://127.0.0.1:${port}/v1`),
        sink,
        mediaDir: mkdtempSync(join(tmpdir(), 'vid-crash-media-')),
        notify: () => {
          // 模拟向已销毁窗口 send：宿主守卫缺失/失效时的旧崩溃面
          if (boom) {
            boom = false
            throw new Error('Object has been destroyed')
          }
        },
      })
      const sub = registry.submit({
        profileId: 'custom-repro',
        modelId: 'agnes-video-2.5-flash',
        prompt: '一只猫在跳舞',
      })
      expect(sub.error).toBeUndefined()
      const deadline = Date.now() + 15_000
      let final = registry.list().tasks.find((t) => t.id === sub.id)
      while (Date.now() < deadline) {
        final = registry.list().tasks.find((t) => t.id === sub.id)
        if (final && (final.status === 'failed' || final.status === 'succeeded')) break
        await new Promise((r) => setTimeout(r, 250))
      }
      expect(final?.status).toBe('failed')
      // 让 at-most-once 的 throw 不掩盖后续断言
      expect(unhandled).toEqual([])
    } finally {
      server.close()
      process.off('unhandledRejection', onUnhandled)
    }
  }, 30_000)
})

describe.each<Mode>(['404', 'accepted-failed'])('video submit against fake agnes (%s)', (mode) => {
  let server: Server
  let port: number

  beforeAll(async () => {
    ;({ server, port } = await startFakeAgnes(mode))
  })
  afterAll(() => server.close())

  it('task fails visibly, process survives, no unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (err: unknown): void => {
      unhandled.push(err)
    }
    process.on('unhandledRejection', onUnhandled)

    const registry = createVideoTaskRegistry({
      runtime: () => makeRuntime(`http://127.0.0.1:${port}/v1`),
      sink,
      mediaDir: mkdtempSync(join(tmpdir(), 'vid-crash-media-')),
      notify: () => {},
    })

    const sub = registry.submit({
      profileId: 'custom-repro',
      modelId: 'agnes-video-2.5-flash',
      prompt: '一只猫在跳舞',
    })
    expect(sub.error).toBeUndefined()

    // 404 → immediate fail; accepted → 6s poll interval → wait generously
    const deadline = Date.now() + (mode === '404' ? 15_000 : 25_000)
    let final = registry.list().tasks.find((t) => t.id === sub.id)
    while (Date.now() < deadline) {
      final = registry.list().tasks.find((t) => t.id === sub.id)
      if (final && (final.status === 'failed' || final.status === 'succeeded')) break
      await new Promise((r) => setTimeout(r, 250))
    }
    expect(final?.status).toBe('failed')
    expect(final?.error).toBeTruthy()
    expect(unhandled).toEqual([])
    process.off('unhandledRejection', onUnhandled)
  }, 40_000)
})
