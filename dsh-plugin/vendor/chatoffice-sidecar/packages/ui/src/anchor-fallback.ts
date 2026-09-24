/**
 * CSS Anchor Positioning fallback for older browsers (八-5).
 *
 * The three editors' ribbon panels (.gs-dd-pop / .rb-drop / .menu-select-drop /
 * .rb-collapse-panel / .file-menu) are `position: fixed` + anchored to their
 * trigger wrapper. On engines without anchor positioning those anchor
 * declarations are dropped and the panels land at the viewport origin —
 * invisible or covering content. This observer-based shim repositions every
 * mounted panel below its trigger wrapper (with a right-edge flip), refreshing
 * on resize/scroll. Modern Chromium (Electron 43+) keeps the native path and
 * the shim never activates.
 *
 * Panels rendered into body portals whose anchor wrapper is not their parent
 * are out of scope (they carry their own fallbacks or degrade closed).
 */

// docs names its anchored panels per-family (layout-menu/color-palette/…), while
// slides/sheets share .rb-drop/.menu-select-drop; .sheets-color-pop's body-portal
// variant has no wrapper parentElement to anchor to and stays out of scope.
const PANEL_SEL = [
  // slides / sheets / shared
  '.gs-dd-pop',
  '.rb-drop',
  '.menu-select-drop',
  '.rb-collapse-panel',
  '.file-menu',
  '.sheets-color-pop',
  // docs (anchored panel families, styles.css `position-anchor` users)
  '.color-palette',
  '.layout-menu',
  '.spacing-menu',
  '.cover-gallery',
  '.table-picker',
  '.symbol-palette',
  '.shape-palette',
  '.wordart-palette',
  '.dropcap-menu',
  '.equation-gallery',
  '.docs-color-pop',
].join(', ')

function anchorPositioningSupported(): boolean {
  try {
    return typeof CSS !== 'undefined' && CSS.supports('top: anchor(bottom)')
  } catch {
    return false
  }
}

export function installAnchorPanelFallback(): void {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return
  if (anchorPositioningSupported()) return

  const place = (el: HTMLElement): void => {
    const wrap = el.parentElement
    if (!wrap || !el.isConnected) return
    const r = wrap.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return // trigger hidden — leave as-is
    el.style.top = `${Math.round(r.bottom + 4)}px`
    if (r.left + el.offsetWidth > window.innerWidth - 8) {
      el.style.left = 'auto'
      el.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`
    } else {
      el.style.left = `${Math.round(r.left)}px`
      el.style.right = 'auto'
    }
  }

  const refreshAll = (): void => {
    document.querySelectorAll<HTMLElement>(PANEL_SEL).forEach(place)
  }

  let queued = false
  const scheduleRefresh = (): void => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      refreshAll()
    })
  }

  const mo = new MutationObserver(scheduleRefresh)
  mo.observe(document.body, { childList: true, subtree: true })
  window.addEventListener('resize', refreshAll, { passive: true })
  // capture: ribbon bodies scroll in inner containers, not the window
  window.addEventListener('scroll', refreshAll, { capture: true, passive: true })
  refreshAll()
}
