import { dashscopeRoot, isDashscopeCall } from './capability-runtime'
import { aiFetch } from './fetch'
import { httpBodyDetail } from './http-error'
import type { ResolvedModelCall } from './settings-v2'

/**
 * Speech synthesis (TTS) over the configured tts-kind model, dispatched by
 * protocol:
 * - openai-compatible: POST /audio/speech (the shape most gateways mirror)
 * - gemini: generateContent with AUDIO response modality; raw L16 PCM comes
 *   back and is wrapped into a playable WAV container here
 * Other protocols have no speech API — a clear error, never a silent skip.
 */

export interface SpeechSynthesisInput {
  text: string
  /** vendor voice id; protocol-appropriate default when omitted */
  voice?: string
  /** 'mp3' | 'wav' | 'opus' | 'flac' | 'aac' (openai-compatible); gemini always WAV */
  format?: string
}

export interface SpeechSynthesisResult {
  bytes: Uint8Array
  mime: string
  /** vendor-side temporary URL when the provider answers with a link (qwen-tts) */
  remoteUrl?: string
}

const TTS_TIMEOUT_MS = 180_000

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  if (signal) return signal
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  void timer
  return ctrl.signal
}

const OPENAI_FORMAT_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/mp4',
}

/** wrap raw signed 16-bit little-endian mono PCM in a minimal WAV container */
export function pcm16ToWav(pcm: Uint8Array, sampleRate: number, channels = 1): Uint8Array {
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  const dataLen = pcm.byteLength
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataLen, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, (sampleRate * channels * 2) | 0, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataLen, true)
  const out = new Uint8Array(44 + dataLen)
  out.set(new Uint8Array(header), 0)
  out.set(pcm, 44)
  return out
}

