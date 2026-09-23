/**
 * AI IPC for the slides main process, extracted from slides-main.ts:
 * settings persistence, the streaming proxy (main process does the networking
 * to avoid renderer CORS), search tools, and the slides-only ai:* channels
 * (image generation, media analysis, style templates).
 */
import { app, dialog, ipcMain, nativeImage, net, shell, BrowserWindow } from 'electron'
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  watch,
  writeFileSync,
} from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  inferModelType,
  modelAcceptsImages,
  resolveDefaultModel,
  runMediaJob,
  setAiUserAgent,
  setRescueFetch,
  type AiRuntime,
} from '@chatoffice/ai-provider'
import { persistGeneratedImage } from '@chatoffice/ai-host'
import { registerMediaIpc, registerSharedAiIpc, registerSharedKbIpc } from '@chatoffice/ai-host'
import { MAX_REMOTE_IMAGE_BYTES, fetchRemoteImage, readBodyCapped } from '@chatoffice/electron-utils'
import { shutdownCodexAppServers } from '@chatoffice/ai-provider/codex-app-server' 
import {
  webSearch,
  imageSearch,
  readUrlContent,
  ensureChatofficeLogin,
  chatofficeApiKey,
  chatofficeAnalyzeMedia,
  chatofficeLoginInfo,
  hasChatOfficeAuth,
} from '@chatoffice/ai-search'
import { addPicture, editPictureSrcRect, replacePictureBytes } from '@chatoffice/pptx-engine'
import { matchesElementRef } from '@chatoffice/pptx-engine/identity'
import { coverCropFractions } from '@chatoffice/pipelines/slides/cover-crop'
import type { AiRunFailure } from '../shared/ipc'
import { EMU_PER_PX_96 } from '@chatoffice/pptx-render'
import { tm } from './i18n-main'
import { pushHistory, rebuildSlide, scheduleHistoryNotify, sessions } from './session-state'

// ---- AI settings + streaming proxy (the main process does the networking to avoid renderer CORS; implementation shared via @chatoffice/ai-provider) ----

const AI_SETTINGS_PATH = () => join(app.getPath('userData'), 'ai-settings.json')

/** ChatOffice cloud backend removed — always false */
function chatofficeCloudToolsOn(): boolean {
  return false
}

/** v2 AI runtime, created by registerAiIpc and reused by the slides-only channels */
let aiRuntime: AiRuntime | null = null
export function getAiRuntime(): AiRuntime {
  if (!aiRuntime) throw new Error('AI runtime used before registerAiIpc()')
  return aiRuntime
}

function readJson<T>(path: string, fallback: T): T {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    /* Corrupted state file: fall back to defaults */
  }
  return fallback
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2))
}

// ---- Post-mortem log for runs that produced no usable reply ----

const AI_RUN_FAILURES_PATH = () => join(app.getPath('userData'), 'ai-run-failures.jsonl')
/** Enough of a repetition blowup to recognize the pattern, without storing megabytes */
const RUN_FAILURE_TEXT_MAX = 20_000
/** Rotated (one generation kept) rather than grown without bound */
const RUN_FAILURES_MAX_BYTES = 2_000_000

function appendRunFailure(entry: AiRunFailure): void {
  const path = AI_RUN_FAILURES_PATH()
  try {
    if (existsSync(path) && statSync(path).size > RUN_FAILURES_MAX_BYTES) {
      renameSync(path, `${path}.1`)
    }
    const record = {
      ts: new Date().toISOString(),
      ...entry,
      instruction: entry.instruction.slice(0, RUN_FAILURE_TEXT_MAX),
      streamed: entry.streamed.slice(0, RUN_FAILURE_TEXT_MAX),
      streamedChars: entry.streamed.length,
    }
    appendFileSync(path, JSON.stringify(record) + '\n', 'utf-8')
  } catch {
    /* Diagnostics must never break a run */
  }
}

