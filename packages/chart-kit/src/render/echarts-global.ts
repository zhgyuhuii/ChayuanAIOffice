/**
 * 主页面 echarts 全局兜底:
 * option 函数(formatter/数据构造)若引用 `echarts` 全局,其作用域链解析
 * 取决于创建 realm——帧内编译的看帧的 window(见 eval-frame),主线程直解
 * 的看主页 window。三端页面 echarts 都是模块导入、从不挂 window,这里
 * 统一挂上(同一模块实例,零额外加载),消除 "echarts is not defined"。
 */

import * as echarts from 'echarts'

export function ensureEchartsGlobal(): void {
  try {
    const w = window as unknown as { echarts?: unknown }
    if (!w.echarts) w.echarts = echarts
  } catch {
    /* 非浏览器环境忽略 */
  }
}
