import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang, type Lang } from '@chatoffice/i18n'
import { App } from './App'
import { LocaleProvider, setModuleLang } from './i18n/locale'
import type { DocTheme, UiTheme } from '../shared/ipc'
import '@chatoffice/ui/tokens.css'
import '@chatoffice/ui/screentip.css'
import '@chatoffice/ui/color-picker.css'
import '@chatoffice/ui/dropdown.css'
import '@chatoffice/ui/dock.css'
import '@chatoffice/ui/ribbon-collapse.css'
import '@chatoffice/ui/markdown.css'
import '@chatoffice/ui/ai-panel-prefs.css'
import '@chatoffice/ui/ai-scope-quote.css'
import '@chatoffice/ui/image-viewer.css'
import './styles.css'
import './fonts/fonts.css'
import { applyAiPanelPrefs, installScreenTips } from '@chatoffice/ui'
import { setAltChunkHtmlConverter } from '@chatoffice/docx-engine'

installScreenTips()
if (window.desktop?.convertAltChunkHtml) {
  setAltChunkHtmlConverter((html) => window.desktop.convertAltChunkHtml(html))
}

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

function applyDocumentTheme(theme: DocTheme): void {
  // data-doc-theme drives the canvas/paper (#1811); absent means 'follow' the UI theme
  if (theme === 'follow') document.documentElement.removeAttribute('data-doc-theme')
  else document.documentElement.setAttribute('data-doc-theme', theme)
}

async function bootstrap(): Promise<void> {
  let lang: Lang = 'zh'
  let theme: UiTheme = 'system'
  let docTheme: DocTheme = 'follow'
  try {
    // per-promise catch: standalone runs have no app:get-theme handler, and
    // that rejection must not drop a resolved language
    ;[lang, theme, docTheme] = await Promise.all([
      window.desktop.getLanguage().catch(() => 'zh' as const),
      window.desktop.getTheme().catch(() => 'system' as const),
      window.desktop.getDocumentTheme?.().catch(() => 'follow' as const),
    ])
  } catch {
    /* dev renderer without the preload bridge */
  }
  setModuleLang(lang)
  document.documentElement.lang = htmlLang(lang)
  document.documentElement.dir = htmlDir(lang)
  applyTheme(theme)
  applyDocumentTheme(docTheme ?? 'follow')
  window.desktop?.onThemeChanged(applyTheme)
  window.desktop?.onDocumentThemeChanged?.(applyDocumentTheme)
  await window.desktop
    ?.getAiPanelPrefs?.()
    .then(applyAiPanelPrefs)
    .catch(() => {})
  window.desktop?.onAiPanelPrefsChanged?.(applyAiPanelPrefs)
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider initial={lang}>
      <App />
    </LocaleProvider>,
  )
}

void bootstrap()