export function registerAiIpc(): void {
  app.once('before-quit', shutdownCodexAppServers)
  // Node fetch (undici) direct connections get reset under VPN/tun setups; retry over Chromium's stack
  setRescueFetch((url, init) => net.fetch(url, init))
  setAiUserAgent(`ChatOffice/${app.getVersion()}`)

  registerSharedKbIpc({ ipcMain, statePath: () => join(app.getPath('userData'), 'kb-source.json') })
  // LOCAL(2026-09-20): unified media capability channels; upstream: additive-only; converge: never (local feature)
  registerMediaIpc({
    ipcMain,
    settingsPath: () => AI_SETTINGS_PATH(),
    mediaDir: () => join(app.getPath('userData'), 'media', 'files'),
  })
  aiRuntime = registerSharedAiIpc({
    ipcMain,
    settingsPath: AI_SETTINGS_PATH(),
    fs: {
      readFile: (p) => readFile(p, 'utf8'),
      writeFile: async (p, contents) => {
        mkdirSync(join(p, '..'), { recursive: true })
        writeFileSync(p, contents)
      },
      watch: (p, cb) => {
        try {
          const w = watch(p, () => cb())
          return () => w.close()
        } catch {
          return () => {}
        }
      },
    },
    chatoffice: {
      apiKey: () => chatofficeApiKey(),
      hasAuth: () => hasChatOfficeAuth(),
      status: async (withEmail) => {
        if (!hasChatOfficeAuth()) return { loggedIn: false }
        if (!withEmail) return { loggedIn: true }
        const info = await chatofficeLoginInfo()
        return info?.email ? { loggedIn: true, email: info.email } : { loggedIn: true }
      },
    },
    chatofficeLogin: () => ensureChatofficeLogin((url) => void shell.openExternal(url)),
    translate: (key, params) =>
      tm(key as Parameters<typeof tm>[0], params as Parameters<typeof tm>[1]),
    videoTasks: {
      runtime: () => getAiRuntime(),
      sink: {
        mkdir: (p, opts) => mkdir(p, opts),
        createWriteStream: (p) => createWriteStream(p),
        readFile: (p) => readFile(p),
        statSize: async (p) => (await stat(p)).size,
      },
      mediaDir: join(app.getPath('userData'), 'media', 'videos'),
      notify: (channel, payload) => {
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
      },
    },
  })

  ipcMain.handle('ai:log-run-failure', (_event, entry: AiRunFailure) => {
    appendRunFailure(entry)
  })

  // Search tools (content + images), Serper with DuckDuckGo fallback
  ipcMain.handle('ai:web-search', async (_event, query: string, maxResults?: number) => {
    try {
      return await webSearch(
        String(query),
        typeof maxResults === 'number' ? maxResults : 6,
        chatofficeCloudToolsOn(),
      )
    } catch (err) {
      return { results: [], method: 'error', error: String(err) }
    }
  })

  ipcMain.handle('ai:image-search', async (_event, query: string, maxResults?: number) => {
    try {
      return await imageSearch(
        String(query),
        typeof maxResults === 'number' ? maxResults : 8,
        chatofficeCloudToolsOn(),
      )
    } catch (err) {
      return { images: [], method: 'error', error: String(err) }
    }
  })
}

