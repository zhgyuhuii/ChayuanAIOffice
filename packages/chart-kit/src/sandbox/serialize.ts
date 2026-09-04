/**
 * option 的函数安全序列化:
 * ECharts option 常含 formatter 等函数,无法结构化克隆跨 Worker 传递。
 * 约定:函数序列化为 { __chartkit_fn__: "<源码>" },主线程按需复活。
 *
 * 残余风险(有档):复活即在主线程执行任意 JS,与 ECharts 消费 formatter 的需要共存;
 * 渲染若迁入 Worker(OffscreenCanvas)则可消除,P2 评估。
 */

const FN_KEY = '__chartkit_fn__'

export function stringifyOption(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === 'function') return { [FN_KEY]: String(v) }
    return v
  })
}

export function parseOption(json: string): unknown {
  return JSON.parse(json, (_k, v) => {
    if (v && typeof v === 'object' && typeof v[FN_KEY] === 'string') {
      // 包一层括号同时兼容箭头函数与 function 声明/表达式
      return new Function(`return (${v[FN_KEY]})`)()
    }
    return v
  })
}
