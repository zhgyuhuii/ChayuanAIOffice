/**
 * 示例库采集管线(Q8 签定:构建期自动过滤)
 *
 * 源:apache/echarts-examples gh-pages 快照(默认 .tmp/ee-extract/echarts-examples-gh-pages,
 *     可 --examples-dir 覆盖;tarball: https://codeload.github.com/apache/echarts-examples/tar.gz/refs/heads/gh-pages)
 * 流程:chart-list-data(-gl).js 导航树 → 逐示例读源码 → Worker 沙箱试跑(同线上运行时边界)
 *     → 能捕获 option 的收录 → data/examples.json + data/coverage.json
 * 每组保底(Q8):官方示例全灭的组注入 chartkit 基础模板(src/examples/baselines.ts)。
 *
 * 运行:npm run harvest -w @chatoffice/chart-kit [-- --examples-dir <dir>]
 */

import fs from 'node:fs'
import path from 'node:path'
import { transformSync } from 'esbuild'
import { runOptionCode, mapWithConcurrency } from '../src/sandbox/runner'
import { CHART_GROUPS, canonicalGroupId } from '../src/examples/taxonomy'
import { BASELINE_TEMPLATES } from '../src/examples/baselines'

interface TreeEntry {
  category: string[]
  id: string
  title?: string
  titleCN?: string
  difficulty?: number
}

interface HarvestedExample {
  id: string
  title: string
  titleCN: string
  groups: string[]
  code: string
  ok: boolean
  seriesTypes: string[]
  durationMs: number
  error?: string
  thumb: string | null
  /** chartkit 自带的保底模板(非官方源) */
  baseline?: boolean
}

const ROOT = path.resolve(import.meta.dirname, '..')
const DEFAULT_EXAMPLES_DIR = path.resolve(ROOT, '../../.tmp/ee-extract/echarts-examples-gh-pages')
const TIMEOUT_MS = 2000
const CONCURRENCY = 8

function parseTreeData(file: string): TreeEntry[] {
  const raw = fs.readFileSync(file, 'utf8')
  const json = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*export default\s*/m, '')
    .trim()
    .replace(/;\s*$/, '')
  return JSON.parse(json) as TreeEntry[]
}

/** 去掉头部 frontmatter 注释与尾部 export {};TS 源经 esbuild 转译为纯 JS */
function prepareSource(src: string): string {
  const stripped = src
    .replace(/^\/\*[\s\S]*?\*\/\s*/, (m) => (m.includes('title:') ? '' : m))
    .replace(/^export \{\};?\s*$/gm, '')
    .trim()
  try {
    return transformSync(stripped, {
      loader: 'ts',
      format: 'esm',
      legalComments: 'none',
    }).code.trim()
  } catch {
    // 非 TS 语法(或转译失败)则原样交给沙箱,由试跑裁决
    return stripped
  }
}