async function synthesizeOpenAiCompatible(
  call: ResolvedModelCall,
  req: SpeechSynthesisInput,
  signal?: AbortSignal,
): Promise<SpeechSynthesisResult> {
  const format = req.format && OPENAI_FORMAT_MIME[req.format] ? req.format : 'mp3'
  const resp = await aiFetch(`${call.baseUrl.replace(/\/$/, '')}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${call.apiKey}` },
    body: JSON.stringify({
      model: call.model,
      input: req.text,
      voice: req.voice ?? 'alloy',
      response_format: format,
    }),
    signal: withTimeout(signal, TTS_TIMEOUT_MS),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${httpBodyDetail(await resp.text())}`)
  const bytes = new Uint8Array(await resp.arrayBuffer())
  if (!bytes.byteLength) throw new Error('speech synthesis returned no audio')
  return { bytes, mime: OPENAI_FORMAT_MIME[format]! }
}

/** gemini TTS answers inline L16 PCM at 24kHz mono — wrap to WAV */
async function synthesizeGemini(
  call: ResolvedModelCall,
  req: SpeechSynthesisInput,
  signal?: AbortSignal,
): Promise<SpeechSynthesisResult> {
  const voice = req.voice ?? 'Kore'
  const resp = await aiFetch(
    `${call.baseUrl.replace(/\/$/, '')}/models/${call.model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': call.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: req.text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
      signal: withTimeout(signal, TTS_TIMEOUT_MS),
    },
  )
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${httpBodyDetail(await resp.text())}`)
  const json = (await resp.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> }
    }>
    error?: { message?: string }
  }
  if (json.error) throw new Error(json.error.message || 'speech synthesis failed')
  const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData
  if (!inline?.data) throw new Error('speech synthesis returned no audio')
  // base64 → bytes without Buffer (renderer-safe by construction)
  const bin = atob(inline.data)
  const pcm = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) pcm[i] = bin.charCodeAt(i)
  const rateMatch = /rate=(\d+)/.exec(inline.mimeType ?? '')
  const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000
  return { bytes: pcm16ToWav(pcm, sampleRate), mime: 'audio/wav' }
}

/**
 * Alibaba DashScope voice synthesis — three model families, three shapes:
 * - qwen-tts(-latest): JSON answer carrying a temporary output.audio.url
 * - cosyvoice-v1/v2: binary audio body from multimodal-generation
 * - sambert-*: binary audio body from the dedicated /audio/tts endpoint
 */
async function synthesizeDashscope(
  call: ResolvedModelCall,
  req: SpeechSynthesisInput,
  signal?: AbortSignal,
): Promise<SpeechSynthesisResult> {
  const root = dashscopeRoot(call.baseUrl)
  const model = call.model.toLowerCase()
  const auth = { Authorization: `Bearer ${call.apiKey}` }
  if (/qwen-tts/.test(model)) {
    const resp = await aiFetch(`${root}/api/v1/services/aigc/multimodal-generation/generation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        model: call.model,
        input: { text: req.text, ...(req.voice ? { voice: req.voice } : {}) },
      }),
      signal: withTimeout(signal, TTS_TIMEOUT_MS),
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${httpBodyDetail(await resp.text())}`)
    const json = (await resp.json()) as {
      output?: { audio?: { url?: string } }
      message?: string
    }
    const url = json.output?.audio?.url
    if (!url) throw new Error(json.message || 'qwen-tts returned no audio URL')
    const dl = await aiFetch(url, { signal: withTimeout(signal, TTS_TIMEOUT_MS) })
    if (!dl.ok) throw new Error(`audio download failed: HTTP ${dl.status}`)
    const bytes = new Uint8Array(await dl.arrayBuffer())
    const ct = dl.headers.get('content-type')?.split(';')[0]?.trim()
    return {
      bytes,
      mime: ct && ct.startsWith('audio/') ? ct : 'audio/wav',
      ...(url.startsWith('http') ? { remoteUrl: url } : {}),
    }
  }
  if (/sambert/.test(model)) {
    const resp = await aiFetch(`${root}/api/v1/services/audio/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        model: call.model,
        input: { text: req.text },
        parameters: { format: req.format === 'mp3' ? 'mp3' : 'wav' },
      }),
      signal: withTimeout(signal, TTS_TIMEOUT_MS),
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${httpBodyDetail(await resp.text())}`)
    const bytes = new Uint8Array(await resp.arrayBuffer())
    return { bytes, mime: req.format === 'mp3' ? 'audio/mpeg' : 'audio/wav' }
  }
  // cosyvoice family (default): binary audio from multimodal-generation
  const format = req.format === 'mp3' ? 'mp3' : 'wav'
  const resp = await aiFetch(`${root}/api/v1/services/aigc/multimodal-generation/generation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({
      model: call.model,
      input: { text: req.text, voice: req.voice ?? 'longxiaochun' },
      parameters: { format, sample_rate: format === 'mp3' ? 22050 : 24000 },
    }),
    signal: withTimeout(signal, TTS_TIMEOUT_MS),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${httpBodyDetail(await resp.text())}`)
  const bytes = new Uint8Array(await resp.arrayBuffer())
  return { bytes, mime: format === 'mp3' ? 'audio/mpeg' : 'audio/wav' }
}

export async function synthesizeSpeechWithModel(
  call: ResolvedModelCall,
  input: SpeechSynthesisInput,
  signal?: AbortSignal,
): Promise<SpeechSynthesisResult> {
  if (!input.text.trim()) throw new Error('text must not be empty')
  if (isDashscopeCall(call)) return synthesizeDashscope(call, input, signal)
  switch (call.protocol) {
    case 'gemini':
      return synthesizeGemini(call, input, signal)
    case 'anthropic':
    case 'codex-app-server':
      throw new Error(
        `the ${call.protocol} protocol has no speech-synthesis API; configure an OpenAI-compatible or Gemini TTS model`,
      )
    default:
      return synthesizeOpenAiCompatible(call, input, signal)
  }
}
