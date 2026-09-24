import React from 'react'
import { createRoot } from 'react-dom/client'
import { htmlLang, type Lang } from '@chatoffice/i18n'
import { App } from './App'
import { AudienceView } from './components/AudienceView'
import { LocaleProvider, setModuleLang } from './i18n/locale'
import type { SlidesApi } from '../shared/ipc'
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
import type { UiTheme } from '../shared/ipc'
import '@chatoffice/ui/files-pane.css'
import './styles.css'
import { applyAiPanelPrefs, installScreenTips } from '@chatoffice/ui'
import { installAnchorPanelFallback } from '@chatoffice/ui'

installScreenTips()

// Canvas fillText never triggers @font-face downloads, so the bundled document fonts
// (Carlito ↔ Calibri) must be loaded explicitly or Konva silently draws the fallback face.
for (const variant of ['', 'bold ', 'italic ', 'italic bold ']) {
  document.fonts?.load?.(`${variant}16px Carlito`).catch(() => {})
  document.fonts?.load?.(`${variant}16px 'Carlito GO'`).catch(() => {})
}

// ?mode=audience: the presenter view's external-screen audience show window (created by the main process)
const mode = new URLSearchParams(window.location.search).get('mode')

// macOS windows are created with vibrancy; let the thumbnail pane show it
// (the audience show window stays fully opaque)
if (mode !== 'audience' && navigator.platform.toLowerCase().includes('mac'))
  document.body.classList.add('vib')

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

// Bare renderer run (npm run dev:renderer without Electron or the web-bridge
// host): the preload bridge never arrives and every mount effect would trip
// over the missing window.slidesApi (white screen). Install a stand-in before
// first render: on* subscriptions return a no-op unsubscriber, commands reject
// so the existing .catch paths surface toasts instead of crashing. Real hosts
// inject the bridge before this module executes and are left untouched.
if (!window.slidesApi) {
  const stub = new Proxy({} as SlidesApi, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined
      if (/^on[A-Z]/.test(prop)) return () => {}
      return () => Promise.reject(new Error(`slidesApi.${prop}: 无主进程桥接（裸 web 渲染器）`))
    },
  })
  window.slidesApi = stub
}

async function bootstrap(): Promise<void> {
  let lang: Lang = 'zh'
  let theme: UiTheme = 'system'
  try {
    // per-promise catch: standalone runs have no app:get-theme handler, and
    // that rejection must not drop a resolved language
    ;[lang, theme] = await Promise.all([
      window.slidesApi.getLanguage().catch(() => 'zh' as const),
      window.slidesApi.getTheme().catch(() => 'system' as const),
    ])
  } catch {
    /* dev renderer without the preload bridge */
  }
  setModuleLang(lang)
  document.documentElement.lang = htmlLang(lang)
  // the audience show window renders slide content only — it never themes
  if (mode !== 'audience') {
    applyTheme(theme)
    window.slidesApi?.onThemeChanged(applyTheme)
    void window.slidesApi
      ?.getAiPanelPrefs?.()
      .then(applyAiPanelPrefs)
      .catch(() => {})
    window.slidesApi?.onAiPanelPrefsChanged?.(applyAiPanelPrefs)
  }
  installAnchorPanelFallback()
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <LocaleProvider initial={lang}>
        {mode === 'audience' ? <AudienceView /> : <App />}
      </LocaleProvider>
    </React.StrictMode>,
  )
}

void bootstrap()
