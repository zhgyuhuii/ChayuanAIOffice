/**
 * Web host boot: installs the web bridge shims BEFORE the (unmodified) shell
 * renderer starts, wires the in-page tab manager into the shell's content
 * area, then hands control to the original main.tsx.
 */

import { registerBatch1Degradations } from '@chatoffice/web-bridge'
import { installShellShims } from './host/shell-shims.js'
import { startBridgeHost } from './host/bridge-host.js'
import { tabManager } from './host/tab-manager.js'
import { dockHost } from './host/dock.js'

registerBatch1Degradations()
installShellShims()
startBridgeHost()

// WPS 式一行窗口让位（共识 v2.3）：chatop 形态下窗口按钮叠加在 TabBar 两端——
// mac 交通灯占左 ~84px，win 三钮占右 ~138px，给标签条留出对应内边距。
// 判定：宿主页在 chatop 窗口 iframe 内时（parent !== self）才让位，纯浏览器不偏移。
if (window.parent !== window) {
  const style = document.createElement('style')
  const mac = /mac/i.test(navigator.platform || '')
  const pad = mac ? 'padding-left: 84px;' : 'padding-right: 138px;'
  style.textContent = `.tab-bar{${pad}}`
  document.head.appendChild(style)
}

// Editor iframe layer: absolutely positioned over the shell's content area.
const layer = document.createElement('div')
layer.style.cssText = 'position:fixed;z-index:1;background:#fff;display:none'
document.body.appendChild(layer)

// Dock iframe layer (P1): the Home right pane's docked editors — positioned
// from the shell renderer's mirrored .dock-area rect via chatOfficeDock.setRect
const dockLayer = document.createElement('div')
document.body.appendChild(dockLayer)
dockHost.attach(dockLayer)

// The shell mounts async (language/theme bootstrap); poll briefly for the
// content anchor so the layer tracks .app-frame-content from first paint.
let anchored = false
const anchorTimer = setInterval(() => {
  const anchor = document.querySelector<HTMLElement>('.app-frame-content')
  if (anchor) {
    clearInterval(anchorTimer)
    if (!anchored) {
      anchored = true
      tabManager.attach(layer, anchor)
    }
  }
}, 50)
setTimeout(() => clearInterval(anchorTimer), 30_000)

// Then the ORIGINAL renderer — zero modifications.
import('../../shell/src/renderer/src/main')
