/**
 * Model settings page strings — zh is the source of truth, en the fallback;
 * other locales fall back to en (per the v2 rollout plan). Kept in-module so
 * the shared page needs no per-app i18n wiring.
 */
export type ModelSettingsLang = 'zh' | 'en'

const zh = {
  title: '模型设置',
  subtitle: '多家供应商同时启用，勾选模型后在面板顶部快速切换',
  close: '关闭',
  searchPlaceholder: '搜索供应商…',
  filterHint: '可按「免费」筛选厂商',
  enabledGroup: '已启用',
  noModelsGuide:
    '尚未启用任何模型：在左侧选择厂商，填写 API 密钥并开启；或登录 察元AIOffice 直接使用内置模型。',
  noModelsGuideNoLogin: '尚未启用任何模型：在左侧选择厂商，填写 API 密钥并开启。',
  // 说明页（初次进入的落地）
  guideCnTitle: '国内常用模型',
  guideGlobalTitle: '国外常用模型',
  guideCardHint: '点击配置',
  guideMore:
    '更多服务见左侧完整目录：本地与自建（Ollama / LM Studio 等）、API 聚合（OpenRouter 等）；左下角「自定义供应商」可接入任意 OpenAI 兼容接口。',
  tagNeedsKey: '需 Key',
  tagNoKey: '无需 Key',
  tagFree: '免费',
  tagFreeTier: '免费额度',
  imageModel: '生图模型',
  imageModelAuto: '自动（第一个已启用的生图模型）',
  imageModelNone: '未启用生图模型',
  currentModel: '当前模型',
  // form
  apiUrl: 'API 地址',
  displayNameLabel: '显示名',
  displayNamePlaceholder: '给这个自定义厂商起个名字（保存后各能力分组同步显示）',
  apiUrlPlaceholder: 'https://api.example.com/v1',
  protocol: '协议',
  protocolHint: {
    'anthropic-messages':
      'Anthropic Messages（直连，不转换格式）—— 供应商原生为 Anthropic Messages API 时选择',
    'openai-completions':
      'Chat（OpenAI Chat Completions）—— 供应商使用 Chat Completions 协议时选择',
    'openai-responses': 'Responses（OpenAI Responses API）—— 供应商使用 Responses API 时选择',
    'gemini-native':
      'Gemini Native（generateContent）—— 供应商使用 Gemini generateContent 协议时选择',
  } as Record<string, string>,
  protocolFooter: '四种协议均为原生直连，无需格式转换。',
  apiKey: 'API 密钥',
  apiKeyPlaceholder: '粘贴密钥',
  apiKeyConfigured: '已配置（留空保持不变）',
  getKey: '获取密钥',
  showKey: '显示密钥',
  hideKey: '隐藏密钥',
  ollamaHint: '本地服务可不填密钥',
  models: '模型清单',
  fetchModels: '获取模型列表',
  refetchModels: '重新获取',
  fetching: '获取中…',
  testConnection: '测试连接',
  testing: '测试中…',
  connectionOk: '连接成功',
  saveEnable: '保存并启用',
  saving: '保存中…',
  disable: '停用',
  disabled: '已停用',
  enabledOk: '已启用',
  // validation
  errApiUrl: '请填写 API 地址',
  errApiKey: '请填写 API 密钥',
  errPickModel: '至少勾选一个模型',
  errNoModelsParsed: '未解析到任何模型',
  modelsFound: '获取到 {n} 个模型',
  fetchFailed: '获取失败：{message}',
  testFailed: '测试失败：{message}',
  enableFailed: '启用失败：{message}',
  saveFailed: '保存失败：{message}',
  // model types
  type: {
    chat: '对话',
    vision: '视觉',
    embedding: '向量',
    'image-generation': '生图',
    'video-generation': '视频生成',
    tts: '语音合成',
    asr: '语音识别',
    'audio-understanding': '音频理解',
    'video-understanding': '视频理解',
  } as Record<string, string>,
  // chatoffice special card
  chatofficeLoginTitle: '察元AIOffice 登录',
  chatofficeLoginDesc:
    '登录后可使用默认模型与云端工具（网页/图片搜索、兜底生图）。不登录也能使用自己配置的任何模型。',
  chatofficeLoggedIn: '已登录：{email}',
  chatofficeLoggedInNoEmail: '已登录',
  chatofficeLoggedOut: '未登录',
  chatofficeLoginBtn: '登录',
  chatofficePresetModels: '可用模型',
  // misc
  freeNokey: '免密钥',
  freeFreekey: '免费密钥',
  freeTier: '免费额度',
  enabledBadge: '已启用',
  useAsCurrent: '设为当前',
  presetModelsHint: '该供应商暂不支持自动获取模型列表，以下为预设清单',
  pickerSettings: '模型设置',
  pickerEmptyTitle: '还没有可用的模型',
  pickerEmptyBody: '配置一个自己的供应商（密钥即用），或登录 察元AIOffice 使用内置模型。',
  pickerRunning: '运行中',
  statusEnabled: '已启用，模型出现在选择器中',
  statusNotEnabled: '未启用',
  selectAll: '全选',
  selectNone: '全不选',
  addVendor: '自定义供应商',
  saveChanges: '保存更改',
  saveValidateFailed: '协议验证失败，未保存：{message}',
  toggleVendorModels: '展开/折叠该厂商的模型',
  filterAll: '全部',
  filterEmptyHint: '该分类暂无已启用模型，去模型设置里启用',
  defaultsNote: '为每类用途指定默认模型；不设置时自动使用识别到的第一个可用模型。',
  defaultsAuto: '自动（使用识别到的第一个可用模型）',
  defaultsAutoUsing: '当前自动使用：',
  maxTokensLabel: '单次输出上限（tokens）',
  maxTokensDesc:
    '一次回合的输出预算。推理模型会先消耗预算用于思考，预算用完时回复可能变成空白，遇到这种情况请调大此项。',
  defaultsNoneAvailable: '暂无可用模型（先在模型设置中启用）',
  defaultsKind: {
    chat: '对话默认模型',
    generation: '页面生成默认模型（写每页版式 spec，建议配最强模型）',
    qc: '质检默认模型（视觉审稿，需支持图片）',
    image: '生图默认模型',
    videoGeneration: '视频生成默认模型',
    tts: '语音合成默认模型',
    asr: '语音识别默认模型',
  } as Record<string, string>,
  defaultsImageSourceLabel: '图片来源默认',
  defaultsImageSourceNote:
    'PPT/文档/表格配图的来源；生成时可临时覆盖，覆盖后即成为新的默认（上次使用优先）。',
  imageSourceOpts: {
    auto: '自动（有生图模型→模型生成，否则网络搜索，再否则矢量图形）',
    web: '网络图片搜索',
    model: 'AI 生图模型',
    local: '本地图片文件夹',
    svg: '矢量图形（SVG，免费且元素可编辑）',
  } as Record<string, string>,
  pickerHint:
    '勾选的模型会出现在 AI 面板的模型选择器中；对话模型可直接切换，生图模型用于绘画工具。',
  // 本地与自建：一键安装
  localDetecting: '正在检测本地安装…',
  localRunning: '本地服务运行中',
  localInstalledNoServer: '已安装，服务未运行',
  localNotInstalled: '未检测到本地安装',
  localInstallBtn: '一键安装',
  localInstalling: '正在下载安装，可能需要几分钟…',
  localStartBtn: '启动服务',
  localStarting: '启动中…',
  localStartOk: '服务已启动',
  localRedetect: '重新检测',
  localInstallHint: '从官方源下载安装，耗时视网络而定。',
  localInstallDone: '安装完成',
  localInstallFailed: '操作失败：{message}',
}

