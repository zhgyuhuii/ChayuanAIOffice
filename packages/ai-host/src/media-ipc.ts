import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  createFileSource,
  resolveMediaCapabilityChain,
  generateImageWithModel,
  resolveMediaCapability,
  runMediaJob,
  understandMediaWithModel,
  transcribeWithModel,
  synthesizeSpeechWithModel,
  type FileSourceFs,
  type ResolvedModelCall,
} from '@chatoffice/ai-provider'
import { fetchRemoteImage } from '@chatoffice/electron-utils/remote-image'
import { fetchWithSsrfGuard } from '@chatoffice/electron-utils/safe-remote-url'
import { storeGeneratedImage } from '@chatoffice/electron-utils/generated-images'

/**
 * Unified media-model IPC — one registrar, six channels, every editor main:
 *
 *   ai:media-capabilities  live per-kind availability + model labels
 *   ai:media-image         image generation        (generateImageWithModel)
 *   ai:media-video         video generation        (runMediaJob, awaited)
 *   ai:media-understand    image/video analysis    (understandMediaWithModel)
 *   ai:media-asr           audio → text            (transcribeWithModel)
 *   ai:media-tts           text → audio file       (synthesizeSpeechWithModel)
 *
 * Resolution goes through resolveMediaCapability: the settings default for
 * each kind, or nothing — an unconfigured kind answers with an honest
 * "not configured" error instead of silently substituting another model.
 * Binary results never ride IPC: images land in the generated-image store,
 * audio/video in the app media dir; only file URLs and metadata return.
 */

export interface MediaIpcDeps {
  ipcMain: {
    handle(channel: string, fn: (event: unknown, payload: unknown) => Promise<unknown>): void
    /** LOCAL(2026-09-21, d8201ad0): 重复注册防崩——shell 启动已注册媒体通道时,编辑器
     * 标签的 register*Ipc 再次注册改为 last-wins(Electron ipcMain 自带,测试桩可缺省) */
    removeHandler?(channel: string): void
  }
  /** ai-settings.json path (string or lazy resolver) */
  settingsPath: string | (() => string)
  /** injectable fs for tests; defaults to node:fs/promises (utf8 text io) */
  fs?: FileSourceFs
  /** output dir for generated audio/video (userData/media/...) */
  mediaDir: string | (() => string)
  /** async secret resolution for reference-only profiles (harness source) */
  resolveSecret?: (profileId: string) => Promise<string | null>
  /**
   * Injectable fetch for media downloads. When set, the SSRF guard is bypassed
   * (tests point sources at a loopback fake vendor; production leaves this
   * unset so private addresses stay blocked).
   */
  fetchImpl?: typeof fetch
  /**
   * LOCAL(2026-09-22, f5247d3..476e5023): app-specific source resolver hook —
   * a URL scheme loadMediaSource cannot read (docs' chatoffice-docx-media://
   * lazy pictures) gets materialized into something it does (data:/file:/…).
   * Resolved value replaces the source; a null/throw keeps the source as-is.
   */
  resolveSource?: (source: string) => Promise<string | null>
}

/** per-kind concurrency gates: protect vendors from parallel-burst rate limits */
const KIND_CONCURRENCY: Record<string, number> = {
  image: 3,
  video: 1,
  understand: 2,
  asr: 2,
  tts: 2,
}

const MAX_MEDIA_BYTES = 200 * 1024 * 1024
const MAX_VIDEO_FILE_BYTES = 40 * 1024 * 1024

class Semaphore {
  private running = 0
  private queue: Array<() => void> = []
  constructor(private readonly max: number) {}
  async acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++
      return
    }
    await new Promise<void>((resolve) => this.queue.push(resolve))
    this.running++
  }
  release(): void {
    this.running--
    this.queue.shift()?.()
  }
}

/** LOCAL(2026-09-22): app-specific source materialization hook (see MediaIpcDeps.resolveSource) */
async function resolveSourceOf(
  source: string,
  deps: Pick<MediaIpcDeps, 'resolveSource'>,
): Promise<string> {
  if (!deps.resolveSource) return source
  try {
    return (await deps.resolveSource(source)) ?? source
  } catch {
    return source
  }
}

