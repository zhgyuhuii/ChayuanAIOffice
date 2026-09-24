// Unified schema for the docs assistant library (助手 tab).
//
// The library is migrated from the chayuan-wps builtin packs by
// tools/gen-docs-assistants.mjs; every legacy assistant field has an explicit
// place here, and build-instruction.ts defines how a DocAssistant becomes an
// agent instruction. Nothing else in the renderer reads the raw pack fields.

/** What may be done with the run result (mirrors the wps document actions) */
export type AssistantAction =
  | 'insert'
  | 'replace'
  | 'append'
  | 'prepend'
  | 'insert-after'
  | 'comment'
  | 'link-comment'
  | 'copy'
  | 'preview'
  | 'none'

/** Which part of the document the assistant consumes */
export type AssistantInputSource = 'document' | 'selection-preferred' | 'selection-only'

export type AssistantOutputFormat = 'markdown' | 'json' | 'plain' | 'bullet-list'

export interface DocAssistantReport {
  /** report type id from the wps report settings catalogue */
  type: string
  /** localized report type label (resolved at generation time) */
  typeLabel: string
  /** markdown skeleton with {{reportType}} placeholders */
  template: string
  /** extra emphasis instruction for the report body */
  prompt: string
}

export interface DocAssistant {
  /** globally unique: `<domain>.<slug>` */
  id: string
  /** domain key — the group this assistant is listed under */
  domain: string
  label: string
  shortLabel: string
  /** emoji, rendered as-is */
  icon: string
  tags: string[]
  /** 简介 */
  description: string
  /** 角色提示词 (persona; prepended to every run of this assistant) */
  systemPrompt: string
  /** 任务模板 with a single {{input}} placeholder */
  userPromptTemplate: string
  /** actions this assistant may offer; defaultAction ∈ actions */
  actions: AssistantAction[]
  /** 动作 — what happens to the result by default */
  defaultAction: AssistantAction
  inputSource: AssistantInputSource
  outputFormat: AssistantOutputFormat
  /** legacy sampling hint; the docs panel uses the model's own settings */
  temperature?: number
  /** legacy: the wps assistant tolerated an empty input */
  inputOptional?: boolean
  /** media assistants (core pack): routes build-instruction to generate_image */
  mediaKind?: 'image' | 'video'
  /** 报告生成 assistants (migrated wps report presets) */
  report?: DocAssistantReport
}