// ── ai:* handlers unique to slides ──────────────────────────────────────
// Must be registered inside registerSlidesIpc (not registerAiIpc): in shell aggregate mode the
// generic ai:* channels are registered by docs-main.registerAiIpc, and slides' registerAiIpc is
// never called; docs does not have these channels, so putting them in the wrong place raises
// "No handler registered".
export function registerSlidesOnlyAiIpc(): void {
  // ── read_url: fetch a public page, extract body text for the model ──
  ipcMain.handle('ai:read-url', async (_event, url: string) => {
    try {
      return await readUrlContent(String(url ?? ''))
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ── AI video generation ──
  // Cost-gated by design: every submit shows a native confirmation dialog
  // (model/length visible) with a per-session "don't ask again" checkbox.
  // The vendor/model pair resolves from the videoGeneration default role, or
  // the first enabled profile carrying a video-generation model + key.
  const videoConfirmSkip = new Set<number>()
  ipcMain.handle(
    'ai:generate-video',
    async (
      event,
      op: { prompt: string; imageUrl?: string; aspectRatio?: string; durationSeconds?: number },
    ): Promise<
      | { bytes: string; ext: string; url: string; model: string; vendorId: string }
      | { cancelled: true; reason?: string }
      | { error: string }
    > => {
      try {
        // raw settings (unredacted): the redacted view carries no keys, so the
        // videoGeneration role pick must resolve against the stored file
        const raw = await getAiRuntime().readRawSettings()
        let pick: { vendorId: string; model: string; apiKey: string; baseUrl?: string } | null =
          null
        const sel = resolveDefaultModel(raw, 'videoGeneration')
        if (sel) {
          const profile = raw.profiles.find((p) => p.id === sel.profileId)
          if (profile?.apiKey) {
            pick = {
              vendorId: profile.vendorId ?? profile.id,
              model: sel.modelId,
              apiKey: profile.apiKey,
              ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
            }
          }
        }
        if (!pick) {
          for (const profile of raw.profiles ?? []) {
            if (!profile.enabled || !profile.apiKey || profile.auth !== 'api-key') continue
            const model = profile.models.find((m) => inferModelType(m.id) === 'video-generation')
            if (model) {
              pick = {
                vendorId: profile.vendorId ?? profile.id,
                model: model.id,
                apiKey: profile.apiKey,
                ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
              }
              break
            }
          }
        }
        if (!pick) {
          return {
            error:
              'No video-generation model with an API key is configured — add one in AI settings',
          }
        }
        const wc = event.sender
        const dur = op.durationSeconds ?? 5
        if (!videoConfirmSkip.has(wc.id)) {
          const win = BrowserWindow.fromWebContents(wc)
          const r = await dialog.showMessageBox(win ?? undefined!, {
            type: 'info',
            message: 'Generate an AI video?',
            detail: `Model: ${pick.vendorId} / ${pick.model}\nLength: ~${dur}s\nVideo generation is billed by the vendor and may take a few minutes.`,
            buttons: ['Generate', 'Cancel'],
            defaultId: 0,
            cancelId: 1,
            checkboxLabel: "Don't ask again this session",
            checkboxChecked: false,
          })
          if (r.response !== 0) return { cancelled: true, reason: 'user declined' }
          if (r.checkboxChecked) videoConfirmSkip.add(wc.id)
        }
        const result = await runMediaJob({
          kind: 'video',
          vendorId: pick.vendorId,
          model: pick.model,
          apiKey: pick.apiKey,
          ...(pick.baseUrl ? { baseUrl: pick.baseUrl } : {}),
          prompt: String(op.prompt ?? ''),
          imageUrl: op.imageUrl,
          aspectRatio: op.aspectRatio,
          durationSeconds: dur,
        })
        const dl = await fetch(result.url)
        if (!dl.ok) return { error: `video download failed: HTTP ${dl.status}` }
        const buf = Buffer.from(await dl.arrayBuffer())
        if (buf.length > 40 * 1024 * 1024) {
          return {
            error: `the generated video is too large to embed (${Math.round(buf.length / 1048576)}MB > 40MB)`,
          }
        }
        return {
          bytes: buf.toString('base64'),
          ext: 'mp4',
          url: result.url,
          model: pick.model,
          vendorId: pick.vendorId,
        }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    },
  )

  // BYOK image generation only — the chatoffice cloud fallback was removed
  // (the cloud backend belongs to the upstream project, not this build).
  ipcMain.handle(
    'ai:generate-image',
    // LOCAL(2026-09-20): materialize generated image into the store — data:/https
    // URLs are not fetchable by the insert pipelines; upstream: additive; converge: upstream may adopt
    async (_event, op: { prompt?: unknown; aspectRatio?: unknown }) => {
      const prompt = String(op.prompt ?? '').trim()
      if (!prompt) return { error: 'prompt must not be empty' }
      const result = await getAiRuntime().generateImage({
        prompt,
        ...(op.aspectRatio ? { aspectRatio: String(op.aspectRatio) } : {}),
      })
      if (result.url) {
        try {
          return { ...result, url: await persistGeneratedImage(result.url) }
        } catch (err) {
          return { ...result, error: err instanceof Error ? err.message : String(err) }
        }
      }
      return result
    },
  )

  ipcMain.handle(
    'ai:analyze-media',
    async (_event, op: { mediaUrls: string[]; requirements: string }) => {
      const mediaUrls = (op.mediaUrls ?? []).map(String)
      const requirements = String(op.requirements ?? '')
      // BYOK first: a vision-capable current model analyzes without any login
      const view = await getAiRuntime().getSettingsView()
      const selection = view.currentModel
      const entry = selection
        ? view.profiles
            .find((p) => p.id === selection.profileId)
            ?.models.find((m) => m.id === selection.modelId)
        : undefined
      const modelType = entry?.type ?? (selection ? inferModelType(selection.modelId) : undefined)
      const visionOk =
        !!selection &&
        (modelType === 'chat' || modelType === 'vision') &&
        modelAcceptsImages(selection.modelId)
      if (selection && visionOk) {
        try {
          const images: Array<{ base64: string; mime: string }> = []
          for (const url of mediaUrls.slice(0, 6)) {
            const resp = await fetchRemoteImage(url)
            if (!resp || !resp.ok) continue
            const buf = Buffer.from(await resp.arrayBuffer())
            const ct = resp.headers.get('content-type') ?? ''
            const mime = ct.includes('png')
              ? 'image/png'
              : ct.includes('gif')
                ? 'image/gif'
                : 'image/jpeg'
            images.push({ base64: buf.toString('base64'), mime })
          }
          let text = ''
          await getAiRuntime().runStream(
            {
              requestId: `analyze-${Date.now()}`,
              selection,
              system: 'You analyze images for slide editing. Answer concisely.',
              messages: [
                {
                  role: 'user',
                  text: requirements || 'Analyze this media.',
                  ...(images.length > 0 ? { images } : {}),
                },
              ],
              tools: [],
            },
            (chunk) => {
              if (chunk.type === 'delta') text += chunk.text ?? ''
            },
          )
          if (text.trim()) return { text }
        } catch {
          // fall through to the chatoffice backend below
        }
      }
      if (!hasChatOfficeAuth()) return { error: tm('errChatOfficeCli') }
      if (!chatofficeCloudToolsOn()) return { error: tm('errChatOfficeToolsOff') }
      try {
        const text = await chatofficeAnalyzeMedia({ mediaUrls, requirements })
        return { text }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  /** Bytes of a user attachment the renderer resolved (attachment://): keep
   *  pptx-native formats as-is, convert anything else (webp/bmp/…) to PNG. */
  const attachmentImageBytes = (
    base64: string,
    ext: string,
  ): { buf: Buffer; ext: string } | null => {
    const buf = Buffer.from(String(base64), 'base64')
    if (!buf.length) return null
    const norm = String(ext)
      .toLowerCase()
      .replace(/^jpeg$/, 'jpg')
    if (norm === 'png' || norm === 'gif' || norm === 'jpg') return { buf, ext: norm }
    const img = nativeImage.createFromBuffer(buf)
    if (img.isEmpty()) return null
    return { buf: img.toPNG(), ext: 'png' }
  }

  // Download an image from a URL and insert it into the given page (image search -> insert in one step; download in the main process avoids CORS)
  ipcMain.handle(
    'ai:insert-image-url',
    async (
      e,
      op: {
        slideIndex: number
        url?: string
        /** raw base64 of a user attachment (attachment:// reference) — no network fetch */
        base64?: string
        ext?: string
        xPx: number
        yPx: number
        wPx: number
        hPx: number
        fitWidthPx: number
      },
    ) => {
      const session = sessions.get(e.sender.id)
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      try {
        let buf: Buffer
        let ext: string
        if (op.base64 != null) {
          const decoded = attachmentImageBytes(op.base64, op.ext ?? '')
          if (!decoded) return null
          ;({ buf, ext } = decoded)
        } else {
          // the URL originates from AI tool calls (prompt-injectable via image
          // search results), so refuse non-http schemes and private/link-local
          // targets; redirects are followed manually so every hop is validated.
          // fetchRemoteImage adds CDN-friendly headers and transient-error retries.
          const resp = await fetchRemoteImage(String(op.url))
          if (!resp || !resp.ok) return null
          buf = Buffer.from(await readBodyCapped(resp, MAX_REMOTE_IMAGE_BYTES))
          const ct = resp.headers.get('content-type') ?? ''
          ext = ct.includes('png') ? 'png' : ct.includes('gif') ? 'gif' : 'jpg'
        }
        const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
        const scale = op.fitWidthPx / baseWidthPx
        const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
        pushHistory(session)
        const el = addPicture(session.opened, slide, {
          bytes: new Uint8Array(buf),
          ext,
          offset: {
            x: toEmu(op.xPx),
            y: toEmu(op.yPx),
            cx: Math.max(1, toEmu(op.wPx)),
            cy: Math.max(1, toEmu(op.hPx)),
          },
        })
        if (!el) {
          session.undoStack.pop()
          scheduleHistoryNotify(session)
          return null
        }
        // The requested frame rarely matches the image's aspect ratio; never
        // stretch — fill the frame and center-crop the overflow (object-fit:
        // cover) so the layout box stays exactly where the model placed it.
        const natural = nativeImage.createFromBuffer(buf).getSize()
        const crop = coverCropFractions(natural.width, natural.height, op.wPx, op.hPx)
        if (crop) editPictureSrcRect(slide, el.id, crop)
        session.fitWidthPx = op.fitWidthPx
        const rebuilt = rebuildSlide(session, op.slideIndex)
        return rebuilt ? { slide: rebuilt, sourceId: el.id } : null
      } catch {
        return null
      }
    },
  )

  // Download an image from a URL and swap it into an existing picture in place
  // (frame/z-order/effects survive). Same URL hardening as ai:insert-image-url.
  ipcMain.handle(
    'ai:replace-picture-url',
    async (
      e,
      op: {
        slideIndex: number
        sourceId: string
        url?: string
        /** raw base64 of a user attachment (attachment:// reference) — no network fetch */
        base64?: string
        ext?: string
        keepSrcRect?: boolean
      },
    ) => {
      const session = sessions.get(e.sender.id)
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      // The AI layer may address the picture by its durable id — translate to the
      // parse-time id the engine matches
      const targetId =
        slide.elements.find((el) => matchesElementRef(el, String(op.sourceId)))?.id ??
        String(op.sourceId)
      try {
        let buf: Buffer
        let ext: string
        if (op.base64 != null) {
          const decoded = attachmentImageBytes(op.base64, op.ext ?? '')
          if (!decoded) return null
          ;({ buf, ext } = decoded)
        } else {
          const resp = await fetchRemoteImage(String(op.url))
          if (!resp || !resp.ok) return null
          buf = Buffer.from(await readBodyCapped(resp, MAX_REMOTE_IMAGE_BYTES))
          const ct = resp.headers.get('content-type') ?? ''
          ext = ct.includes('png') ? 'png' : ct.includes('gif') ? 'gif' : 'jpg'
        }
        pushHistory(session)
        const ok = replacePictureBytes(
          session.opened,
          slide,
          targetId,
          new Uint8Array(buf),
          ext,
          op.keepSrcRect ? { keepSrcRect: true } : undefined,
        )
        if (!ok) {
          session.undoStack.pop()
          scheduleHistoryNotify(session)
          return null
        }
        // A replacement with a different aspect ratio would be stretched into
        // the surviving frame — center-crop it to cover the frame instead.
        if (!op.keepSrcRect) {
          const pic = slide.elements.find((el) => el.id === targetId && el.type === 'picture')
          const frame = pic?.transform?.offset
          if (frame) {
            const natural = nativeImage.createFromBuffer(buf).getSize()
            const crop = coverCropFractions(natural.width, natural.height, frame.cx, frame.cy)
            if (crop) editPictureSrcRect(slide, targetId, crop)
          }
        }
        return rebuildSlide(session, op.slideIndex)
      } catch {
        return null
      }
    },
  )

  // ── Style Skill sidecar persistence: write a same-named .styleskill.json next to the draft (fail-open)
  ipcMain.handle(
    'ai:save-sidecar',
    async (
      event,
      data: { topic: string; styleSkill: string; createdAt: string },
    ): Promise<{ ok: boolean }> => {
      try {
        const session = sessions.get(event.sender.id)
        const draftPath = session?.path
        if (!draftPath || !draftPath.endsWith('.pptx')) return { ok: false }
        const sidecarPath = draftPath.replace(/\.pptx$/i, '.styleskill.json')
        writeFileSync(sidecarPath, JSON.stringify(data, null, 2))
        return { ok: true }
      } catch {
        return { ok: false }
      }
    },
  )

  // ── Style template save: stored in userData/style-templates/<name>.json
  const STYLE_TEMPLATES_DIR = () => join(app.getPath('userData'), 'style-templates')

  ipcMain.handle(
    'ai:save-style-template',
    (
      _event,
      name: string,
      data: { topic: string; styleSkill: string; createdAt: string },
    ): { ok: boolean; error?: string } => {
      try {
        const dir = STYLE_TEMPLATES_DIR()
        mkdirSync(dir, { recursive: true })
        // Filename: replace illegal characters in the name with _ then truncate to 64 chars
        const safeName = name.replace(/[/\\:*?"<>|]/g, '_').slice(0, 64)
        if (!safeName) return { ok: false, error: tm('errTplNameInvalid') }
        writeJson(join(dir, `${safeName}.json`), { ...data, name: safeName })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // ── Style template list
  ipcMain.handle(
    'ai:list-style-templates',
    (): Array<{ name: string; topic: string; createdAt: string }> => {
      try {
        const dir = STYLE_TEMPLATES_DIR()
        if (!existsSync(dir)) return []
        const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
        return files
          .map((f) => {
            try {
              const raw = readJson<{
                name?: string
                topic?: string
                createdAt?: string
                styleSkill?: string
              }>(join(dir, f), {})
              return {
                name: raw.name ?? f.replace(/\.json$/, ''),
                topic: raw.topic ?? '',
                createdAt: raw.createdAt ?? '',
              }
            } catch {
              return null
            }
          })
          .filter(Boolean) as Array<{ name: string; topic: string; createdAt: string }>
      } catch {
        return []
      }
    },
  )

  // ── Style template load
  ipcMain.handle(
    'ai:load-style-template',
    (
      _event,
      name: string,
    ): { ok: boolean; styleSkill?: string; topic?: string; error?: string } => {
      try {
        const dir = STYLE_TEMPLATES_DIR()
        const safeName = name.replace(/[/\\:*?"<>|]/g, '_').slice(0, 64)
        const filePath = join(dir, `${safeName}.json`)
        if (!existsSync(filePath)) return { ok: false, error: tm('errTplMissing', { name }) }
        const raw = readJson<{ styleSkill?: string; topic?: string }>(filePath, {})
        if (!raw.styleSkill) return { ok: false, error: tm('errTplNoSkill', { name }) }
        return { ok: true, styleSkill: raw.styleSkill, topic: raw.topic ?? '' }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )
}
