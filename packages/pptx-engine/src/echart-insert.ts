/**
 * ECharts 扩展图表落 pptx(2026-09-04 三端引用接入):
 * PNG 海报图 = PowerPoint/WPS 里显示的形态;option 源码走 sidecar part
 * `ppt/echarts/echartN.json`,p:cNvPr@descr 存 `aislides-echart:{part}` 指针
 * —— 与 addModel3d 同款范式,重开时据此恢复可编辑状态。
 */

import type { Slide } from './types'
import { creationIdXml, escapeXmlAttr } from './xml-utils'
import { appendRawElements, type OpenedPptx } from './index'
import { nextCNvPrId } from './insert'
import { ensureDefaultContentType, newMediaPart, appendRels } from './media-insert'

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const IMAGE_REL_TYPE = `${R_NS}/image`
export const ECHART_DESCR_PREFIX = 'aislides-echart:'

export interface NewSlideEchart {
  /** raw base64 PNG(无 data: 前缀) */
  pngBase64: string
  /** 函数安全序列化的 ECharts option(__chartkit_fn__ 标记) */
  optionJson: string
  /** chart-kit 39 组 id */
  groupId: string
  title?: string
  code?: string | null
  /** 扁平数据表(数据不锁死) */
  data?: { columns: string[]; rows: Array<Array<string | number | null>> }
  /** EMU 偏移/尺寸;缺省 5×3in @ (1in,1in) */
  offset?: { x: number; y: number; cx: number; cy: number }
}

export interface EchartSidecar {
  v: 1
  option: string
  code: string | null
  title: string | null
  groupId: string
  data?: NewSlideEchart['data']
}

function allocSidecarPath(opened: OpenedPptx): string {
  let maxNum = 0
  for (const path of opened.archive.entries.keys()) {
    const m = /^ppt\/echarts\/echart(\d+)\.json$/.exec(path)
    if (m) maxNum = Math.max(maxNum, Number(m[1]))
  }
  return `ppt/echarts/echart${maxNum + 1}.json`
}

/** 插入 echart(海报图 + sidecar 指针),返回元素 id 与 sidecar 路径 */
export function addSlideEchart(
  opened: OpenedPptx,
  slideIndex: number,
  opts: NewSlideEchart,
): { slide: Slide; elementId: string; sidecarPath: string; mediaPath: string } | null {
  const slide = opened.deck.slides[slideIndex]
  if (!slide) return null

  ensureDefaultContentType(opened, 'json', 'application/json')
  const sidecarPath = allocSidecarPath(opened)
  const sidecar: EchartSidecar = {
    v: 1,
    option: opts.optionJson,
    code: opts.code ?? null,
    title: opts.title ?? null,
    groupId: opts.groupId,
    ...(opts.data ? { data: opts.data } : {}),
  }
  opened.archive.entries.set(sidecarPath, Buffer.from(JSON.stringify(sidecar), 'utf8'))

  const mediaPath = newMediaPart(opened, 'image', 'png', Buffer.from(opts.pngBase64, 'base64'))
  ensureDefaultContentType(opened, 'png', 'image/png')

  const [rid] = appendRels(opened, slide, [
    { type: IMAGE_REL_TYPE, target: `../media/${mediaPath.split('/').pop()}` },
  ])
  if (!rid) return null

  const id = nextCNvPrId(slide)
  const o = opts.offset ?? { x: 914400, y: 914400, cx: 4572000, cy: 2743200 }
  const name = opts.title ? `EChart ${opts.title}` : `EChart ${id}`
  const xml =
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${escapeXmlAttr(name)}" descr="${escapeXmlAttr(ECHART_DESCR_PREFIX + sidecarPath)}">${creationIdXml()}</p:cNvPr>` +
    '<p:cNvPicPr/><p:nvPr/></p:nvPicPr>' +
    `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${o.x}" y="${o.y}"/><a:ext cx="${o.cx}" cy="${o.cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'

  const r = appendRawElements(opened, slideIndex, [xml])
  return r
    ? { slide: r.slide, elementId: r.elementIds[r.elementIds.length - 1]!, sidecarPath, mediaPath }
    : null
}

/** descr 指针 → sidecar 路径 */
export function slideEchartPartOf(el: { descr?: string }): string | null {
  const m = el.descr && new RegExp(`^${ECHART_DESCR_PREFIX}(.+)$`).exec(el.descr)
  return m ? m[1]! : null
}

/** 读取 sidecar(双击回显编辑用) */
export function readSlideEchart(opened: OpenedPptx, sidecarPath: string): EchartSidecar | null {
  const text = opened.archive.readText(sidecarPath)
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as EchartSidecar
    return parsed && typeof parsed.option === 'string' ? parsed : null
  } catch {
    return null
  }
}

/** 双击编辑提交:重写 sidecar + 原位替换海报图字节(几何不动) */
export function updateSlideEchart(
  opened: OpenedPptx,
  target: { sidecarPath: string; mediaPath: string },
  next: {
    pngBase64: string
    optionJson: string
    code?: string | null
    title?: string
    data?: NewSlideEchart['data']
  },
): boolean {
  const existing = readSlideEchart(opened, target.sidecarPath)
  if (!existing) return false
  const sidecar: EchartSidecar = {
    v: 1,
    option: next.optionJson,
    code: next.code ?? existing.code,
    title: next.title ?? existing.title,
    groupId: existing.groupId,
    ...((next.data ?? existing.data) ? { data: next.data ?? existing.data } : {}),
  }
  opened.archive.entries.set(target.sidecarPath, Buffer.from(JSON.stringify(sidecar), 'utf8'))
  opened.archive.entries.set(target.mediaPath, Buffer.from(next.pngBase64, 'base64'))
  return true
}
