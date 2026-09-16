import { createRoot } from 'react-dom/client'
import { htmlLang, type Lang } from '@chatoffice/i18n'
import App from './App'
import { LocaleProvider } from './i18n/locale'
import type { UiTheme } from '../shared/ipc'
import '@chatoffice/ui/tokens.css'
import '@chatoffice/ui/screentip.css'
import '@chatoffice/ui/color-picker.css'
import '@chatoffice/ui/dropdown.css'
import '@chatoffice/ribbon/tab-strip.css'
import '@chatoffice/ui/ribbon-collapse.css'
import '@chatoffice/ui/markdown.css'
import '@chatoffice/ui/ai-panel-prefs.css'
import '@chatoffice/ui/ai-scope-quote.css'
import '@chatoffice/ui/files-pane.css'
import './styles.css'
import { applyAiPanelPrefs, installScreenTips } from '@chatoffice/ui'

installScreenTips()

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

void (async () => {
  const [lang, theme] = await Promise.all([
    window.pdfApi.getLanguage().catch(() => 'zh' as const),
    window.pdfApi.getTheme().catch(() => 'system' as const),
  ])
  document.documentElement.lang = htmlLang(lang as Lang)
  applyTheme(theme)
  window.pdfApi.onThemeChanged(applyTheme)
  void window.pdfApi
    ?.getAiPanelPrefs?.()
    .then(applyAiPanelPrefs)
    .catch(() => {})
  window.pdfApi?.onAiPanelPrefsChanged?.(applyAiPanelPrefs)
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider initial={lang}>
      <App />
    </LocaleProvider>,
  )
})()
