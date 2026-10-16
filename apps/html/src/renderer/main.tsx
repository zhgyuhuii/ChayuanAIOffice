import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang, type Lang } from '@chaoffice/i18n'
import App from './App'
import { PresentView } from './PresentView'
import { LocaleProvider } from './i18n/locale'
import type { UiTheme } from '../shared/ipc'
import { applyAiPanelPrefs, installScreenTips } from '@chaoffice/ui'
import '@chaoffice/ui/tokens.css'
import '@chaoffice/ui/screentip.css'
import '@chaoffice/ui/ai-model-picker.css'
import '@chaoffice/ui/ai-queue-strip.css'
import '@chaoffice/ui/ai-usage.css'
import '@chaoffice/ui/dropdown.css'
import '@chaoffice/ui/dock.css'
import '@chaoffice/ui/find-panel.css'
import '@chaoffice/ui/color-picker.css'
import '@chaoffice/ui/ribbon-collapse.css'
import '@chaoffice/ui/ai-panel-prefs.css'
import '@chaoffice/ui/ai-scope-quote.css'
import '@chaoffice/ui/image-dialogs.css'
import '@chaoffice/ui/files-pane.css'
import './styles.css'

installScreenTips()

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

void (async () => {
  const [lang, theme] = await Promise.all([
    window.htmlApi.getLanguage().catch(() => 'zh' as const),
    window.htmlApi.getTheme().catch(() => 'system' as const),
  ])
  document.documentElement.lang = htmlLang(lang as Lang)
  document.documentElement.dir = htmlDir(lang)
  applyTheme(theme)
  window.htmlApi.onThemeChanged(applyTheme)
  await window.htmlApi
    ?.getAiPanelPrefs?.()
    .then(applyAiPanelPrefs)
    .catch(() => {})
  window.htmlApi?.onAiPanelPrefsChanged?.(applyAiPanelPrefs)
  // a present tab/window (opened by Present → New tab) renders only its owner's preview
  const params = new URLSearchParams(location.search)
  const present = params.has('present')
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider initial={lang}>
      {present ? <PresentView title={params.get('title') ?? ''} /> : <App />}
    </LocaleProvider>,
  )
})()
