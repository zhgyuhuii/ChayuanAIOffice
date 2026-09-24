// echarts-gl(2.1.0)发布包不带类型声明;它只通过副作用注册 3D/GL 系列
declare module 'echarts-gl'

// Vite 的 ?raw 后缀导入(以字符串形式读入文件源码)
declare module '*?raw' {
  const src: string
  export default src
}

// Vite 的 ?url 后缀导入(资源 URL)
declare module '*?url' {
  const url: string
  export default url
}
