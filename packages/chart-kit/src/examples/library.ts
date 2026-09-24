/**
 * 示例库访问层:读取采集管线生成的 data/examples.json(Q8)。
 * 数据由 `npm run harvest -w @chatoffice/chart-kit` 重新生成,
 * 提交入库保证构建可复现(Q13 版本锁定同理)。
 */

import libraryData from '../../data/examples.json'
import { CHART_GROUPS, type ChartGroupMeta } from './taxonomy'

export interface LibraryExample {
  id: string
  title: string
  titleCN: string
  code: string
  seriesTypes: string[]
  thumb: string | null
  baseline: boolean
}

export interface LibraryGroup {
  id: string
  zh: string
  en: string
  gl: boolean
  examples: LibraryExample[]
}

interface LibraryData {
  generatedAt: string
  groups: Array<{
    id: string
    zh: string
    en: string
    gl: boolean
    total: number
    okCount: number
    examples: LibraryExample[]
  }>
}

const data = libraryData as unknown as LibraryData

/** 全部分组(按 taxonomy 顺序),含保底注入的模板 */
export function getLibraryGroups(): LibraryGroup[] {
  return data.groups.map((g) => ({ id: g.id, zh: g.zh, en: g.en, gl: g.gl, examples: g.examples }))
}

export function findGroup(id: string): LibraryGroup | undefined {
  return getLibraryGroups().find((g) => g.id === id)
}

export function findExample(
  id: string,
): { group: LibraryGroup; example: LibraryExample } | undefined {
  for (const group of getLibraryGroups()) {
    const example = group.examples.find((e) => e.id === id)
    if (example) return { group, example }
  }
  return undefined
}

/** 供设计器侧栏分组树使用:分组元数据 + 示例数 */
export function getGroupSummaries(): Array<ChartGroupMeta & { count: number }> {
  return getLibraryGroups().map((g) => {
    const meta = CHART_GROUPS.find((m) => m.id === g.id) ?? { id: g.id, zh: g.zh, en: g.en }
    return { ...meta, count: g.examples.length }
  })
}

export const libraryGeneratedAt = data.generatedAt
