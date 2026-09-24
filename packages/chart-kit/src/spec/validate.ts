import {
  ChartSpec,
  ChartSpecInput,
  OOXML_CHART_TYPES,
  deriveEngine,
  type ChartSpec as ChartSpecType,
} from './chartspec'

export interface ChartSpecValidation {
  ok: boolean
  /** 推导出的持久化路由;校验失败时为 null */
  engine: 'ooxml' | 'echarts' | null
  /** 规整后的 spec(仅 ok 时存在) */
  spec?: ChartSpecType
  /** 人可读错误列表(zod 错误已展平) */
  errors: string[]
}

const TREE_TYPES = new Set(['tree', 'treemap', 'sunburst', 'sankey'])

/**
 * 校验 ChartSpec:zod 结构校验 + 跨字段规则。
 * 三入口(UI/双击/LLM)都必须过这里;LLM 产出校验失败时把 errors 回喂重试(Q7)。
 */
export function validateChartSpec(input: unknown): ChartSpecValidation {
  const parsed = ChartSpec.safeParse(input)
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    return { ok: false, engine: null, errors }
  }
  const spec = parsed.data
  const engine = deriveEngine(spec)
  const errors: string[] = []

  if (engine === 'ooxml') {
    if (!spec.data)
      errors.push('标准档(type ∈ OOXML 类型且无 option)必须提供 data(categories+series)')
    if (spec.tree) errors.push('标准档不支持 tree,层级数据请改用扩展档类型')
    if (spec.graph) errors.push('标准档不支持 graph,关系数据请改用 graph 类型')
  } else {
    const hasPayload =
      spec.data !== undefined ||
      spec.tree !== undefined ||
      spec.graph !== undefined ||
      spec.option !== undefined
    if (!hasPayload) errors.push('扩展档必须提供 data / tree / graph / option 至少之一')
  }

  if (spec.type === 'candlestick') {
    if (spec.data) {
      for (const [i, s] of spec.data.series.entries()) {
        if (!s.values.every((v) => Array.isArray(v))) {
          errors.push(
            `candlestick 的 series[${i}].values 每项必须是 [open, close, low, high] 四元组`,
          )
          break
        }
      }
    }
  }

  if (TREE_TYPES.has(spec.type) && spec.data && !spec.tree && spec.option === undefined) {
    errors.push(`${spec.type} 需要 tree 数据(或 option),平面 data 形状无法表达层级`)
  }

  if (errors.length > 0) return { ok: false, engine: null, errors }
  return { ok: true, engine, spec, errors: [] }
}

/** 便捷断言版:校验失败直接抛错(内部调用点用) */
export function assertChartSpec(input: ChartSpecInput | unknown): ChartSpecType {
  const v = validateChartSpec(input)
  if (!v.ok || !v.spec) throw new Error(`invalid ChartSpec: ${v.errors.join('; ')}`)
  return v.spec
}

export { OOXML_CHART_TYPES }
