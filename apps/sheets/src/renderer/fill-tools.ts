/**
 * 数据处理组的纯函数内核（填充⌄ 各项 / 条件统计）：矩阵变换与公式拼装全部
 * 纯函数化，单测直接覆盖；ribbon-actions 负责取选区、写回与消息。
 */

type CellValue = string | number | boolean | null | undefined

export type Matrix = CellValue[][]

/** 向上填充：每列以选区最后一行（最下方单元格）为准，整体复制到该列。 */
export function fillUpMatrix(values: Matrix): Matrix {
  const height = values.length
  if (height === 0) return values
  const width = values[0]?.length ?? 0
  const source = values[height - 1] ?? []
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, (__, column) => source[column]),
  )
}

/** 向左填充：每行以选区最右一列为准，整体复制到该行。 */
export function fillLeftMatrix(values: Matrix): Matrix {
  return values.map((row) => {
    const last = row[row.length - 1] ?? null
    return row.map(() => last)
  })
}

/** 录入123序列：选区内按列（先向下再右移）填 1..N。 */
export function fillSeries123(height: number, width: number): number[][] {
  return Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (__, column) => column * height + row + 1),
  )
}

/**
 * 计算并录入排名：把每个值在该列中的名次（最大值为 1，RANK.EQ 语义——
 * 并列同名次、后继名次跳号）写入同一行的结果矩阵。
 */
export function rankColumn(values: CellValue[]): number[] {
  const nums = values
    .map((value, index) => ({ value: typeof value === 'number' && Number.isFinite(value) ? value : null, index }))
    .filter((entry): entry is { value: number; index: number } => entry.value !== null)
  const ranks = new Array<number>(values.length).fill(0)
  const sorted = [...nums].sort((a, b) => b.value - a.value)
  let previousRank = 0
  let previousValue = Number.NaN
  for (const [position, entry] of sorted.entries()) {
    const tied = position > 0 && entry.value === previousValue
    const rank = tied ? previousRank : position + 1
    ranks[entry.index] = rank
    previousRank = rank
    previousValue = entry.value
  }
  return ranks
}

/**
 * 填充空白单元格：选区内空单元格取同列上方最近的非空值；列首的空格
 * 无来源，保持空。
 */
export function fillBlanksFromAbove(values: Matrix): Matrix {
  return values.map((row, rowIndex) =>
    row.map((value, column) => {
      if (value !== null && value !== undefined && value !== '') return value
      for (let above = rowIndex - 1; above >= 0; above -= 1) {
        const candidate = values[above]?.[column]
        if (candidate !== null && candidate !== undefined && candidate !== '') return candidate
      }
      return value
    }),
  )
}

/**
 * 录入当前日期：支持 yyyy / yy / mm / m / dd / d 令牌（其余字符原样输出）。
 * 未识别的字母序列按原字符输出，避免吞掉分隔符。
 */
export function formatFillDate(date: Date, pattern: string): string {
  let out = ''
  for (let i = 0; i < pattern.length; ) {
    const rest = pattern.slice(i)
    const token = /^(yyyy|yy|mm|m|dd|d)/.exec(rest)
    if (!token) {
      out += pattern[i]
      i += 1
      continue
    }
    const t = token[0]
    if (t === 'yyyy') out += String(date.getFullYear())
    else if (t === 'yy') out += String(date.getFullYear() % 100).padStart(2, '0')
    else if (t === 'mm') out += String(date.getMonth() + 1).padStart(2, '0')
    else if (t === 'm') out += String(date.getMonth() + 1)
    else if (t === 'dd') out += String(date.getDate()).padStart(2, '0')
    else out += String(date.getDate())
    i += t.length
  }
  return out
}

/**
 * 批量插入文本：where = start（开头）/ mid（中间，位于 ceil(len/2) 之前）/
 * end（结尾）。数字先转字符串，结果回写为文本。
 */
export function insertTextAtPosition(value: CellValue, text: string, where: 'start' | 'mid' | 'end'): string {
  const base = value === null || value === undefined ? '' : String(value)
  if (text === '') return base
  if (where === 'start') return `${text}${base}`
  if (where === 'end') return `${base}${text}`
  const cut = Math.ceil(base.length / 2)
  return `${base.slice(0, cut)}${text}${base.slice(cut)}`
}

/**
 * 序列：等差 / 等比，起点取选区首格数值（缺省 1），stop 提供时值超过即截断，
 * 截断后的选区余格清空。返回与选区同尺寸的值矩阵。
 */
export function seriesValues(options: {
  readonly height: number
  readonly width: number
  readonly down: boolean
  readonly growth: boolean
  readonly step: number
  readonly stop: number | null
  readonly start: number
}): Matrix {
  const { height, width, down, growth, step, stop, start } = options
  const total = height * width
  const out: Matrix = Array.from({ length: height }, () => Array.from({ length: width }, () => null))
  for (let i = 0; i < total; i += 1) {
    const factor = growth ? Math.pow(step, i) : step * i
    const value = growth ? start * factor : start + factor
    if (stop !== null && value > stop) break
    const cell = down
      ? { row: i % height, column: Math.floor(i / height) }
      : { row: Math.floor(i / width), column: i % width }
    const rowOut = out[cell.row]
    if (rowOut) rowOut[cell.column] = value
  }
  return out
}

/**
 * 条件统计公式拼装：sum = SUMIF / average = AVERAGEIF / count = COUNTIF。
 * 文本条件加引号；数值裸写。区域引用原样透传（对话框负责合法性）。
 */
export function condStatsFormula(options: {
  readonly fn: 'sum' | 'average' | 'count'
  readonly criteriaRange: string
  readonly criteria: string
  readonly sumRange: string
}): string {
  const { fn, criteriaRange, criteria, sumRange } = options
  const quoted = /^-?\d+(\.\d+)?$/.test(criteria) || criteria.startsWith('=') ? criteria : `"${criteria.replace(/"/g, '""')}"`
  if (fn === 'count') return `=COUNTIF(${criteriaRange},${quoted})`
  const fnName = fn === 'sum' ? 'SUMIF' : 'AVERAGEIF'
  return `=${fnName}(${criteriaRange},${quoted},${sumRange})`
}
