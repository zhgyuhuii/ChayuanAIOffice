/**
 * option → PNG 快照(Q2:每图必有;快照即扩展类型在 WPS/Office 里的显示形态)。
 * 浏览器专用(离屏 canvas 渲染);GL/3D 走 CSP 豁免帧,地图 option 先注册
 * 内置 GeoJSON。
 */

import * as echarts from 'echarts'
import { GlFrame } from '../render/gl-frame-bridge'
import { optionNeedsGl } from '../render/mount'
import { ensureMapsForOption } from '../render/maps'
import { ensureEchartsGlobal } from '../render/echarts-global'

export interface SnapshotOptions {
  width?: number
  height?: number
  /** 输出像素比;默认 2(打印/PDF 清晰度) */
  pixelRatio?: number
  backgroundColor?: string
}

export async function renderOptionSnapshot(
  option: unknown,
  opts: SnapshotOptions = {},
): Promise<string> {
  const width = opts.width ?? 640
  const height = opts.height ?? 400
  const pixelRatio = opts.pixelRatio ?? 2
  const backgroundColor = opts.backgroundColor ?? '#ffffff'

  if (optionNeedsGl(option)) {
    const host = document.createElement('div')
    host.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:${height}px;`
    document.body.append(host)
    const frame = new GlFrame(host)
    try {
      const ok = await frame.update(option, width, height)
      if (!ok) throw new Error('gl frame unavailable')
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => setTimeout(resolve, 120))
      })
      const url = await frame.snapshot(pixelRatio, backgroundColor)
      if (!url) throw new Error('gl snapshot failed')
      return url
    } finally {
      frame.dispose()
      host.remove()
    }
  }

  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:${height}px;`
  document.body.append(host)
  ensureEchartsGlobal()
  const instance = echarts.init(host, null, { renderer: 'canvas', width, height })
  try {
    await ensureMapsForOption(option)
    instance.setOption(option as never)
    // 等首帧绘制完成(getDataURL 立即调用会拿到空画布)
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, 40))
    })
    return instance.getDataURL({
      type: 'png',
      pixelRatio,
      backgroundColor,
    })
  } finally {
    instance.dispose()
    host.remove()
  }
}
