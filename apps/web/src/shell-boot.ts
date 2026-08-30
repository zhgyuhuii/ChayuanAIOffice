/**
 * Web host boot: installs the web bridge shims BEFORE the (unmodified) shell
 * renderer starts, wires the in-page tab manager into the shell's content
 * area, then hands control to the original main.tsx.
 */

import { registerBatch1Degradations } from '@genoffice/web-bridge'
import { installShellShims } from './host/shell-shims.js'
import { startBridgeHost } from './host/bridge-host.js'
import { tabManager } from './host/tab-manager.js'

registerBatch1Degradations()
installShellShims()
startBridgeHost()

// Editor iframe layer: absolutely positioned over the shell's content area.
const layer = document.createElement('div')
layer.style.cssText = 'position:fixed;z-index:1;background:#fff;display:none'
document.body.appendChild(layer)

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
