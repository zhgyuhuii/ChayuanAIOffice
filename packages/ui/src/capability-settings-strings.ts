/**
 * CapabilitySettingsPage strings — zh source of truth, en fallback; other
 * locales fall back to en (same policy as ModelSettingsPage).
 */
export type CapabilitySettingsLang = 'zh' | 'en'

const zh = {
  title: '生图、媒体与搜索',
  // left tree groups
  groupSearch: '网络搜索',
  groupImageGen: 'AI 生图',
  groupVideoGen: '视频生成',
  groupImageUnderstanding: '图片解析',
  groupVideoUnderstanding: '视频解析',
  groupSpeechSynthesis: '语音合成',
  groupSpeechRecognition: '语音识别',
  groupSvgGen: 'SVG 图像生成',
  stockTag: '图库',
  // group overview panes
  searchOverview:
    '网页搜索与图片素材平台。选择平台配置 API Key，并勾选一个作为默认网络搜索；插图对话框会按此列出可用平台。',
  modelOverview:
    '从模型供应商中列出支持该能力的厂商。点击厂商查看可用模型，勾选一个设为默认；未设置时自动使用第一个可用模型。对话与插图会自动关联这里的默认模型。',
  svgOverview: '选择用于绘制 SVG 插图的对话模型（矢量插画由对话模型直接绘制，不消耗生图额度）。',
  defaultLabel: '默认',
  defaultHint: '未设置时自动使用第一个可用模型',
  clearDefault: '恢复自动',
  defaultCleared: '已恢复自动匹配',
  // search platform pane
  keyLabel: 'API Key',
  keyLabelSearxng: '实例地址',
  keyConfigured: '已配置',
  getKey: '申请 Key ↗',
  getDocs: '说明文档 ↗',
  testKey: '测试',
  testing: '测试中…',
  testOk: '连接成功',
  testFail: '连接失败',
  setDefault: '设为默认',
  isDefault: '当前默认',
  keyFree: '免 Key 平台，无需配置',
  // model vendor pane
  vendorEnabled: '已启用',
  vendorNotEnabled: '未在模型设置中启用',
  vendorBaseUrl: 'API 地址',
  vendorKey: 'API Key',
  enableInModelSettings: '去模型设置启用',
  enableHint: '该厂商尚未启用：先在模型设置中配置密钥并启用，再回到这里挑选默认模型。',
  modelsTitle: '可用模型',
  noModels: '暂无该能力的模型：点击「刷新模型列表」从厂商获取。',
  refreshModels: '刷新模型列表',
  refreshing: '刷新中…',
  refreshOk: '已从厂商获取 {n} 个新模型',
  refreshNone: '没有发现新的可用模型',
  refreshFailed: '刷新失败：{message}',
  refreshUnsupported: '该厂商的模型列表由服务端固定提供，无需刷新。',
  autoDefault: '当前默认（自动）：{name}',
  saved: '已保存',
  save: '保存',
  saveFailed: '保存失败：{message}',
  // AI-gen capability descriptions
  capImageGenDesc: '对话与插图中的 AI 生图默认模型。',
  capVideoGenDesc: 'AI 生成视频的默认模型（插图对话框 AI 生视频）。',
  capSpeechSynthesisDesc: '文本转语音的默认模型（TTS：cosyvoice / qwen-tts / sambert 等）。',
  capSpeechRecognitionDesc: '音频转文字的默认模型（ASR：paraformer / sensevoice / qwen3-asr 等）。',
  capImageUnderstandingDesc: '识别与理解图片内容的默认模型（图片解析）。',
  capVideoUnderstandingDesc: '解析视频内容的默认模型（视频理解）。',
  capSvgGenDesc: '绘制 SVG 矢量插图的对话模型。',
}

const en: typeof zh = {
  title: 'AI Media & Search',
  groupSearch: 'Web search',
  groupImageGen: 'AI image gen',
  groupVideoGen: 'Video generation',
  groupImageUnderstanding: 'Image understanding',
  groupVideoUnderstanding: 'Video understanding',
  groupSpeechSynthesis: 'Speech synthesis',
  groupSpeechRecognition: 'Speech recognition',
  groupSvgGen: 'SVG generation',
  stockTag: 'Stock',
  searchOverview:
    'Web-search and stock-photo platforms. Configure API keys and check one platform as the default web search; the insert-media dialog lists the platforms configured here.',
  modelOverview:
    'Model vendors that serve this capability. Open a vendor to see its models and check one as the default; with no pick, the first available model is used automatically. Chats and insert dialogs follow the defaults set here.',
  svgOverview:
    'Pick the chat model that draws SVG illustrations (vector art is written by a chat model — no image-gen quota).',
  defaultLabel: 'Default',
  defaultHint: 'With no pick, the first available model is used automatically',
  clearDefault: 'Use auto',
  defaultCleared: 'Back to automatic matching',
  keyLabel: 'API Key',
  keyLabelSearxng: 'Instance URL',
  keyConfigured: 'Configured',
  getKey: 'Get a key ↗',
  getDocs: 'Docs ↗',
  testKey: 'Test',
  testing: 'Testing…',
  testOk: 'Connected',
  testFail: 'Connection failed',
  setDefault: 'Set default',
  isDefault: 'Current default',
  keyFree: 'Keyless platform — nothing to configure',
  vendorEnabled: 'Enabled',
  vendorNotEnabled: 'Not enabled in model settings',
  vendorBaseUrl: 'API base URL',
  vendorKey: 'API Key',
  enableInModelSettings: 'Open model settings',
  enableHint:
    'This vendor is not enabled yet: configure its key in model settings first, then come back to pick the default model.',
  modelsTitle: 'Available models',
  noModels: 'No models for this capability yet: use "Refresh" to fetch the vendor list.',
  refreshModels: 'Refresh model list',
  refreshing: 'Refreshing…',
  refreshOk: 'Fetched {n} new models from the vendor',
  refreshNone: 'No new available models found',
  refreshFailed: 'Refresh failed: {message}',
  refreshUnsupported: "This vendor's model list is fixed server-side; no refresh needed.",
  autoDefault: 'Current default (auto): {name}',
  saved: 'Saved',
  save: 'Save',
  saveFailed: 'Save failed: {message}',
  capImageGenDesc: 'Default model for AI image generation in chats and dialogs.',
  capVideoGenDesc: 'Default model for AI video generation (insert-media dialog).',
  capSpeechSynthesisDesc:
    'Default text-to-speech model (TTS: cosyvoice / qwen-tts / sambert etc.).',
  capSpeechRecognitionDesc:
    'Default audio-to-text model (ASR: paraformer / sensevoice / qwen3-asr etc).',
  capImageUnderstandingDesc: 'Default model that reads and understands images.',
  capVideoUnderstandingDesc: 'Default model that parses video content.',
  capSvgGenDesc: 'Chat model that draws SVG illustrations.',
}

export type CapabilitySettingsStrings = typeof zh

export function capabilitySettingsStrings(lang: string | undefined): CapabilitySettingsStrings {
  return lang && lang.toLowerCase().startsWith('zh') ? zh : en
}

/** {placeholder} interpolation for the strings above */
export function fmtCapability(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in params ? String(params[key]) : `{${key}}`,
  )
}
