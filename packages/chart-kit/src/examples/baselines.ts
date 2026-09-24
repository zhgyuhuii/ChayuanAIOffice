/**
 * 每组保底基础模板(Q8):官方示例在纯 JS 沙箱(禁网络/外部数据)下全灭的组,
 * 由采集管线注入这些自带内联数据、无外部依赖的模板,保证 39 组每组非空。
 *
 * 注意:模板不走沙箱试跑(部分需 echarts 全局/地图注册,在应用运行时环境可用);
 * coverage.json 的 baselineInjected 字段会标明哪些组用了保底。
 */

export interface BaselineTemplate {
  id: string
  title: string
  titleCN: string
  code: string
  seriesTypes?: string[]
}

export const BASELINE_TEMPLATES: Record<string, BaselineTemplate> = {
  lines: {
    id: 'lines-chartkit-basic',
    title: 'Basic Lines (Cartesian)',
    titleCN: '基础路径图(直角坐标系)',
    seriesTypes: ['lines'],
    code: `option = {
  title: { text: '基础路径图' },
  tooltip: {},
  xAxis: { type: 'value', min: 0, max: 10 },
  yAxis: { type: 'value', min: 0, max: 10 },
  series: [{
    type: 'lines',
    coordinateSystem: 'cartesian2d',
    data: [
      { coords: [[1, 1], [4, 6], [8, 2]] },
      { coords: [[2, 8], [6, 3], [9, 9]] },
      { coords: [[0, 5], [5, 5], [10, 5]] }
    ],
    polyline: false,
    lineStyle: { width: 3, curveness: 0.2 },
    emphasis: { lineStyle: { width: 5 } }
  }]
};`,
  },
  globe: {
    id: 'globe-chartkit-basic',
    title: 'Globe Basic (Procedural)',
    titleCN: '基础 3D 地球(程序纹理)',
    seriesTypes: ['globe'],
    code: `option = {
  title: { text: '基础 3D 地球' },
  globe: {
    baseTexture: '',
    heightTexture: '',
    displacementScale: 0.05,
    shading: 'lambert',
    viewControl: { autoRotate: true }
  },
  series: []
};`,
  },
  map3D: {
    id: 'map3d-chartkit-basic',
    title: 'Map3D Basic (Registered Map)',
    titleCN: '基础 3D 地图(需注册地图)',
    seriesTypes: ['map3D'],
    code: `option = {
  title: { text: '基础 3D 地图' },
  series: [{
    type: 'map3D',
    map: 'world',
    regionHeight: 2,
    shading: 'lambert',
    emphasis: { label: { show: true } }
  }]
};`,
  },
  line3D: {
    id: 'line3d-chartkit-basic',
    title: 'Basic Line3D (Helix)',
    titleCN: '基础 3D 折线图(螺旋线)',
    seriesTypes: ['line3D'],
    code: `const points = [];
for (let t = 0; t < Math.PI * 8; t += 0.05) {
  points.push([Math.cos(t) * 4 + 5, Math.sin(t) * 4 + 5, t * 0.6]);
}
option = {
  title: { text: '基础 3D 折线图' },
  tooltip: {},
  grid3D: { viewControl: { autoRotate: true } },
  xAxis3D: { type: 'value' },
  yAxis3D: { type: 'value' },
  zAxis3D: { type: 'value' },
  series: [{ type: 'line3D', data: points, lineStyle: { width: 4 } }]
};`,
  },
  scatter3D: {
    id: 'scatter3d-chartkit-basic',
    title: 'Basic Scatter3D (Procedural)',
    titleCN: '基础 3D 散点图(程序数据)',
    seriesTypes: ['scatter3D'],
    code: `const data = [];
for (let i = 0; i < 600; i++) {
  const t = i / 60;
  data.push([
    5 + Math.cos(t) * (t * 0.6) * 4,
    5 + Math.sin(t) * (t * 0.6) * 4,
    t * 1.5
  ]);
}
option = {
  title: { text: '基础 3D 散点图' },
  grid3D: { viewControl: { autoRotate: true } },
  xAxis3D: { type: 'value' },
  yAxis3D: { type: 'value' },
  zAxis3D: { type: 'value' },
  series: [{ type: 'scatter3D', data, symbolSize: 4 }]
};`,
  },
  lines3D: {
    id: 'lines3d-chartkit-basic',
    title: 'Basic Lines3D (Procedural Spirals)',
    titleCN: '基础 3D 路径图(程序螺旋线)',
    seriesTypes: ['lines3D'],
    code: `const data = [];
for (let k = 0; k < 3; k++) {
  const coords = [];
  for (let t = 0; t < Math.PI * 6; t += 0.08) {
    coords.push([5 + Math.cos(t + k * 2.1) * 4, 5 + Math.sin(t + k * 2.1) * 4, t * 0.8]);
  }
  data.push({ coords });
}
option = {
  title: { text: '基础 3D 路径图' },
  grid3D: { viewControl: { autoRotate: true } },
  xAxis3D: { type: 'value' },
  yAxis3D: { type: 'value' },
  zAxis3D: { type: 'value' },
  series: [{ type: 'lines3D', data, lineStyle: { width: 3 } }]
};`,
  },
  scatterGL: {
    id: 'scattergl-chartkit-basic',
    title: 'Basic ScatterGL (Procedural)',
    titleCN: '基础 GL 散点图(程序数据)',
    seriesTypes: ['scatterGL'],
    code: `const data = [];
for (let i = 0; i < 2000; i++) {
  const a = Math.random() * 6.28, r = Math.random() ** 0.5 * 8;
  data.push([5 + Math.cos(a) * r, 5 + Math.sin(a) * r, Math.random()]);
}
option = {
  title: { text: '基础 GL 散点图' },
  xAxis: { type: 'value', min: 0, max: 10 },
  yAxis: { type: 'value', min: 0, max: 10 },
  series: [{ type: 'scatterGL', data, symbolSize: 3 }]
};`,
  },
  linesGL: {
    id: 'linesgl-chartkit-basic',
    title: 'Basic LinesGL (Cartesian)',
    titleCN: '基础 GL 路径图(直角坐标系)',
    seriesTypes: ['linesGL'],
    code: `const data = [];
for (let i = 0; i < 60; i++) {
  const x = Math.random() * 10;
  data.push({ coords: [[x, 0], [x + (Math.random() - 0.5) * 4, 10]] });
}
option = {
  title: { text: '基础 GL 路径图' },
  xAxis: { type: 'value', min: 0, max: 10 },
  yAxis: { type: 'value', min: 0, max: 10 },
  series: [{ type: 'linesGL', coordinateSystem: 'cartesian2d', data, lineStyle: { width: 2, opacity: 0.6 } }]
};`,
  },
  flowGL: {
    id: 'flowgl-chartkit-basic',
    title: 'Basic FlowGL (Sine Field)',
    titleCN: '基础 GL 矢量场图(正弦场)',
    seriesTypes: ['flowGL'],
    code: `const data = [];
for (let x = 0; x <= 10; x += 0.5) {
  for (let y = 0; y <= 10; y += 0.5) {
    data.push([x, y, Math.sin(x) * Math.cos(y), Math.cos(x) * Math.sin(y)]);
  }
}
option = {
  title: { text: '基础 GL 矢量场图' },
  xAxis: { type: 'value', min: 0, max: 10 },
  yAxis: { type: 'value', min: 0, max: 10 },
  series: [{ type: 'flowGL', data, particleDensity: 4, particleSize: 2 }]
};`,
  },
  graphGL: {
    id: 'graphgl-chartkit-basic',
    title: 'Basic GraphGL (GPU Layout)',
    titleCN: '基础 GL 关系图(GPU 布局)',
    seriesTypes: ['graphGL'],
    code: `const nodes = [], links = [];
for (let i = 0; i < 120; i++) nodes.push({ name: 'n' + i });
for (let i = 0; i < 120; i++) {
  links.push({ source: i, target: Math.floor(Math.random() * 120) });
}
option = {
  title: { text: '基础 GL 关系图' },
  series: [{
    type: 'graphGL',
    nodes, links,
    layout: 'forceGPU',
    forceAtlas2: { GPU: true, steps: 5 },
    itemStyle: { color: '#5470c6' },
    lineStyle: { opacity: 0.3 },
    emphasis: { focus: 'adjacency' }
  }]
};`,
  },
}
