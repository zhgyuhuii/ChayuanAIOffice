import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang, type Lang } from '@chaoffice/i18n'
import App from './App'
import { LocaleProvider } from './i18n/locale'
import type { UiTheme } from '../shared/ipc'
import '@chaoffice/ui/tokens.css'
import '@chaoffice/ui/dock.css'
import '@chaoffice/ui/screentip.css'
import '@chaoffice/ui/ai-model-picker.css'
import '@chaoffice/ui/ai-queue-strip.css'
import '@chaoffice/ui/ai-usage.css'
import '@chaoffice/ui/ai-skills.css'
import '@chaoffice/ui/color-picker.css'
import '@chaoffice/ui/dropdown.css'
import '@chaoffice/ribbon/tab-strip.css'
import '@chaoffice/ui/ribbon-collapse.css'
import '@chaoffice/ui/markdown.css'
import '@chaoffice/ui/ai-panel-prefs.css'
import '@chaoffice/ui/ai-scope-quote.css'
import '@chaoffice/ui/files-pane.css'
import './styles.css'
import { applyAiPanelPrefs, installScreenTips } from '@chaoffice/ui'

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
  document.documentElement.dir = htmlDir(lang)
  applyTheme(theme)
  window.pdfApi.onThemeChanged(applyTheme)
  await window.pdfApi
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
