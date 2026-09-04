/**
 * GL 渲染帧的父页桥:
 * 宿主页 CSP(script-src 'self')会拦死 claygl 的 new Function,所以
 * 3D/GL 图表整体渲染进本包自带的 CSP 豁免同源 iframe(gl-frame.html)。
 * echarts/echarts-gl 的模块 URL 由宿主页 import.meta.resolve 解析后
 * 传给帧内动态 import——dev(dev-server 依赖地址)与 build(哈希 chunk
 * 地址)都成立,不需要每个应用改打包配置。
 */

import glFrameUrl from './gl-frame.html?url'
// Vite 把依赖入口也 emit 成 URL 资源(dev=/@fs/ 真实地址,build=哈希 chunk),
// 帧内动态 import 用;import.meta.resolve('echarts') 在 Vite 下不可用(实测)
import echartsUrl from 'echarts?url'
import echartsGlUrl from 'echarts-gl?url'
import { stringifyOption } from '../sandbox/serialize'
import { mapNamesInOption, loadBundledMap } from './maps'

interface FrameDone {
  ok: boolean
  url?: string
  error?: string
}

type Resolve = (r: FrameDone) => void

function resolveModuleUrls(): { echartsUrl: string; echartsGlUrl: string } {
  return { echartsUrl, echartsGlUrl }
}

export class GlFrame {
  private iframe: HTMLIFrameElement
  private waiters = new Map<number, Resolve>()
  private seq = 0
  private listener: (ev: MessageEvent) => void
  /** 帧就绪(true)/不可用(false:URL 解析失败或模块加载失败) */
  readonly ready: Promise<boolean>
  private readyResolve!: (ok: boolean) => void
  private mapsRegisteredInFrame = new Set<string>()

  constructor(container: HTMLElement) {
    this.iframe = document.createElement('iframe')
    this.iframe.src = glFrameUrl
    this.iframe.style.cssText = 'width:100%;height:100%;border:0;display:block'
    this.iframe.title = 'chart gl frame'
    this.ready = new Promise<boolean>((resolve) => {
      this.readyResolve = resolve
    })

    this.listener = (ev: MessageEvent) => {
      const m = ev.data as {
        __ckgl?: boolean
        type?: string
        id?: number
        ok?: boolean
        url?: string
        error?: string
      }
      if (!m || m.__ckgl !== true) return
      if (m.type === 'booted') {
        this.readyResolve(Boolean(m.ok))
        return
      }
      if (m.type === 'done' && typeof m.id === 'number') {
        const waiter = this.waiters.get(m.id)
        this.waiters.delete(m.id)
        waiter?.({ ok: Boolean(m.ok), url: m.url, error: m.error })
      }
    }
    window.addEventListener('message', this.listener)

    this.iframe.addEventListener('load', () => {
      const urls = resolveModuleUrls()
      if (!urls) {
        this.readyResolve(false)
        return
      }
      this.iframe.contentWindow?.postMessage({ __ckgl: true, type: 'boot', ...urls }, '*')
    })
    container.append(this.iframe)
  }

  private request(msg: Record<string, unknown>): Promise<FrameDone> {
    return new Promise((resolve) => {
      const id = ++this.seq
      this.waiters.set(id, resolve)
      this.iframe.contentWindow?.postMessage({ __ckgl: true, ...msg, id }, '*')
    })
  }

  private async ensureFrameMaps(option: unknown): Promise<void> {
    for (const name of mapNamesInOption(option)) {
      if (this.mapsRegisteredInFrame.has(name)) continue
      const geojson = await loadBundledMap(name)
      if (!geojson) continue
      await this.request({ type: 'registerMap', name, geojson })
      this.mapsRegisteredInFrame.add(name)
    }
  }

  /** 更新 option(内部做函数安全序列化,帧内复活)并适配尺寸;失败抛出帧内错误 */
  async update(option: unknown, width: number, height: number): Promise<boolean> {
    if (!(await this.ready)) return false
    await this.ensureFrameMaps(option)
    const r = await this.request({
      type: 'setOption',
      option: stringifyOption(option),
      width,
      height,
    })
    if (!r.ok && r.error) throw new Error(`gl frame: ${r.error}`)
    return r.ok
  }

  async resize(width: number, height: number): Promise<void> {
    if (!(await this.ready)) return
    this.iframe.contentWindow?.postMessage({ __ckgl: true, type: 'resize', width, height }, '*')
  }

  async snapshot(pixelRatio = 2, backgroundColor = '#ffffff'): Promise<string | null> {
    if (!(await this.ready)) return null
    const r = await this.request({ type: 'snapshot', pixelRatio, backgroundColor })
    return r.ok && r.url ? r.url : null
  }

  dispose(): void {
    window.removeEventListener('message', this.listener)
    try {
      this.iframe.contentWindow?.postMessage({ __ckgl: true, type: 'dispose' }, '*')
    } catch {
      /* ignore */
    }
    this.iframe.remove()
  }
}
