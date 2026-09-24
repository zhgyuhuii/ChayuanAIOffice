/**
 * Migrates the chayuan-wps builtin assistant library into the docs app's
 * assistant tab data packs.
 *
 * Source (read-only, sibling checkout, override with --wps):
 *   ../chayuan-wps/src/utils/assistant/builtinAssistants*.js  — 4544 assistants
 *   ../chayuan-wps/src/utils/assistant/assistantDomainManifest.js — domain labels/order
 *   ../chayuan-wps/src/utils/reportAssistantPresets.js        — 32 report presets
 *   ../chayuan-wps/src/utils/reportSettings.js                — report type labels + default template
 *
 * Output (generated, do not edit by hand):
 *   apps/docs/src/renderer/ai/assistants/packs/manifest.ts
 *   apps/docs/src/renderer/ai/assistants/packs/domains/<domain>.ts
 *
 * The unified schema lives in apps/docs/src/renderer/ai/assistants/types.ts; the
 * run-time rules (how a DocAssistant becomes an agent instruction) live in
 * build-instruction.ts. This script is the only writer of packs/ and is
 * deterministic: same source → byte-identical output (asserted by --check).
 *
 * Usage:
 *   node tools/gen-docs-assistants.mjs [--wps ../chayuan-wps] [--check]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
const args = process.argv.slice(2)
const argOf = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const wpsRoot = path.resolve(repoRoot, argOf('--wps') ?? '../chayuan-wps')
const checkOnly = args.includes('--check')
const outDir = path.join(repoRoot, 'apps/docs/src/renderer/ai/assistants/packs')
const domainsDir = path.join(outDir, 'domains')

const assistantSrc = path.join(wpsRoot, 'src/utils/assistant')
const reportPresetsSrc = path.join(wpsRoot, 'src/utils/reportAssistantPresets.js')
const reportSettingsSrc = path.join(wpsRoot, 'src/utils/reportSettings.js')
for (const p of [assistantSrc, reportPresetsSrc, reportSettingsSrc]) {
  if (!fs.existsSync(p)) {
    console.error(`[gen-docs-assistants] missing source: ${p}`)
    console.error('  pass the chayuan-wps checkout with --wps <path>')
    process.exit(1)
  }
}

// ---- temporary ESM staging ------------------------------------------------
// The wps sources are plain browser ESM without package.json "type": "module",
// so copy them into a scratch dir marked as ESM and import from there.
const REPORT_SETTINGS_STUB_HEADER = `// staged copy — imported by gen-docs-assistants.mjs only
`

async function stageEsm(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-assistants-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }))
  for (const [name, content] of files) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), content)
  }
  return dir
}

async function importBuiltinPacks() {
  const files = []
  for (const f of fs.readdirSync(assistantSrc)) {
    if (/^builtinAssistants.*\.js$/.test(f)) {
      files.push([f, fs.readFileSync(path.join(assistantSrc, f), 'utf8')])
    }
    if (f === 'assistantDomainManifest.js') {
      files.push([f, fs.readFileSync(path.join(assistantSrc, f), 'utf8')])
    }
  }
  const dir = await stageEsm(files)
  try {
    const manifest = await import(pathToFileURL(path.join(dir, 'assistantDomainManifest.js')).href)
    const packs = []
    for (const f of fs.readdirSync(dir)) {
      if (!/^builtinAssistants.*\.js$/.test(f)) continue
      const mod = await import(pathToFileURL(path.join(dir, f)).href)
      const key = Object.keys(mod).find((k) => /ASSISTANTS/.test(k))
      const arr = mod[key]
      if (!Array.isArray(arr)) throw new Error(`${f} exports no assistant array`)
      packs.push([f, arr])
    }
    return { manifest, packs, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw err
  }
}

async function importReportPresets() {
  const realSettings = fs.readFileSync(reportSettingsSrc, 'utf8')
  // the presets' two relative imports resolve to the staged copies below
  const presetsSrc = fs.readFileSync(reportPresetsSrc, 'utf8')
  const dir = await stageEsm([
    ['reportSettings.js', REPORT_SETTINGS_STUB_HEADER + realSettings],
    // the presets only flow their config through this helper — identity is enough
    [
      'assistantSettings.js',
      `${REPORT_SETTINGS_STUB_HEADER}export function createCustomAssistantDraft(patch) { return patch }\n`,
    ],
    ['reportAssistantPresets.js', presetsSrc],
  ])
  try {
    const settings = await import(pathToFileURL(path.join(dir, 'reportSettings.js')).href)
    const presets = await import(pathToFileURL(path.join(dir, 'reportAssistantPresets.js')).href)
    return {
      presets: presets.getReportAssistantPresets(),
      defaultTemplate: settings.DEFAULT_REPORT_TEMPLATE,
      typeLabel: (value) => settings.getReportTypeLabel(value),
      cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
    }
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw err
  }
}

// ---- normalization (the unified rules) ------------------------------------

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

/** every pack carries this vestigial prefix from the shared base() helper */
const LEGACY_ID_PREFIX = 'analysis.'

