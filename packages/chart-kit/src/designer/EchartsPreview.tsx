/**
 * 设计器右侧实时预览(Q5:39 组全部 ECharts 出图)。
 * React 薄封装:不做快照切换,始终活渲染。
 * - GL/3D option:渲染进 CSP 豁免帧(宿主页 CSP 会拦 claygl 的 eval);
 * - geo/map option:先注册内置 GeoJSON(china/world)。
 * 同时对外暴露 snapshot():从当前活实例直接出 PNG——设计器插入用它,
 * 避免再起一个离屏帧从头渲染(GL 场景首帧晚于 zrender finished,离屏
 * 帧的快照时序不可靠,曾截到只剩 visualMap 的空图)。
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as echarts from 'echarts'
import { optionNeedsGl } from '../render/mount'
import { GlFrame } from '../render/gl-frame-bridge'
import { ensureMapsForOption } from '../render/maps'
import { ensureEchartsGlobal } from '../render/echarts-global'

export interface EchartsPreviewHandle {
  /** 从当前活实例出 PNG(dataURL);实例未就绪时返回 null */
  snapshot(opts?: { pixelRatio?: number; backgroundColor?: string }): Promise<string | null>
}

export const EchartsPreview = forwardRef<
  EchartsPreviewHandle,
  {
    option: unknown
    className?: string
    heightPx?: number
  }
>(function EchartsPreview({ option, className, heightPx = 340 }, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef<{
    instance: ReturnType<typeof echarts.init> | null
    frame: GlFrame | null
    isGl: boolean
  }>({ instance: null, frame: null, isGl: false })

  useImperativeHandle(ref, () => ({
    async snapshot(opts) {
      // 任何失败都返回 null,由调用方回退到离屏 renderOptionSnapshot
      try {
        const pixelRatio = opts?.pixelRatio ?? 2
        const backgroundColor = opts?.backgroundColor ?? '#ffffff'
        const { instance, frame, isGl } = stateRef.current
        if (isGl && frame) {
          return frame.snapshot(pixelRatio, backgroundColor)
        }
        if (instance && !instance.isDisposed()) {
          return instance.getDataURL({ type: 'png', pixelRatio, backgroundColor })
        }
      } catch {
        /* fall through */
      }
      return null
    },
  }))

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
        stateRef.current = { instance: null, frame, isGl: frame !== null }
        return
      }
      await ensureMapsForOption(option)
      if (disposed) return
      ensureEchartsGlobal()
      instance = echarts.init(host)
      instance.resize({ width: host.clientWidth, height: heightPx })
      instance.setOption(option as never, { notMerge: true })
      stateRef.current = { instance, frame: null, isGl: false }
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
      try {
        instance?.dispose()
      } catch {
        /* dispose 幂等/内部态损坏时忽略 */
      }
      frame?.dispose()
      stateRef.current = { instance: null, frame: null, isGl: false }
    }
    // option 引用变化即重建(设计器内每次沙箱运行产出新对象)
  }, [option, heightPx])

  return <div ref={hostRef} className={className} style={{ height: `${heightPx}px` }} />
})
