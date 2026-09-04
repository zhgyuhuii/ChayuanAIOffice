/**
 * ECharts 画布挂载器(框架无关 DOM):
 * 文档/表格/演示画布上的扩展组图表 = 活渲染 + 视口外切快照(Q2)。
 * 快照同时是 WPS/Office 里的显示形态本身(Q3),由调用方持久化。
 *
 * 浏览器专用(依赖 DOM/ECharts);Node 侧请走 ./spec、./sandbox 入口。
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../types/echarts-gl.d.ts" />
import * as echarts from 'echarts'
import { parseOption } from '../sandbox/serialize'

export interface EchartMountOptions {
  /** option 的函数安全序列化串(__chartkit_fn__ 标记);载入时解析 */
  optionJson?: string | null
  /** 静态快照 URL(dataUrl 或文件);视口外/降级时显示 */
  snapshotUrl?: string | null
  /** GL/3D 组:激活前先动态装载 echarts-gl(Q9:GL 组不进主包) */
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

type EChartsInstance = ReturnType<typeof echarts.init>

let glModuleLoading: Promise<unknown> | null = null
function ensureGl(): Promise<unknown> {
  glModuleLoading ??= import('echarts-gl')
  return glModuleLoading
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

  let instance: EChartsInstance | null = null
  let currentJson = opts.optionJson ?? null
  let active = false
  let glReady = opts.gl !== true
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

  const ensureInstance = async () => {
    if (instance || disposed) return
    if (!glReady) await ensureGl().catch(() => undefined)
    glReady = true
    if (disposed) return
    instance = echarts.init(live)
    instance.resize({ width: container.clientWidth, height: heightPx })
    if (currentJson) {
      instance.setOption(parseOption(currentJson) as never)
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
    instance?.resize({ width: container.clientWidth, height: heightPx })
  })
  ro.observe(container)

  // 初始状态:视口检测首轮回调前先按快照呈现(有快照时)
  showSnapshot()

  return {
    setOptionJson(optionJson: string) {
      currentJson = optionJson
      if (instance) instance.setOption(parseOption(optionJson) as never, { notMerge: true })
    },
    activate,
    deactivate,
    dispose() {
      disposed = true
      io.disconnect()
      ro.disconnect()
      instance?.dispose()
      instance = null
    },
  }
}
