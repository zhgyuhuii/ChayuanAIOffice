import { dashscopeRoot, isDashscopeCall } from './capability-runtime'
import { aiFetch } from './fetch'
import { httpBodyDetail } from './http-error'
import { bytesToBase64 } from './media-protocols'
import type { ResolvedModelCall } from './settings-v2'

/**
 * Speech recognition (ASR / transcription) over the configured asr-kind
 * model, dispatched by protocol:
 * - openai-compatible: multipart POST /audio/transcriptions (whisper shape,
 *   mirrored by most gateways)
 * - gemini: inline_data audio + transcription prompt
 * Other protocols have no transcription API — a clear error, never a silent skip.
 */

export interface TranscriptionInput {
  bytes: Uint8Array
  mime: string
  /** ISO language hint, e.g. 'zh' / 'en'; omitted = auto */
  language?: string
  /** optional prompt/ vocabulary hint passed through where supported */
  prompt?: string
  /**
   * Public http(s) URL of the source when it came from the network.
   * DashScope file transcription (paraformer family) only accepts public
   * URLs — inline bytes cannot reach that API.
   */
  sourceUrl?: string
}

const ASR_TIMEOUT_MS = 300_000

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  if (signal) return signal
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  void timer
  return ctrl.signal
}

function extForMime(mime: string): string {
  if (mime.includes('mpeg')) return 'mp3'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('flac')) return 'flac'
  if (mime.includes('m4a') || mime.includes('mp4')) return 'm4a'
  if (mime.includes('webm')) return 'webm'
  return 'bin'
}

