/**
 * Media param specs — the single declarative source for the dynamic parameter
 * inputs of the insert-media dialog's AI tab. Same philosophy as
 * capabilities.ts: declarative + regex, no network probing. Adapters consume
 * the same ids from `MediaJobRequest`/`ImageGenRequest.params`, so a field
 * declared here is exactly the field an adapter reads; the renderer stays
 * vendor-agnostic (specs travel inside the model list IPC).
 *
 * Labels follow the vendor-catalog `label`/`labelZh` bilingual pattern; the
 * dialog picks by lang.
 */

export interface MediaParamField {
  id: string
  label: string
  labelZh?: string
  type: 'select' | 'text' | 'number'
  /** select choices (values, displayed as-is) */
  options?: Array<string | number>
  min?: number
  max?: number
  step?: number
  default: string | number
  required?: boolean
}

export interface MediaParamSpec {
  fields: MediaParamField[]
}

const NO_FIELDS: MediaParamSpec = { fields: [] }

const N_FIELD: MediaParamField = {
  id: 'n',
  label: 'Count',
  labelZh: '数量',
  type: 'select',
  options: [1, 2, 4],
  default: 1,
}

const SIZE_FIELD = (options: string[], def: string, zh = '尺寸'): MediaParamField => ({
  id: 'size',
  label: 'Size',
  labelZh: zh,
  type: 'select',
  options,
  default: def,
})

/** specs keyed by vendorId; first matching modelId regex wins */
const SPEC_RULES: Array<{
  vendorId: string
  test: RegExp
  fields: MediaParamField[]
}> = [
  // ── OpenAI ─────────────────────────────────────────────────────────
  {
    vendorId: 'openai',
    test: /^gpt-image/i,
    fields: [
      SIZE_FIELD(['1024x1024', '1536x1024', '1024x1536'], '1024x1024'),
      { id: 'quality', label: 'Quality', labelZh: '画质', type: 'select', options: ['auto', 'low', 'medium', 'high'], default: 'auto' },
      { id: 'background', label: 'Background', labelZh: '背景', type: 'select', options: ['auto', 'transparent', 'opaque'], default: 'auto' },
      N_FIELD,
    ],
  },
  {
    vendorId: 'openai',
    test: /^dall-e-3/i,
    fields: [
      SIZE_FIELD(['1024x1024', '1792x1024', '1024x1792'], '1024x1024'),
      { id: 'quality', label: 'Quality', labelZh: '画质', type: 'select', options: ['standard', 'hd'], default: 'standard' },
    ],
  },
  {
    vendorId: 'openai',
    test: /^dall-e-2/i,
    fields: [SIZE_FIELD(['256x256', '512x512', '1024x1024'], '1024x1024'), N_FIELD],
  },
  // ── DashScope (aliyun-bailian) ─────────────────────────────────────
  {
    vendorId: 'aliyun-bailian',
    test: /qwen-image/i,
    fields: [
      SIZE_FIELD(['1664*928', '928*1664', '1024*1024', '1328*1328'], '1024*1024'),
      N_FIELD,
    ],
  },
  {
    vendorId: 'aliyun-bailian',
    test: /wanx|wan2|flux/i,
    fields: [
      { id: 'size', label: 'Size', labelZh: '尺寸', type: 'text', default: '1024*1024', required: true },
      N_FIELD,
    ],
  },
  // ── Gemini ─────────────────────────────────────────────────────────
  {
    vendorId: 'gemini',
    test: /imagen/i,
    fields: [
      {
        id: 'aspectRatio',
        label: 'Aspect Ratio',
        labelZh: '宽高比',
        type: 'select',
        options: ['1:1', '3:4', '4:3', '9:16', '16:9'],
        default: '1:1',
      },
    ],
  },
  // gemini generateContent image models (nano-banana style) take no extra params
  { vendorId: 'gemini', test: /image/i, fields: [] },
  // ── Recraft (the only native SVG generator; style vector_illustration → svg) ──
  {
    vendorId: 'recraft',
    test: /recraft/i,
    fields: [
      SIZE_FIELD(['1024x1024', '1536x1024', '1024x1536'], '1024x1024'),
      {
        id: 'style',
        label: 'Style',
        labelZh: '风格',
        type: 'select',
        options: ['realistic_image', 'digital_illustration', 'vector_illustration'],
        default: 'digital_illustration',
      },
      N_FIELD,
    ],
  },
  // ── chatoffice proxy (OpenAI-shaped, normalized) ───────────────────
  { vendorId: 'chatoffice', test: /./, fields: [N_FIELD] },
]

/** param spec for an image-generation model; unknown models get just the count */
export function imageParamSpec(vendorId: string, modelId: string): MediaParamSpec {
  for (const rule of SPEC_RULES) {
    if (rule.vendorId === vendorId && rule.test.test(modelId)) return { fields: rule.fields }
  }
  return { fields: [N_FIELD] }
}