const en = {
  title: 'Model Settings',
  subtitle:
    'Enable multiple providers at once; pick models and switch instantly from the panel header',
  close: 'Close',
  searchPlaceholder: 'Search providers…',
  filterHint: 'Tip: filter vendors by free plans',
  enabledGroup: 'Enabled',
  noModelsGuide:
    'No models enabled yet: pick a vendor on the left, add your API key and enable it — or sign in to ChaAI Office to use its built-in models.',
  noModelsGuideNoLogin:
    'No models enabled yet: pick a vendor on the left, add your API key and enable it.',
  // guide landing (first entry)
  guideCnTitle: 'Popular in China',
  guideGlobalTitle: 'Popular worldwide',
  guideCardHint: 'Click to configure',
  guideMore:
    'The full catalog on the left has more — local & self-hosted (Ollama, LM Studio…), API aggregators (OpenRouter…); "Custom provider" at the bottom left connects any OpenAI-compatible endpoint.',
  tagNeedsKey: 'Key needed',
  tagNoKey: 'No key',
  tagFree: 'Free',
  tagFreeTier: 'Free tier',
  imageModel: 'Image model',
  imageModelAuto: 'Auto (first enabled image model)',
  imageModelNone: 'No image model enabled',
  currentModel: 'Current model',
  apiUrl: 'API URL',
  displayNameLabel: 'Display name',
  displayNamePlaceholder: 'Name this custom vendor (all capability groups pick it up on save)',
  apiUrlPlaceholder: 'https://api.example.com/v1',
  protocol: 'Protocol',
  protocolHint: {
    'anthropic-messages':
      'Anthropic Messages (direct, no format conversion) — pick when the provider is natively an Anthropic Messages API',
    'openai-completions':
      'Chat (OpenAI Chat Completions) — pick when the provider speaks the Chat Completions protocol',
    'openai-responses':
      'Responses (OpenAI Responses API) — pick when the provider speaks the Responses API',
    'gemini-native':
      'Gemini Native (generateContent) — pick when the provider speaks the Gemini generateContent protocol',
  } as Record<string, string>,
  protocolFooter: 'All four protocols connect natively — no conversion needed.',
  apiKey: 'API key',
  apiKeyPlaceholder: 'Paste key',
  apiKeyConfigured: 'Configured (leave empty to keep)',
  getKey: 'Get key',
  showKey: 'Show key',
  hideKey: 'Hide key',
  ollamaHint: 'Local services can skip the key',
  models: 'Models',
  fetchModels: 'Fetch model list',
  refetchModels: 'Refetch',
  fetching: 'Fetching…',
  testConnection: 'Test connection',
  testing: 'Testing…',
  connectionOk: 'Connection OK',
  saveEnable: 'Save & enable',
  saving: 'Saving…',
  disable: 'Disable',
  disabled: 'Disabled',
  enabledOk: 'Enabled',
  errApiUrl: 'Enter an API URL',
  errApiKey: 'Enter an API key',
  errPickModel: 'Pick at least one model',
  errNoModelsParsed: 'No models parsed',
  modelsFound: '{n} models found',
  fetchFailed: 'Fetch failed: {message}',
  testFailed: 'Test failed: {message}',
  enableFailed: 'Enable failed: {message}',
  saveFailed: 'Save failed: {message}',
  type: {
    chat: 'Chat',
    vision: 'Vision',
    embedding: 'Embedding',
    'image-generation': 'Image gen',
    'video-generation': 'Video gen',
    tts: 'TTS',
    asr: 'ASR',
    'audio-understanding': 'Audio',
    'video-understanding': 'Video',
  } as Record<string, string>,
  chatofficeLoginTitle: 'ChaAI Office sign-in',
  chatofficeLoginDesc:
    'Sign in for the default models and cloud tools (web/image search, fallback image gen). Everything you configure yourself works without signing in.',
  chatofficeLoggedIn: 'Signed in: {email}',
  chatofficeLoggedInNoEmail: 'Signed in',
  chatofficeLoggedOut: 'Not signed in',
  chatofficeLoginBtn: 'Sign in',
  chatofficePresetModels: 'Available models',
  freeNokey: 'Keyless',
  freeFreekey: 'Free key',
  freeTier: 'Free tier',
  enabledBadge: 'Enabled',
  useAsCurrent: 'Set current',
  presetModelsHint: 'This provider has no model-list API; presets below',
  pickerSettings: 'Model settings',
  pickerEmptyTitle: 'No model available yet',
  pickerEmptyBody:
    'Configure your own provider (your key, ready to use), or sign in to ChaAI Office for its built-in models.',
  pickerRunning: 'running',
  statusEnabled: 'Enabled — models appear in the picker',
  statusNotEnabled: 'Not enabled',
  selectAll: 'Select all',
  selectNone: 'Select none',
  addVendor: 'Custom provider',
  saveChanges: 'Save changes',
  saveValidateFailed: 'Protocol check failed, nothing saved: {message}',
  toggleVendorModels: "Expand/collapse this vendor's models",
  filterAll: 'All',
  filterEmptyHint: 'No enabled models of this kind yet — enable them in Model Settings',
  defaultsNote:
    'Pick a default model per purpose; unset kinds automatically use the first available model detected.',
  defaultsAuto: 'Auto (first available model detected)',
  defaultsAutoUsing: 'Currently auto-using:',
  maxTokensLabel: 'Max output tokens',
  maxTokensDesc:
    'Output budget for one turn. Reasoning models spend part of it thinking, so an answer can come back empty once the budget runs out; raise this value if that happens.',
  defaultsNoneAvailable: 'No models available yet (enable them in Model Settings first)',
  defaultsKind: {
    generation:
      'Page-generation default model (writes per-page layout specs; use your strongest model)',
    qc: 'QC default model (visual review; must accept images)',
    chat: 'Default chat model',
    image: 'Default image model',
    videoGeneration: 'Default video model',
    tts: 'Default TTS model',
    asr: 'Default ASR model',
  } as Record<string, string>,
  defaultsImageSourceLabel: 'Default imagery source',
  defaultsImageSourceNote:
    'Where deck/document imagery comes from; the per-run picker overrides this and becomes the new default (last use wins).',
  imageSourceOpts: {
    auto: 'Auto (image model → web search → vector graphics)',
    web: 'Web image search',
    model: 'AI image model',
    local: 'Local image folder',
    svg: 'Vector graphics (SVG, free & editable elements)',
  } as Record<string, string>,
  pickerHint:
    "Checked models appear in the AI panel's model picker; chat models switch instantly, image models drive the drawing tool.",
  // local self-hosted: one-click install
  localDetecting: 'Checking the local install…',
  localRunning: 'Local server is running',
  localInstalledNoServer: 'Installed — server not running',
  localNotInstalled: 'Not installed on this machine',
  localInstallBtn: 'Install',
  localInstalling: 'Downloading & installing — this can take a few minutes…',
  localStartBtn: 'Start server',
  localStarting: 'Starting…',
  localStartOk: 'Server started',
  localRedetect: 'Re-check',
  localInstallHint: 'Downloads from the official source; duration depends on your network.',
  localInstallDone: 'Install complete',
  localInstallFailed: 'Operation failed: {message}',
}

export type ModelSettingsStrings = typeof zh & typeof en

const dicts: Record<ModelSettingsLang, ModelSettingsStrings> = { zh, en }

/** normalize any BCP-47 tag (zh-CN, en-US, zh-TW…) onto the dict pair; any zh* → zh */
export function normalizeSettingsLang(lang: string | undefined): ModelSettingsLang {
  const base = (lang ?? '').trim().toLowerCase().split('-')[0]
  return base === 'zh' ? 'zh' : 'en'
}

export function modelSettingsStrings(lang: string | undefined): ModelSettingsStrings {
  return dicts[normalizeSettingsLang(lang)]
}

/** simple {placeholder} interpolation */
export function fmt(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`))
}
