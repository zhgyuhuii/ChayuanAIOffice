/**
 * 条件格式富菜单的数据表：数据条 / 色阶 / 图标集画廊与真正落规则用的
 * 参数共用这一份（Excel/WPS 画廊同款预设），菜单渲染与 cf-* 命令处理
 * 不会各画各的。
 */

/** 数据条预设：Excel 渐变 6 + 实心 6，色值取 Excel 内置规则。 */
export const DATA_BAR_PRESETS: ReadonlyArray<{
  readonly id: string
  readonly color: string
  readonly solid: boolean
}> = [
  { id: 'grad-blue', color: '#638EC6', solid: false },
  { id: 'grad-green', color: '#63C384', solid: false },
  { id: 'grad-red', color: '#FF7285', solid: false },
  { id: 'grad-orange', color: '#FFB628', solid: false },
  { id: 'grad-lightblue', color: '#87D0F4', solid: false },
  { id: 'grad-purple', color: '#9D6FB6', solid: false },
  { id: 'solid-blue', color: '#4472C4', solid: true },
  { id: 'solid-green', color: '#5FAA71', solid: true },
  { id: 'solid-red', color: '#E14A54', solid: true },
  { id: 'solid-orange', color: '#ED9A28', solid: true },
  { id: 'solid-lightblue', color: '#54B6E4', solid: true },
  { id: 'solid-purple', color: '#8C5BA8', solid: true },
]

/** 色阶预设：三色阶 6 + 两色阶 4（Excel 内置规则同款）。 */
export const COLOR_SCALE_PRESETS: ReadonlyArray<{
  readonly id: string
  readonly stops: readonly [string, string | null, string]
}> = [
  { id: 'gwr', stops: ['#63BE7B', '#FFEB84', '#F8696B'] },
  { id: 'rwg', stops: ['#F8696B', '#FFEB84', '#63BE7B'] },
  { id: 'gwr-white', stops: ['#63BE7B', '#FFFFFF', '#F8696B'] },
  { id: 'rwr-white', stops: ['#F8696B', '#FFFFFF', '#63BE7B'] },
  { id: 'bwr', stops: ['#5A8AC6', '#FCFCFF', '#F8696B'] },
  { id: 'rwb', stops: ['#F8696B', '#FCFCFF', '#5A8AC6'] },
  { id: 'wr', stops: ['#FFFFFF', null, '#F8696B'] },
  { id: 'wg', stops: ['#FFFFFF', null, '#63BE7B'] },
  { id: 'wb', stops: ['#FFFFFF', null, '#5A8AC6'] },
  { id: 'wk', stops: ['#FFFFFF', null, '#1F1F1F'] },
]

/** 图标集预设：分组与 Univer IIconSetType 对齐，菜单里用同构 SVG 预览。 */
export type IconSetPreset = {
  readonly id: string
  readonly iconType: string
  readonly count: number
  readonly group: 'direction' | 'shape' | 'mark' | 'rating'
}

export const ICON_SET_PRESETS: ReadonlyArray<IconSetPreset> = [
  { id: '3arrows', iconType: '3Arrows', count: 3, group: 'direction' },
  { id: '3arrows-gray', iconType: '3ArrowsGray', count: 3, group: 'direction' },
  { id: '4arrows', iconType: '4Arrows', count: 4, group: 'direction' },
  { id: '5arrows', iconType: '5Arrows', count: 5, group: 'direction' },
  { id: '3traffic', iconType: '3TrafficLights1', count: 3, group: 'shape' },
  { id: '3signs', iconType: '3Signs', count: 3, group: 'shape' },
  { id: '4traffic', iconType: '4TrafficLights', count: 4, group: 'shape' },
  { id: '5quarters', iconType: '5Quarters', count: 5, group: 'shape' },
  { id: '3flags', iconType: '3Flags', count: 3, group: 'mark' },
  { id: '3symbols', iconType: '3Symbols', count: 3, group: 'mark' },
  { id: '3symbols2', iconType: '3Symbols2', count: 3, group: 'mark' },
  { id: '3stars', iconType: '3Stars', count: 3, group: 'rating' },
  { id: '4rating', iconType: '4Rating', count: 4, group: 'rating' },
  { id: '5rating', iconType: '5Rating', count: 5, group: 'rating' },
  { id: '5boxes', iconType: '5Boxes', count: 5, group: 'rating' },
]

/** 突出显示单元格规则 / 项目选取规则的格式预设（Excel 六件套）。 */
export const CF_HL_STYLE_PRESETS: ReadonlyArray<{
  readonly id: string
  readonly labelKey: string
  readonly fill: string | null
  readonly ink: string | null
  readonly border: string | null
}> = [
  { id: 'light-red-text', labelKey: 'appCfStyleLightRedText', fill: '#FFC7CE', ink: '#9C0006', border: null },
  { id: 'light-yellow-text', labelKey: 'appCfStyleLightYellowText', fill: '#FFEB9C', ink: '#9C6500', border: null },
  { id: 'light-green-text', labelKey: 'appCfStyleLightGreenText', fill: '#C6EFCE', ink: '#006100', border: null },
  { id: 'light-red', labelKey: 'appCfStyleLightRed', fill: '#FFC7CE', ink: null, border: null },
  { id: 'red-text', labelKey: 'appCfStyleRedText', fill: null, ink: '#9C0006', border: null },
  { id: 'red-border', labelKey: 'appCfStyleRedBorder', fill: null, ink: null, border: '#FF0000' },
]

export function cfHlStyleOf(id: string): (typeof CF_HL_STYLE_PRESETS)[number] | null {
  return CF_HL_STYLE_PRESETS.find((preset) => preset.id === id) ?? null
}

export function colorScaleStopsOf(id: string): readonly [string, string | null, string] | null {
  return COLOR_SCALE_PRESETS.find((preset) => preset.id === id)?.stops ?? null
}

export function dataBarOf(id: string): { color: string; solid: boolean } | null {
  const preset = DATA_BAR_PRESETS.find((entry) => entry.id === id)
  return preset ? { color: preset.color, solid: preset.solid } : null
}

export function iconSetOf(id: string): IconSetPreset | null {
  return ICON_SET_PRESETS.find((preset) => preset.id === id) ?? null
}
