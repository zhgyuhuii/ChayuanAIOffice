/**
 * site-sync —— 官网同步客户端（察元AI Office · Electron 主进程）
 *
 *  1) 运行心跳：30 分钟一跳 POST {SITE}/api/node-sync（匿名 hid，无文档内容）
 *  2) 检查更新：启动 30s 后 + 每 4h GET {SITE}/api/update/check
 *     有新版本 → 系统通知 → 点击下载安装包到 ~/Downloads → 在访达/Finder 定位
 *
 *  铁律：一切网络失败静默吞掉（AbortController 超时 + try/catch 全覆盖），断网零报错。
 *  官网唯一口径：https://aidooo.com
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { app, net, Notification, shell } from 'electron'

const SITE = (process.env.CHAYUAN_SITE || 'https://aidooo.com').replace(/\/+$/, '')

function platformKey(): string {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'windows-arm64' : 'windows-amd64'
  return process.arch === 'arm64' ? 'linux-arm64' : 'linux-amd64'
}

function getHid(): string {
  try {
    const f = path.join(app.getPath('userData'), 'site-hid')
    let v = ''
    try { v = fs.readFileSync(f, 'utf8').trim() } catch { /* 首次 */ }
    if (!v) { v = crypto.randomUUID(); fs.writeFileSync(f, v) }
    return v
  } catch { return crypto.randomUUID() }
}

async function silentPost(url: string, body: unknown): Promise<void> {
  try {
    const res = await net.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000)
    })
    await res.arrayBuffer().catch(() => {})
  } catch { /* 断网/超时：静默 */ }
}

async function downloadTo(filename: string, url: string): Promise<string | null> {
  try {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(10 * 60_000) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const dest = path.join(app.getPath('downloads'), filename)
    fs.writeFileSync(dest, buf)
    return dest
  } catch { return null }
}

let checking = false
export function startSiteSync(product: string): void {
  const version = app.getVersion()
  const hid = getHid()
  const beat = () => void silentPost(`${SITE}/api/node-sync`, {
    hid, product, ver: version,
    os: process.platform, arch: process.arch, osVer: os.release(), brand: true
  })
  setTimeout(beat, 120_000)
  const beatTimer = setInterval(beat, 30 * 60_000)
  app.on('will-quit', () => clearInterval(beatTimer))

  const check = async () => {
    if (checking) return
    checking = true
    try {
      const res = await net.fetch(
        `${SITE}/api/update/check?product=${product}&platform=${platformKey()}&version=${encodeURIComponent(version)}`,
        { signal: AbortSignal.timeout(12_000) }
      )
      const j: any = await res.json()
      if (!j?.updateAvailable || !j?.latest?.url || !Notification.isSupported()) return
      const n = new Notification({
        title: `察元AI Office ${j.latest.version} 可用`,
        body: '点击下载新版本安装包（保存到下载目录）',
        silent: false
      })
      n.on('click', () => {
        void downloadTo(j.latest.url.split('/').pop() || 'chayuan-office-update.pkg', j.latest.url)
          .then((p) => { if (p) void shell.showItemInFolder(p) })
        n.close()
      })
      n.show()
    } catch { /* 静默 */ } finally { checking = false }
  }
  setTimeout(check, 30_000)
  const checkTimer = setInterval(check, 4 * 3600_000)
  app.on('will-quit', () => clearInterval(checkTimer))
}