async function loadMediaSource(
  source: string,
  fetchImpl?: typeof fetch,
): Promise<{ base64: string; mime: string }> {  if (source.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(source)
    if (!match) throw new Error('unsupported data URL')
    const base64 = match[2]!
    if (base64.length > (MAX_MEDIA_BYTES / 3) * 4) throw new Error('media too large to analyze')
    return { base64, mime: match[1]! }
  }
  let bytes: Uint8Array
  let mime = ''
  if (source.startsWith('file://')) {
    const path = fileURLToPath(source)
    bytes = new Uint8Array(await readFile(path))
  } else if (/^https?:\/\//i.test(source)) {
    const resp = fetchImpl
      ? await fetchImpl(source)
      : await fetchWithSsrfGuard(source, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!resp || !resp.ok) throw new Error(`could not download ${source}`)
    const declared = Number(resp.headers.get('content-length') ?? 0)
    if (declared > MAX_MEDIA_BYTES) throw new Error('media too large to analyze')
    const buf = new Uint8Array(await resp.arrayBuffer())
    if (buf.byteLength > MAX_MEDIA_BYTES) throw new Error('media too large to analyze')
    bytes = buf
    mime = resp.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  } else {
    // plain absolute local path (attachment files saved by the renderer)
    bytes = new Uint8Array(await readFile(source))
  }
  if (!bytes.byteLength) throw new Error('empty media file')
  if (!mime) {
    mime = sniffMime(bytes)
  }
  return { base64: Buffer.from(bytes).toString('base64'), mime }
}

/** magic-byte sniffing for the handful of containers we accept */
function sniffMime(bytes: Uint8Array): string {
  const b = bytes
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50) return 'image/png'
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b.length > 12 && b[8] === 0x66 && b[9] === 0x74 && b[10] === 0x79 && b[11] === 0x70) {
    return 'video/mp4'
  }
  if (b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return 'video/webm'
  }
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) {
    return 'audio/wav'
  }
  if (b.length > 2 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg'
  if (b.length > 4 && b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) {
    return 'audio/ogg'
  }
  if (b.length > 4 && b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43) {
    return 'audio/flac'
  }
  return 'application/octet-stream'
}

const err = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** data: URL or remote link → bytes + sniffed mime (imagegen returns either) */
export async function materializeUrl(
  url: string,
  fetchImpl?: typeof fetch,
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (url.startsWith('file:')) {
    // already in the generated-image store — readGeneratedImage will serve it
    return { bytes: new Uint8Array(0), mime: '' }
  }
  if (url.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(url)
    if (!match) throw new Error('unsupported image data URL')
    const bytes = new Uint8Array(Buffer.from(match[2]!, 'base64'))
    return {
      bytes,
      mime: sniffMime(bytes) === 'application/octet-stream' ? match[1]! : sniffMime(bytes),
    }
  }
  let resp = await (fetchImpl ?? fetch)(url)
  if (!resp || !resp.ok) {
    // transient OSS/DNS hiccups observed in the wild — one retry
    resp = await (fetchImpl ?? fetch)(url)
  }
  if (!resp || !resp.ok) throw new Error(`image download failed: HTTP ${resp.status}`)
  const bytes = new Uint8Array(await resp.arrayBuffer())
  const ct = resp.headers.get('content-type')?.split(';')[0]?.trim()
  return { bytes, mime: ct && ct !== 'application/octet-stream' ? ct : sniffMime(bytes) }
}

/**
 * Materialize a generated image URL (data:/https) into the generated-image
 * store and return its file:// URL — the one shape every editor's
 * fetch-image/insert pipeline accepts. Store-backed file:// URLs pass through.
 */
export async function persistGeneratedImage(
  url: string,
  fetchImpl?: typeof fetch,
): Promise<string> {
  if (url.startsWith('file:')) return url
  const materialized = await materializeUrl(url, fetchImpl)
  return storeGeneratedImage(materialized.bytes, materialized.mime)
}

