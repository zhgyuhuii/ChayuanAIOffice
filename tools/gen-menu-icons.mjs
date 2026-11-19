/**
 * Regenerates the native-menu file-type icons
 * (apps/shell/src/main/assets/menu-<type>.png + @2x) from the single-glyph
 * SVG tiles the in-app badges render (apps/shell/src/renderer/src/assets/
 * file-*.svg) — same source of truth as tools/gen-file-association-icons.mjs,
 * so the "+" new-file dropdown, the tab context menu and the tab strip all
 * show one design (2026-11-19: the old banner-art PNGs retired).
 *
 *   node tools/gen-menu-icons.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// single-source tiles (packages/ui/src/file-tiles — see badge.tsx)
const assetDir = join(root, 'packages/ui/src/file-tiles')
const outDir = join(root, 'apps/shell/src/main/assets')

// the six document kinds the "+" menu and the per-tab context menu offer
// (the home entry keeps the brand logo tile, not a file-type glyph)
const TYPES = {
  docx: 'file-docx.svg',
  xlsx: 'file-xlsx.svg',
  pptx: 'file-pptx.svg',
  pdf: 'file-pdf.svg',
  md: 'file-md.svg',
  html: 'file-html.svg',
}

// fresh page per frame — see gen-file-association-icons.mjs for the stale-
// compositing note that makes viewport reuse unsafe
async function renderPng(browser, svgDataUrl, size) {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { width: size, height: size },
  })
  await page.setContent(
    `<body style="margin:0"><div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">` +
      `<img src="${svgDataUrl}" style="height:${size}px;width:${size}px"></div></body>`,
  )
  try {
    return await page.screenshot({ omitBackground: true })
  } finally {
    await page.close()
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const [type, fileName] of Object.entries(TYPES)) {
    const bytes = readFileSync(join(assetDir, fileName))
    const dataUrl = `data:image/svg+xml;base64,${bytes.toString('base64')}`
    writeFileSync(join(outDir, `menu-${type}.png`), await renderPng(browser, dataUrl, 16))
    writeFileSync(join(outDir, `menu-${type}@2x.png`), await renderPng(browser, dataUrl, 32))
    console.log(`regenerated menu-${type}.png + @2x from ${fileName}`)
  }
} finally {
  await browser.close()
}
