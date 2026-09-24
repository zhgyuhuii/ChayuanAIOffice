import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registerMediaJobAdapter, type MediaJobAdapter } from '@chatoffice/ai-provider'
import { persistGeneratedImage, registerFetchImageIpc, registerMediaIpc } from '../src/media-ipc'
import { createByokImageHandler } from '../src/index'

/**
 * End-to-end drive of the unified media channels against a local fake vendor:
 * a real HTTP server answers in the openai-compatible wire shapes, settings
 * point every kind at it, and the registered ipcMain handlers are invoked the
 * same way the renderer preloads do.
 */

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const WAV_BYTES = Buffer.from('RIFF____WAVEfmt ', 'binary')

let server: ReturnType<typeof import('node:http').createServer>
let base = ''
let dir = ''

const channels = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
const ipcMain = {
  handle: (channel: string, fn: (event: unknown, payload: unknown) => Promise<unknown>) => {
    channels.set(channel, fn)
  },
}

async function call(channel: string, payload?: unknown): Promise<Record<string, unknown>> {
  const handler = channels.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return (await handler({}, payload)) as Record<string, unknown>
}

/** rewrite the settings fixture wholesale (registerMediaIpc reads per call) */
function writeSettings(profiles: unknown[]): void {
  writeFileSync(join(dir, 'ai-settings.json'), JSON.stringify({ version: 2, profiles }))
}
const openaiProfile = (models: unknown[]) => ({
  id: 'fake',
  displayName: 'Fake Vendor',
  enabled: true,
  auth: 'api-key',
  apiKey: 'sk-test',
  protocol: 'openai-completions',
  baseUrl: base,
  models,
})
/** aliyun vendor id → the voice adapters take the DashScope native paths */
const dashProfile = (models: unknown[]) => ({
  id: 'aliyun-bailian',
  displayName: 'Aliyun Bailian',
  vendorId: 'aliyun-bailian',
  enabled: true,
  auth: 'api-key',
  apiKey: 'sk-aliyun',
  protocol: 'openai-completions',
  baseUrl: base,
  models,
})

beforeAll(async () => {
  const http = await import('node:http')
  dir = mkdtempSync(join(tmpdir(), 'media-ipc-test-'))
  writeFileSync(join(dir, 'sample.png'), PNG_1PX)
  writeFileSync(join(dir, 'sample.wav'), WAV_BYTES)
  server = http.createServer((req, res) => {
    const body: string[] = []
    req.on('data', (c) => body.push(c))
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url?.includes('/images/generations')) {
        const raw = body.join('')
        if (raw.includes('broken-image')) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: { message: 'broken vendor' } }))
          return
        }
        res.end(JSON.stringify({ data: [{ b64_json: PNG_1PX.toString('base64') }] }))
        return
      }
      if (req.url?.includes('/audio/speech')) {
        res.setHeader('Content-Type', 'audio/mpeg')
        res.end(WAV_BYTES)
        return
      }
      if (req.url?.includes('/audio/transcriptions')) {
        res.end(JSON.stringify({ text: 'hello from the fake vendor' }))
        return
      }
      if (req.url?.includes('/chat/completions')) {
        res.setHeader('Content-Type', 'application/json')
        const raw = body.join('')
        // dashscope compatible-mode inline ASR (input_audio) vs vision chat
        const payload = raw.includes('"audio"')
          ? { choices: [{ message: { content: 'dashscope audio-url transcript' } }] }
          : { choices: [{ message: { content: 'a red square on white' } }] }
        res.end(JSON.stringify(payload))
        return
      }
      if (req.url?.includes('/api/v1/services/aigc/multimodal-generation/generation')) {
        const raw = body.join('')
        res.setHeader('Content-Type', 'application/json')
        if (raw.includes('qwen-tts')) {
          const host = req.headers.host ?? '127.0.0.1'
          res.end(
            JSON.stringify({
              output: { audio: { url: `http://${host}/qwen-tts.wav` } },
            }),
          )
          return
        }
        res.setHeader('Content-Type', 'audio/wav')
        res.end(WAV_BYTES)
        return
      }
      if (req.url?.includes('/api/v1/services/audio/tts')) {
        res.setHeader('Content-Type', 'audio/wav')
        res.end(WAV_BYTES)
        return
      }
      if (req.url?.includes('/api/v1/services/audio/asr/transcription')) {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ output: { task_id: 'task-1' } }))
        return
      }
      if (req.url?.includes('/api/v1/tasks/')) {
        res.setHeader('Content-Type', 'application/json')
        const host = req.headers.host ?? '127.0.0.1'
        res.end(
          JSON.stringify({
            output: {
              task_status: 'SUCCEEDED',
              results: [{ transcription_url: `http://${host}/transcript.json` }],
            },
          }),
        )
        return
      }
      if (req.url?.includes('/transcript.json')) {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ transcripts: [{ text: '阿里云文件转写结果' }] }))
        return
      }
      if (req.url?.includes('/sample.wav') || req.url?.includes('/qwen-tts.wav')) {
        res.setHeader('Content-Type', 'audio/wav')
        res.end(WAV_BYTES)
        return
      }
      if (req.url?.includes('/video.mp4')) {
        res.setHeader('Content-Type', 'video/mp4')
        res.end(Buffer.from('0123456789abcdef'))
        return
      }
      res.statusCode = 404
      res.end('{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  base = `http://127.0.0.1:${port}`

  writeSettings([
    openaiProfile([
      { id: 'fake-image' },
      { id: 'fake-tts' },
      { id: 'fake-asr' },
      { id: 'fake-vision' },
    ]),
  ])

  registerMediaIpc({
    ipcMain,
    settingsPath: join(dir, 'ai-settings.json'),
    mediaDir: join(dir, 'media'),
    // the fake vendor lives on loopback — bypass the SSRF guard for this test
    fetchImpl: (input, init) => fetch(input, init),
  })
  registerFetchImageIpc({ ipcMain, fetchImpl: (input, init) => fetch(input, init) })
})