export function registerMediaIpc(deps: MediaIpcDeps): void {
  const settingsPath = () =>
    typeof deps.settingsPath === 'function' ? deps.settingsPath() : deps.settingsPath
  const mediaDir = () => (typeof deps.mediaDir === 'function' ? deps.mediaDir() : deps.mediaDir)
  const fileFs: FileSourceFs = deps.fs ?? {
    readFile: (p) => readFile(p, 'utf8'),
    writeFile: async (p, contents) => {
      await writeFile(p, contents, 'utf8')
    },
  }
  const readSettings = async () => createFileSource(settingsPath(), fileFs).read()
  const semaphores = new Map<string, Semaphore>()
  const gate = async (kind: string, fn: () => Promise<unknown>): Promise<unknown> => {
    const sem = semaphores.get(kind) ?? new Semaphore(KIND_CONCURRENCY[kind] ?? 2)
    semaphores.set(kind, sem)
    await sem.acquire()
    try {
      return await fn()
    } finally {
      sem.release()
    }
  }
  /** priority chain: default first, then every other configured model of the kind */
  const resolveChain = (kind: Parameters<typeof resolveMediaCapability>[1]) =>
    readSettings().then((settings) =>
      resolveMediaCapabilityChain(
        settings,
        kind,
        deps.resolveSecret ? { resolveSecret: deps.resolveSecret } : {},
      ),
    )
  /** walk candidates top-down; first success wins, all-fail returns the last error */
  const tryChain = async <T>(
    calls: ResolvedModelCall[],
    run: (call: ResolvedModelCall) => Promise<T>,
    kindLabel: string,
  ): Promise<
    | { ok: true; result: T; model: string }
    | {
        ok: false
        error: string
        attempts?: Array<{ model: string; error: string; notes?: string }>
      }
  > => {
    if (!calls.length) {
      return {
        ok: false,
        error: `no ${kindLabel} model configured (Settings → 生图、媒体与搜索)`,
      }
    }
    let lastError = ''
    const attempts: Array<{ model: string; error: string; notes?: string }> = []
    for (const call of calls) {
      try {
        return { ok: true, result: await run(call), model: call.model }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        attempts.push({ model: call.model, error, ...(call.notes ? { notes: call.notes } : {}) })
        lastError = error
      }
    }
    return {
      ok: false,
      error: calls.length > 1 ? `${lastError} (tried ${calls.length} models)` : lastError,
      ...(attempts.length ? { attempts } : {}),
    }
  }

  deps.ipcMain.removeHandler?.('ai:media-capabilities')
  deps.ipcMain.handle('ai:media-capabilities', async () => {
    try {
      const settings = await readSettings()
      const kinds = [
        'image',
        'video',
        'imageUnderstanding',
        'videoUnderstanding',
        'tts',
        'asr',
      ] as const
      const flags: Record<string, boolean> = {}
      const models: Record<string, string> = {}
      const notes: Record<string, string | undefined> = {}
      for (const kind of kinds) {
        const call = await resolveMediaCapability(
          settings,
          kind,
          deps.resolveSecret ? { resolveSecret: deps.resolveSecret } : {},
        )
        flags[kind] = !!call
        if (call) {
          models[kind] = call.model
          if (call.notes) notes[kind] = call.notes
        }
      }
      return { flags, models, notes }
    } catch (e) {
      return { flags: {}, models: {}, error: err(e) }
    }
  })

  deps.ipcMain.removeHandler?.('ai:media-image')
  deps.ipcMain.handle('ai:media-image', async (_event, payload: unknown) => {
    const op = (payload ?? {}) as { prompt?: unknown; aspectRatio?: unknown }
    const prompt = String(op.prompt ?? '').trim()
    if (!prompt) return { error: 'prompt must not be empty' }
    const aspectRatio = String(op.aspectRatio ?? '').trim()
    return gate('image', async () => {
      try {
        const chain = await resolveChain('image')
        const ir = await tryChain(
          chain,
          (call) =>
            generateImageWithModel(call, {
              prompt,
              ...(aspectRatio ? { aspectRatio } : {}),
            }),
          'image',
        )
        if (!ir.ok) return { error: ir.error, attempts: ir.attempts }
        const call = { model: ir.model }
        const result = ir.result
        // imagegen answers data: URLs or remote links; materialize to bytes so
        // the result lands in the generated-image store as a file:// URL
        const first = result.urls[0]
        if (!first) throw new Error('the image API returned no image')
        const url = await persistGeneratedImage(first, deps.fetchImpl)
        return {
          url,
          model: call.model,
        }
      } catch (e) {
        return { error: err(e) }
      }
    })
  })

  deps.ipcMain.removeHandler?.('ai:media-video')
  deps.ipcMain.handle('ai:media-video', async (_event, payload: unknown) => {
    const op = (payload ?? {}) as {
      prompt?: unknown
      aspectRatio?: unknown
      durationSeconds?: unknown
    }
    const prompt = String(op.prompt ?? '').trim()
    if (!prompt) return { error: 'prompt must not be empty' }
    const durationSeconds = Number(op.durationSeconds) || undefined
    const aspectRatio = String(op.aspectRatio ?? '').trim()
    return gate('video', async () => {
      try {
        const chain = await resolveChain('video')
        const vr = await tryChain(
          chain,
          (call) =>
            runMediaJob({
              kind: 'video',
              vendorId: call.vendorId ?? 'openai',
              model: call.model,
              apiKey: call.apiKey,
              ...(call.baseUrl ? { baseUrl: call.baseUrl } : {}),
              prompt,
              ...(aspectRatio ? { aspectRatio } : {}),
              ...(durationSeconds ? { durationSeconds } : {}),
            }),
          'video',
        )
        if (!vr.ok) return { error: vr.error }
        const call = { model: vr.model }
        const result = vr.result
        const dl = await fetch(result.url)
        if (!dl.ok) return { error: `video download failed: HTTP ${dl.status}` }
        const buf = new Uint8Array(await dl.arrayBuffer())
        if (buf.byteLength > MAX_VIDEO_FILE_BYTES) {
          return {
            error: `the generated video is too large (${Math.round(buf.byteLength / 1048576)}MB > ${MAX_VIDEO_FILE_BYTES / 1048576}MB)`,
          }
        }
        const dir = mediaDir()
        await mkdir(dir, { recursive: true })
        const filePath = join(dir, `media-video-${Date.now()}.mp4`)
        await writeFile(filePath, buf)
        return {
          filePath,
          url: pathToFileURL(filePath).toString(),
          model: call.model,
          bytes: Buffer.from(buf).toString('base64'),
        }
      } catch (e) {
        return { error: err(e) }
      }
    })
  })

  deps.ipcMain.removeHandler?.('ai:media-understand')
  deps.ipcMain.handle('ai:media-understand', async (_event, payload: unknown) => {
    const op = (payload ?? {}) as { sources?: unknown; requirements?: unknown }
    const sources = Array.isArray(op.sources)
      ? (op.sources as unknown[]).map(String).filter((s) => s.trim() !== '')
      : []
    const requirements = String(op.requirements ?? '').trim()
    if (!sources.length) return { error: 'sources must not be empty' }
    if (!requirements) return { error: 'requirements must not be empty' }
    return gate('understand', async () => {
      try {
        let media
        try {
          media = await Promise.all(
            sources.map(async (s) => loadMediaSource(await resolveSourceOf(s, deps), deps.fetchImpl)),
          )
        } catch (loadErr) {
          return { error: err(loadErr) }
        }
        const hasVideo = media.some((m) => m.mime.startsWith('video/'))
        const chain = await resolveChain(hasVideo ? 'videoUnderstanding' : 'imageUnderstanding')
        const ur = await tryChain(
          chain,
          (call) => understandMediaWithModel(call, { media, requirements }),
          hasVideo ? 'video analysis' : 'image analysis',
        )
        if (!ur.ok) return { error: ur.error }
        const text = ur.result
        return { text, model: ur.model }
      } catch (e) {
        return { error: err(e) }
      }
    })
  })

  deps.ipcMain.removeHandler?.('ai:media-asr')
  deps.ipcMain.handle('ai:media-asr', async (_event, payload: unknown) => {
    const op = (payload ?? {}) as { source?: unknown; language?: unknown }
    const source = String(op.source ?? '').trim()
    if (!source) return { error: 'source must not be empty' }
    const language = String(op.language ?? '').trim()
    return gate('asr', async () => {
      try {
        let media
        try {
          media = await loadMediaSource(await resolveSourceOf(source, deps), deps.fetchImpl)
        } catch (loadErr) {
          return { error: err(loadErr) }
        }
        const chain = await resolveChain('asr')
        const bytes = new Uint8Array(Buffer.from(media.base64, 'base64'))
        const ar = await tryChain(
          chain,
          (call) =>
            transcribeWithModel(call, {
              bytes,
              mime: media.mime,
              // DashScope file transcription (paraformer family) needs the public URL
              ...(source.startsWith('http') ? { sourceUrl: source } : {}),
              ...(language ? { language } : {}),
            }),
          'asr',
        )
        if (!ar.ok) return { error: ar.error }
        return { text: ar.result, model: ar.model }
      } catch (e) {
        return { error: err(e) }
      }
    })
  })

  deps.ipcMain.removeHandler?.('ai:media-tts')
  deps.ipcMain.handle('ai:media-tts', async (_event, payload: unknown) => {
    const op = (payload ?? {}) as { text?: unknown; voice?: unknown }
    const text = String(op.text ?? '').trim()
    if (!text) return { error: 'text must not be empty' }
    const voice = String(op.voice ?? '').trim()
    return gate('tts', async () => {
      try {
        const chain = await resolveChain('tts')
        const tr = await tryChain(
          chain,
          (call) => synthesizeSpeechWithModel(call, { text, ...(voice ? { voice } : {}) }),
          'tts',
        )
        if (!tr.ok) return { error: tr.error }
        const call = { model: tr.model }
        const result = tr.result
        const dir = mediaDir()
        await mkdir(dir, { recursive: true })
        const ext = result.mime.includes('wav')
          ? 'wav'
          : result.mime.includes('mpeg')
            ? 'mp3'
            : 'audio'
        const filePath = join(dir, `media-speech-${Date.now()}.${ext}`)
        await writeFile(filePath, result.bytes)
        return {
          url: pathToFileURL(filePath).toString(),
          mime: result.mime,
          model: call.model,
          ...(result.remoteUrl ? { remoteUrl: result.remoteUrl } : {}),
        }
      } catch (e) {
        return { error: err(e) }
      }
    })
  })
}

