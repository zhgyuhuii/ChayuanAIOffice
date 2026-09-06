/**
 * SVG rasterization lives in @chatoffice/pptx-render now (shared with the
 * docs/sheets SVG fallback tools); this file stays as the slides-local import
 * shim so existing call sites don't change.
 */
export { rasterizeSvg, type SvgRasterResult } from '@chatoffice/pptx-render'
