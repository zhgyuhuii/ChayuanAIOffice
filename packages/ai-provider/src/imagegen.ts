import { aiFetch } from './fetch'
import { httpBodyDetail } from './http-error'
import { chatofficeAttributionHeaders } from './providers'
import type { ResolvedModelCall } from './settings-v2'

/**
 * BYOK image generation: the drawing tool routes through the user's configured
 * image model instead of a cloud backend. Dispatch by protocol + vendor:
 * - gemini-native → generateContent with image output modality
 * - dashscope (aliyun-bailian) → native async text2image task with polling
 * - everything else OpenAI-shaped → POST {base}/images/generations
 * - anthropic-messages → no image API (surfaced as a clear error)
 */

export interface ImageGenRequest {
  prompt: string
  /** '1:1' | '16:9' | '9:16' | ... */
  aspectRatio?: string
  /** dynamic per-model parameters from the dialog's spec-rendered inputs
   * (size/n/quality/background/... — ids match media-params.ts field ids) */
  params?: Record<string, unknown>
  signal?: AbortSignal
}

/** one url per produced image; n>1-capable adapters return as many as asked */
export interface ImageGenResult {
  urls: string[]
}

/** string param probe: trims, ignores empty */
function strParam(params: Record<string, unknown> | undefined, id: string): string | undefined {
  const v = params?.[id]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/** numeric param probe: accepts real numbers and numeric strings */
function numParam(params: Record<string, unknown> | undefined, id: string): number | undefined {
  const v = params?.[id]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  return undefined
}

function aspectToSize(aspectRatio: string | undefined, sep: 'x' | '*'): string | undefined {
  switch ((aspectRatio ?? '').trim()) {
    case '1:1':
      return sep === 'x' ? '1024x1024' : '1024*1024'
    case '16:9':
    case '4:3':
    case '3:2':
      return sep === 'x' ? '1536x1024' : '1328*1328'
    case '9:16':
    case '3:4':
    case '2:3':
      return sep === 'x' ? '1024x1536' : '1328*1328'
    default:
      return undefined
  }
}

async function generateViaOpenAiImages(
  call: ResolvedModelCall,
  req: ImageGenRequest,
): Promise<ImageGenResult> {
  const size = strParam(req.params, 'size') ?? aspectToSize(req.aspectRatio, 'x')
  const n = numParam(req.params, 'n') ?? 1
  const quality = strParam(req.params, 'quality')
  const background = strParam(req.params, 'background')
  // Recraft's style select (digital_illustration/vector_illustration/…);
  // vector_illustration returns native SVG — the SVG line's dedicated channel.
  // Sent only when provided, so OpenAI's strict body validation never sees it.
  const style = strParam(req.params, 'style')
  const response = await aiFetch(`${call.baseUrl.replace(/\/$/, '')}/images/generations`, {
    method: 'POST',
    ...(req.signal ? { signal: req.signal } : {}),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${call.apiKey}`,
      ...chatofficeAttributionHeaders(call.baseUrl),
    },
    body: JSON.stringify({
      model: call.model,
      prompt: req.prompt,
      n,
      ...(size ? { size } : {}),
      ...(quality ? { quality } : {}),
      ...(background ? { background } : {}),
      ...(style ? { style } : {}),
    }),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${httpBodyDetail(await response.text())}`)
  }
  const json = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>
    error?: { message?: string }
  }
  if (json.error) throw new Error(json.error.message || 'image generation failed')
  const urls = (json.data ?? [])
    .map((item) => (item.b64_json ? `data:image/png;base64,${item.b64_json}` : (item.url ?? '')))
    .filter((u) => u !== '')
  if (!urls.length) throw new Error('the image API returned neither an image nor a URL')
  return { urls }
}

/** DashScope's image models are task-based: submit with X-DashScope-Async, poll to a result URL.
 * Two request shapes live behind the same task/poll flow: wanx models take
 * `input.prompt` on text2image/image-synthesis, while qwen-image is a
 * multimodal-generation model — it validates `input.messages` (role 'user',
 * content as a part list) and rejects the prompt form. */
