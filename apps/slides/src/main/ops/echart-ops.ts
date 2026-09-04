/**
 * ECharts 扩展图表 ops(三端引用接入,2026-09-04):
 * addEchart   插入(海报图 + ppt/echarts/echartN.json sidecar + descr 指针)
 * getEchart   读取 sidecar(双击回显编辑)
 * updateEchart 原位更新(sidecar 重写 + 海报图字节替换,几何不动)
 */
import {
  addSlideEchart,
  readSlideEchart,
  updateSlideEchart,
  slideEchartPartOf,
  type EchartSidecar,
} from '@chatoffice/pptx-engine'
import {
  GuidedError,
  register,
  resolveElement,
  resolveSlide,
  type Op,
  type OpRecord,
} from './registry'

function reqStr(op: Op, field: string): string {
  const v = op[field]
  if (typeof v !== 'string' || !v) {
    throw new GuidedError(`op "${op.op}" needs "${field}": a non-empty string.`)
  }
  return v
}

register({
  name: 'addEchart',
  validate(op, ctx) {
    resolveSlide(ctx, op)
    reqStr(op, 'optionJson')
    reqStr(op, 'groupId')
    const b = op.pngBase64
    if (typeof b !== 'string' || !b) {
      throw new GuidedError('op "addEchart" needs "pngBase64": raw base64 PNG (no data: prefix).')
    }
  },
  apply(op, ctx): OpRecord {
    const { index } = resolveSlide(ctx, op)
    const r = addSlideEchart(ctx.opened, index, {
      pngBase64: String(op.pngBase64),
      optionJson: String(op.optionJson),
      groupId: String(op.groupId),
      ...(typeof op.title === 'string' ? { title: op.title } : {}),
      ...(typeof op.code === 'string' ? { code: op.code } : {}),
      ...(op.data && typeof op.data === 'object'
        ? { data: op.data as { columns: string[]; rows: Array<Array<string | number | null>> } }
        : {}),
      ...(op.offset && typeof op.offset === 'object'
        ? { offset: op.offset as { x: number; y: number; cx: number; cy: number } }
        : {}),
    })
    if (!r) throw new GuidedError('op "addEchart": failed to insert (bad slide index?).')
    return { op, created: [r.elementId] }
  },
})

/** 只读 op:返回 sidecar 内容供渲染层双击回显(get ops 走 executor 的只读通道) */
register({
  name: 'getEchart',
  validate(op, ctx) {
    const { el } = resolveElement(ctx, op)
    if (!slideEchartPartOf(el)) {
      throw new GuidedError('op "getEchart": target element is not an echart picture.')
    }
  },
  apply(op, ctx): OpRecord {
    const { el } = resolveElement(ctx, op)
    const sidecarPath = slideEchartPartOf(el)
    if (!sidecarPath) throw new GuidedError('op "getEchart": missing descr pointer.')
    const sidecar = readSlideEchart(ctx.opened, sidecarPath)
    if (!sidecar) throw new GuidedError(`op "getEchart": sidecar "${sidecarPath}" unreadable.`)
    ;(op as Op & { result?: EchartSidecar }).result = sidecar
    return { op }
  },
})

register({
  name: 'updateEchart',
  validate(op, ctx) {
    const { el } = resolveElement(ctx, op)
    if (!slideEchartPartOf(el)) {
      throw new GuidedError('op "updateEchart": target element is not an echart picture.')
    }
    reqStr(op, 'optionJson')
    if (typeof op.pngBase64 !== 'string' || !op.pngBase64) {
      throw new GuidedError('op "updateEchart" needs "pngBase64".')
    }
  },
  apply(op, ctx): OpRecord {
    const { el } = resolveElement(ctx, op)
    const sidecarPath = slideEchartPartOf(el)
    if (!sidecarPath) throw new GuidedError('op "updateEchart": missing descr pointer.')
    const mediaPath =
      (el as { mediaRef?: string }).mediaRef ??
      (() => {
        throw new GuidedError('op "updateEchart": element has no mediaRef.')
      })()
    const ok = updateSlideEchart(
      ctx.opened,
      { sidecarPath, mediaPath },
      {
        pngBase64: String(op.pngBase64),
        optionJson: String(op.optionJson),
        ...(typeof op.code === 'string' ? { code: op.code } : {}),
        ...(typeof op.title === 'string' ? { title: op.title } : {}),
        ...(op.data && typeof op.data === 'object'
          ? {
              data: op.data as {
                columns: string[]
                rows: Array<Array<string | number | null>>
              },
            }
          : {}),
      },
    )
    if (!ok) throw new GuidedError('op "updateEchart": sidecar rewrite failed.')
    return { op }
  },
})
