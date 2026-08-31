/**
 * genoffice — client 半：向察元桌面（chatop-shell）注册「GenOffice」应用。
 *
 * 机制：window.__chatop_shell__.registerDesktopApp({id,label,icon,order,comp})
 * （dsh-plugin/src/desktop/app-registry.js）。外壳缺席时静默 no-op + 低频
 * 重试（装载顺序不保证，对齐 chatop-kb）。窗口内容 = 指向本机 BFF origin
 * 的全尺寸 iframe（Web 宿主 + 五编辑器 + RPC/WS），origin 从 host 半的
 * /api/genoffice/status 取（sidecar 动态端口）。
 *
 * 两种形态同一链路：`dsh web` 与 chatop Electron 桌面（主窗口加载同一
 * dsh web origin）——Dock 图标与窗口自动在两边出现，无需 Electron 侧改动。
 */
import React, { useEffect, useState } from 'react'

const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect x="6" y="6" width="52" height="52" rx="14" fill="#e35205"/>' +
  '<path d="M18 20h12a8 8 0 0 1 8 8v18H26a8 8 0 0 1-8-8V20z" fill="#fff" opacity="0.94"/>' +
  '<path d="M22 27h10M22 34h10M22 41h7" stroke="#e35205" stroke-width="3" stroke-linecap="round"/>' +
  '<path d="M40 18l8 8-8 8" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>'
const ICON_URI = `data:image/svg+xml;utf8,${encodeURIComponent(ICON_SVG)}`

const STATUS_TEXT = {
  starting: 'GenOffice 引擎启动中…',
  missing: 'GenOffice sidecar 未打包（在 genoffice 仓库运行 npm run package:plugin）',
  failed: 'GenOffice 引擎启动失败（详见 dsh 日志）',
}

function GenOfficeApp() {
  const [origin, setOrigin] = useState(null)
  const [status, setStatus] = useState('starting')

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch('/api/genoffice/status')
        const doc = await res.json()
        if (cancelled) return
        if (doc.appOrigin) {
          setOrigin(doc.appOrigin)
          setStatus('ready')
          return true
        }
        setStatus(doc.status ?? 'starting')
      } catch {
        setStatus('starting')
      }
      return false
    }
    const timer = setInterval(async () => {
      if (await poll()) clearInterval(timer)
    }, 800)
    poll()
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  if (!origin) {
    return (
      <div
        style={{
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          background: '#1e1f22',
          color: '#b8b8b8',
          font: '13px/1.6 system-ui, sans-serif',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <div>
          <div style={{ fontSize: 22, marginBottom: 8 }}>📄</div>
          {STATUS_TEXT[status] ?? STATUS_TEXT.starting}
        </div>
      </div>
    )
  }

  return (
    <iframe
      src={origin}
      title="GenOffice"
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        display: 'block',
        background: '#fff',
      }}
      allow="clipboard-read; clipboard-write"
    />
  )
}

function tryRegister() {
  const shell = typeof window !== 'undefined' ? window.__chatop_shell__ : null
  if (shell && typeof shell.registerDesktopApp === 'function') {
    shell.registerDesktopApp({
      id: 'genoffice',
      label: 'GenOffice',
      icon: ICON_URI,
      order: 52,
      comp: React.createElement(GenOfficeApp),
    })
  }
}

export const inject = []

/** dsh client 契约：client 模块暴露 apply()；注册动作在此外发。 */
export function apply() {
  tryRegister()
}

tryRegister()
// 插件 client 与外壳 client 的装载顺序不保证：外壳缺席时低频重试注册
let registerRetries = 0
const registerTimer = setInterval(() => {
  registerRetries++
  if (typeof window !== 'undefined' && window.__chatop_shell__) {
    clearInterval(registerTimer)
    tryRegister()
  } else if (registerRetries > 50) {
    clearInterval(registerTimer)
  }
}, 200)
