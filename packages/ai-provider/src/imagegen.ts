import { aiFetch } from './fetch'
import { httpBodyDetail } from './http-error'
import { gensparkAttributionHeaders } from './providers'
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
  signal?: AbortSignal
}

/** url is an https link or a data: URL — the renderer download path handles both */
export interface ImageGenResult {
  url: string
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
  const size = aspectToSize(req.aspectRatio, 'x')
  const response = await aiFetch(`${call.baseUrl.replace(/\/$/, '')}/images/generations`, {
    method: 'POST',
    ...(req.signal ? { signal: req.signal } : {}),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${call.apiKey}`,
      ...gensparkAttributionHeaders(call.baseUrl),
    },
    body: JSON.stringify({
      model: call.model,
      prompt: req.prompt,
      n: 1,
      ...(size ? { size } : {}),
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
  const item = json.data?.[0]
  if (item?.b64_json) return { url: `data:image/png;base64,${item.b64_json}` }
  if (item?.url) return { url: item.url }
  throw new Error('the image API returned neither an image nor a URL')
}

/** DashScope's image models are task-based: submit with X-DashScope-Async, poll to a result URL */
async function generateViaDashscope(
  call: ResolvedModelCall,
  req: ImageGenRequest,
): Promise<ImageGenResult> {
  const root = 'https://dashscope.aliyuncs.com'
  const size = aspectToSize(req.aspectRatio, '*') ?? '1024*1024'
  const submit = await aiFetch(`${root}/api/v1/services/aigc/text2image/image-synthesis`, {
    method: 'POST',
    ...(req.signal ? { signal: req.signal } : {}),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${call.apiKey}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: call.model,
      input: { prompt: req.prompt },
      parameters: { n: 1, size },
    }),
  })
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
      const url = out.results?.[0]?.url
      if (url) return { url }
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
        ...gensparkAttributionHeaders(call.baseUrl),
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
    const inline = (part as Record<string, { mimeType?: string; mime_type?: string; data?: string }>)
      .inlineData ?? (part as Record<string, { mimeType?: string; mime_type?: string; data?: string }>).inline_data
    const mime = inline?.mimeType ?? inline?.mime_type ?? 'image/png'
    if (inline?.data) return { url: `data:${mime};base64,${inline.data}` }
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
    throw new Error('the Anthropic Messages protocol has no image-generation API; configure a Gemini/OpenAI/DashScope image model instead')
  }
  if (isDashscopeNative(call)) return generateViaDashscope(call, req)
  if (call.protocol === 'gemini') return generateViaGemini(call, req)
  return generateViaOpenAiImages(call, req)
}