async function generateViaDashscope(
  call: ResolvedModelCall,
  req: ImageGenRequest,
): Promise<ImageGenResult> {
  const root = 'https://dashscope.aliyuncs.com'
  const size = strParam(req.params, 'size') ?? aspectToSize(req.aspectRatio, '*') ?? '1024*1024'
  const n = numParam(req.params, 'n') ?? 1
  const isQwenImage = /qwen-image/i.test(call.model)
  // qwen-image / wanx watermark their output ("AI生成" mark, bottom-right) unless
  // explicitly disabled; flux on dashscope doesn't document the parameter, so it
  // only goes to the two families that do.
  const noWatermark = /qwen-image|wanx/i.test(call.model) ? { watermark: false } : {}
  const submit = await aiFetch(
    isQwenImage
      ? `${root}/api/v1/services/aigc/multimodal-generation/generation`
      : `${root}/api/v1/services/aigc/text2image/image-synthesis`,
    {
      method: 'POST',
      ...(req.signal ? { signal: req.signal } : {}),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${call.apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(
        isQwenImage
          ? {
              model: call.model,
              input: { messages: [{ role: 'user', content: [{ text: req.prompt }] }] },
              parameters: { n, size, ...noWatermark },
            }
          : {
              model: call.model,
              input: { prompt: req.prompt },
              parameters: { n, size, ...noWatermark },
            },
      ),
    },
  )
  if (!submit.ok) {
    throw new Error(`HTTP ${submit.status}: ${httpBodyDetail(await submit.text())}`)
  }
  const submitted = (await submit.json()) as { output?: { task_id?: string } }
  const taskId = submitted.output?.task_id
  if (!taskId) throw new Error('dashscope returned no task id')

  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (req.signal?.aborted) throw new Error('aborted')
    await new Promise((r) => setTimeout(r, 1500))
    const poll = await aiFetch(`${root}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${call.apiKey}` },
      ...(req.signal ? { signal: req.signal } : {}),
    })
    if (!poll.ok) {
      throw new Error(`HTTP ${poll.status}: ${httpBodyDetail(await poll.text())}`)
    }
    const status = (await poll.json()) as {
      output?: { task_status?: string; results?: Array<{ url?: string }>; message?: string }
    }
    const out = status.output ?? {}
    if (out.task_status === 'SUCCEEDED') {
      const urls = (out.results ?? []).map((r) => r.url ?? '').filter((u) => u !== '')
      if (urls.length) return { urls }
      throw new Error('dashscope task finished without a result image')
    }
    if (out.task_status === 'FAILED' || out.task_status === 'CANCELED') {
      throw new Error(out.message || `dashscope task ${out.task_status}`)
    }
  }
  throw new Error('dashscope image task timed out')
}

async function generateViaGemini(
  call: ResolvedModelCall,
  req: ImageGenRequest,
): Promise<ImageGenResult> {
  const response = await aiFetch(
    `${call.baseUrl.replace(/\/$/, '')}/models/${call.model}:generateContent`,
    {
      method: 'POST',
      ...(req.signal ? { signal: req.signal } : {}),
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': call.apiKey,
        ...chatofficeAttributionHeaders(call.baseUrl),
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    },
  )
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${httpBodyDetail(await response.text())}`)
  }
  const json = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { mimeType?: string; data?: string }
          inline_data?: { mime_type?: string; data?: string }
        }>
      }
    }>
    error?: { message?: string }
  }
  if (json.error) throw new Error(json.error.message || 'gemini image generation failed')
  for (const part of json.candidates?.[0]?.content?.parts ?? []) {
    const inline =
      (part as Record<string, { mimeType?: string; mime_type?: string; data?: string }>)
        .inlineData ??
      (part as Record<string, { mimeType?: string; mime_type?: string; data?: string }>).inline_data
    const mime = inline?.mimeType ?? inline?.mime_type ?? 'image/png'
    if (inline?.data) return { urls: [`data:${mime};base64,${inline.data}`] }
  }
  throw new Error('gemini returned no image part')
}

/** an image-capable model on a dashscope host runs through the native async API */
function isDashscopeNative(call: ResolvedModelCall): boolean {
  if (call.protocol !== 'openai-compatible' && call.protocol !== 'openai-responses') return false
  if (!/(qwen-image|wanx|wan2|flux)/i.test(call.model)) return false
  return /dashscope\.aliyuncs\.com/.test(call.baseUrl)
}

export async function generateImageWithModel(
  call: ResolvedModelCall,
  req: ImageGenRequest,
): Promise<ImageGenResult> {
  if (!req.prompt.trim()) throw new Error('prompt must not be empty')
  if (call.protocol === 'anthropic') {
    throw new Error(
      'the Anthropic Messages protocol has no image-generation API; configure a Gemini/OpenAI/DashScope image model instead',
    )
  }
  if (isDashscopeNative(call)) return generateViaDashscope(call, req)
  if (call.protocol === 'gemini') return generateViaGemini(call, req)
  return generateViaOpenAiImages(call, req)
}
