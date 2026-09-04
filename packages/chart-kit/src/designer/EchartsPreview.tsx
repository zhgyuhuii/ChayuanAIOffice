/**
 * 设计器右侧实时预览(Q5:39 组全部 ECharts 出图)。
 * React 薄封装:不做快照切换,始终活渲染。
 * - GL/3D option:渲染进 CSP 豁免帧(宿主页 CSP 会拦 claygl 的 eval);
 * - geo/map option:先注册内置 GeoJSON(china/world)。
 */

import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import { optionNeedsGl } from '../render/mount'
import { GlFrame } from '../render/gl-frame-bridge'
import { ensureMapsForOption } from '../render/maps'

export function EchartsPreview({
  option,
  className,
  heightPx = 340,
}: {
  option: unknown
  className?: string
  heightPx?: number
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host || !option) return
    let disposed = false
    let frame: GlFrame | null = null
    let instance: ReturnType<typeof echarts.init> | null = null

    const setup = async () => {
      if (optionNeedsGl(option)) {
        frame = new GlFrame(host)
        const ok = await frame.ready
        if (disposed) return
        if (ok) await frame.update(option, host.clientWidth || 640, heightPx)
        else {
          frame.dispose()
          frame = null
        }
        return
      }
      await ensureMapsForOption(option)
      if (disposed) return
      instance = echarts.init(host)
      instance.resize({ width: host.clientWidth, height: heightPx })
      instance.setOption(option as never, { notMerge: true })
    }
    void setup()

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth
      instance?.resize({ width: w, height: heightPx })
      void frame?.resize(w, heightPx)
    })
    ro.observe(host)
    return () => {
      disposed = true
      ro.disconnect()
      instance?.dispose()
      frame?.dispose()
    }
    // option 引用变化即重建(设计器内每次沙箱运行产出新对象)
  }, [option, heightPx])

  return <div ref={hostRef} className={className} style={{ height: `${heightPx}px` }} />
}
