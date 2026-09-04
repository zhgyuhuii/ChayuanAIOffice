/**
 * option → PNG 快照(Q2:每图必有;快照即扩展类型在 WPS/Office 里的显示形态)。
 * 浏览器专用(离屏 canvas 渲染)。
 */

import * as echarts from 'echarts'

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
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:${height}px;`
  document.body.append(host)
  const instance = echarts.init(host, null, { renderer: 'canvas', width, height })
  try {
    instance.setOption(option as never)
    // 等首帧绘制完成(getDataURL 立即调用会拿到空画布)
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, 40))
    })
    return instance.getDataURL({
      type: 'png',
      pixelRatio,
      backgroundColor: opts.backgroundColor ?? '#ffffff',
    })
  } finally {
    instance.dispose()
    host.remove()
  }
}
