import ReactDOM from 'react-dom/client'
import { htmlDir, htmlLang, type Lang } from '@chaoffice/i18n'
import type { DesktopApi } from '../shared/desktop-api'
import { applyAiPanelPrefs, installScreenTips } from '@chaoffice/ui'

import '@chaoffice/ui/tokens.css'
import '@chaoffice/ui/screentip.css'
import '@chaoffice/ui/ai-model-picker.css'
import '@chaoffice/ui/ai-queue-strip.css'
import '@chaoffice/ui/ai-usage.css'
import '@chaoffice/ui/ai-skills.css'
import '@chaoffice/ui/color-picker.css'
import '@chaoffice/ui/dropdown.css'
import '@chaoffice/ui/dock.css'
import '@chaoffice/ribbon/tab-strip.css'
import '@chaoffice/ui/ribbon-collapse.css'
import '@chaoffice/ui/markdown.css'
import '@chaoffice/ui/ai-panel-prefs.css'
import '@chaoffice/ui/ai-scope-quote.css'
import '@chaoffice/ui/image-viewer.css'
import '@univerjs/preset-sheets-core/lib/index.css'

import { App } from './App'
import {
  installCanvasFontFallback,
  registerTextDingbatsFace,
  untilCellFontsLoaded,
} from './cell-font-fallback'
import { connectMeasurementUnit } from '@chaoffice/ui/use-measurement-unit'
import { LocaleProvider, setModuleLang } from './i18n/locale'
import { separatorsForLocale, setNumberSeparators } from './number-separators'
import type { DocTheme, UiTheme } from '../shared/desktop-api'
import './styles.css'
// LOCAL(2026-11-19, main@b4f4499d3): ZCode-style visual language — kept after the
// host stylesheets so its scoped overrides win the cascade
// LOCAL(2026-11-19, main@b4f4499d3): FilesPane base styles (side pane host)
import '@chaoffice/ui/files-pane.css'
import '@chaoffice/ui/zcode-theme.css'
import { installAnchorPanelFallback } from '@chaoffice/ui'

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

function applyDocumentTheme(theme: DocTheme): void {
  // data-doc-theme drives the canvas/paper (chaoffice#1811); absent means 'follow' the UI theme
  if (theme === 'follow') document.documentElement.removeAttribute('data-doc-theme')
  else document.documentElement.setAttribute('data-doc-theme', theme)
}

// Canvas fillText never triggers @font-face downloads, so the bundled Carlito
// faces (Calibri/Aptos aliases in styles.css) must be loaded before Univer's
// first skeleton — MDW, wrap points, and #### overflow all measure with them.
// The Office-font aliases load with each workbook (openLazyWorkbook).
async function loadCellFonts(): Promise<void> {
  const loads: Promise<unknown>[] = [registerTextDingbatsFace()]
  for (const variant of ['', 'bold ', 'italic ', 'italic bold ']) {
    for (const family of ['Calibri', 'Aptos', "'Aptos Narrow'", 'Carlito']) {
      loads.push(document.fonts?.load?.(`${variant}16px ${family}`)?.catch(() => {}) ?? [])
    }
  }
  await untilCellFontsLoaded(Promise.all(loads))
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
  let docTheme: DocTheme = 'follow'
  try {
    // per-promise catch: standalone runs have no app:get-theme handler, and
    // that rejection must not drop a resolved language
    let numberLocale: string | undefined
    ;[lang, theme, docTheme, numberLocale] = await Promise.all([
      window.desktopApi.getLanguage().catch(() => 'zh' as const),
      window.desktopApi.getTheme().catch(() => 'system' as const),
      window.desktopApi.getDocumentTheme?.().catch(() => 'follow' as const),
      window.desktopApi.getNumberLocale?.().catch(() => undefined),
    ])
    setNumberSeparators(separatorsForLocale(numberLocale))
  } catch {
    /* dev renderer without the preload bridge */
  }
  setModuleLang(lang)
  document.documentElement.lang = htmlLang(lang)
  document.documentElement.dir = htmlDir(lang)
  applyTheme(theme)
  applyDocumentTheme(docTheme ?? 'follow')
  await loadCellFonts()
  window.desktopApi?.onThemeChanged(applyTheme)
  window.desktopApi?.onDocumentThemeChanged?.(applyDocumentTheme)
  const api = window.desktopApi
  if (api?.getMeasurementUnit && api.onMeasurementUnitChanged)
    connectMeasurementUnit({
      get: () => api.getMeasurementUnit!(),
      onChanged: (handler) => api.onMeasurementUnitChanged!(handler),
    })
  await window.desktopApi
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
