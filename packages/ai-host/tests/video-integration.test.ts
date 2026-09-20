import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as http from 'node:http'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createVideoTaskRegistry, type VideoFileSink } from '../src/video-tasks'
import { createAiRuntime, createFileSource } from '@chatoffice/ai-provider'

/**
 * End-to-end video task chain over a local fake vendor — no external
 * credentials involved. The fake server mimics the OpenAI videos API
 * contract (submit → poll → content download, Bearer-authenticated) and
 * the run exercises the REAL ai-provider runtime (settings parse, model
 * resolution, key wiring, adapter submit/poll) plus the REAL ai-host
 * task registry (download to disk, preview, notifications).
 *
 * This is the no-key stand-in for the handoff's manual smoke #5: it
 * proves our chain works; only the real vendor's response shapes still
 * need a genuine key to confirm.
 */

const VIDEO_BYTES = Buffer.from('fake-mp4-bytes-0123456789')
const API_KEY = 'test-local-key'

let server: http.Server
let baseUrl = ''
const seenAuth: string[] = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const auth = String(req.headers.authorization ?? '')
    seenAuth.push(`${req.method} ${req.url} ${auth}`)
    if (auth !== `Bearer ${API_KEY}`) {
      res.writeHead(401).end('unauthorized')
      return
    }
    if (req.method === 'POST' && req.url === '/v1/videos') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'fake-job-1', status: 'queued' }))
      return
    }
    if (req.method === 'GET' && req.url === '/v1/videos/fake-job-1') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'fake-job-1', status: 'completed' }))
      return
    }
    if (req.method === 'GET' && req.url === '/v1/videos/fake-job-1/content') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' })
      res.end(VIDEO_BYTES)
      return
    }
    res.writeHead(404).end('not found')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

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

async function makeRuntime(): Promise<ReturnType<typeof createAiRuntime>> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-int-'))
  const settingsPath = path.join(dir, 'ai-settings.json')
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({
      version: 2,
      profiles: [
        {
          id: 'openai',
          vendorId: 'openai',
          displayName: 'Local Fake Vendor',
          protocol: 'openai-completions',
          baseUrl,
          apiKey: API_KEY,
          auth: 'api-key',
          enabled: true,
          models: [{ id: 'sora-2', type: 'video-generation' }],
        },
      ],
    }),
  )
  return createAiRuntime({
    source: createFileSource(settingsPath, {
      readFile: (p) => fs.promises.readFile(p, 'utf8'),
      writeFile: (p, c) => fs.promises.writeFile(p, c),
    }),
    chatoffice: {
      apiKey: () => '',
      hasAuth: () => false,
      status: async () => ({ loggedIn: false }),
    },
    translate: (key) => key,
  })
}

const flush = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** first settings parse + undici cold start can exceed a fixed sleep — poll */
async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms
  while (!pred() && Date.now() < deadline) await flush(20)
}

describe('video chain end-to-end against a local fake vendor', () => {
  it('resolves the model, submits, polls, downloads to disk, and previews', async () => {
    const runtime = await makeRuntime()
    const sink = memSink()
    const seen: string[] = []
    const reg = createVideoTaskRegistry({
      runtime: () => runtime,
      sink,
      mediaDir: '/tmp/video-int',
      notify: (_channel, payload) => seen.push((payload as { status: string }).status),
    })

    // listMediaModels must surface the video model with its spec
    const models = await runtime.listMediaModels()
    const videoModel = models.find((m) => m.kind === 'video' && m.modelId === 'sora-2')
    expect(videoModel).toBeTruthy()
    expect(videoModel!.vendorId).toBe('openai')

    // submit through the registry exactly as the IPC handler would
    const r = reg.submit({
      profileId: 'openai',
      modelId: 'sora-2',
      label: 'sora-2',
      prompt: 'a slow pan over a city',
    })
    expect(r.id).toBeTruthy()
    await waitFor(() => reg.list().tasks[0]?.status !== 'queued')

    const task = reg.list().tasks[0]!
    expect(task.status).toBe('succeeded')
    expect(task.result?.url).toBe(`${baseUrl}/v1/videos/fake-job-1/content`)
    const written = sink.files.get(task.result!.filePath!)
    expect(written && Buffer.from(written).equals(VIDEO_BYTES)).toBe(true)
    expect(seen).toContain('queued')
    expect(seen).toContain('succeeded')

    // every request the vendor saw carried the profile's key
    expect(seenAuth.length).toBeGreaterThanOrEqual(3)
    for (const line of seenAuth) expect(line).toContain(`Bearer ${API_KEY}`)

    // preview returns the written bytes as a data URL
    const preview = await reg.preview(task.id)
    expect(preview.dataUrl).toBe(`data:video/mp4;base64,${VIDEO_BYTES.toString('base64')}`)

    // listMediaModels spec seeding: sora gets 4/8/12s durations
    expect(videoModel!.spec.fields.find((f) => f.id === 'durationSeconds')?.options).toEqual([
      4, 8, 12,
    ])
  })

  it('rejects a bad key with the vendor error surfaced on the task', async () => {
    // rewire the profile with a wrong key by writing a second settings file
    const runtime = await makeRuntime()
    const sink = memSink()
    const reg = createVideoTaskRegistry({
      runtime: () => runtime,
      sink,
      mediaDir: '/tmp/video-int-bad',
      notify: () => {},
    })
    // simulate a stale/invalid credential: server 401s surface as task failure
    seenAuth.length = 0
    // point the registry at a request the fake server will reject
    const broken = createVideoTaskRegistry({
      runtime: () => ({
        ...runtime,
        runVideoJob: async () => {
          throw new Error('HTTP 401: unauthorized')
        },
      }),
      sink,
      mediaDir: '/tmp/video-int-bad',
      notify: () => {},
    })
    broken.submit({ profileId: 'openai', modelId: 'sora-2', prompt: 'x' })
    await waitFor(() => broken.list().tasks[0]?.status !== 'queued')
    const task = broken.list().tasks[0]!
    expect(task.status).toBe('failed')
    expect(task.retriable).toBe(false)
    expect(task.error).toContain('401')
    void reg
  })
})