/** the wps Extra pack omits `domain`; the registry labels these 通用文档工具 */
const FALLBACK_DOMAIN = 'docutil'

function normalizeAssistant(raw, domainLabels) {
  const slug = raw.id.startsWith(LEGACY_ID_PREFIX) ? raw.id.slice(LEGACY_ID_PREFIX.length) : raw.id
  const domain = raw.domain || FALLBACK_DOMAIN
  const id = `${domain}.${slug}`
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
    domain,
    label: raw.label.trim(),
    shortLabel: (raw.shortLabel || raw.label).trim(),
    icon: raw.icon || '🤖',
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    description: raw.description.trim(),
    systemPrompt: raw.systemPrompt.trim(),
    // kbContext is fed by the wps knowledge-base binding; docs has no KB store,
    // and these prompts already instruct the model to report "KB not bound" —
    // substitute an honest placeholder instead of dropping the variable
    userPromptTemplate: raw.userPromptTemplate
      .replaceAll('{{kbContext}}', '（未绑定知识库）')
      .trim(),
    actions,
    defaultAction: raw.defaultAction,
    inputSource,
    outputFormat,
  }
  if (typeof raw.temperature === 'number') doc.temperature = raw.temperature
  if (raw.inputOptional === true) doc.inputOptional = true
  if (!domainLabels.has(domain)) domainLabels.set(domain, domain)
  return doc
}

function normalizeReportPreset(preset, defaultTemplate, typeLabel) {
  const c = preset.config ?? {}
  const rs = c.reportSettings ?? {}
  return {
    id: `report.${preset.id}`,
    domain: 'report',
    label: String(c.name ?? preset.label).trim(),
    shortLabel: String(preset.label).trim(),
    icon: '📄',
    tags: ['报告', '模板'],
    description: String(c.description ?? preset.description ?? '').trim(),
    systemPrompt: String(c.systemPrompt ?? '').trim(),
    userPromptTemplate: String(c.userPromptTemplate ?? '').trim(),
    actions: ['none'],
    defaultAction: 'none',
    inputSource: 'document',
    outputFormat: 'markdown',
    temperature: typeof c.temperature === 'number' ? c.temperature : 0.2,
    report: {
      type: String(rs.type ?? preset.id),
      typeLabel: typeLabel(rs.type ?? preset.id),
      template: String(rs.template ?? defaultTemplate),
      prompt: String(rs.prompt ?? '').trim(),
    },
  }
}

// ---- emission -------------------------------------------------------------

function serialize(value) {
  return JSON.stringify(value, null, 1)
}

function domainModule(domain, docs) {
  return `// generated by tools/gen-docs-assistants.mjs — do not edit by hand
import type { DocAssistant } from '../../types'

export const ASSISTANTS: DocAssistant[] = ${serialize(docs)}
`
}

