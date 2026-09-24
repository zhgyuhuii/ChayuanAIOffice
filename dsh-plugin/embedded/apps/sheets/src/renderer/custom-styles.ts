/**
 * 用户自定义样式（localStorage 持久化）：新建表格样式 / 新建数据透视表样式 /
 * 新建单元格样式三张对话框共用的存取层。表格样式只存颜色骨架（表头填充 /
 * 镶边行填充），套用时按选区逐行落成直接格式——保存管线尚不支持把自定义
 * 样式写成 xlsx dxfs，故自定义样式不走 xl/tables 命名样式。
 */
import type { CellFormatPatch } from '@chatoffice/xlsx-gateway/domain/workbook-dsl'

export interface CustomTableStyle {
  readonly id: string
  readonly name: string
  readonly kind: 'table' | 'pivot'
  readonly headerFill: string
  readonly bandFill: string | null
}

export interface CustomCellStyle {
  readonly id: string
  readonly name: string
  readonly patch: CellFormatPatch
}

const TABLE_KEY = 'sheets-custom-table-styles'
const CELL_KEY = 'sheets-custom-cell-styles'

const TABLE_LIMIT = 40
const CELL_LIMIT = 60

function readList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function writeList<T>(key: string, list: readonly T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(0, 200)))
  } catch {
    /* quota / privacy mode: keep the style session-only */
  }
}

export function listCustomTableStyles(): CustomTableStyle[] {
  return readList<CustomTableStyle>(TABLE_KEY)
}

export function listCustomCellStyles(): CustomCellStyle[] {
  return readList<CustomCellStyle>(CELL_KEY)
}

export function saveCustomTableStyle(style: CustomTableStyle): CustomTableStyle[] {
  const list = listCustomTableStyles().filter(
    (entry) => !(entry.id === style.id || (entry.kind === style.kind && entry.name === style.name)),
  )
  const next = [{ ...style }, ...list].slice(0, TABLE_LIMIT)
  writeList(TABLE_KEY, next)
  return next
}

export function saveCustomCellStyle(style: CustomCellStyle): CustomCellStyle[] {
  const list = listCustomCellStyles().filter(
    (entry) => entry.id !== style.id && entry.name !== style.name,
  )
  const next = [{ ...style }, ...list].slice(0, CELL_LIMIT)
  writeList(CELL_KEY, next)
  return next
}

export function getCustomTableStyle(id: string): CustomTableStyle | null {
  return listCustomTableStyles().find((entry) => entry.id === id) ?? null
}

export function getCustomCellStyle(id: string): CustomCellStyle | null {
  return listCustomCellStyles().find((entry) => entry.id === id) ?? null
}

/// 合并样式（WPS 合并样式）：按名称归并自定义单元格样式，重名保留最新一条。
/// 返回归并掉的数量。
export function mergeCustomCellStyles(): number {
  const list = listCustomCellStyles()
  const byName = new Map<string, CustomCellStyle>()
  for (const entry of list) byName.set(entry.name, entry)
  if (byName.size === list.length) return 0
  writeList(CELL_KEY, [...byName.values()])
  return list.length - byName.size
}

export function clearCustomStylesForTests(): void {
  try {
    localStorage.removeItem(TABLE_KEY)
    localStorage.removeItem(CELL_KEY)
  } catch {
    /* ignore */
  }
}
