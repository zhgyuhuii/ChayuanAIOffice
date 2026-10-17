/**
 * Media + document channels for the web/dsh forms — the HTTP port of the
 * desktop's registerMediaIpc (packages/ai-host/src/media-ipc.ts) and the
 * create_document skill's host write. Model resolution rides the same runtime
 * the chat uses (settings defaults → per-kind chain, harness apiKeyRef resolved
 * server-side); binaries return as base64 so the web shim can hand them to the
 * FS Access save picker — agent tool calls run outside user-gesture windows,
 * where the picker degrades to a browser download by design.
 *
 * docx creation is headless: the blank-docx zip skeleton (styles + numbering)
 * from docx-engine with a markdown-derived OOXML body — the desktop instead
 * opens the docs editor with the payload, a flow the web shell cannot host
 * yet; the produced file is a real .docx that opens in Word/WPS and the docs
 * editor unchanged.
 */
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import type { FastifyInstance } from 'fastify'
import {
  resolveMediaCapabilityChain,
  runMediaJob,
  understandMediaWithModel,
  transcribeWithModel,
  synthesizeSpeechWithModel,
  type AiRuntime,
  type ResolvedModelCall,
} from '@chaoffice/ai-provider'
import {
  BLANK_BULLET_NUM_ID,
  BLANK_ORDERED_NUM_ID,
  buildBlankDocx,
} from '@chaoffice/docx-engine'

export interface MediaRouteDeps {
  runtime: AiRuntime
  /** harness-fused secret resolution (ai-proxy buildRuntime); absent for BYOK file settings */
  mediaResolveSecret?: (profile: import('@chaoffice/ai-provider').AiProviderProfile) => Promise<string>
}

const MAX_MEDIA_BYTES = 200 * 1024 * 1024
const MAX_VIDEO_FILE_BYTES = 40 * 1024 * 1024
const CREATE_DOCUMENT_MAX_CHARS = 2_000_000

const err = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// ── markdown → docx (subset: headings, lists, quote, code, tables, inline) ──

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** inline markdown → w:r runs (bold / italic / code / links as text + url) */
function inlineRuns(text: string): string {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g)
  let out = ''
  for (const part of parts) {
    if (!part) continue
    if (part.startsWith('**') && part.endsWith('**')) {
      out += `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${esc(part.slice(2, -2))}</w:t></w:r>`
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      out += `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${esc(part.slice(1, -1))}</w:t></w:r>`
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      out += `<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t xml:space="preserve">${esc(part.slice(1, -1))}</w:t></w:r>`
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part)
      const body = link ? `${link[1]} (${link[2]})` : part
      out += `<w:r><w:t xml:space="preserve">${esc(body)}</w:t></w:r>`
    }
  }
  return out || '<w:r><w:t xml:space="preserve"></w:t></w:r>'
}

function paragraph(runs: string, pPr = ''): string {
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${runs}</w:p>`
}

function tableXml(rows: string[][]): string {
  const cols = Math.max(...rows.map((r) => r.length))
  const cell = (text: string, bold: boolean): string => {
    const runs = bold
      ? `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
      : inlineRuns(text)
    return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${paragraph(runs)}</w:tc>`
  }
  const body = rows
    .map((r, ri) => `<w:tr>${Array.from({ length: cols }, (_, ci) => cell(r[ci] ?? '', ri === 0)).join('')}</w:tr>`)
    .join('')
  const borders =
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`)
      .join('') +
    '</w:tblBorders>'
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}</w:tblPr>` +
    `<w:tblGrid>${Array.from({ length: cols }, () => '<w:gridCol/>').join('')}</w:tblGrid>` +
    `${body}</w:tbl>`
  )
}

/** markdown body → OOXML block sequence (blank-docx style/numbering ids only) */
export function markdownBodyXml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const blocks: string[] = []
  let i = 0
  const listPara = (numId: string) =>
    `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`
  while (i < lines.length) {
    const line = lines[i]!
    if (line.startsWith('```')) {
      i++
      const code: string[] = []
      while (i < lines.length && !lines[i]!.startsWith('```')) code.push(lines[i++]!)
      i++ // closing fence
      for (const c of code) {
        blocks.push(
          paragraph(
            `<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t xml:space="preserve">${esc(c)}</w:t></w:r>`,
          ),
        )
      }
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push(paragraph(inlineRuns(heading[2]!), `<w:pStyle w:val="Heading${heading[1]!.length}"/>`))
      i++
      continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      blocks.push(paragraph(inlineRuns(line.replace(/^\s*[-*+]\s+/, '')), listPara(BLANK_BULLET_NUM_ID)))
      i++
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      blocks.push(paragraph(inlineRuns(line.replace(/^\s*\d+[.)]\s+/, '')), listPara(BLANK_ORDERED_NUM_ID)))
      i++
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      blocks.push(paragraph(inlineRuns(line.replace(/^\s*>\s?/, '')), '<w:pStyle w:val="Quote"/>'))
      i++
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) {
        const cells = lines[i]!
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim())
        // separator row (|---|---|)
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) rows.push(cells)
        i++
      }
      if (rows.length) blocks.push(tableXml(rows))
      continue
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push(paragraph('<w:r><w:t xml:space="preserve"></w:t></w:r>'))
      i++
      continue
    }
    if (!line.trim()) {
      i++
      continue
    }
    blocks.push(paragraph(inlineRuns(line)))
    i++
  }
  return blocks.join('')
}

