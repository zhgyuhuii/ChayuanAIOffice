/**
 * 39 个分组的中英名称与排序(用户目录为权威,2026-09-04 签定)。
 * id 对齐 apache/echarts-examples 的 category 标签;GL 组映射自 chart-list-data-gl。
 */

export interface ChartGroupMeta {
  id: string
  zh: string
  en: string
  /** GL/3D 组:需 WebGL,缩略图在 data-gl/,示例在 ts/gl/(Q9 能力检测) */
  gl?: boolean
}

export const CHART_GROUPS: ChartGroupMeta[] = [
  { id: 'line', zh: '折线图', en: 'Line' },
  { id: 'bar', zh: '柱状图', en: 'Bar' },
  { id: 'pie', zh: '饼图', en: 'Pie' },
  { id: 'scatter', zh: '散点图', en: 'Scatter' },
  { id: 'map', zh: '地理坐标/地图', en: 'Geo/Map' },
  { id: 'candlestick', zh: 'K 线图', en: 'Candlestick' },
  { id: 'radar', zh: '雷达图', en: 'Radar' },
  { id: 'boxplot', zh: '盒须图', en: 'Boxplot' },
  { id: 'heatmap', zh: '热力图', en: 'Heatmap' },
  { id: 'graph', zh: '关系图', en: 'Graph' },
  { id: 'lines', zh: '路径图', en: 'Lines' },
  { id: 'tree', zh: '树图', en: 'Tree' },
  { id: 'treemap', zh: '矩形树图', en: 'Treemap' },
  { id: 'sunburst', zh: '旭日图', en: 'Sunburst' },
  { id: 'parallel', zh: '平行坐标系', en: 'Parallel' },
  { id: 'sankey', zh: '桑基图', en: 'Sankey' },
  { id: 'funnel', zh: '漏斗图', en: 'Funnel' },
  { id: 'gauge', zh: '仪表盘', en: 'Gauge' },
  { id: 'pictorialBar', zh: '象形柱图', en: 'PictorialBar' },
  { id: 'themeRiver', zh: '主题河流图', en: 'ThemeRiver' },
  { id: 'calendar', zh: '日历坐标系', en: 'Calendar' },
  { id: 'matrix', zh: '矩阵坐标系', en: 'Matrix' },
  { id: 'chord', zh: '和弦图', en: 'Chord' },
  { id: 'custom', zh: '自定义系列', en: 'Custom' },
  { id: 'dataset', zh: '数据集', en: 'Dataset' },
  { id: 'dataZoom', zh: '数据区域缩放', en: 'DataZoom' },
  { id: 'graphic', zh: '图形组件', en: 'Graphic' },
  { id: 'rich', zh: '富文本', en: 'Rich Text' },
  { id: 'globe', zh: '3D 地球', en: 'Globe', gl: true },
  { id: 'bar3D', zh: '3D 柱状图', en: 'Bar3D', gl: true },
  { id: 'scatter3D', zh: '3D 散点图', en: 'Scatter3D', gl: true },
  { id: 'surface', zh: '3D 曲面', en: 'Surface', gl: true },
  { id: 'map3D', zh: '3D 地图', en: 'Map3D', gl: true },
  { id: 'lines3D', zh: '3D 路径图', en: 'Lines3D', gl: true },
  { id: 'line3D', zh: '3D 折线图', en: 'Line3D', gl: true },
  { id: 'scatterGL', zh: 'GL 散点图', en: 'ScatterGL', gl: true },
  { id: 'linesGL', zh: 'GL 路径图', en: 'LinesGL', gl: true },
  { id: 'flowGL', zh: 'GL 矢量场图', en: 'FlowGL', gl: true },
  { id: 'graphGL', zh: 'GL 关系图', en: 'GraphGL', gl: true },
]

/** 仓库 category 标签 → 规范分组 id(GL 侧大小写不统一) */
export function canonicalGroupId(category: string): string | null {
  const hit = CHART_GROUPS.find((g) => g.id.toLowerCase() === category.toLowerCase())
  return hit ? hit.id : null
}
