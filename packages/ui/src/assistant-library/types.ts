/** 跨端助手库（整体要求: 每种文档类型 ≥100 个助手）。
 *  docs 端沿用其 4576 助手的 DocAssistant 体系不受影响;其余五端共享此轻量 schema——
 *  助手即一条结构化提示词,点击后送入对应端的 AI 对话(模型经文件工具直接操作文档)。 */

export interface AppAssistant {
  /** 全局唯一: `<app>.<domain>.<slug>` */
  id: string
  label: string
  /** emoji, rendered as-is */
  icon: string
  description: string
  /** 发送给 AI 的完整任务提示词（自包含,模型经文件工具读写当前文档） */
  prompt: string
}

export interface AssistantDomain {
  key: string
  label: string
  icon: string
  items: AppAssistant[]
}

export type AssistantApp = 'sheets' | 'slides' | 'pdf' | 'markdown' | 'html'

export const ASSISTANT_LIBRARY: Record<AssistantApp, AssistantDomain[]> = {
  sheets: [],
  slides: [],
  pdf: [],
  markdown: [],
  html: [],
}

export function libraryTotal(app: AssistantApp): number {
  return ASSISTANT_LIBRARY[app].reduce((n, d) => n + d.items.length, 0)
}
