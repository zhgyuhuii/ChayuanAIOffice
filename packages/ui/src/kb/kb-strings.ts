/**
 * Knowledge-base picker strings — zh is the source of truth, en the fallback
 * (same policy as model-settings-strings.ts). Kept in-module so the shared
 * component needs no per-app i18n wiring.
 */
export type KbLang = 'zh' | 'en'

const zh = {
  kbPickerLabel: '知识库',
  kbPickerHint: '选中后，发送消息会先检索知识库，回答以 [n] 标注引用',
  kbPickerEmpty: '暂无知识库',
  kbPickerUnavailable: '未检测到知识库服务',
  kbPickerRetry: '重试',
  kbRefresh: '刷新',
  kbSource: '来源：{origin}',
  kbSourceManual: '手动',
  kbDocsCount: '{n} 篇文档',
  kbDocsFailed: '{n} 篇解析失败',
  kbEmbedWarning: '嵌入模型不可用，请先在察元桌面配置嵌入或在知识库中重建索引',
  kbRemove: '移除知识库',
  kbCiteTitle: '引用 {n}',
  kbPreviewClose: '关闭',
  kbPreviewSource: '来自文档：{name}',
  kbPreviewDownload: '下载原文',
  kbPreviewDownloading: '下载中…',
  kbPreviewDownloaded: '已下载',
  kbPreviewDownloadFailed: '下载失败',
  kbBudget: '上下文预算',
  kbBudgetChars: '{n} 字',
  kbUnavailableNotice: '知识库暂不可达，本次未使用知识库回答',
  kbSave: '保存',
  kbClear: '清除',
}

const en: typeof zh = {
  kbPickerLabel: 'Knowledge base',
  kbPickerHint: 'When selected, messages search the knowledge base first and answers cite [n]',
  kbPickerEmpty: 'No knowledge base yet',
  kbPickerUnavailable: 'Knowledge base service not found',
  kbPickerRetry: 'Retry',
  kbRefresh: 'Refresh',
  kbSource: 'Source: {origin}',
  kbSourceManual: 'manual',
  kbDocsCount: '{n} docs',
  kbDocsFailed: '{n} failed',
  kbEmbedWarning:
    'Embedding model unavailable — configure it or rebuild the index in the harness app',
  kbRemove: 'Remove knowledge base',
  kbCiteTitle: 'Citation {n}',
  kbPreviewClose: 'Close',
  kbPreviewSource: 'From document: {name}',
  kbPreviewDownload: 'Download source file',
  kbPreviewDownloading: 'Downloading…',
  kbPreviewDownloaded: 'Downloaded',
  kbPreviewDownloadFailed: 'Download failed',
  kbBudget: 'Context budget',
  kbBudgetChars: '{n} chars',
  kbUnavailableNotice: 'Knowledge base unreachable — answered without it',
  kbSave: 'Save',
  kbClear: 'Clear',
}

const dicts: Record<KbLang, typeof zh> = { zh, en }

export type KbStrings = typeof zh

export function normalizeKbLang(lang: string | undefined): KbLang {
  const base = (lang ?? '').trim().toLowerCase().split('-')[0]
  return base === 'zh' ? 'zh' : 'en'
}

export function kbStrings(lang: string | undefined): KbStrings {
  return dicts[normalizeKbLang(lang)]
}

/** simple {placeholder} interpolation (same convention as model-settings-strings) */
export function fmt(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`))
}
