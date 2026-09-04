/**
 * 设计器右侧实时预览(Q5:39 组全部 ECharts 出图)。
 * React 薄封装:不做快照切换,始终活渲染;GL 组动态装载 echarts-gl。
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../types/echarts-gl.d.ts" />
import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import { optionNeedsGl } from '../render/mount'

let glModuleLoading: Promise<unknown> | null = null
function ensureGl(): Promise<unknown> {
  glModuleLoading ??= import('echarts-gl')
  return glModuleLoading
}

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
  const instanceRef = useRef<ReturnType<typeof echarts.init> | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    const setup = async () => {
      if (optionNeedsGl(option)) await ensureGl().catch(() => undefined)
      if (disposed || !hostRef.current) return
      instanceRef.current ??= echarts.init(host)
      instanceRef.current.resize({ width: host.clientWidth, height: heightPx })
      if (option) instanceRef.current.setOption(option as never, { notMerge: true })
    }
    void setup()
    const ro = new ResizeObserver(() => {
      const w = hostRef.current?.clientWidth ?? 0
      instanceRef.current?.resize({ width: w, height: heightPx })
    })
    ro.observe(host)
    return () => {
      disposed = true
      ro.disconnect()
      instanceRef.current?.dispose()
      instanceRef.current = null
    }
    // option 引用变化即重绘(设计器内每次沙箱运行产出新对象)
  }, [option, heightPx])

  return <div ref={hostRef} className={className} style={{ height: `${heightPx}px` }} />
}
