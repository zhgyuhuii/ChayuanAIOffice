// Unified run rules: a DocAssistant + the current document state → one agent
// instruction. This is the single place that turns assistant metadata into
// prompt text, so every migrated assistant behaves the same way.
//
// Adaptations from the wps runtime (documented, deliberate):
// - systemPrompt: the docs agent loop has no per-run system-prompt slot, so the
//   persona is prepended to the instruction instead.
// - input: the loop already injects a document skeleton + the user's selection
//   as context each turn. Selection text is embedded verbatim; whole-document
//   input stays tool-based (read_blocks) instead of duplicating the full text.
// - comment / link-comment: the agent's add_comment tool anchors批注 to verbatim
//   text (table cells included), so these actions write real document comments
//   — closer to the wps behaviour than the old conversation-only fallback.
import type { AssistantAction, DocAssistant } from './types'

export type AssistantRunError = 'need-selection'

export type AssistantRunPlan =
  | { ok: true; instruction: string; display: string; inputScope: 'selection' | 'document' }
  | { ok: false; error: AssistantRunError }

/** 动作 → write-back directive appended to every instruction */
const ACTION_DIRECTIVES: Record<AssistantAction, string> = {
  replace:
    '完成后把需要修改的内容直接改写进文档对应位置：只改动需要修改的部分，未涉及的内容保持原样。',
  insert: '完成后把生成内容插入到文档中合适的位置，格式风格与原文一致。',
  append: '完成后把生成内容追加到文档末尾。',
  prepend: '完成后把生成内容添加到文档开头。',
  'insert-after': '完成后把生成内容插入到所处理内容的后面。',
  comment:
    '不要直接改写原文：逐条把意见用 add_comment 工具写成文档批注（anchorText 必须逐字引用原文中可定位的连续片段，含表格内命中时用 blockIndex+row+col 定位），全部批注写完后在对话中汇总条数与要点。',
  'link-comment':
    '不要直接改写原文：逐条把意见用 add_comment 工具写成文档批注（anchorText 必须逐字引用原文中可定位的连续片段，含表格内命中时用 blockIndex+row+col 定位），全部批注写完后在对话中汇总条数与要点。',
  copy: '仅在对话中输出结果，不要修改文档。',
  preview: '仅在对话中输出结果，不要修改文档。',
  none: '仅在对话中输出结果，不要修改文档。',
}

/** media assistants (core pack) — the docs agent's image channel */
const MEDIA_DIRECTIVES: Record<NonNullable<DocAssistant['mediaKind']>, string> = {
  image:
    '执行时优先用 generate_image 工具生成图片（把需求转成详细的英文提示词，并按要求的比例传 aspectRatio），生成成功后图片会插入文档；不要只输出文字建议。',
  video:
    '当前环境没有视频生成工具：不要伪造视频文件。请输出一份可直接交给视频模型或拍摄团队使用的分镜脚本（镜头号/画面描述/时长/文案），并用 generate_image 为最重要的 2-3 个镜头生成关键帧插图插入文档，同时在对话中说明本环境暂不能直接产出视频文件。',
}

const OUTPUT_FORMAT_DIRECTIVES: Partial<Record<DocAssistant['outputFormat'], string>> = {
  json: '结果仅输出合法的 JSON，不要附加任何解释文字或代码块围栏。',
  plain: '用纯文本输出，不要使用 Markdown 标记。',
  'bullet-list': '用简短要点列表输出。',
}

const DOC_INPUT_PLACEHOLDER =
  '（当前文档全文：请先通读本条消息附带的文档结构上下文，需要更多细节时用 read_blocks 工具读取，再开始执行任务。）'

/** selection-preferred behaves like document: a selection wins, else whole doc (wps semantics) */
export function resolveInputScope(
  doc: DocAssistant,
  selectionText: string,
): 'selection' | 'document' | 'need-selection' {
  const hasSelection = selectionText.trim().length >= 2
  if (doc.inputSource === 'selection-only') return hasSelection ? 'selection' : 'need-selection'
  return hasSelection ? 'selection' : 'document'
}

/**
 * Build the agent instruction for running `doc`.
 * `selectionText` is the current plain-text selection (empty when none).
 */
export function buildAssistantInstruction(
  doc: DocAssistant,
  selectionText: string,
): AssistantRunPlan {
  const scope = resolveInputScope(doc, selectionText)
  if (scope === 'need-selection') return { ok: false, error: 'need-selection' }

  const parts: string[] = []
  parts.push(`【角色设定】\n${doc.systemPrompt}`)
  const input =
    scope === 'selection'
      ? `【以下为用户当前选中的内容】\n---\n${selectionText.trim()}\n---`
      : DOC_INPUT_PLACEHOLDER
  parts.push(doc.userPromptTemplate.replaceAll('{{input}}', input))
  parts.push(`【结果处理】\n${ACTION_DIRECTIVES[doc.defaultAction]}`)

  if (doc.report) {
    const report = doc.report
    parts.push(
      [
        '【报告要求】',
        `报告类型：${report.typeLabel}`,
        `按下面的结构模板组织报告：\n${report.template.replaceAll('{{reportType}}', report.typeLabel)}`,
        report.prompt ? `内容侧重：${report.prompt}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  const outputDirective = OUTPUT_FORMAT_DIRECTIVES[doc.outputFormat]
  if (outputDirective) parts.push(outputDirective)
  if (doc.mediaKind) parts.push(MEDIA_DIRECTIVES[doc.mediaKind])

  const scopeLabel = scope === 'selection' ? '选区' : '全文'
  return {
    ok: true,
    instruction: parts.join('\n\n'),
    display: `${doc.icon} ${doc.label} · ${scopeLabel}`,
    inputScope: scope,
  }
}
