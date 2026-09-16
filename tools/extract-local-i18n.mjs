#!/usr/bin/env node
/**
 * i18n 本地键分离工具（上游共存制度 P0，见 docs/upstream-coexistence.md §3.1）。
 *
 * 把 `<strings 文件>` 里「上游没有的本地键」按语言迁出到 <输出文件>（B 区），
 * strings 文件保留纯上游键，并在尾部追加 spread 合并 shim 导出同名 `strings`。
 * 消费方（locale.tsx 等）无需改动。
 *
 * 用法：
 *   node tools/extract-local-i18n.mjs <strings文件> <上游参照文件> <输出文件> [语言列表逗号分隔]
 *
 * 例（shell 已完成；其余 app 复用时替换三个路径）：
 *   node tools/extract-local-i18n.mjs \
 *     apps/docs/src/renderer/i18n/strings-ai.ts <上游参照> ... 
 *
 * 注意：
 * - 上游参照 = 当前同步终点 sha 的同路径文件（git show <sha>:<path>），用于判定"本地键"。
 * - 语言列表缺省为 shell 的 20 语言；其他 app 按自身 shard 语言传参。
 * - 运行后必须：esbuild/tsc 解析校验 + 全量测试 + 提交。
 * - 迁移包含工作树中未提交的文案值（并行会话的值编辑会被保留进输出）。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [stringsPath, upstreamPath, outPath, langsArg] = process.argv.slice(2)
if (!stringsPath || !upstreamPath || !outPath) {
  console.error('usage: node tools/extract-local-i18n.mjs <strings> <upstream> <out> [langs]')
  process.exit(1)
}
const LANGS = (langsArg ?? 'zh,en,ja,ko,fr,de,es,th,id,ru,ar,pt,it,pl,cs,nl,ms,he,hi,zh-TW').split(',')

const sec = /^  '?([a-z]{2}(?:-[A-Za-z]+)?)'?: \{$/
const keyline = /^    ([A-Za-z][A-Za-z0-9]*):(?: |$)/
const keyRe = keyline

function sections(text) {
  const lines = text.split('\n')
  const marks = []
  lines.forEach((l, i) => {
    const m = secRe.exec(l)
    if (m) marks.push([m[1], i])
  })
  const spans = {}
  marks.forEach(([lang, off], idx) => {
    const start = off
    const stop = idx + 1 < marks.length ? marks[idx + 1][1] : lines.length
    if (!spans[lang]) spans[lang] = []
    spans[lang].push([start, stop])
  })
  return { lines, spans }
}

function keysIn(lines, a, b) {
  const keys = []
  for (let i = a; i < b; i++) {
    const m = keyRe.exec(lines[i])
    if (m && !keys.includes(m[1])) keys.push(m[1])
  }
  return keys
}

function valueLines(lines, a, b, key) {
  for (let i = a; i < b; i++) {
    const m = keyRe.exec(lines[i])
    if (m && m[1] === key) {
      const cap = [lines[i]]
      let j = i + 1
      while (j < b && !keyRe.test(lines[j]) && lines[j].trim() !== '},') {
        cap.push(lines[j]); j++
      }
      while (cap.length && cap[cap.length - 1].trim() === '') cap.pop()
      return cap
    }
  }
  return null
}

const src = readFileSync(stringsPath, 'utf8')
const up = readFileSync(upstreamPath, 'utf8')
const { lines, spans } = sections(src)
const { spans: upSpans } = sections(up)

const upKeys = new Set()
for (const spansL of Object.values(upSpans))
  for (const [a, b] of spansL)
    for (const l of lines.slice(a, b)) {
      const m = keyRe.exec(l)
      if (m) upKeys.add(m[1])
    }

const main_span = {}
for (const [lang, spansL] of Object.entries(spans)) main_span[lang] = spansL[spansL.length - 1]

const zh = main_span.zh
const zhKeys = keysIn(lines, zh[0] + 1, zh[1]).filter((k) => !upKeys.has(k))

// 1) 本地文件
const out = [
  '/**',
  ' * 本地独有词条（B 区）—— 与上游 strings 物理分离，上游同步不触碰本文件。',
  ' * 键集以 zh 为准；其余语言缺翻译时回退 zh 文案。',
  ' * 由 tools/extract-local-i18n.mjs 生成；运行时在 strings 尾部 spread 合并。',
  ' */',
  'export const localStrings = {',
]
for (const lang of LANGS) {
  const opener = lang === 'zh-TW' ? "  'zh-TW': {" : `  ${lang}: {`
  out.push(opener)
  for (const k of zhKeys) {
    let v = null
    if (main_span[lang]) v = valueLines(lines, main_span[lang][0] + 1, main_span[lang][1], k)
    if (!v && main_span.zh) v = valueLines(lines, main_span.zh[0] + 1, main_span.zh[1], k)
    if (v) out.push(...v)
  }
  out.push('  },')
}
out.push('} as const')
writeFileSync(outPath, out.join('\n') + '\n')

// 2) strings：删本地键 + 尾部合并 shim
const out2 = []
let removed = 0
let i = 0
while (i < lines.length) {
  const l = lines[i]
  let inMain = false
  for (const lang of LANGS) {
    if (main_span[lang]) {
      const [a, b] = main_span[lang]
      if (i >= a && i < b) inMain = true
    }
  }
  const m = keyRe.exec(l)
  if (inMain && m && zhKeys.includes(m[1])) {
    removed++
    let j = i + 1
    while (j < lines.length && !keyRe.test(lines[j]) && lines[j].trim() !== '},') j++
    i = j
    continue
  }
  out2.push(l)
  i++
}
let text = out2.join('\n')
const shim =
  '\n// ── LOCAL i18n 合并（B 区）──────────────────────────────\n' +
  "// 本地词条 spread 进各语言节后导出；StringKey 自动包含本地键。\nimport { localStrings } from '" +
  outPath.replace(/^apps\/[a-z]+\/src\/renderer\//, './').replace(/\.ts$/, '') +
  "'\n\nconst strings = {\n" +
  LANGS.map((lang) => {
    const acc = lang === 'zh-TW' ? "['zh-TW']" : `.${lang}`
    const key = lang === 'zh-TW' ? "'zh-TW'" : lang
    return `  ${key}: { ...upstreamStrings${acc}, ...localStrings${acc} },`
  }).join('\n') +
  '\n} as const\n\nexport { strings }\n'
text = text.replace(/\n} as const\n/, '\n} as const\n\n' + shim)
writeFileSync(stringsPath, text)
console.log(`migrated ${zhKeys.length} local keys × ${LANGS.length} langs; removed ${removed} lines from strings`)
