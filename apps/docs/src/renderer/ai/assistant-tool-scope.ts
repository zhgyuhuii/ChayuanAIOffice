import type { AgentToolDef } from '@chaoffice/agent-core'

/**
 * Intent-scoped wire toolsets + description/schema slimming for the docs
 * agent. Lives in its own file (not docs-skill.ts / tools.ts) so upstream
 * merges never clash with it: consumers import two functions and wire one
 * optional accessor, everything else is local here.
 *
 * Two levers, both measured against the live 16.5k-token editor request:
 * - A: a pure-writing instruction (扩写/润色/续写/校对/翻译…) only needs the
 *   core read/write tools — the other ~25 tool definitions (≈4.5k tokens of
 *   schema + description) never apply to that intent and stay off the wire.
 * - B: a few tool descriptions/schemas carry text the system prompt already
 *   states (formatting-inheritance contract, restricted-HTML note) or spell
 *   out at more length than the model needs; the overrides below restate
 *   them tighter. Contracts are preserved — only duplicated wording goes.
 */

/** Tools a pure-writing run (expand/polish/continue/translate/proofread) needs. */
export const WRITING_CORE_TOOL_NAMES = [
  'get_document_context',
  'read_blocks',
  'insert_content',
  'write_document',
  'replace_blocks',
  'replace_selection',
  // within the "6–8 core" budget: rewrite runs restyle runs (apply_ops), and
  // proofread-and-comment runs anchor comments (add_comment)
  'apply_ops',
  'add_comment',
] as const

/**
 * Pure-writing instructions. Conservative on purpose: a miss keeps the full
 * toolset (safe), a false positive would withhold tools the run needs.
 * The media/structure guard overrides the match — an instruction that also
 * asks for pictures/charts/cover/… needs the general toolset.
 */
const WRITING_INTENT_RE =
  /扩写|润色|润饰|续写|改写|重写|缩写|校对|纠错|改写语气|润色一下|翻译|polish|proofread|expand on|continue writing|rewrite this|translate/i
const NON_WRITING_INTENT_RE =
  /生成图|配图|插图|图片|画一|画个|画张|图表|表格|页眉|页脚|水印|封面|目录|思维导图|公式|脚注|尾注|批注|修订|新建(一个)?文档|单独文件|image|chart|header|footer|watermark|cover page|table of contents|mind ?map|footnote|comment on/i

/** True when the instruction is a pure writing/editing pass (see class guard above). */
export function isWritingIntent(instruction: string): boolean {
  if (!instruction) return false
  if (NON_WRITING_INTENT_RE.test(instruction)) return false
  return WRITING_INTENT_RE.test(instruction)
}

/**
 * A → keep only the core writing tools (in the skill's own order) when the
 * run's instruction is a pure writing pass; any other instruction keeps the
 * full set. Unknown names in the subset are skipped, so the filter tracks
 * whatever the skill currently exposes.
 */
export function scopeToolsForIntent<T extends { name: string }>(
  instruction: string,
  all: readonly T[],
): T[] {
  if (!isWritingIntent(instruction)) return all as T[]
  const core = new Set<string>(WRITING_CORE_TOOL_NAMES)
  const scoped = all.filter((t) => core.has(t.name))
  // an empty result means the skill changed shape under us — fail open
  return scoped.length > 0 ? scoped : (all as T[])
}

/**
 * B → tighter restatements where the system prompt (or a sibling tool) already
 * carries the contract, plus schemas whose property notes ran long. Keyed by
 * tool name so an upstream rename simply stops matching (no stale rewrite).
 * `description` replaces the whole text; `schema` merges over the original
 * (properties/descriptions only — required lists and shapes come from the
 * source of truth).
 */
const DESCRIPTION_OVERRIDES: Record<string, string> = {
  // the formatting-inheritance sentence is already in the system prompt
  // (# Tool usage): the tool only needs its own scope and preconditions
  replace_blocks:
    'Replace a block range with new content (restricted HTML). For rewriting/translating/condensing/expanding existing content; the new block count may differ from the old. Formatting is inherited from the replaced blocks (paragraph, text and table formatting) — see the system prompt; never restore formatting afterwards.',
  insert_content:
    'Insert new content at a position (restricted HTML, may contain multiple blocks). For writing/continuing/generating new content; to rewrite existing content use replace_blocks. Long drafts (beyond a few paragraphs) go through write_document instead.',
}

/** Per-property description rewrites for the fattest schemas (measured ≥0.7KB). */
const SCHEMA_DESC_OVERRIDES: Record<string, Record<string, string>> = {
  add_comment: {
    text: 'exact text inside the block to anchor to; omitted = whole block',
    occurrence: 'which match to anchor when text repeats (1 = first)',
    author: 'author name; default: the AI author',
    initials: 'author initials',
  },
  accept_changes: {
    ids: 'revision ids from read_revisions (r1, r2, …); re-read after edits',
    author: 'only changes by this author',
    type: 'only changes of this type',
  },
  reject_changes: {
    ids: 'revision ids from read_revisions (r1, r2, …); re-read after edits',
    author: 'only changes by this author',
    type: 'only changes of this type',
  },
  edit_chart: {
    categories: 'new category labels, same length as the original; null keeps a position',
  },
  insert_chart: {
    data: 'chart data; real numbers from the document or search results',
  },
}

function slimSchema(
  name: string,
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const overrides = SCHEMA_DESC_OVERRIDES[name]
  if (!overrides || !schema) return schema
  const props = (schema as { properties?: Record<string, { description?: string }> }).properties
  if (!props) return schema
  let touched = false
  const next: Record<string, { description?: string }> = { ...props }
  for (const [key, text] of Object.entries(overrides)) {
    const prop = next[key]
    if (prop?.description && prop.description !== text) {
      next[key] = { ...prop, description: text }
      touched = true
    }
  }
  return touched ? { ...schema, properties: next } : schema
}

/**
 * B → apply the description/schema slimming to a toolset. Returns the same
 * array when nothing matches (tools.ts stays the source of truth; this is a
 * pure post-processor).
 */
export function slimToolDefs<
  T extends { name: string; description: string; inputSchema?: unknown },
>(all: readonly T[]): T[] {
  let changed = false
  const out = all.map((t) => {
    const desc = DESCRIPTION_OVERRIDES[t.name]
    const slimmed = desc !== undefined && desc !== t.description
    const schema = slimSchema(t.name, t.inputSchema as Record<string, unknown> | undefined)
    const schemaSlimmed = schema !== t.inputSchema
    if (!slimmed && !schemaSlimmed) return t
    changed = true
    return {
      ...t,
      ...(slimmed ? { description: desc } : {}),
      ...(schemaSlimmed ? { inputSchema: schema } : {}),
    }
  })
  return changed ? out : (all as T[])
}
