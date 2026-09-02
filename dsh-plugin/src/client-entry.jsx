/**
 * chatoffice — client 半：向察元桌面（chatop-shell）注册「ChatOffice」应用。
 *
 * chrome:'self'（WPS 式一行窗口，共识 v2.3）：应用自绘窗口控制——TabBar 在
 * 应用 iframe 顶部一行，窗口按钮叠加在该行两端的空白处，与标签同行：
 *   mac：左上交通灯（红黄绿）；win：右上 — □ ✕（✕ hover 红）。
 * 平台按 navigator.platform（iframe 内即宿主 OS）。window-drag-handle class
 * 是 chatop AppWindow 的拖拽约定（react-rnd dragHandleClassName）。
 * 老外壳/无能力时 shell 缺 windows API → 回落默认标题栏，按钮不渲染。
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
  starting: 'ChatOffice 引擎启动中…',
  missing: 'ChatOffice sidecar 未打包（在 chatoffice 仓库运行 npm run package:plugin）',
  failed: 'ChatOffice 引擎启动失败（详见 dsh 日志）',
}

const isMac = () => /mac/i.test(navigator.platform || '')

/** win 三钮（— □ ✕） */
function WinButtons({ shell, windowId, maximized }) {
  const [hover, setHover] = React.useState(null)
  const btn = (key, glyph, label, onClick, danger) => (
    <button
      key={key}
      title={label}
      onMouseEnter={() => setHover(key)}
      onMouseLeave={() => setHover(null)}
      onClick={onClick}
      style={{
        width: 46, height: '100%', border: 'none', cursor: 'pointer', font: '12px/1 system-ui',
        color: hover === key ? (danger ? '#fff' : '#222') : '#ddd',
        background: danger && hover === key ? '#e81123' : 'transparent',
        display: 'grid', placeItems: 'center',
      }}
    >
      {glyph}
    </button>
  )
  return (
    <div style={{ height: '100%', display: 'flex' }}>
      {btn('min', '—', '最小化', () => shell.windows.minimize(windowId))}
      {btn('max', maximized ? '❐' : '□', maximized ? '还原' : '最大化', () => shell.windows.toggleMaximize(windowId))}
      {btn('close', '✕', '关闭', () => shell.windows.close(windowId), true)}
    </div>
  )
}

/** mac 交通灯（红黄绿） */
function MacTrafficLights({ shell, windowId }) {
  const [hover, setHover] = React.useState(null)
  const dot = (key, color, glyph, label, onClick) => (
    <button
      key={key}
      title={label}
      onMouseEnter={() => setHover(key)}
      onMouseLeave={() => setHover(null)}
      onClick={onClick}
      style={{
        width: 12, height: 12, borderRadius: '50%', border: 'none', cursor: 'pointer',
        background: hover ? color : 'rgba(255,255,255,0.22)',
        color: 'rgba(0,0,0,0.55)', font: '9px/12px system-ui', display: 'grid', placeItems: 'center',
      }}
    >
      {hover ? glyph : ''}
    </button>
  )
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', gap: 8 }}>
      {dot('close', '#ff5f57', '✕', '关闭', () => shell.windows.close(windowId))}
      {dot('min', '#febc2e', '—', '最小化', () => shell.windows.minimize(windowId))}
      {dot('max', '#28c840', '⤢', '全屏', () => shell.windows.toggleMaximize(windowId))}
    </div>
  )
}

function ChatOfficeApp({ windowId, maximized }) {
  const [origin, setOrigin] = useState(null)
  const [status, setStatus] = useState('starting')

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch('/api/chatoffice/status')
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
          height: '100%', display: 'grid', placeItems: 'center', background: '#1e1f22',
          color: '#b8b8b8', font: '13px/1.6 system-ui, sans-serif', textAlign: 'center', padding: 24,
        }}
      >
        <div>
          <div style={{ fontSize: 22, marginBottom: 8 }}>📄</div>
          {STATUS_TEXT[status] ?? STATUS_TEXT.starting}
        </div>
      </div>
    )
  }

  const shell = typeof window !== 'undefined' ? window.__chatop_shell__ : null
  const canChrome = !!(shell && shell.windows && windowId)

  return (
    <div style={{ position: 'relative', height: '100%', background: '#fff' }}>
      <iframe
        src={origin}
        title="ChatOffice"
        style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: '#fff' }}
        allow="clipboard-read; clipboard-write"
      />
      {canChrome && isMac() && (
        <div
          className="window-drag-handle"
          style={{
            position: 'absolute', top: 0, left: 0, height: 38, width: 84, display: 'flex',
            alignItems: 'center', paddingLeft: 12, cursor: 'grab', userSelect: 'none',
          }}
        >
          <MacTrafficLights shell={shell} windowId={windowId} />
        </div>
      )}
      {canChrome && !isMac() && (
        <div
          className="window-drag-handle"
          style={{ position: 'absolute', top: 0, left: 96, right: 142, height: 10, cursor: 'grab' }}
        />
      )}
      {canChrome && !isMac() && (
        <div style={{ position: 'absolute', top: 0, right: 0, height: 38 }}>
          <WinButtons shell={shell} windowId={windowId} maximized={maximized} />
        </div>
      )}
    </div>
  )
}

function tryRegister() {
  const shell = typeof window !== 'undefined' ? window.__chatop_shell__ : null
  if (shell && typeof shell.registerDesktopApp === 'function') {
    shell.registerDesktopApp({
      id: 'chatoffice',
      label: 'ChatOffice',
      icon: ICON_URI,
      order: 52,
      chrome: 'self', // WPS 式一行窗口：应用自绘控制按钮（老外壳自动回落默认标题栏）
      comp: React.createElement(ChatOfficeApp),
    })
  }
}

export const inject = []

/** dsh client 契约：client 模块暴露 apply()；注册动作在此外发。 */
export function apply() {
  tryRegister()
}

tryRegister()
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
