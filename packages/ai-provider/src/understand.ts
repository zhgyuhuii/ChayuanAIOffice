import { aiFetch } from './fetch'
import { httpBodyDetail } from './http-error'
import { bytesToBase64 } from './media-protocols'
import type { ResolvedModelCall } from './settings-v2'

/**
 * Media understanding over the chat-completions surface: images / video /
 * audio in, analysis text out — dispatched by the configured understanding
 * model's protocol. Unlike the attachment pipeline (which rides whatever
 * chat model is current), this calls the model the user explicitly configured
 * for imageUnderstanding / videoUnderstanding.
 *
 * Per-protocol media carriage:
 * - openai-compatible: images as image_url data URLs; video via the
 *   vendor-video dialect (`video_url` part, dashscope/qwen shape) — gateways
 *   that cannot carry video answer 4xx and the error passes through honestly
 * - gemini: inline_data for everything the request size allows
 * - anthropic: images as base64 source; no video carriage (clear error)
 */

export interface UnderstandMediaInput {
  /** loaded media blobs, mime-sniffed by the caller */
  media: Array<{ mime: string; base64: string }>
  requirements: string
}

/** hard inline cap: base64 inflates by 4/3, keep request bodies ~<= 20MB */
const MAX_INLINE_B64_CHARS = 28_000_000

const UNDERSTAND_TIMEOUT_MS = 300_000

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  if (signal) return signal
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  void timer
  return ctrl.signal
}

function dataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`
}

async function understandOpenAiCompatible(
  call: ResolvedModelCall,
  req: UnderstandMediaInput,
  signal?: AbortSignal,
): Promise<string> {
  const parts: Array<Record<string, unknown>> = [{ type: 'text', text: req.requirements }]
  for (const m of req.media) {
    const url = dataUrl(m.mime, m.base64)
    if (m.mime.startsWith('video/')) {
      // vendor-video dialect (dashscope/qwen shape); strict-OpenAI gateways
      // reject the part type and the error body passes through
      parts.push({ type: 'video_url', video_url: { url } })
    } else {
      parts.push({ type: 'image_url', image_url: { url } })
    }
  }
  const resp = await aiFetch(`${call.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${call.apiKey}` },
    body: JSON.stringify({
      model: call.model,
      messages: [{ role: 'user', content: parts }],
    }),
    signal: withTimeout(signal, UNDERSTAND_TIMEOUT_MS),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${httpBodyDetail(await resp.text())}`)
  const json = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    error?: { message?: string }
  }
  if (json.error) throw new Error(json.error.message || 'media understanding failed')
  const text = json.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('media understanding returned an empty answer')
  return text
}

async function understandGemini(
  call: ResolvedModelCall,
  req: UnderstandMediaInput,
  signal?: AbortSignal,
): Promise<string> {
  const parts: Array<Record<string, unknown>> = []
  let inlineChars = 0
  for (const m of req.media) {
    inlineChars += m.base64.length
    if (inlineChars > MAX_INLINE_B64_CHARS) {
      throw new Error('media too large for inline analysis (use a smaller clip)')
    }
    parts.push({ inline_data: { mime_type: m.mime, data: m.base64 } })
  }
  parts.push({ text: req.requirements })
  const resp = await aiFetch(
    `${call.baseUrl.replace(/\/$/, '')}/models/${call.model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': call.apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts }] }),
      signal: withTimeout(signal, UNDERSTAND_TIMEOUT_MS),
    },
  )
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${httpBodyDetail(await resp.text())}`)
  const json = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    error?: { message?: string }
  }
  if (json.error) throw new Error(json.error.message || 'media understanding failed')
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim()
  if (!text) throw new Error('media understanding returned an empty answer')
  return text
}

async function understandAnthropic(
  call: ResolvedModelCall,
  req: UnderstandMediaInput,
  signal?: AbortSignal,
): Promise<string> {
  const content: Array<Record<string, unknown>> = []
  for (const m of req.media) {
    if (!m.mime.startsWith('image/')) {
      throw new Error(
        `the Anthropic Messages protocol carries images only — ${m.mime} is not supported; configure a Gemini or OpenAI-compatible analysis model for video`,
      )
    }
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: m.mime, data: m.base64 },
    })
  }
  content.push({ type: 'text', text: req.requirements })
  const resp = await aiFetch(`${call.baseUrl.replace(/\/$/, '')}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': call.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: call.model,
      max_tokens: 4096,
      messages: [{ role: 'user', content }],
    }),
    signal: withTimeout(signal, UNDERSTAND_TIMEOUT_MS),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${httpBodyDetail(await resp.text())}`)
  const json = (await resp.json()) as {
    content?: Array<{ type: string; text?: string }>
    error?: { message?: string }
  }
  if (json.error) throw new Error(json.error.message || 'media understanding failed')
  const text = (json.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim()
  if (!text) throw new Error('media understanding returned an empty answer')
  return text
}

/** dispatch by protocol; throws with an honest reason when nothing matches */
export async function understandMediaWithModel(
  call: ResolvedModelCall,
  input: UnderstandMediaInput,
  signal?: AbortSignal,
): Promise<string> {
  if (!input.requirements.trim()) throw new Error('requirements must not be empty')
  if (!input.media.length) throw new Error('no media to analyze')
  for (const m of input.media) {
    if (m.base64.length > MAX_INLINE_B64_CHARS) {
      throw new Error(`media too large for inline analysis (${m.mime})`)
    }
  }
  switch (call.protocol) {
    case 'gemini':
      return understandGemini(call, input, signal)
    case 'anthropic':
      return understandAnthropic(call, input, signal)
    case 'codex-app-server':
      throw new Error('the Codex app-server protocol has no media-understanding API')
    default:
      // openai-compatible / openai-responses share the chat shape
      return understandOpenAiCompatible(call, input, signal)
  }
}

/** bytes → base64 convenience for callers that loaded media as bytes */
export function mediaToBase64(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
}