async function transcribeOpenAiCompatible(
  call: ResolvedModelCall,
  input: TranscriptionInput,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData()
  form.append(
    'file',
    new Blob([new Uint8Array(input.bytes)], { type: input.mime }),
    `audio.${extForMime(input.mime)}`,
  )
  form.append('model', call.model)
  if (input.language) form.append('language', input.language)
  if (input.prompt) form.append('prompt', input.prompt)
  const resp = await aiFetch(`${call.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${call.apiKey}` },
    body: form,
    signal: withTimeout(signal, ASR_TIMEOUT_MS),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${httpBodyDetail(await resp.text())}`)
  const json = (await resp.json()) as { text?: string; error?: { message?: string } }
  if (json.error) throw new Error(json.error.message || 'transcription failed')
  const text = json.text?.trim()
  if (!text) throw new Error('transcription returned an empty answer')
  return text
}

async function transcribeGemini(
  call: ResolvedModelCall,
  input: TranscriptionInput,
  signal?: AbortSignal,
): Promise<string> {
  const b64 = bytesToBase64(input.bytes)
  const resp = await aiFetch(
    `${call.baseUrl.replace(/\/$/, '')}/models/${call.model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': call.apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inline_data: { mime_type: input.mime, data: b64 } },
              {
                text:
                  input.prompt ??
                  'Transcribe this audio exactly as spoken. Output only the transcript text.',
              },
            ],
          },
        ],
      }),
      signal: withTimeout(signal, ASR_TIMEOUT_MS),
    },
  )
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${httpBodyDetail(await resp.text())}`)
  const json = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    error?: { message?: string }
  }
  if (json.error) throw new Error(json.error.message || 'transcription failed')
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim()
  if (!text) throw new Error('transcription returned an empty answer')
  return text
}

const FILE_ASR_MODEL = /paraformer|sensevoice|fun-asr/i
const FILE_ASR_TIMEOUT_MS = 600_000
const FILE_ASR_POLL_MS = 3_000

/**
 * Alibaba DashScope speech recognition — two model families:
 * - paraformer / sensevoice / fun-asr: async file-transcription task over a
 *   public http(s) URL (inline bytes cannot reach this API)
 * - qwen3-asr / qwen-audio: inline base64 audio through compatible-mode chat
 */
async function transcribeDashscope(
  call: ResolvedModelCall,
  input: TranscriptionInput,
  signal?: AbortSignal,
): Promise<string> {
  const root = dashscopeRoot(call.baseUrl)
  const auth = { Authorization: `Bearer ${call.apiKey}` }
  const model = call.model
  if (FILE_ASR_MODEL.test(model)) {
    if (!input.sourceUrl || !/^https?:\/\//i.test(input.sourceUrl)) {
      throw new Error(
        `${model} file transcription requires a public http(s) URL of the audio — pass a URL source, or configure an inline-capable ASR model (qwen3-asr)`,
      )
    }
    const submit = await aiFetch(`${root}/api/v1/services/audio/asr/transcription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable', ...auth },
      body: JSON.stringify({
        model,
        input: { file_urls: [input.sourceUrl] },
        ...(input.language ? { parameters: { language_hints: [input.language] } } : {}),
      }),
      signal: withTimeout(signal, FILE_ASR_TIMEOUT_MS),
    })
    if (!submit.ok) throw new Error(`HTTP ${submit.status}: ${httpBodyDetail(await submit.text())}`)
    const submitted = (await submit.json()) as { output?: { task_id?: string }; message?: string }
    const taskId = submitted.output?.task_id
    if (!taskId) throw new Error(submitted.message || 'transcription task was not created')
    const deadline = Date.now() + FILE_ASR_TIMEOUT_MS
    for (;;) {
      if (signal?.aborted) throw new Error('cancelled')
      if (Date.now() + FILE_ASR_POLL_MS > deadline) {
        throw new Error('transcription task timed out')
      }
      await new Promise((r) => setTimeout(r, FILE_ASR_POLL_MS))
      const poll = await aiFetch(`${root}/api/v1/tasks/${taskId}`, {
        headers: auth,
        signal: withTimeout(signal, ASR_TIMEOUT_MS),
      })
      if (!poll.ok) throw new Error(`HTTP ${poll.status}: ${httpBodyDetail(await poll.text())}`)
      const state = (await poll.json()) as {
        output?: {
          task_status?: string
          results?: Array<{ transcription_url?: string; subtask_status?: string }>
          message?: string
        }
      }
      const out = state.output ?? {}
      if (out.task_status === 'FAILED' || out.task_status === 'UNKNOWN') {
        throw new Error(out.message || `transcription task ${out.task_status}`)
      }
      if (out.task_status !== 'SUCCEEDED') continue
      const url = out.results?.[0]?.transcription_url
      if (!url) throw new Error('transcription task finished without a result URL')
      const detail = await aiFetch(url, { signal: withTimeout(signal, ASR_TIMEOUT_MS) })
      if (!detail.ok) throw new Error(`transcript download failed: HTTP ${detail.status}`)
      const json = (await detail.json()) as { transcripts?: Array<{ text?: string }> }
      const text = (json.transcripts ?? [])
        .map((t) => (t.text ?? '').trim())
        .filter((t) => t !== '')
        .join('\n')
        .trim()
      if (!text) throw new Error('transcription returned an empty answer')
      return text
    }
  }
  // qwen3-asr family (real-device verified): public audio URL via
  // compatible-mode chat — a system message must be present (empty context is
  // fine) and inline base64 is NOT supported by this model family.
  if (!input.sourceUrl || !/^https?:\/\//i.test(input.sourceUrl)) {
    throw new Error(
      `${model} requires a public http(s) URL of the audio — DashScope cannot fetch local files`,
    )
  }
  const resp = await aiFetch(`${dashscopeRoot(call.baseUrl)}/compatible-mode/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: [{ type: 'text', text: input.prompt ?? '' }] },
        { role: 'user', content: [{ type: 'audio', audio: input.sourceUrl }] },
      ],
    }),
    signal: withTimeout(signal, ASR_TIMEOUT_MS),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${httpBodyDetail(await resp.text())}`)
  const json = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    error?: { message?: string }
  }
  if (json.error) throw new Error(json.error.message || 'transcription failed')
  const text = json.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('transcription returned an empty answer')
  return text
}

export async function transcribeWithModel(
  call: ResolvedModelCall,
  input: TranscriptionInput,
  signal?: AbortSignal,
): Promise<string> {
  if (!input.bytes.byteLength) throw new Error('no audio to transcribe')
  if (isDashscopeCall(call)) return transcribeDashscope(call, input, signal)
  switch (call.protocol) {
    case 'gemini':
      return transcribeGemini(call, input, signal)
    case 'anthropic':
    case 'codex-app-server':
      throw new Error(
        `the ${call.protocol} protocol has no transcription API; configure an OpenAI-compatible or Gemini ASR model`,
      )
    default:
      return transcribeOpenAiCompatible(call, input, signal)
  }
}
