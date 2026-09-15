/**
 * Harvests the chayuan-wps CORE builtin assistants (the prompt-driven helpers
 * behind the WPS ribbon: spell-check, summary, the text-analysis family,
 * security check, declassify keyword extraction, text-to-image/video) into the
 * docs app's static core pack `core-builtin.ts`.
 *
 * The 4576 domain assistants arrive via gen-docs-assistants.mjs; the core
 * builtins live inside assistantRegistry.js (runtime module, not a data pack),
 * so this script stages that one module with stubbed side-effect imports and
 * picks the curated ids below. Prompts are copied verbatim — no retyping, no
 * paraphrasing; the only transforms are the documented adaptations:
 *
 * - id: `analysis.<slug>` → `core.<slug>` (domain scoping, same rule as the
 *   domain migration); spell-check/summary drop their "…设置" label suffix.
 * - {{kbContext}} → honest placeholder (same as the domain migration).
 * - text-to-image/video: {{aspectRatio}}/{{duration}} bake the wps runner
 *   defaults (16:9 / 8s); mediaKind rides on the new DocAssistant field so
 *   build-instruction.ts can route the agent to generate_image.
 *
 * Output is deterministic; `--check` asserts byte-identical output.
 *
 * Usage: node tools/harvest-core-assistants.mjs [--wps ../chayuan-wps] [--check]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
const args = process.argv.slice(2)
const argOf = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const wpsRoot = path.resolve(repoRoot, argOf('--wps') ?? '../chayuan-wps')
const checkOnly = args.includes('--check')
const outFile = path.join(
  repoRoot,
  'apps/docs/src/renderer/ai/assistants/core-builtin.ts',
)

const registrySrc = path.join(wpsRoot, 'src/utils/assistantRegistry.js')
const reportSettingsSrc = path.join(wpsRoot, 'src/utils/reportSettings.js')
const domainManifestSrc = path.join(wpsRoot, 'src/utils/assistant/assistantDomainManifest.js')
for (const p of [registrySrc, reportSettingsSrc, domainManifestSrc]) {
  if (!fs.existsSync(p)) {
    console.error(`[harvest-core-assistants] missing source: ${p}`)
    process.exit(1)
  }
}

/** the curated core set — ids exactly as they appear in assistantRegistry.js */
const CORE_IDS = [
  'spell-check',
  'summary',
  'analysis.rewrite',
  'analysis.polish',
  'analysis.formalize',
  'analysis.simplify',
  'analysis.expand',
  'analysis.abbreviate',
  'analysis.extract-keywords',
  'analysis.action-items',
  'analysis.risks',
  'analysis.term-unify',
  'analysis.title',
  'analysis.structure',
  'analysis.minutes',
  'analysis.policy-style',
  'analysis.paragraph-numbering-check',
  'analysis.ai-trace-check',
  'analysis.comment-explain',
  'analysis.hyperlink-explain',
  'analysis.security-check',
  'analysis.secret-keyword-extract',
  'text-to-image',
  'text-to-video',
]

/** registry labels for the settings page; the pack shows the action label */
const LABEL_OVERRIDES = {
  'spell-check': '拼写与语法检查',
  summary: '生成摘要',
}

/** registry descriptions describe the wps settings entry; the pack runs directly */
const DESCRIPTION_OVERRIDES = {
  'spell-check':
    '对选中文本或全文做错别字、语法、标点检查，每处问题以批注形式锚定到原文位置。',
  summary: '将选中内容或全文压缩为结构清晰的摘要：一句话结论加 3-6 条要点。',
}

const KNOWN_ACTIONS = new Set([
  'insert',
  'replace',
  'append',
  'prepend',
  'insert-after',
  'comment',
  'link-comment',
  'copy',
  'preview',
  'none',
])
const KNOWN_INPUT_SOURCES = new Set(['document', 'selection-preferred', 'selection-only'])
const KNOWN_OUTPUT_FORMATS = new Set(['markdown', 'json', 'plain', 'bullet-list'])

