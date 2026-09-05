/**
 * Generates the app icon set from the brand artwork
 * (apps/shell/src/renderer/src/assets/logo.png):
 *   build/icon.icns       — macOS app icon (dock, Finder, 桌面快捷方式)
 *   build/icon.ico        — Windows NSIS installer / shortcut icon
 *   build/icon.png        — 1024px master png
 *   build/icon-mac.png    — 1024px canvas with the mac grid margin (824/1024)
 *   build/icons/<n>.png   — linux hicolor set (deb/rpm `icon: 'build/icons'`)
 *
 * The brand png is padded onto a square transparent canvas (it is 380×381)
 * before scaling. Regenerate after changing logo.png:
 *   node tools/gen-app-icon.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const logoPath = join(root, 'apps/shell/src/renderer/src/assets/logo.png')
const outDir = join(root, 'apps/shell/build')

const MAC_CONTENT_RATIO = 824 / 1024
const CANVAS_SIZES = [16, 32, 64, 128, 256, 512, 1024]
const ICONSET_ENTRIES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]
const WIN_SIZES = [16, 24, 32, 48, 64, 128, 256]
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]

/** ICO container with PNG-compressed entries (supported since Vista). */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = header.length + dir.length
  entries.forEach(({ size, png }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o) // 0 means 256
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2) // palette
    dir.writeUInt8(0, o + 3) // reserved
    dir.writeUInt16LE(1, o + 4) // planes
    dir.writeUInt16LE(32, o + 6) // bpp
    dir.writeUInt32LE(png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

async function renderPng(page, dataUrl, canvasSize, contentRatio) {
  await page.setViewportSize({ width: canvasSize, height: canvasSize })
  await page.setContent(
    `<body style="margin:0"><div style="width:${canvasSize}px;height:${canvasSize}px;display:flex;align-items:center;justify-content:center">` +
      `<img src="${dataUrl}" style="max-width:${Math.round(canvasSize * contentRatio)}px;max-height:${Math.round(canvasSize * contentRatio)}px"></div></body>`,
  )
  return page.screenshot({ omitBackground: true })
}

const logo = readFileSync(logoPath)
const dataUrl = `data:image/png;base64,${logo.toString('base64')}`
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ deviceScaleFactor: 1 })
const tmp = mkdtempSync(join(tmpdir(), 'chatoffice-app-icon-'))

try {
  const pngs = new Map()
  for (const size of CANVAS_SIZES) {
    pngs.set(size, await renderPng(page, dataUrl, size, 1))
  }

  const iconset = join(tmp, 'app.iconset')
  mkdirSync(iconset, { recursive: true })
  for (const [name, size] of ICONSET_ENTRIES) {
    writeFileSync(join(iconset, name), pngs.get(size))
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(outDir, 'icon.icns')])

  writeFileSync(
    join(outDir, 'icon.ico'),
    buildIco(
      await Promise.all(
        WIN_SIZES.map(async (size) => ({
          size,
          png: pngs.get(size) ?? (await renderPng(page, dataUrl, size, 1)),
        })),
      ),
    ),
  )

  writeFileSync(join(outDir, 'icon.png'), pngs.get(1024))
  writeFileSync(
    join(outDir, 'icon-mac.png'),
    await renderPng(page, dataUrl, 1024, MAC_CONTENT_RATIO),
  )

  const linuxDir = join(outDir, 'icons')
  mkdirSync(linuxDir, { recursive: true })
  for (const size of LINUX_SIZES) {
    writeFileSync(
      join(linuxDir, `${size}x${size}.png`),
      pngs.get(size) ?? (await renderPng(page, dataUrl, size, 1)),
    )
  }

  console.log('generated icon.icns + icon.ico + icon.png + icon-mac.png + icons/')
} finally {
  rmSync(tmp, { recursive: true, force: true })
  await browser.close()
}
