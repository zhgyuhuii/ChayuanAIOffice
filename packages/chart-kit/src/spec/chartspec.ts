import { z } from 'zod'

/**
 * ChartSpec —— 图表公共契约(v1)
 *
 * 三入口收敛(设计器 UI / 画布双击 / LLM 工具调用)的统一产物:
 * - 标准档(type ∈ OOXML_CHART_TYPES 且无 option):落 OOXML chart XML + 内嵌工作簿,
 *   WPS/Office 打开可显示可编辑;样式字段只暴露 chart XML 可表达的子集(Q5 硬约束)。
 * - 扩展档(其余 type 或带 option):落 ECharts option JSON + PNG 快照,仅显示。
 *
 * 注意:engine 不由调用方显式指定,由 deriveEngine 按 type/option 推导,保证路由唯一。
 */

/** 标准档类型:可无损序列化为 ECMA-376 DrawingML chart 的 9 类(Q3/Q4 签定) */
export const OOXML_CHART_TYPES = [
  'line',
  'area',
  'bar',
  'pie',
  'doughnut',
  'scatter',
  'bubble',
  'radar',
  'candlestick',
  'combo',
] as const

/** 组合图里每个系列允许的类型(标准档内自由组合,映射到不同 c:*Chart plot) */
export const OOXML_SERIES_TYPES = ['line', 'area', 'bar', 'pie', 'scatter', 'bubble'] as const

/** 扩展档类型:ECharts 特有系列(无 OOXML 对应,option+PNG 持久化) */
export const ECHARTS_CHART_TYPES = [
  'boxplot',
  'heatmap',
  'graph',
  'lines',
  'tree',
  'treemap',
  'sunburst',
  'parallel',
  'sankey',
  'funnel',
  'gauge',
  'pictorialBar',
  'themeRiver',
  'calendar',
  'matrix',
  'chord',
  'custom',
  'map',
  'globe',
  'bar3D',
  'scatter3D',
  'surface',
  'map3D',
  'lines3D',
  'line3D',
  'scatterGL',
  'linesGL',
  'flowGL',
  'graphGL',
] as const

export const CHART_TYPES = [...OOXML_CHART_TYPES, ...ECHARTS_CHART_TYPES] as const

export type ChartType = (typeof CHART_TYPES)[number]
export type OoxmlChartType = (typeof OOXML_CHART_TYPES)[number]
export type EchartsChartType = (typeof ECHARTS_CHART_TYPES)[number]

/** K 线一根蜡烛的 [open, close, low, high] */
export const CandleTuple = z.tuple([z.number(), z.number(), z.number(), z.number()])

const CellValue = z.union([z.number(), z.null(), CandleTuple])

/** 标准数据形状:类别 × 系列矩阵(表格编辑器的服务对象,Q10) */
const StandardData = z.object({
  categories: z.array(z.union([z.string(), z.number()])).optional(),
  series: z
    .array(
      z.object({
        name: z.string().optional(),
        /** 组合图/combo 时允许逐系列指定;缺省继承 spec.type */
        type: z.enum(OOXML_SERIES_TYPES).optional(),
        values: z.array(CellValue),
      }),
    )
    .min(1),
})

/** 层级数据形状:旭日/树/矩形树/桑基(JSON 树编辑器的服务对象,Q10) */
export interface ChartTreeNode {
  name: string
  value?: number | undefined
  children?: ChartTreeNode[] | undefined
}
const TreeNode: z.ZodType<ChartTreeNode> = z.object({
  name: z.string(),
  value: z.number().optional(),
  children: z.lazy(() => z.array(TreeNode)).optional(),
})

/** 关系数据形状:关系图 nodes/links(一期只进代码编辑区,Q10) */
const GraphData = z.object({
  nodes: z.array(
    z.object({ id: z.string().optional(), name: z.string(), value: z.number().optional() }),
  ),
  links: z.array(
    z.object({
      source: z.union([z.string(), z.number()]),
      target: z.union([z.string(), z.number()]),
      value: z.number().optional(),
    }),
  ),
})

/** 受限样式字段:全部为 chart XML 可表达,杜绝 ECharts 特有样式(Q5) */
const RestrictedStyle = z.object({
  title: z.string().max(200).optional(),
  palette: z
    .array(z.string().regex(/^#[0-9a-fA-F]{6,8}$/))
    .max(36)
    .optional(),
  stacked: z.boolean().optional(),
  smooth: z.boolean().optional(),
  showLegend: z.boolean().optional(),
  legendPos: z.enum(['top', 'right', 'bottom', 'left']).optional(),
  showDataLabels: z.boolean().optional(),
  horizontal: z.boolean().optional(),
})

const ChartMeta = z.object({
  source: z.enum(['user', 'ai', 'example']).optional(),
  exampleId: z.string().optional(),
  createdAt: z.string().optional(),
})

export const ChartSpec = z.object({
  version: z.literal(1),
  type: z.enum(CHART_TYPES),
  title: z.string().max(200).optional(),
  data: StandardData.optional(),
  tree: TreeNode.optional(),
  graph: GraphData.optional(),
  /** 扩展档逃生舱:扩展类型允许直传(部分)option;标准档禁用(Q7) */
  option: z.unknown().optional(),
  style: RestrictedStyle.optional(),
  meta: ChartMeta.optional(),
})

export type ChartSpec = z.infer<typeof ChartSpec>
export type ChartSpecInput = z.input<typeof ChartSpec>

/** 由契约推导持久化路由:每张图只有一个事实源(Q3/Q4) */
export function deriveEngine(spec: ChartSpec): 'ooxml' | 'echarts' {
  const isStandardType = (OOXML_CHART_TYPES as readonly string[]).includes(spec.type)
  return isStandardType && spec.option === undefined ? 'ooxml' : 'echarts'
}

/** 供 LLM 工具调用(function calling)导出 JSON Schema(Q7) */
export function chartSpecJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ChartSpec, { io: 'input' }) as Record<string, unknown>
}