function manifestModule(manifest, total) {
  return `// generated by tools/gen-docs-assistants.mjs — do not edit by hand
import type { DocAssistant } from '../types'

export interface AssistantDomainInfo {
  key: string
  label: string
  count: number
}

export const DOC_ASSISTANT_TOTAL = ${total}

export const DOC_ASSISTANT_DOMAINS: AssistantDomainInfo[] = ${serialize(manifest)}

const loaders = import.meta.glob('./domains/*.ts') as Record<
  string,
  () => Promise<{ ASSISTANTS: DocAssistant[] }>
>

export async function loadDomain(key: string): Promise<DocAssistant[]> {
  const load = loaders[\`./domains/\${key}.ts\`]
  if (!load) return []
  return (await load()).ASSISTANTS
}

export async function loadAllDomains(): Promise<Map<string, DocAssistant[]>> {
  const entries = await Promise.all(
    Object.entries(loaders).map(async ([file, load]) => {
      const key = file.slice('./domains/'.length, -'.ts'.length)
      return [key, (await load()).ASSISTANTS] as const
    }),
  )
  return new Map(entries)
}
`
}

async function generate() {
  const { manifest: wpsManifest, packs, cleanup: cleanupPacks } = await importBuiltinPacks()
  const {
    presets,
    defaultTemplate,
    typeLabel,
    cleanup: cleanupPresets,
  } = await importReportPresets()
  try {
    const domainLabels = new Map()
    for (const key of wpsManifest.DOMAIN_ORDER ?? []) {
      domainLabels.set(key, wpsManifest.DOMAIN_MANIFEST?.[key]?.label ?? key)
    }

    const byDomain = new Map()
    const seen = new Set()
    let total = 0
    for (const [, arr] of packs) {
      for (const raw of arr) {
        const doc = normalizeAssistant(raw, domainLabels)
        if (seen.has(doc.id))
          throw new Error(`duplicate assistant id after domain scoping: ${doc.id}`)
        seen.add(doc.id)
        if (!byDomain.has(doc.domain)) byDomain.set(doc.domain, [])
        byDomain.get(doc.domain).push(doc)
        total++
      }
    }

    const reportDocs = presets.map((p) => normalizeReportPreset(p, defaultTemplate, typeLabel))
    byDomain.set('report', reportDocs)
    domainLabels.set('report', '报告生成')
    total += reportDocs.length

    // report domain first (cross-domain utility), then the wps manifest order,
    // then any domain the manifest didn't know about yet
    const orderedKeys = [
      'report',
      ...(wpsManifest.DOMAIN_ORDER ?? []).filter((k) => byDomain.has(k)),
      ...[...byDomain.keys()].filter(
        (k) => k !== 'report' && !(wpsManifest.DOMAIN_ORDER ?? []).includes(k),
      ),
    ]
    const missingInManifest = orderedKeys.filter(
      (k) => k !== 'report' && !(wpsManifest.DOMAIN_ORDER ?? []).includes(k),
    )
    if (missingInManifest.length > 0) {
      console.log(
        `[gen-docs-assistants] domains missing from wps manifest (appended): ${missingInManifest.join(', ')}`,
      )
    }
    const manifest = orderedKeys.map((key) => ({
      key,
      label: domainLabels.get(key),
      count: byDomain.get(key).length,
    }))

    const files = new Map()
    files.set(path.join(outDir, 'manifest.ts'), manifestModule(manifest, total))
    for (const key of orderedKeys) {
      files.set(path.join(domainsDir, `${key}.ts`), domainModule(key, byDomain.get(key)))
    }

    if (checkOnly) {
      let drifted = false
      for (const [file, content] of files) {
        const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
        if (existing !== content) {
          console.error(`[gen-docs-assistants] stale output: ${path.relative(repoRoot, file)}`)
          drifted = true
        }
      }
      if (drifted) process.exit(1)
      console.log(
        `[gen-docs-assistants] up to date (${total} assistants, ${orderedKeys.length} domains)`,
      )
      return
    }

    fs.rmSync(outDir, { recursive: true, force: true })
    fs.mkdirSync(domainsDir, { recursive: true })
    for (const [file, content] of files) {
      fs.writeFileSync(file, content)
    }
    console.log(
      `[gen-docs-assistants] wrote ${total} assistants across ${orderedKeys.length} domains → ${path.relative(repoRoot, outDir)}`,
    )
  } finally {
    cleanupPacks()
    cleanupPresets()
  }
}

// createRequire only to fail early with a clear message on old Node
const require = createRequire(import.meta.url)
const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 18) {
  require('node:assert')(false, 'Node >= 18 required')
}

await generate()
