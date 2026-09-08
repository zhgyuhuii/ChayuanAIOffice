/**
 * Generates the app icon set from the brand artwork
 * (apps/shell/src/renderer/src/assets/logo.png):
 *
 * Packaging (electron-builder conventions):
 *   shell/build/icon.icns     — macOS app icon (dock, Finder, 桌面快捷方式)
 *   shell/build/icon.ico      — Windows NSIS installer / shortcut icon
 *   shell/build/icon.png      — 1024px master png
 *   shell/build/icon-mac.png  — 1024px canvas with the mac grid margin (824/1024)
 *   shell/build/icons/<n>.png — linux hicolor set (deb/rpm `icon: 'build/icons'`)
 *   docs/build/<same set>     — apps/docs has standalone dist:* scripts running
 *                               electron-builder with no config file, which reads
 *                               the same build/ defaults
 *
 * Runtime window icon (imported ?asset by every Electron main; drives the
 * dev-mode taskbar / native title-bar / Alt-Tab icon and the Linux window
 * icon — packaged win/mac get it baked into the exe/bundle instead):
 *   shell/src/main/assets/app-icon.png — 512px
 *
 * Browser-tab favicons for the renderer html shells (electron ignores them;
 * the web form and vite dev-server tabs show them):
 *   <renderer html dir>/app-icon-64.png in shell/docs/sheets/slides/pdf/markdown/web
 *
 * The brand png is padded onto a square transparent canvas (it is 380×381)
 * before scaling. Regenerate after changing logo.png:
 *   node tools/gen-app-icon.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const logoPath = join(root, 'apps/shell/src/renderer/src/assets/logo.png')
const shellBuild = join(root, 'apps/shell/build')
const docsBuild = join(root, 'apps/docs/build')
// runtime window icon imported by every Electron main via `?asset`
const appIconPath = join(root, 'apps/shell/src/main/assets/app-icon.png')
// browser-tab favicons, one next to each renderer html entry
const faviconDirs = [
  'apps/shell/src/renderer',
  'apps/docs/src/renderer',
  'apps/sheets/src/renderer',
  'apps/slides/src/renderer',
  'apps/pdf/src/renderer',
  'apps/markdown/src/renderer',
  'apps/web',
].map((rel) => join(root, rel))

const MAC_CONTENT_RATIO = 824 / 1024
const CANVAS_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
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

function writeIcns(pngs, out) {
  const iconset = join(tmp, `app-${basename(out)}.iconset`)
  mkdirSync(iconset, { recursive: true })
  for (const [name, size] of ICONSET_ENTRIES) {
    writeFileSync(join(iconset, name), pngs.get(size))
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', out])
  rmSync(iconset, { recursive: true, force: true })
}

function writeIco(pngs, out) {
  return writeFileSync(out, buildIco(WIN_SIZES.map((size) => ({ size, png: pngs.get(size) }))))
}

/** electron-builder's default icon layout for one app: build/icon.{icns,ico,png} + icon-mac.png */
function writePackagingSet(pngs, dir) {
  writeIcns(pngs, join(dir, 'icon.icns'))
  writeIco(pngs, join(dir, 'icon.ico'))
  writeFileSync(join(dir, 'icon.png'), pngs.get(1024))
  writeFileSync(join(dir, 'icon-mac.png'), macMaster)
}

const logo = readFileSync(logoPath)
const dataUrl = `data:image/png;base64,${logo.toString('base64')}`
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ deviceScaleFactor: 1 })
const tmp = mkdtempSync(join(tmpdir(), 'chatoffice-app-icon-'))
/** 1024px canvas with the mac grid margin, rendered once in try{} below */
let macMaster

try {
  const pngs = new Map()
  for (const size of CANVAS_SIZES) {
    pngs.set(size, await renderPng(page, dataUrl, size, 1))
  }
  macMaster = await renderPng(page, dataUrl, 1024, MAC_CONTENT_RATIO)

  writePackagingSet(pngs, shellBuild)
  mkdirSync(docsBuild, { recursive: true })
  writePackagingSet(pngs, docsBuild)

  const linuxDir = join(shellBuild, 'icons')
  mkdirSync(linuxDir, { recursive: true })
  for (const size of LINUX_SIZES) {
    writeFileSync(
      join(linuxDir, `${size}x${size}.png`),
      pngs.get(size) ?? (await renderPng(page, dataUrl, size, 1)),
    )
  }

  writeFileSync(appIconPath, pngs.get(512))
  for (const dir of faviconDirs) {
    writeFileSync(join(dir, 'app-icon-64.png'), pngs.get(64))
  }

  console.log(
    'generated shell/build + docs/build icon sets, main/assets/app-icon.png, renderer favicons',
  )
} finally {
  rmSync(tmp, { recursive: true, force: true })
  await browser.close()
}