afterAll(() => {
  server?.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('registerMediaIpc end-to-end', () => {
  it('reports per-kind capability flags from ai-settings', async () => {
    const r = await call('ai:media-capabilities')
    expect(r.flags).toMatchObject({
      image: true,
      video: false,
      imageUnderstanding: true,
      videoUnderstanding: true,
      tts: true,
      asr: true,
    })
    expect((r.models as Record<string, string>).image).toBe('fake-image')
  })

  it('generates an image and returns a file:// URL in the store', async () => {
    const r = await call('ai:media-image', { prompt: 'a red square', aspectRatio: '1:1' })
    expect(r.error).toBeUndefined()
    expect(String(r.url)).toMatch(/^file:/)
    expect(r.model).toBe('fake-image')
  })

  it('answers an unconfigured kind with the honest not-configured error', async () => {
    const r = await call('ai:media-video', { prompt: 'waves' })
    expect(String(r.error)).toContain('no video model configured')
  })

  it('understands a local image through the configured analysis model', async () => {
    const r = await call('ai:media-understand', {
      sources: [join(dir, 'sample.png')],
      requirements: 'describe the image',
    })
    expect(r.error).toBeUndefined()
    expect(r.text).toBe('a red square on white')
  })

  it('transcribes a local audio file through the configured ASR model', async () => {
    const r = await call('ai:media-asr', { source: join(dir, 'sample.wav'), language: 'en' })
    expect(r.error).toBeUndefined()
    expect(r.text).toBe('hello from the fake vendor')
  })

  it('synthesizes speech to an audio file', async () => {
    const r = await call('ai:media-tts', { text: '你好，察元' })
    expect(r.error).toBeUndefined()
    expect(String(r.url)).toMatch(/^file:/)
    expect(r.mime).toBe('audio/mpeg')
    const path = join(dir, 'media', decodeURIComponent(String(r.url)).split('/').pop()!)
    expect(readFileSync(path).byteLength).toBeGreaterThan(0)
  })

  it('synthesizes speech through cosyvoice (dashscope binary flow)', async () => {
    writeSettings([dashProfile([{ id: 'cosyvoice-v2' }])])
    const r = await call('ai:media-tts', { text: '牛气冲天', voice: 'longxiaochun' })
    expect(r.error).toBeUndefined()
    expect(String(r.url)).toMatch(/^file:/)
    expect(r.mime).toBe('audio/wav')
    expect(r.model).toBe('cosyvoice-v2')
  })

  it('synthesizes speech through qwen-tts (dashscope JSON URL flow)', async () => {
    writeSettings([dashProfile([{ id: 'qwen-tts' }])])
    const r = await call('ai:media-tts', { text: '你好', voice: 'Cherry' })
    expect(r.error).toBeUndefined()
    expect(String(r.url)).toMatch(/^file:/)
    expect(r.model).toBe('qwen-tts')
  })

  it('qwen3-asr transcribes via public audio URL (real-device shape: audio part)', async () => {
    writeSettings([dashProfile([{ id: 'qwen3-asr-flash', type: 'asr' }])])
    const r = await call('ai:media-asr', { source: `${base}/sample.wav` })
    expect(r.error).toBeUndefined()
    expect(r.text).toBe('dashscope audio-url transcript')
  })

  it('qwen3-asr with a local file is honestly refused (dashscope fetches URLs only)', async () => {
    writeSettings([dashProfile([{ id: 'qwen3-asr-flash', type: 'asr' }])])
    const r = await call('ai:media-asr', { source: join(dir, 'sample.wav') })
    expect(String(r.error)).toContain('public http(s) URL')
  })

  it('transcribes through paraformer file transcription (public URL source)', async () => {
    writeSettings([dashProfile([{ id: 'paraformer-v2', type: 'asr' }])])
    const r = await call('ai:media-asr', {
      source: `${base}/sample.wav`,
      language: 'zh',
    })
    expect(r.error).toBeUndefined()
    expect(r.text).toBe('阿里云文件转写结果')
  })

  it('refuses paraformer with a local file instead of failing silently', async () => {
    const r = await call('ai:media-asr', { source: join(dir, 'sample.wav') })
    expect(String(r.error)).toContain('public http(s) URL')
  })

  it('persistGeneratedImage stores data: URLs as file:// and leaves store URLs as-is', async () => {
    const dataUrl = `data:image/png;base64,${PNG_1PX.toString('base64')}`
    const stored = await persistGeneratedImage(dataUrl)
    expect(stored).toMatch(/^file:/)
    expect(await persistGeneratedImage(stored)).toBe(stored)
  })

  it('fetch-image channel downloads store-backed file:// URLs with real mime', async () => {
    const stored = await persistGeneratedImage(
      `data:image/png;base64,${PNG_1PX.toString('base64')}`,
    )
    const r = await call('ai:fetch-image', stored)
    expect(r).not.toBeNull()
    expect(r.mime).toBe('image/png')
    expect(String(r.base64).length).toBeGreaterThan(0)
  })

  it('createByokImageHandler returns a store-backed file:// URL (markdown/pdf insert path)', async () => {
    // earlier tests rewrote the fixture without an image model — restore it
    writeSettings([openaiProfile([{ id: 'fake-image' }])])
    const handler = createByokImageHandler({
      settingsPath: () => join(dir, 'ai-settings.json'),
      fs: {
        readFile: (p) => import('node:fs/promises').then((m) => m.readFile(p, 'utf8')),
        writeFile: (p, c) => import('node:fs/promises').then((m) => m.writeFile(p, c, 'utf8')),
      },
      chatoffice: {
        apiKey: () => '',
        hasAuth: () => false,
        status: async () => ({ loggedIn: false }),
      },
    })
    const r = await handler({ prompt: 'a red square' })
    expect(r.error).toBeUndefined()
    expect(String(r.url)).toMatch(/^file:/)
  })

  it('image generation walks the priority chain past a broken default', async () => {
    writeSettings([openaiProfile([{ id: 'broken-image' }, { id: 'fake-image' }])])
    const r = await call('ai:media-image', { prompt: 'a red square' })
    expect(r.error).toBeUndefined()
    expect(String(r.url)).toMatch(/^file:/)
    // the chain landed on the healthy candidate, not the broken default
    expect(r.model).toBe('fake-image')
  })

  it('reports the accumulated error when every model in the chain fails', async () => {
    writeSettings([openaiProfile([{ id: 'broken-image' }])])
    const r = await call('ai:media-image', { prompt: 'a red square' })
    expect(String(r.error)).toContain('broken vendor')
  })

  it('drives video generation through a registered job adapter', async () => {
    const adapter: MediaJobAdapter = {
      vendorId: 'fake',
      pollIntervalMs: 10,
      async submit() {
        return 'job-1'
      },
      async poll() {
        return { state: 'succeeded', result: { url: `${base}/video.mp4`, mime: 'video/mp4' } }
      },
    }
    registerMediaJobAdapter(adapter)
    // the settings fixture has no video model — add one by rewriting the file
    writeFileSync(
      join(dir, 'ai-settings.json'),
      JSON.stringify({
        version: 2,
        profiles: [
          {
            id: 'fake',
            displayName: 'Fake Vendor',
            vendorId: 'fake',
            enabled: true,
            auth: 'api-key',
            apiKey: 'sk-test',
            protocol: 'openai-compatible',
            baseUrl: base,
            models: [
              { id: 'fake-image' },
              { id: 'fake-tts' },
              { id: 'fake-asr' },
              { id: 'fake-vision' },
              { id: 'fake-video', type: 'video-generation' },
            ],
          },
        ],
      }),
    )
    const r = await call('ai:media-video', { prompt: 'waves', durationSeconds: 5 })
    expect(r.error).toBeUndefined()
    expect(String(r.filePath)).toBeTruthy()
    expect(readFileSync(String(r.filePath)).byteLength).toBeGreaterThan(0)
  })
})
