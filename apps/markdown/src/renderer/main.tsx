import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang, type Lang } from '@chaoffice/i18n'
import App from './App'
import { LocaleProvider } from './i18n/locale'
import type { DocTheme, UiTheme } from '../shared/ipc'
import '@chaoffice/ui/tokens.css'
import '@chaoffice/ui/screentip.css'
import '@chaoffice/ui/ai-model-picker.css'
import '@chaoffice/ui/ai-queue-strip.css'
import '@chaoffice/ui/ai-usage.css'
import '@chaoffice/ui/ai-skills.css'
import '@chaoffice/ui/dropdown.css'
import '@chaoffice/ui/dock.css'
import '@chaoffice/ui/ribbon-collapse.css'
import '@chaoffice/ui/markdown.css'
import '@chaoffice/ui/ai-panel-prefs.css'
import '@chaoffice/ui/ai-scope-quote.css'
import '@chaoffice/ui/find-panel.css'
import '@chaoffice/ui/files-pane.css'
import '@chaoffice/ui/image-viewer.css'
import 'katex/dist/katex.min.css'
import './styles.css'
import './markdown-themes.css'
// LOCAL(2026-11-19, main@b4f4499d3): ZCode-style visual language — kept after the
// host stylesheets so its scoped overrides win the cascade
import '@chaoffice/ui/zcode-theme.css'
import { applyAiPanelPrefs, installScreenTips } from '@chaoffice/ui'
import type { MarkdownTheme } from '../shared/markdown-theme'

installScreenTips()

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

function applyMarkdownTheme(theme: MarkdownTheme): void {
  // a picked paper theme overrides the light/dark document theme for the paper
  if (theme === 'default') document.documentElement.removeAttribute('data-markdown-theme')
  else document.documentElement.setAttribute('data-markdown-theme', theme)
}

function applyDocumentTheme(theme: DocTheme): void {
  // data-doc-theme drives the preview paper (chaoffice#1811); absent means 'follow' the UI theme
  if (theme === 'follow') document.documentElement.removeAttribute('data-doc-theme')
  else document.documentElement.setAttribute('data-doc-theme', theme)
}

void (async () => {
  const [lang, theme, docTheme, mdTheme] = await Promise.all([
    window.markdownApi.getLanguage().catch(() => 'zh' as const),
    window.markdownApi.getTheme().catch(() => 'system' as const),
    window.markdownApi.getDocumentTheme?.().catch(() => 'follow' as const),
    window.markdownApi.getMarkdownTheme?.().catch(() => 'default' as const),
  ])
  document.documentElement.lang = htmlLang(lang as Lang)
  document.documentElement.dir = htmlDir(lang)
  applyTheme(theme)
  applyDocumentTheme(docTheme ?? 'follow')
  applyMarkdownTheme(mdTheme)
  window.markdownApi.onThemeChanged(applyTheme)
  window.markdownApi.onDocumentThemeChanged?.(applyDocumentTheme)
  // aiPanelInitiallyOpen (App boot) reads the shell prefs — apply them pre-render
  await window.markdownApi
    ?.getAiPanelPrefs?.()
    .then(applyAiPanelPrefs)
    .catch(() => {})
  window.markdownApi?.onAiPanelPrefsChanged?.(applyAiPanelPrefs)
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider initial={lang}>
      <App />
    </LocaleProvider>,
  )
})()
