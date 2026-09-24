/**
 * 数据兼容层(2026-09-04 签定的"数据兼容"增强):
 * 1. toFlatTable:任意 option → 扁平数据表(平面表或层级列展平),
 *    写进 echart sidecar,让扩展图表的数据不被格式层锁死(可导出/跨端加工);
 * 2. chartEx 数据模型 → ECharts option 组装器(cx:strDim 多 lvl 即层级树,
 *    读端把 WPS 新版/Excel 2016+ 的瀑布/旭日/树图文件转成我们的活图表)。
 */

import type { ChartTreeNode } from '../spec/chartspec'

export interface FlatTable {
  /** 列名(层级数据的列名=各层名称字段) */
  columns: string[]
  /** 行数据,与 columns 对齐 */
  rows: Array<Array<string | number | null>>
}

/** 从 option 提取扁平表:平面类目系 → 类别+系列;层级树 → 层级列+值 */
export function toFlatTable(option: unknown, seriesName = '数值'): FlatTable | null {
  if (!option || typeof option !== 'object') return null
  const o = option as Record<string, unknown>

  // 层级族(sunburst/treemap/tree):展平树为 层级列+值
  const series = Array.isArray(o.series) ? (o.series as Array<Record<string, unknown>>) : []
  const treeData = series.find((s) => {
    const t = s.type
    return t === 'sunburst' || t === 'treemap' || (t === 'tree' && Array.isArray(s.data))
  })?.data
  if (Array.isArray(treeData) && treeData.length > 0 && typeof treeData[0] === 'object') {
    const rows: FlatTable['rows'] = []
    let depth = 1
    const walk = (nodes: unknown[], path: string[]) => {
      for (const n of nodes) {
        if (!n || typeof n !== 'object') continue
        const node = n as { name?: unknown; value?: unknown; children?: unknown }
        const name = typeof node.name === 'string' ? node.name : ''
        if (Array.isArray(node.children) && node.children.length > 0) {
          walk(node.children, [...path, name])
        } else if (typeof node.value === 'number') {
          rows.push([...path, name, node.value])
          depth = Math.max(depth, path.length + 1)
        }
      }
    }
    walk(treeData, [])
    if (rows.length === 0) return null
    return {
      columns: Array.from({ length: depth }, (_, i) => `层级${i + 1}`).concat(['值']),
      rows,
    }
  }

  // 平面族(bar/line):xAxis 类目 + 数值系列
  const xAxis = o.xAxis as Record<string, unknown> | undefined
  if (!xAxis || xAxis.type !== 'category' || !Array.isArray(xAxis.data)) return null
  const cats = xAxis.data.map((c) => String(c))
  const numSeries: string[] = []
  const numRows: FlatTable['rows'] = cats.map(() => [] as Array<number | null>)
  for (const s of series) {
    const data = s?.data
    if (!Array.isArray(data)) continue
    numSeries.push(
      typeof s.name === 'string' && s.name ? s.name : `${seriesName}${numSeries.length + 1}`,
    )
    data.forEach((v, i) => {
      const n =
        typeof v === 'number'
          ? v
          : v !== null && typeof v === 'object' && 'value' in (v as object)
            ? (v as { value: unknown }).value
            : null
      if (numRows[i]) numRows[i].push(typeof n === 'number' ? n : null)
    })
  }
  if (numSeries.length === 0) return null
  return { columns: ['类别', ...numSeries], rows: cats.map((c, i) => [c, ...(numRows[i] ?? [])]) }
}

/** 扁平表(层级列+值)→ 树(sunburst/treemap 通用) */
export function flatTableToTree(table: FlatTable): ChartTreeNode | null {
  if (table.columns.length < 2) return null
  const valueIdx = table.columns.length - 1
  const levelIdx = Array.from({ length: valueIdx }, (_, i) => i)
  const root: ChartTreeNode = { name: 'root', children: [] }
  for (const row of table.rows) {
    let cur = root
    for (const li of levelIdx) {
      const name = String(row[li] ?? '')
      if (!name) break
      cur.children ??= []
      let next = cur.children.find((c) => c.name === name)
      if (!next) {
        next = { name }
        cur.children.push(next)
      }
      cur = next
    }
    const v = row[valueIdx]
    if (typeof v === 'number') cur.value = (cur.value ?? 0) + v
  }
  return root.children?.length ? root : null
}

/* ---------------- chartEx 读端组装 ---------------- */

export interface ChartExDataBlock {
  /** strDim 各层缓存(层级数据的层列表;平面数据=单层类别) */
  categoryLevels: string[][]
  /** numDim 数值缓存(与最内层类别对齐) */
  values: number[]
  /** cx:f 引用的区间(如 Sheet1!$A$2:$C$7) */
  formula?: string
}

/** chartEx 的 layoutId/元素名 → 我们的扩展组 id */
export function chartExGroupOf(layoutId: string): string {
  const map: Record<string, string> = {
    sunburst: 'sunburst',
    treemap: 'treemap',
    funnel: 'funnel',
    waterfall: 'bar',
    boxplot: 'boxplot',
    histogram: 'custom',
    pareto: 'custom',
    regionMap: 'map',
  }
  return map[layoutId] ?? 'custom'
}

/** chartEx 数据块 → ECharts option(旭日/树图走树,其余走类目+值) */
export function optionFromChartEx(
  layoutId: string,
  data: ChartExDataBlock,
  seriesName = '系列 1',
): Record<string, unknown> | null {
  const { categoryLevels, values } = data
  if (categoryLevels.length === 0 || values.length === 0) return null

  if (layoutId === 'sunburst' || layoutId === 'treemap') {
    // 多层类别 → 树;最内层类别即叶子名
    const leafNames = categoryLevels[categoryLevels.length - 1] ?? []
    const root: ChartTreeNode = { name: 'root', children: [] }
    leafNames.forEach((leaf, i) => {
      let cur = root
      for (let lvl = 0; lvl < categoryLevels.length; lvl++) {
        const name = lvl === categoryLevels.length - 1 ? leaf : ((categoryLevels[lvl] ?? [])[i] ?? '')
        if (!name) continue
        cur.children ??= []
        let next = cur.children.find((c) => c.name === name)
        if (!next) {
          next = lvl === categoryLevels.length - 1 ? { name, value: values[i] ?? 0 } : { name }
          cur.children.push(next)
        }
        cur = next
      }
    })
    return {
      series: [
        {
          type: layoutId,
          data: root.children,
          radius: layoutId === 'sunburst' ? ['15%', '85%'] : undefined,
        },
      ],
    }
  }

  // 平面类目(瀑布/漏斗/箱线等):最内层做类别
  const cats = categoryLevels[categoryLevels.length - 1]
  const typeMap: Record<string, string> = {
    waterfall: 'bar',
    funnel: 'funnel',
    boxplot: 'boxplot',
    histogram: 'bar',
    pareto: 'bar',
    regionMap: 'map',
  }
  return {
    xAxis: { type: 'category', data: cats },
    yAxis: { type: 'value' },
    series: [{ type: typeMap[layoutId] ?? 'bar', name: seriesName, data: values }],
  }
}