function findCodeFile(dir: string, id: string, gl: boolean): string | null {
  const candidates = gl
    ? [
        path.join(dir, 'public/examples/ts/gl', `${id}.js`),
        path.join(dir, 'public/examples/ts/gl', `${id}.ts`),
      ]
    : [
        path.join(dir, 'public/examples/ts', `${id}.ts`),
        path.join(dir, 'public/examples/ts', `${id}.js`),
      ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
}

function extractSeriesTypes(option: unknown): string[] {
  const series = (option as { series?: unknown } | undefined)?.series
  if (!Array.isArray(series)) return []
  const types = series
    .map((s) =>
      s && typeof s === 'object' && 'type' in s ? String((s as { type: unknown }).type) : null,
    )
    .filter((t): t is string => Boolean(t))
  return [...new Set(types)]
}

async function main() {
  const args = process.argv.slice(2)
  const dirIdx = args.indexOf('--examples-dir')
  const dir = dirIdx >= 0 ? path.resolve(args[dirIdx + 1]) : DEFAULT_EXAMPLES_DIR
  if (!fs.existsSync(dir)) {
    console.error(
      `示例仓库不存在: ${dir}\n先下载: curl -L -o .tmp/ee.tar.gz https://codeload.github.com/apache/echarts-examples/tar.gz/refs/heads/gh-pages && tar xzf .tmp/ee.tar.gz -C .tmp/ee-extract`,
    )
    process.exit(1)
  }

  const entries = [
    ...parseTreeData(path.join(dir, 'src/data/chart-list-data.js')),
    ...parseTreeData(path.join(dir, 'src/data/chart-list-data-gl.js')),
  ]
  console.log(`导航树条目: ${entries.length}`)

  const results = await mapWithConcurrency(entries, CONCURRENCY, async (entry) => {
    const glEntry = entry.category.some((c) => {
      const g = canonicalGroupId(c)
      return g ? CHART_GROUPS.find((meta) => meta.id === g)?.gl === true : false
    })
    const codeFile = findCodeFile(dir, entry.id, glEntry)
    const groups = entry.category.map(canonicalGroupId).filter((g): g is string => Boolean(g))
    const thumbDir = glEntry ? 'public/data-gl/thumb' : 'public/data/thumb'
    const thumb = fs.existsSync(path.join(dir, thumbDir, `${entry.id}.webp`))
      ? `${glEntry ? 'data-gl' : 'data'}/thumb/${entry.id}.webp`
      : fs.existsSync(path.join(dir, thumbDir, `${entry.id}.png`))
        ? `${glEntry ? 'data-gl' : 'data'}/thumb/${entry.id}.png`
        : null

    const base: HarvestedExample = {
      id: entry.id,
      title: entry.title ?? entry.id,
      titleCN: entry.titleCN ?? entry.title ?? entry.id,
      groups,
      code: '',
      ok: false,
      seriesTypes: [],
      durationMs: 0,
      thumb,
    }
    if (!codeFile) return { ...base, error: 'code file not found' }
    const code = prepareSource(fs.readFileSync(codeFile, 'utf8'))
    // bmap 组件依赖外部百度地图 SDK,离线环境永不可渲染:直接过滤
    if (/\bbmap\s*:/.test(code))
      return { ...base, code, error: 'bmap needs external Baidu Map SDK (filtered)' }
    // yAxis 用 id 字符串引用的示例(甘特/矩阵变形等)依赖跨轴装配,
    // 组装器不支持:过滤(渲染会报 yAxis not found)
    if (/yAxis\s*:\s*['"]/.test(code))
      return { ...base, code, error: 'yAxis id-reference not supported (filtered)' }
    const run = await runOptionCode(code, { timeoutMs: TIMEOUT_MS })
    return {
      ...base,
      code,
      ok: run.ok,
      seriesTypes: run.ok ? extractSeriesTypes(run.option) : [],
      durationMs: run.durationMs,
      error: run.ok ? undefined : run.error,
    }
  })

  // 每组保底注入(Q8):官方全灭的组补基础模板
  const okCountFor = (groupId: string) =>
    results.filter((r) => r.ok && r.groups.includes(groupId)).length
  const injected = new Set<string>()
  for (const g of CHART_GROUPS) {
    if (okCountFor(g.id) === 0 && BASELINE_TEMPLATES[g.id]) {
      const t = BASELINE_TEMPLATES[g.id]
      results.push({
        ...t,
        groups: [g.id],
        ok: true,
        seriesTypes: t.seriesTypes ?? [],
        durationMs: 0,
        thumb: null,
        baseline: true,
        error: undefined,
      })
      injected.add(g.id)
    }
  }

  // 汇总输出
  const groups = CHART_GROUPS.map((g) => {
    const all = results.filter((r) => r.groups.includes(g.id))
    const ok = all.filter((r) => r.ok)
    return {
      id: g.id,
      zh: g.zh,
      en: g.en,
      gl: g.gl ?? false,
      total: all.length,
      okCount: ok.length,
      examples: ok.map((r) => ({
        id: r.id,
        title: r.title,
        titleCN: r.titleCN,
        code: r.code,
        seriesTypes: r.seriesTypes,
        thumb: r.thumb,
        baseline: r.baseline ?? false,
      })),
    }
  })

  const coverage = {
    generatedAt: new Date().toISOString(),
    source: 'apache/echarts-examples gh-pages',
    total: results.length,
    okTotal: results.filter((r) => r.ok).length,
    failedTotal: results.filter((r) => !r.ok).length,
    baselineInjected: [...injected],
    emptyGroups: groups.filter((g) => g.examples.length === 0).map((g) => g.id),
    perGroup: groups.map((g) => ({ id: g.id, total: g.total, ok: g.okCount })),
    failedExamples: results.filter((r) => !r.ok).map((r) => ({ id: r.id, error: r.error })),
  }

  fs.writeFileSync(
    path.join(ROOT, 'data/examples.json'),
    JSON.stringify({ generatedAt: coverage.generatedAt, groups }, null, 2),
  )
  fs.writeFileSync(path.join(ROOT, 'data/coverage.json'), JSON.stringify(coverage, null, 2))

  // 收录示例的缩略图拷入库内(designer 画廊用;Vite ?url 装载,见 src/designer/thumbs.ts)
  const thumbDir = path.join(ROOT, 'data/thumb')
  fs.rmSync(thumbDir, { recursive: true, force: true })
  fs.mkdirSync(thumbDir, { recursive: true })
  let copied = 0
  for (const r of results) {
    if (!r.ok || !r.thumb) continue
    const base = r.thumb.startsWith('data-gl/') ? 'public/data-gl' : 'public/data'
    const src = path.join(dir, base, 'thumb', `${r.id}.webp`)
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(thumbDir, `${r.id}.webp`))
      copied++
    }
  }
  console.log(`缩略图拷入: ${copied} 张 → packages/chart-kit/data/thumb/`)

  console.log('\n=== 覆盖率 ===')
  for (const g of groups)
    console.log(
      `${String(g.okCount).padStart(3)} / ${String(g.total).padStart(3)}  ${g.id}${g.gl ? ' (GL)' : ''}${injected.has(g.id) ? '  [保底注入]' : ''}`,
    )
  console.log(
    `\n合计: ${coverage.okTotal}/${coverage.total} 收录, ${coverage.failedTotal} 被过滤(动态数据/外部依赖,二期随白名单重跑)`,
  )
  if (coverage.emptyGroups.length) {
    console.error(`仍为空的组(需人工补模板): ${coverage.emptyGroups.join(', ')}`)
    process.exitCode = 1
  }
}

void main()
