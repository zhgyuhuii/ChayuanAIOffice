/**
 * InsertImageDialog strings — zh source of truth, en fallback; other locales
 * fall back to en (same policy as ModelSettingsPage). Kept in-module so the
 * shared dialog needs no per-app i18n wiring.
 */
export type InsertImageLang = 'zh' | 'en'

const zh = {
  title: '插入图片',
  tabLocal: '本地文件',
  tabWeb: '网络图片',
  tabAI: 'AI 生成',
  close: '关闭',
  pickLocal: '选择本地图片',
  localHint: '支持 PNG / JPEG / GIF / WebP / BMP，20MB 以内',
  searchPlaceholder: '输入关键词搜索图片…',
  search: '搜索',
  sourceWeb: '网页',
  sourcePexels: 'Pexels',
  sourcePixabay: 'Pixabay',
  keysTitle: '图库 API Key',
  keysHint: 'Pexels / Pixabay 图库需要免费 API Key；',
  keysApply: '申请后粘贴到此处即可使用',
  pexelsKey: 'Pexels Key',
  pixabayKey: 'Pixabay Key',
  keyPlaceholder: '未配置（粘贴 Key）',
  keysSave: '保存',
  keysSaved: '已保存',
  keyApplyUrl: '去申请 Key ↗',
  emptyQuery: '输入关键词开始搜索',
  noResults: '没有找到图片，换个关键词试试',
  insert: '插入',
  aiPrompt: '描述你想要的图片…',
  aiGenerate: '生成图像',
  aiSize: '尺寸',
  aiCount: '数量',
  aiGenerating: '生成中…',
  aiEmptyHint: '未配置生图模型：请在模型设置中启用生图模型，或登录后使用默认生图',
  aiOpenModelSettings: '打开模型设置',
  aiErrorTitle: '生成失败',
  loadFail: '图片下载失败，请重试',
}

const en: typeof zh = {
  title: 'Insert Image',
  tabLocal: 'Local File',
  tabWeb: 'Web Images',
  tabAI: 'AI Generate',
  close: 'Close',
  pickLocal: 'Choose a local image',
  localHint: 'PNG / JPEG / GIF / WebP / BMP up to 20MB',
  searchPlaceholder: 'Search images by keyword…',
  search: 'Search',
  sourceWeb: 'Web',
  sourcePexels: 'Pexels',
  sourcePixabay: 'Pixabay',
  keysTitle: 'Stock API Keys',
  keysHint: 'Pexels / Pixabay need a free API key.',
  keysApply: 'Paste the key here once granted.',
  pexelsKey: 'Pexels Key',
  pixabayKey: 'Pixabay Key',
  keyPlaceholder: 'Not configured (paste key)',
  keysSave: 'Save',
  keysSaved: 'Saved',
  keyApplyUrl: 'Get a key ↗',
  emptyQuery: 'Type a keyword to start searching',
  noResults: 'No images found — try another keyword',
  insert: 'Insert',
  aiPrompt: 'Describe the image you want…',
  aiGenerate: 'Generate',
  aiSize: 'Size',
  aiCount: 'Count',
  aiGenerating: 'Generating…',
  aiEmptyHint:
    'No image model configured: enable one in Model Settings, or sign in to use the default.',
  aiOpenModelSettings: 'Open Model Settings',
  aiErrorTitle: 'Generation failed',
  loadFail: 'Image download failed, please retry',
}

export function insertImageStrings(lang?: string): typeof zh {
  const tag = (lang ?? (typeof document !== 'undefined' ? document.documentElement.lang : 'zh'))
    .toLowerCase()
    .startsWith('zh')
    ? 'zh'
    : 'en'
  return tag === 'zh' ? zh : en
}
