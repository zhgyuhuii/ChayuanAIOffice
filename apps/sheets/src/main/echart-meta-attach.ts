/**
 * 重开恢复 echart 元数据:sheets 的 visuals 由 Rust sidecar 解析,它不认识
 * 我们写在 drawing descr 里的 `chatoffice-echart:` 指针与 xl/echarts sidecar。
 * 打开后在 JS 侧补一道:抽取 drawing/rels/sidecar 部件,按媒体路径
 * (锚点 r:embed→rels target ↔ visual.mediaPath)匹配,把 option/code/数据表
 * 挂回 visual.echartMeta——图表在表格端即可双击回显编辑。
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { XlsxSidecarClient } from './xlsx-sidecar-client'
import type { WorkbookFile } from '../shared/desktop-api'

const manifestSchema = z.object({
  entries: z.array(z.object({ name: z.string() })),
})

/// readEntries 落盘为平铺的 entry-N.bin,返回 archive 名 → 磁盘路径的映射。
const extractedSchema = z.object({
  entries: z.array(z.object({ name: z.string(), path: z.string() })),
})

interface EchartSidecar {
  option: string
  code: string | null
  groupId: string
  data: { columns: string[]; rows: Array<Array<string | number | null>> } | null
}

const ANCHOR_PATTERN =
  /<([A-Za-z_][\w.-]*:)?(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[\s\S]*?<\/\1\2>/g

/** 相对 target(' ../media/image1.png') → 规范包路径('xl/media/image1.png') */
function normalizePackagePath(baseDir: string, target: string): string {
  if (target.startsWith('/xl/')) return target.slice(1)
  const stack: string[] = baseDir.split('/')
  for (const part of target.split('/')) {
    if (part === '.' || part === '') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

export async function attachEchartMetadata(
  client: XlsxSidecarClient,
  snapshotPath: string,
  file: WorkbookFile,
): Promise<WorkbookFile> {
  const hasEchartVisual = file.visuals.some((v) => v.kind === 'image')
  if (!hasEchartVisual) return file

  const manifest = manifestSchema.parse(await client.archiveManifest(snapshotPath))
  const names = manifest.entries.map((e) => e.name)
  const drawings = names.filter((n) => /^xl\/drawings\/drawing\d+\.xml$/.test(n))
  const rels = names.filter((n) => /^xl\/drawings\/_rels\/drawing\d+\.xml\.rels$/.test(n))
  const sidecars = names.filter((n) => /^xl\/echarts\/echart\d+\.json$/.test(n))
  if (drawings.length === 0 || sidecars.length === 0) return file

  const outDir = await mkdtemp(join(tmpdir(), 'ck-echart-'))
  try {
    // readEntries 落盘的是平铺的 entry-N.bin(返回 name→path 映射),必须按
    // 映射读——按包内相对路径 join(outDir, name) 永远读不到,echartMeta
    // 也就从未挂回,保存重开后双击回显一直失效。
    const extracted = extractedSchema.parse(
      await client.readEntries({
        path: snapshotPath,
        entries: [...drawings, ...rels, ...sidecars],
        outputDir: outDir,
      }),
    )
    const partByPath = new Map(extracted.entries.map((entry) => [entry.name, entry.path]))
    const readPart = async (name: string): Promise<string | null> => {
      const path = partByPath.get(name)
      if (path === undefined) return null
      return readFile(path, 'utf8').catch(() => null)
    }

    // sidecar 内容
    const sidecarByPath = new Map<string, EchartSidecar>()
    for (const path of sidecars) {
      try {
        const content = await readPart(path)
        if (content === null) continue
        const parsed = JSON.parse(content) as EchartSidecar
        if (parsed && typeof parsed.option === 'string') sidecarByPath.set(path, parsed)
      } catch {
        /* 损坏的 sidecar 忽略 */
      }
    }
    if (sidecarByPath.size === 0) return file

    // 锚点 descr 指针 + r:embed → mediaPath 映射
    const metaByMediaPath = new Map<string, EchartSidecar>()
    for (const drawingPath of drawings) {
      const xml = await readPart(drawingPath)
      if (!xml || !xml.includes('chatoffice-echart:')) continue
      const relsPath = `xl/drawings/_rels/${drawingPath.split('/').pop()}.rels`
      const relsXml = await readPart(relsPath)
      const relTarget = new Map<string, string>()
      if (relsXml) {
        for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
          const row = m[0]
          const id = /Id="([^"]+)"/.exec(row)?.[1]
          const target = /Target="([^"]+)"/.exec(row)?.[1]
          if (id && target) relTarget.set(id, target)
        }
      }
      const baseDir = drawingPath.split('/').slice(0, -1).join('/')
      for (const anchor of xml.matchAll(ANCHOR_PATTERN)) {
        const anchorXml = anchor[0]
        const pointer = /\bdescr="chatoffice-echart:([^"]+)"/.exec(anchorXml)?.[1]
        if (!pointer) continue
        const sidecar = sidecarByPath.get(pointer)
        if (!sidecar) continue
        const embed = /\s[\w.-]+:embed="([^"]+)"/.exec(anchorXml)?.[1]
        const target = embed ? relTarget.get(embed) : undefined
        if (!target) continue
        metaByMediaPath.set(normalizePackagePath(baseDir, target), sidecar)
      }
    }
    if (metaByMediaPath.size === 0) return file

    // 挂回 visual(mediaPath 可能带前导斜杠,双侧归一)
    let attached = 0
    const visuals = file.visuals.map((visual) => {
      if (visual.kind !== 'image' || !visual.mediaPath) return visual
      const key = visual.mediaPath.replace(/^\//, '')
      const meta = metaByMediaPath.get(key)
      if (!meta || visual.echartMeta) return visual
      attached += 1
      return {
        ...visual,
        echartMeta: {
          optionJson: meta.option,
          code: meta.code ?? null,
          groupId: meta.groupId ?? 'custom',
          data: meta.data ?? null,
        },
      }
    })
    if (attached === 0) return file
    return { ...file, visuals }
  } finally {
    await rm(outDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