/**
 * Video param specs (videoGeneration models). Rules are keyed by vendorId with
 * a modelId regex; ids here are exactly what the media-jobs adapters read from
 * `MediaJobRequest.params` (or the mapped aspectRatio/durationSeconds). First
 * matching rule wins; unknown vendors get the generic shape.
 */

/** shared field builders — labels follow the vendor-catalog bilingual pattern */
const vAspectRatio = (options: string[], def = '16:9'): MediaParamField => ({
  id: 'aspectRatio',
  label: 'Aspect Ratio',
  labelZh: '宽高比',
  type: 'select',
  options,
  default: def,
})
const vDuration = (
  options?: number[],
  def = 5,
  minMax?: { min: number; max: number },
): MediaParamField =>
  options
    ? { id: 'durationSeconds', label: 'Duration (s)', labelZh: '时长（秒）', type: 'select', options, default: def }
    : {
        id: 'durationSeconds',
        label: 'Duration (s)',
        labelZh: '时长（秒）',
        type: 'number',
        default: def,
        ...(minMax ?? { min: 5, max: 10, step: 1 }),
      }
const vSelect = (id: string, label: string, labelZh: string, options: string[], def: string): MediaParamField => ({
  id,
  label,
  labelZh,
  type: 'select',
  options,
  default: def,
})
const vText = (id: string, label: string, labelZh: string): MediaParamField => ({
  id,
  label,
  labelZh,
  type: 'text',
  default: '',
})

const VIDEO_SPEC_RULES: Array<{
  vendorId: string
  test: RegExp
  fields: MediaParamField[]
}> = [
  {
    vendorId: 'runway',
    test: /^gen/,
    fields: [
      vAspectRatio(['16:9', '9:16', '1:1', '4:3', '3:4']),
      vDuration([5, 10], 5),
    ],
  },
  {
    vendorId: 'vidu',
    test: /^vidu/,
    fields: [
      vAspectRatio(['16:9', '9:16']),
      vDuration([4, 8], 4),
      vSelect('resolution', 'Resolution', '分辨率', ['540p', '720p', '1080p'], '720p'),
    ],
  },
  {
    vendorId: 'pixverse',
    test: /^v[\d.]+$|^c1$/,
    fields: [
      vAspectRatio(['16:9', '4:3', '1:1', '3:4', '9:16']),
      vDuration([5, 8], 5),
      vSelect('quality', 'Quality', '画质', ['360p', '540p', '720p', '1080p'], '540p'),
    ],
  },
  {
    vendorId: 'gemini',
    test: /^veo-3\.1/,
    fields: [
      vAspectRatio(['16:9', '9:16']),
      vDuration([4, 6, 8], 8),
      vText('negativePrompt', 'Negative Prompt', '反向提示词'),
    ],
  },
  {
    vendorId: 'gemini',
    test: /^veo/,
    // veo-3.0 pins 8s — no duration field, or the API rejects the call
    fields: [vAspectRatio(['16:9', '9:16']), vText('negativePrompt', 'Negative Prompt', '反向提示词')],
  },
  {
    vendorId: 'openai',
    test: /^sora/,
    fields: [vAspectRatio(['16:9', '9:16']), vDuration([4, 8, 12], 4)],
  },
  {
    vendorId: 'kling',
    test: /^kling/,
    fields: [
      vAspectRatio(['16:9', '9:16', '1:1']),
      vDuration([5, 10], 5),
      vSelect('mode', 'Mode', '生成模式', ['std', 'pro'], 'std'),
    ],
  },
  {
    vendorId: 'luma',
    test: /^ray/,
    fields: [
      vAspectRatio(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21']),
      vDuration([5, 9], 5),
      vSelect('resolution', 'Resolution', '分辨率', ['720p', '1080p', '4k'], '720p'),
    ],
  },
  {
    vendorId: 'volcengine',
    test: /seedance|doubao-seed/i,
    fields: [
      vAspectRatio(['16:9', '9:16', '1:1', '4:3', '3:4']),
      vDuration([5, 10], 5),
      vSelect('resolution', 'Resolution', '分辨率', ['480p', '720p', '1080p'], '720p'),
    ],
  },
  {
    vendorId: 'zhipu',
    test: /cogvideox/,
    fields: [vAspectRatio(['16:9', '9:16']), vDuration([5, 10], 5)],
  },
  {
    vendorId: 'minimax',
    test: /video-01|hailuo/i,
    // minimax T2V pins 1280x720 — aspect ratio is not a parameter here
    fields: [vDuration(undefined, 6)],
  },
  // aliyun-bailian (wan t2v) + chatoffice + unknown vendors: the generic shape
]

/**
 * Video param spec for a videoGeneration model. Generic fallback: aspect
 * ratio (16:9/9:16) + duration 5-10s.
 */
export function videoParamSpec(vendorId: string, modelId: string): MediaParamSpec {
  for (const rule of VIDEO_SPEC_RULES) {
    if (rule.vendorId === vendorId && rule.test.test(modelId)) return { fields: rule.fields }
  }
  return { fields: [vAspectRatio(['16:9', '9:16']), vDuration(undefined, 5)] }
}

export { NO_FIELDS as emptyParamSpec }