async function stageRegistry() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-core-assistants-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }))
  fs.copyFileSync(registrySrc, path.join(dir, 'assistantRegistry.js'))
  fs.copyFileSync(reportSettingsSrc, path.join(dir, 'reportSettings.js'))
  fs.mkdirSync(path.join(dir, 'assistant'), { recursive: true })
  fs.copyFileSync(domainManifestSrc, path.join(dir, 'assistant/assistantDomainManifest.js'))
  // the extra/P5 packs are domain-migration territory (gen-docs-assistants);
  // stub them empty so the registry module loads without their dep chains
  for (const [name, exportName] of [
    ['builtinAssistantsExtra.js', 'EXTRA_BUILTIN_ASSISTANTS'],
    ['builtinAssistantsP5.js', 'P5_BUILTIN_ASSISTANTS'],
    ['builtinAssistantsP5Plus.js', 'P5_PLUS_BUILTIN_ASSISTANTS'],
  ]) {
    fs.writeFileSync(
      path.join(dir, 'assistant', name),
      `export const ${exportName} = []\n`,
    )
  }
  // icon plumbing pulls @iconify + the WPS data path — the pack keeps the
  // emoji verbatim, so an identity stub is enough for the registry to load
  fs.writeFileSync(
    path.join(dir, 'assistantIcons.js'),
    `export const DEFAULT_ASSISTANT_ICON = '🤖'\nexport function normalizeAssistantIcon(icon) { return icon }\n`,
  )
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  }
}

function normalizeAssistant(raw) {
  if (!raw || typeof raw.id !== 'string') throw new Error('bad assistant entry')
  const slug = raw.id.startsWith('analysis.') ? raw.id.slice('analysis.'.length) : raw.id
  const id = `core.${slug}`
  const actions = (raw.allowedActions ?? []).filter((a) => KNOWN_ACTIONS.has(a))
  const inputSource = KNOWN_INPUT_SOURCES.has(raw.defaultInputSource)
    ? raw.defaultInputSource
    : 'document'
  const outputFormat = KNOWN_OUTPUT_FORMATS.has(raw.defaultOutputFormat)
    ? raw.defaultOutputFormat
    : 'markdown'
  if (actions.length === 0 || !actions.includes(raw.defaultAction)) {
    throw new Error(`${id}: defaultAction ${raw.defaultAction} missing from allowedActions`)
  }
  const doc = {
    id,
    domain: 'core',
    label: LABEL_OVERRIDES[raw.id] ?? raw.label.trim(),
    shortLabel: (raw.shortLabel || raw.label).trim(),
    icon: raw.icon || '🤖',
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    description: (DESCRIPTION_OVERRIDES[raw.id] ?? raw.description).trim(),
    systemPrompt: raw.systemPrompt.trim(),
    userPromptTemplate: raw.userPromptTemplate
      .replaceAll('{{kbContext}}', '（未绑定知识库）')
      // wps runner defaults (taskRunner mediaOptions) baked in — the docs
      // runtime has no per-run media option panel
      .replaceAll('{{aspectRatio}}', '16:9')
      .replaceAll('{{duration}}', '8s')
      .replaceAll('{{voiceStyle}}', '专业自然')
      .trim(),
    actions,
    defaultAction: raw.defaultAction,
    inputSource,
    outputFormat,
  }
  if (typeof raw.temperature === 'number') doc.temperature = raw.temperature
  if (raw.inputOptional === true) doc.inputOptional = true
  const mediaKind = raw.runtimeCapabilities?.mediaKind
  if (mediaKind === 'image' || mediaKind === 'video') doc.mediaKind = mediaKind
  return doc
}

function moduleFor(docs) {
  return `// generated by tools/harvest-core-assistants.mjs — do not edit by hand
// Source: ../chayuan-wps/src/utils/assistantRegistry.js CORE_BUILTIN_ASSISTANTS
// (prompts verbatim; see the tool header for the documented adaptations).
import type { DocAssistant } from './types'

export const CORE_ASSISTANTS: DocAssistant[] = ${JSON.stringify(docs, null, 1)}
`
}

const { dir, cleanup } = await stageRegistry()
try {
  const registry = await import(pathToFileURL(path.join(dir, 'assistantRegistry.js')).href)
  const builtins = registry.getBuiltinAssistants()
  const byId = new Map(builtins.map((a) => [a.id, a]))
  const missing = CORE_IDS.filter((id) => !byId.has(id))
  if (missing.length > 0) {
    console.error(`[harvest-core-assistants] ids not found in wps registry: ${missing.join(', ')}`)
    process.exit(1)
  }
  const docs = CORE_IDS.map((id) => normalizeAssistant(byId.get(id)))
  const content = moduleFor(docs)

  if (checkOnly) {
    const existing = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : ''
    if (existing !== content) {
      console.error(`[harvest-core-assistants] stale output: ${path.relative(repoRoot, outFile)}`)
      process.exit(1)
    }
    console.log(`[harvest-core-assistants] up to date (${docs.length} core assistants)`)
  } else {
    fs.writeFileSync(outFile, content)
    console.log(
      `[harvest-core-assistants] wrote ${docs.length} core assistants → ${path.relative(repoRoot, outFile)}`,
    )
  }
} finally {
  cleanup()
}
