/**
 * Pure slide render pipeline shared by the Electron main process and the web
 * BFF (plan v2.2 batch 4): opened deck → renderer-facing RenderSlide[].
 * No Electron imports — node-only.
 */
import type { OpenedPptx } from '@chatoffice/pptx-engine'
import { parseTheme, parseClrMap, resolveSchemeColor } from '@chatoffice/pptx-engine'
import { buildRenderSlide, type RenderSlide } from '@chatoffice/pptx-render'
import { tiffToPng } from './tiff-decode'
import { neutralizeJpegOrientation } from './jpeg-orientation'
import { displayMime } from './media-mime'
import { createSystemFontMetrics } from './fonts'

export function buildAllRenderSlides(opened: OpenedPptx, fitWidthPx: number): RenderSlide[] {
  return opened.deck.slides.map((s, i) =>
    buildRenderSlide(s, opened.deck.size, {
      fitWidthPx,
      media: makeMediaResolver(opened, s.path),
      metrics: getFontMetrics(),
      slideNo: i + 1,
    }),
  )
}
/** Office theme-class slot (MsftOfcThm_<slot>_Fill/_Stroke) → schemeClr name. */
const SVG_THEME_SLOTS: Record<string, string> = {
  background1: 'bg1',
  text1: 'tx1',
  background2: 'bg2',
  text2: 'tx2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hyperlink: 'hlink',
  followedhyperlink: 'folHlink',
}

/**
 * Office-exported SVGs carry `.MsftOfcThm_<slot>_Fill/_Stroke` CSS classes whose baked
 * values PowerPoint rewrites to the CURRENT theme's colors at render time (the static
 * value is just the export-time snapshot — probe deck: a bg1-classed blob draws white
 * on a white theme, not its baked blue). Mirror that rewrite before serving the SVG.
 */
export function retintThemedSvg(svg: string, opened: OpenedPptx, slidePath?: string): string {
  const path = slidePath ?? opened.deck.slides[0]?.path
  if (!path) return svg
  let theme
  try {
    const chain = opened.archive.resolveSlideChain(path)
    const themeXml = chain.themePath ? opened.archive.readText(chain.themePath) : null
    if (!themeXml) return svg
    theme = parseTheme(themeXml)
    const masterXml = chain.masterPath ? opened.archive.readText(chain.masterPath) : undefined
    const layoutXml = chain.layoutPath ? opened.archive.readText(chain.layoutPath) : undefined
    theme.clrMap = parseClrMap(
      masterXml ?? undefined,
      layoutXml ?? undefined,
      opened.archive.readText(path) ?? undefined,
    )
  } catch {
    return svg
  }
  return svg.replace(
    /\.MsftOfcThm_(\w+?)_(Fill|Stroke)\w*\s*\{[^}]*\}/g,
    (rule, slot: string, kind: string) => {
      const scheme = SVG_THEME_SLOTS[slot.toLowerCase()]
      const color = scheme ? resolveSchemeColor(scheme, theme) : undefined
      if (!color) return rule
      const prop = kind === 'Stroke' ? 'stroke' : 'fill'
      return rule.replace(new RegExp(`${prop}\\s*:\\s*[^;}]+`, 'g'), `${prop}:${color}`)
    },
  )
}

export function makeMediaResolver(opened: OpenedPptx, slidePath?: string) {
  const cache = new Map<string, string | undefined>()
  return (mediaRef: string): string | undefined => {
    if (cache.has(mediaRef)) return cache.get(mediaRef)
    const bytes = opened.archive.readBytes(mediaRef)
    let url: string | undefined
    if (bytes) {
      const mime = displayMime(mediaRef, bytes)
      if (mime === 'image/tiff') {
        const decoded = tiffToPng(bytes)
        if (decoded) url = `data:image/png;base64,${Buffer.from(decoded.png).toString('base64')}`
      } else if (mime === 'image/svg+xml') {
        let text = Buffer.from(bytes).toString('utf8')
        if (text.includes('MsftOfcThm_')) text = retintThemedSvg(text, opened, slidePath)
        url = `data:${mime};base64,${Buffer.from(text, 'utf8').toString('base64')}`
      } else {
        // PowerPoint ignores EXIF orientation; Chromium applies it on decode — neutralize
        // the flag so rotated-pixel JPEGs with a shape-level rot don't double-rotate
        const served = mime === 'image/jpeg' ? neutralizeJpegOrientation(bytes) : bytes
        url = `data:${mime};base64,${Buffer.from(served).toString('base64')}`
      }
    }
    cache.set(mediaRef, url)
    return url
  }
}
/** Precise system-font metrics (lazily built, shared process-wide). */
let fontMetrics: ReturnType<typeof createSystemFontMetrics> | null = null
export function getFontMetrics(): ReturnType<typeof createSystemFontMetrics> {
  if (!fontMetrics) fontMetrics = createSystemFontMetrics()
  return fontMetrics
}

/** Deck default body font from the first slide's theme (minor font slot). */
export function deckDefaultFont(opened: OpenedPptx): string | undefined {
  try {
    const slidePath = opened.archive.readPresentation().slidePaths[0]
    if (!slidePath) return undefined
    const themePath = opened.archive.resolveSlideChain(slidePath).themePath
    const xml = themePath ? opened.archive.readText(themePath) : undefined
    return xml ? parseTheme(xml).minorFont : undefined
  } catch {
    return undefined
  }
}
