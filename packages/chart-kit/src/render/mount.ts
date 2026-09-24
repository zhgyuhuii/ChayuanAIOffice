/**
 * ECharts 画布挂载器(框架无关 DOM):
 * 文档/表格/演示画布上的扩展组图表 = 活渲染 + 视口外切快照(Q2)。
 * 快照同时是 WPS/Office 里的显示形态本身(Q3),由调用方持久化。
 *
 * 两类特殊路由:
 * - GL/3D:渲染进 CSP 豁免同源 iframe(宿主页 CSP 会拦 claygl 的
 *   new Function),见 gl-frame-bridge;
 * - geo/map:option 引用的地图名先经内置 GeoJSON 注册(china/world)。
 *
 * 浏览器专用(依赖 DOM/ECharts);Node 侧请走 ./spec、./sandbox 入口。
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../types/echarts-gl.d.ts" />
import * as echarts from 'echarts'
import { parseOptionSmart } from './revive'
import { GlFrame } from './gl-frame-bridge'
import { ensureMapsForOption } from './maps'
import { ensureEchartsGlobal } from './echarts-global'

export interface EchartMountOptions {
  /** option 的函数安全序列化串(__chartkit_fn__ 标记);载入时解析 */
  optionJson?: string | null
  /** 静态快照 URL(dataUrl 或文件);视口外/降级时显示 */
  snapshotUrl?: string | null
  /** GL/3D 组:渲染进 CSP 豁免帧(宿主页 CSP 会拦 claygl 的 eval) */
  gl?: boolean
  /** 容器高度 px(echarts 需要显式高度);默认 320 */
  heightPx?: number
  /** 视口外提前激活的边距 px;默认 240 */
  rootMarginPx?: number
}

export interface EchartHandle {
  /** 更新 option(函数安全串) */
  setOptionJson(optionJson: string): void
  /** 手动激活活渲染(如双击进入编辑) */
  activate(): void
  /** 手动降级为快照显示 */
  deactivate(): void
  dispose(): void
}

/** 粗判 option 是否用到 GL/3D 系列(挂载侧兜底;设计器侧按组别精确判断) */
export function optionNeedsGl(option: unknown): boolean {
  if (!option || typeof option !== 'object') return false
  const o = option as Record<string, unknown>
  if ('globe' in o || 'grid3D' in o || 'geo3D' in o) return true
  const series = o.series
  if (!Array.isArray(series)) return false
  return series.some((s) => {
    if (!s || typeof s !== 'object') return false
    const t = (s as { type?: unknown }).type
    return typeof t === 'string' && /(?:3D|GL)$/.test(t)
  })
}

export function mountEchart(container: HTMLElement, opts: EchartMountOptions = {}): EchartHandle {
  const heightPx = opts.heightPx ?? 320
  container.classList.add('ck-echart')
  container.style.height = `${heightPx}px`

  const live = document.createElement('div')
  live.className = 'ck-echart-live'
  live.style.height = '100%'
  const snapshot = document.createElement('img')
  snapshot.className = 'ck-echart-snapshot'
  snapshot.alt = ''
  snapshot.draggable = false
  if (opts.snapshotUrl) snapshot.src = opts.snapshotUrl
  container.append(live, snapshot)

  let instance: ReturnType<typeof echarts.init> | null = null
  let frame: GlFrame | null = null
  let currentJson = opts.optionJson ?? null
  let active = false
  let disposed = false

  const showLive = () => {
    live.style.display = ''
    snapshot.style.display = 'none'
  }
  const showSnapshot = () => {
    live.style.display = 'none'
    if (opts.snapshotUrl) snapshot.style.display = ''
    else showLive() // 无快照兜底:宁可活渲染也不能开天窗
  }

  const applyOption = async (optionJson: string) => {
    const option = await parseOptionSmart(optionJson)
    if (frame) await frame.update(option, container.clientWidth || 640, heightPx)
    else if (instance) instance.setOption(option as never)
  }

  const ensureInstance = async () => {
    if (instance || frame || disposed) return
    const option = currentJson ? await parseOptionSmart(currentJson) : null
    if (disposed) return
    // GL 判定:调用方分组标记优先,option 内容兜底(3D 系列/grid3D 等)
    const useFrame = opts.gl === true || optionNeedsGl(option)
    if (useFrame) {
      frame = new GlFrame(live)
      const ok = await frame.ready
      if (disposed) return
      if (!ok) {
        frame.dispose()
        frame = null
        return // 帧不可用:停留在快照(Q9 降级)
      }
    } else {
      // 非帧模式:先注册内置地图(china/world)再首绘
      if (option) await ensureMapsForOption(option)
      if (disposed) return
      ensureEchartsGlobal()
      try {
        instance = echarts.init(live)
        instance.resize({ width: container.clientWidth, height: heightPx })
        if (option) instance.setOption(option as never)
      } catch (e) {
        // 渲染失败(如 formatter 引用缺失全局):退回快照,绝不让单图故障
        // 冒泡成 React 卸载整树(白屏)
        console.warn('[chart-kit] canvas render failed, falling back to snapshot:', e)
        try {
          instance?.dispose()
        } catch {
          /* dispose 幂等 */
        }
        instance = null
        return
      }
      return
    }
    if (currentJson) {
      try {
        await applyOption(currentJson)
      } catch (e) {
        console.warn('[chart-kit] frame/canvas apply failed:', e)
        active = false
        showSnapshot()
      }
    }
  }

  const activate = () => {
    active = true
    void ensureInstance().then(() => {
      if (active) showLive()
    })
  }
  const deactivate = () => {
    active = false
    showSnapshot()
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) activate()
        else deactivate()
      }
    },
    { rootMargin: `${opts.rootMarginPx ?? 240}px` },
  )
  io.observe(container)

  const ro = new ResizeObserver(() => {
    const w = container.clientWidth
    instance?.resize({ width: w, height: heightPx })
    void frame?.resize(w, heightPx)
  })
  ro.observe(container)

  // 初始状态:视口检测首轮回调前先按快照呈现(有快照时)
  showSnapshot()

  return {
    setOptionJson(optionJson: string) {
      currentJson = optionJson
      if (frame) void applyOption(optionJson)
      else if (instance) {
        void (async () => {
          const option = await parseOptionSmart(optionJson)
          if (disposed) return
          await ensureMapsForOption(option)
          instance?.setOption(option as never, { notMerge: true })
        })()
      }
    },
    activate,
    deactivate,
    dispose() {
      disposed = true
      io.disconnect()
      ro.disconnect()
      try {
        instance?.dispose()
      } catch {
        /* 崩溃状态的实例 dispose 可能内部报错,忽略 */
      }
      instance = null
      frame?.dispose()
      frame = null
    },
  }
}
