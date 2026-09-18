import ReactDOM from 'react-dom/client'
import { htmlLang, type Lang } from '@chatoffice/i18n'
import { applyAiPanelPrefs, installScreenTips } from '@chatoffice/ui'
import type { DesktopApi } from '../shared/desktop-api'

import '@chatoffice/ui/tokens.css'
import '@chatoffice/ui/screentip.css'
import '@chatoffice/ui/color-picker.css'
import '@chatoffice/ui/dropdown.css'
import '@chatoffice/ui/dock.css'
import '@chatoffice/ribbon/tab-strip.css'
import '@chatoffice/ui/ribbon-collapse.css'
import '@chatoffice/ui/markdown.css'
import '@chatoffice/ui/ai-panel-prefs.css'
import '@chatoffice/ui/ai-scope-quote.css'
import '@univerjs/preset-sheets-core/lib/index.css'

import { App } from './App'
import { installCanvasFontFallback, registerCellFontAliases } from './cell-font-fallback'
import { LocaleProvider, setModuleLang } from './i18n/locale'
import type { UiTheme } from '../shared/desktop-api'
import './styles.css'
import { installAnchorPanelFallback } from '@chatoffice/ui'

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', ({ updates }) => {
    const replacesUniverRuntime = updates.some(
      ({ path }) => path.endsWith('/App.tsx') || path.endsWith('/univer-sync.ts'),
    )
    if (replacesUniverRuntime) window.location.reload()
  })
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing application root.')

installScreenTips()
installCanvasFontFallback()

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

// Canvas fillText never triggers @font-face downloads, so the bundled Carlito
// faces (Calibri/Aptos aliases in styles.css) must be loaded before Univer's
// first skeleton — MDW, wrap points, and #### overflow all measure with them.
async function loadCellFonts(): Promise<void> {
  const loads: Promise<unknown>[] = [registerCellFontAliases()]
  for (const variant of ['', 'bold ', 'italic ', 'italic bold ']) {
    for (const family of ['Calibri', 'Aptos', "'Aptos Narrow'", 'Carlito']) {
      loads.push(document.fonts?.load?.(`${variant}16px ${family}`)?.catch(() => {}) ?? [])
    }
  }
  // Local assets resolve in milliseconds; the timeout only guards a broken
  // bundle from blanking the app.
  await Promise.race([Promise.all(loads), new Promise((resolve) => setTimeout(resolve, 3000))])
}

// Bare renderer run (npm run dev:renderer without Electron or the web-bridge
// host): the preload bridge never arrives and mount effects would trip over
// the missing window.desktopApi (white screen). Install a stand-in before
// first render: on* subscriptions return a no-op unsubscriber, commands reject
// so the existing .catch paths surface toasts instead of crashing. Real hosts
// inject the bridge before this module executes and are left untouched.
if (!window.desktopApi) {
  const stub = new Proxy({} as DesktopApi, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined
      if (/^on[A-Z]/.test(prop)) return () => {}
      return () => Promise.reject(new Error(`desktopApi.${prop}: 无主进程桥接（裸 web 渲染器）`))
    },
  })
  ;(window as { desktopApi?: DesktopApi }).desktopApi = stub
}

async function bootstrap(): Promise<void> {
  let lang: Lang = 'zh'
  let theme: UiTheme = 'system'
  try {
    // per-promise catch: standalone runs have no app:get-theme handler, and
    // that rejection must not drop a resolved language
    ;[lang, theme] = await Promise.all([
      window.desktopApi.getLanguage().catch(() => 'zh' as const),
      window.desktopApi.getTheme().catch(() => 'system' as const),
    ])
  } catch {
    /* dev renderer without the preload bridge */
  }
  setModuleLang(lang)
  document.documentElement.lang = htmlLang(lang)
  applyTheme(theme)
  await loadCellFonts()
  window.desktopApi?.onThemeChanged(applyTheme)
  void window.desktopApi
    ?.getAiPanelPrefs?.()
    .then(applyAiPanelPrefs)
    .catch(() => {})
  window.desktopApi?.onAiPanelPrefsChanged?.(applyAiPanelPrefs)
  ReactDOM.createRoot(root!).render(
    <LocaleProvider initial={lang}>
      <App />
    </LocaleProvider>,
  )
}

void bootstrap()

installAnchorPanelFallback()