/**
 * Shared ai:fetch-image registrar — the download channel behind every
 * insert_image / web-image pipeline (markdown and pdf mains register it;
 * docs/sheets carry older inline copies). SSRF-guarded, transient-error
 * retries via fetchRemoteImage; store-backed file:// URLs resolve to real
 * mime types, so callers can trust content-type.
 */
export function registerFetchImageIpc(deps: {
  ipcMain: {
    handle(channel: string, fn: (event: unknown, url: unknown) => Promise<unknown>): void
    removeHandler?(channel: string): void
  }
  fetchImpl?: typeof fetch
}): void {
  deps.ipcMain.removeHandler?.('ai:fetch-image')
  deps.ipcMain.handle(
    'ai:fetch-image',
    async (
      _event,
      url: unknown,
    ): Promise<{
      base64: string
      mime: string
    } | null> => {
      try {
        const resp = await fetchRemoteImage(String(url), {
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        })
        if (!resp || !resp.ok) return null
        const buf = Buffer.from(await resp.arrayBuffer())
        const ct = resp.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
        const bytes = new Uint8Array(buf)
        const mime = ct && ct !== 'application/octet-stream' ? ct : sniffMime(bytes)
        return { base64: buf.toString('base64'), mime }
      } catch {
        return null
      }
    },
  )
}
