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
 * Video param spec (videoGeneration models). All current adapters accept a
 * duration and an aspect ratio; vendor quirks refine this as adapters land.
 */
export function videoParamSpec(vendorId: string, _modelId: string): MediaParamSpec {
  const duration: MediaParamField = {
    id: 'durationSeconds',
    label: 'Duration (s)',
    labelZh: '时长（秒）',
    type: 'number',
    min: 5,
    max: 10,
    step: 1,
    default: 5,
  }
  if (vendorId === 'kling' || vendorId === 'luma') {
    return {
      fields: [
        {
          id: 'aspectRatio',
          label: 'Aspect Ratio',
          labelZh: '宽高比',
          type: 'select',
          options: ['16:9', '9:16', '1:1'],
          default: '16:9',
        },
        duration,
      ],
    }
  }
  return {
    fields: [
      {
        id: 'aspectRatio',
        label: 'Aspect Ratio',
        labelZh: '宽高比',
        type: 'select',
        options: ['16:9', '9:16'],
        default: '16:9',
      },
      duration,
    ],
  }
}

export { NO_FIELDS as emptyParamSpec }