/** markdown → a real .docx over the blank-docx zip skeleton */
export async function markdownToDocx(md: string, eastAsiaFont?: string): Promise<Uint8Array> {
  const blank = await buildBlankDocx(eastAsiaFont ? { eastAsiaFont } : undefined)
  const zip = await JSZip.loadAsync(blank)
  const docXml = await zip.file('word/document.xml')!.async('string')
  const sectPr = /<w:sectPr>[\s\S]*?<\/w:sectPr>/.exec(docXml)?.[0] ?? ''
  zip.file(
    'word/document.xml',
    docXml.replace(
      /<w:body>[\s\S]*<\/w:body>/,
      `<w:body>${markdownBodyXml(md)}${sectPr}</w:body>`,
    ),
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

// ── media source loading (data:/http(s)/plain path; loopback BFF context) ──

async function loadMediaSource(
  source: string,
): Promise<{ base64: string; mime: string }> {
  if (source.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(source)
    if (!match) throw new Error('unsupported data URL')
    if (match[2]!.length > (MAX_MEDIA_BYTES / 3) * 4) throw new Error('media too large to analyze')
    return { base64: match[2]!, mime: match[1]! }
  }
  let bytes: Uint8Array
  let mime = ''
  if (/^https?:\/\//i.test(source)) {
    const resp = await fetch(source)
    if (!resp.ok) throw new Error(`could not download ${source}`)
    const declared = Number(resp.headers.get('content-length') ?? 0)
    if (declared > MAX_MEDIA_BYTES) throw new Error('media too large to analyze')
    bytes = new Uint8Array(await resp.arrayBuffer())
    if (bytes.byteLength > MAX_MEDIA_BYTES) throw new Error('media too large to analyze')
    mime = resp.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  } else {
    bytes = new Uint8Array(await readFile(source))
  }
  if (!bytes.byteLength) throw new Error('empty media file')
  return { base64: Buffer.from(bytes).toString('base64'), mime: mime || 'application/octet-stream' }
}

// ── routes ───────────────────────────────────────────────────────────────────

export function attachMediaRoutes(app: FastifyInstance, deps: MediaRouteDeps): void {
  const { runtime, mediaResolveSecret } = deps
  const chain = (kind: Parameters<typeof resolveMediaCapabilityChain>[1]) =>
    runtime.readRawSettings().then((settings) =>
      resolveMediaCapabilityChain(settings, kind, {
        // capability resolution is profileId-keyed; bridge it onto the
        // profile-keyed harness secret resolver
        resolveSecret: mediaResolveSecret
          ? async (profileId: string): Promise<string | null> => {
              const profile = settings.profiles.find((p) => p.id === profileId)
              if (!profile) return null
              return mediaResolveSecret(profile)
            }
          : async () => null,
      }),
    )
  /** walk candidates top-down; first success wins, all-fail returns the last error */
  const tryChain = async <T>(
    calls: ResolvedModelCall[],
    run: (call: ResolvedModelCall) => Promise<T>,
    kindLabel: string,
  ): Promise<{ ok: true; result: T; model: string } | { ok: false; error: string }> => {
    if (!calls.length) return { ok: false, error: `no ${kindLabel} model configured (Settings → 生图、媒体与搜索)` }
    let lastError = ''
    for (const call of calls) {
      try {
        return { ok: true, result: await run(call), model: call.model }
      } catch (e) {
        lastError = err(e)
      }
    }
    return { ok: false, error: calls.length > 1 ? `${lastError} (tried ${calls.length} models)` : lastError }
  }

  app.post<{
    Body: { prompt?: string; aspectRatio?: string; durationSeconds?: number }
  }>('/ai/media/video', async (request) => {
    const prompt = String(request.body?.prompt ?? '').trim()
    if (!prompt) return { error: 'prompt must not be empty' }
    try {
      const vr = await tryChain(
        await chain('video'),
        (call) =>
          runMediaJob({
            kind: 'video',
            vendorId: call.vendorId ?? 'openai',
            model: call.model,
            apiKey: call.apiKey,
            ...(call.baseUrl ? { baseUrl: call.baseUrl } : {}),
            prompt,
            ...(request.body?.aspectRatio ? { aspectRatio: String(request.body.aspectRatio) } : {}),
            ...(Number(request.body?.durationSeconds) || undefined
              ? { durationSeconds: Number(request.body!.durationSeconds) }
              : {}),
          }),
        'video',
      )
      if (!vr.ok) return { error: vr.error }
      const result = vr.result
      const dl = await fetch(result.url)
      if (!dl.ok) return { error: `video download failed: HTTP ${dl.status}`, url: result.url, model: vr.model }
      const bytes = new Uint8Array(await dl.arrayBuffer())
      if (bytes.byteLength > MAX_VIDEO_FILE_BYTES)
        return { url: result.url, model: vr.model, error: `the generated video is too large to inline (${Math.round(bytes.byteLength / 1048576)}MB)` }
      return { url: result.url, bytesB64: Buffer.from(bytes).toString('base64'), mime: 'video/mp4', model: vr.model }
    } catch (e) {
      return { error: err(e) }
    }
  })

  app.post<{
    Body: { sources?: unknown[]; requirements?: string }
  }>('/ai/media/understand', async (request) => {
    const sources = Array.isArray(request.body?.sources)
      ? request.body.sources.map(String).filter((s) => s.trim() !== '')
      : []
    const requirements = String(request.body?.requirements ?? '').trim()
    if (!sources.length) return { error: 'sources must not be empty' }
    if (!requirements) return { error: 'requirements must not be empty' }
    try {
      const media = await Promise.all(sources.map((s) => loadMediaSource(s)))
      const hasVideo = media.some((m) => m.mime.startsWith('video/'))
      const ur = await tryChain(
        await chain(hasVideo ? 'videoUnderstanding' : 'imageUnderstanding'),
        (call) => understandMediaWithModel(call, { media, requirements }),
        hasVideo ? 'video analysis' : 'image analysis',
      )
      if (!ur.ok) return { error: ur.error }
      return { text: ur.result, model: ur.model }
    } catch (e) {
      return { error: err(e) }
    }
  })

  app.post<{ Body: { source?: string; language?: string } }>('/ai/media/asr', async (request) => {
    const source = String(request.body?.source ?? '').trim()
    if (!source) return { error: 'source must not be empty' }
    try {
      const media = await loadMediaSource(source)
      const ar = await tryChain(
        await chain('asr'),
        (call) =>
          transcribeWithModel(call, {
            bytes: new Uint8Array(Buffer.from(media.base64, 'base64')),
            mime: media.mime,
            ...(source.startsWith('http') ? { sourceUrl: source } : {}),
            ...(request.body?.language ? { language: String(request.body.language) } : {}),
          }),
        'asr',
      )
      if (!ar.ok) return { error: ar.error }
      return { text: ar.result, model: ar.model }
    } catch (e) {
      return { error: err(e) }
    }
  })

  app.post<{ Body: { text?: string; voice?: string } }>('/ai/media/tts', async (request) => {
    const text = String(request.body?.text ?? '').trim()
    if (!text) return { error: 'text must not be empty' }
    try {
      const tr = await tryChain(
        await chain('tts'),
        (call) =>
          synthesizeSpeechWithModel(call, {
            text,
            ...(request.body?.voice ? { voice: String(request.body.voice) } : {}),
          }),
        'tts',
      )
      if (!tr.ok) return { error: tr.error }
      return {
        bytesB64: Buffer.from(tr.result.bytes).toString('base64'),
        mime: tr.result.mime,
        model: tr.model,
        ...(tr.result.remoteUrl ? { remoteUrl: tr.result.remoteUrl } : {}),
      }
    } catch (e) {
      return { error: err(e) }
    }
  })

  app.post<{
    Body: { title?: string; format?: string; content?: string }
  }>('/ai/create-document', async (request) => {
    const title = (String(request.body?.title ?? '').trim() || 'Untitled').replace(/[\\/:*?"<>|]/g, '_')
    const format = request.body?.format
    const content = String(request.body?.content ?? '')
    if (format !== 'md' && format !== 'docx') return { ok: false, error: 'format must be "md" or "docx"' }
    if (!content.trim()) return { ok: false, error: 'content must not be empty' }
    if (content.length > CREATE_DOCUMENT_MAX_CHARS)
      return { ok: false, error: `content is too long (${content.length} characters, cap ${CREATE_DOCUMENT_MAX_CHARS})` }
    try {
      if (format === 'md') {
        return {
          ok: true,
          bytesB64: Buffer.from(content, 'utf8').toString('base64'),
          mime: 'text/markdown',
          filename: `${title}.md`,
        }
      }
      const bytes = await markdownToDocx(content, '宋体')
      return {
        ok: true,
        bytesB64: Buffer.from(bytes).toString('base64'),
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: `${title}.docx`,
      }
    } catch (e) {
      return { ok: false, error: err(e) }
    }
  })

  app.get('/ai/search-capabilities', async () => {
    // the BFF's web-search route always carries the free DuckDuckGo tier
    return { search: true }
  })
}
