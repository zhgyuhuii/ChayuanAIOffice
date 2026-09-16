import type { AiPanelPrefs } from '@chatoffice/ui/ai-panel-prefs'
import {
  aiPanelFontPx,
  AiFontSize,
  DEFAULT_AI_PANEL_PREFS,
  clampAiCustomFontSize,
  AI_CUSTOM_FONT_MIN_PX,
  AI_CUSTOM_FONT_MAX_PX,
} from '@chatoffice/ui/ai-panel-prefs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ModelSettingsPage } from '@chatoffice/ui/ModelSettingsPage'
import type { ModelSettingsBridge } from '@chatoffice/ui/ModelSettingsPage'
import { ModelDefaultsPage } from '@chatoffice/ui/ModelDefaultsPage'
import { Dropdown } from '@chatoffice/ui'
import {
  AI_SEARCH_PROVIDERS,
  AI_MEDIA_PROVIDERS,
} from '@chatoffice/ai-provider/browser'
import type {
  AiSearchProviderId,
  AiSettingsV2,
  AiMediaProviderId,
  AiMediaSettings,
  AiSearchSettings,
} from '@chatoffice/ai-provider/browser'
import { useI18n } from './locale'
import type { StringKey, TFunc } from './locale'
import type { AccountStatus, UiTheme } from '../../shared/home-api'
import { ProviderLogo } from './provider-logos'
import { StoragePane } from './StoragePane'
import { IntegrationsPane, skillUpdateDue } from './IntegrationsPane'
import './settings.css'

// ── Settings modal (opened from the account menu) ─────────
// ChatOffice-style two-pane dialog: section nav on the left, fields on the right.
// All values go through the existing home IPC; nothing is stored locally.

// sorted by ISO 639 language code — native-script labels have no natural
// shared alphabet, so the code is the ordering key
const LANG_OPTIONS = [
  { value: 'ar', label: 'العربية' },
  { value: 'cs', label: 'Čeština' },
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'he', label: 'עברית' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'it', label: 'Italiano' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'ms', label: 'Bahasa Melayu' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'pl', label: 'Polski' },
  { value: 'pt', label: 'Português' },
  { value: 'ru', label: 'Русский' },
  { value: 'th', label: 'ไทย' },
  { value: 'zh', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
] as const

// GenMail's option order: follow-system first, then the manual picks
const THEME_OPTIONS = [
  { value: 'system', labelKey: 'themeSystem' },
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
] as const satisfies readonly { value: UiTheme; labelKey: StringKey }[]

const AI_FONT_SIZE_OPTIONS = [
  { value: 'default', labelKey: 'aiFontSizeDefault' },
  { value: 'large', labelKey: 'aiFontSizeLarge' },
  { value: 'xlarge', labelKey: 'aiFontSizeXLarge' },
  { value: 'custom', labelKey: 'aiFontSizeCustom' },
] as const satisfies readonly { value: AiFontSize; labelKey: StringKey }[]

const CHANNEL_OPTIONS = [
  { value: 'stable', labelKey: 'channelStable' },
  { value: 'beta', labelKey: 'channelBeta' },
] as const satisfies readonly { value: 'stable' | 'beta'; labelKey: StringKey }[]

/** GitHub-style abbreviated stargazer count (2591 → "2.6k") — the number is
 * social proof, not a metric; the cached/exact value would only look stale */
function formatStars(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return `${k >= 100 ? Math.round(k) : (Math.round(k * 10) / 10).toString().replace(/\.0$/, '')}k`
}

type SectionId =
  | 'modelSettings'
  | 'defaultModels'
  | 'remoteStorage'
  | 'general'
  | 'integrations'
  | 'account'
  | 'aiModel'
  | 'aiMedia'
  | 'mcp'
  | 'about'
/** px stepper for the custom AI panel text size; in-range values apply live,
 * out-of-range or partial input is clamped on blur */
function CustomFontSizeInput({
  value,
  label,
  onCommit,
}: {
  value: number
  label: string
  onCommit: (px: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)
  const shown = editing ? draft : String(value)
  const commit = (raw: string) => {
    const px = clampAiCustomFontSize(raw)
    if (px !== null && px !== value) onCommit(px)
  }
  return (
    <label className="set-num">
      <input
        type="number"
        className="set-input set-num-input"
        aria-label={label}
        min={AI_CUSTOM_FONT_MIN_PX}
        max={AI_CUSTOM_FONT_MAX_PX}
        step={1}
        value={shown}
        onFocus={() => {
          setDraft(String(value))
          setEditing(true)
        }}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = Number(e.target.value)
          if (Number.isInteger(n) && n >= AI_CUSTOM_FONT_MIN_PX && n <= AI_CUSTOM_FONT_MAX_PX) {
            onCommit(n)
          }
        }}
        onBlur={() => {
          commit(draft)
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      <span className="set-num-unit">px</span>
    </label>
  )
}

const SECTIONS: readonly { id: SectionId; labelKey: StringKey }[] = [
  { id: 'modelSettings', labelKey: 'setSecModelSettings' },
  { id: 'defaultModels', labelKey: 'setSecDefaultModels' },
  { id: 'aiMedia', labelKey: 'setSecAiMedia' },
  { id: 'remoteStorage', labelKey: 'setSecRemoteStorage' },
  { id: 'general', labelKey: 'setSecGeneral' },
  { id: 'integrations', labelKey: 'setSecIntegrations' },
  { id: 'mcp', labelKey: 'setSecMcp' },
  { id: 'about', labelKey: 'setSecAbout' },
]

function SectionIcon({ id }: { id: SectionId }) {
  if (id === 'remoteStorage') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <ellipse cx="8" cy="4.2" rx="5.3" ry="2.2" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M2.7 4.2v7.6c0 1.2 2.37 2.2 5.3 2.2s5.3-1 5.3-2.2V4.2"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path
          d="M2.7 8c0 1.2 2.37 2.2 5.3 2.2s5.3-1 5.3-2.2"
          stroke="currentColor"
          strokeWidth="1.3"
        />
      </svg>
    )
  }
  if (id === 'defaultModels') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3 4.2h7M3 8h10M3 11.8h5.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (id === 'modelSettings') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 1.8 9.5 6l4.2 1.5L9.5 9 8 13.2 6.5 9 2.3 7.5 6.5 6 8 1.8Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M12.8 11.2v3M11.3 12.7h3"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (id === 'aiMedia') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M2.5 11.5 6 8l2.5 2.5L10.5 9l3 2.8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="10.5" cy="6" r="1.1" fill="currentColor" />
      </svg>
    )
  }
  if (id === 'account') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="5.2" r="2.9" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M2.7 13.6a5.5 5.5 0 0 1 10.6 0"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (id === 'integrations') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M5.5 2v3M10.5 2v3M4 5h8v2.5a4 4 0 0 1-8 0V5ZM8 11.5V14"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (id === 'general') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2 5h8M13 5h1M2 11h1M6 11h8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <circle cx="11.5" cy="5" r="1.7" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="4.5" cy="11" r="1.7" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    )
  }
  if (id === 'mcp') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M5.5 1.8v3M10.5 1.8v3"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path
          d="M3.6 4.8h8.8v2.4a4.4 4.4 0 0 1-8.8 0V4.8Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M8 11.6v2.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7.4v3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="5.1" r="0.8" fill="currentColor" />
    </svg>
  )
}

/** label-over-value field row with an optional right-aligned action */
function Field({
  label,
  value,
  valueTitle,
  action,
}: {
  label: string
  value: string
  valueTitle?: string
  action?: ReactNode
}) {
  return (
    <div className="set-field">
      <div className="set-field-text">
        <div className="set-field-label">{label}</div>
        <div className="set-field-value" data-tip={valueTitle}>
          {value}
        </div>
      </div>
      {action}
    </div>
  )
}

/** copies the given text; the label flips to "Copied" for a moment as feedback */
function CopyTextButton({ text, label }: { text: string; label?: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )
  return (
    <button
      className="set-btn"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true)
            if (timerRef.current !== null) window.clearTimeout(timerRef.current)
            timerRef.current = window.setTimeout(() => setCopied(false), 1600)
          },
          () => {},
        )
      }}
    >
      {copied ? t('setMcpCopied') : (label ?? t('setMcpCopy'))}
    </button>
  )
}

/** mcp.json snippet a client needs to reach the local server */
function mcpConfigExample(port: string): string {
  return JSON.stringify(
    { mcpServers: { chatoffice: { url: `http://127.0.0.1:${port}/mcp` } } },
    null,
    2,
  )
}

interface AiStatus {
  kind: 'testing' | 'ok' | 'err'
  text: string
}

/** colored feedback pill in the AI pane footer: spinner while testing, then success/error */
function AiStatusPill({ status }: { status: AiStatus | null }) {
  if (!status) return null
  return (
    <span
      className={`set-ai-status ${status.kind}`}
      role="status"
      title={status.kind === 'err' ? status.text : undefined}
    >
      {status.kind === 'testing' ? (
        <span className="set-ai-spin" aria-hidden="true" />
      ) : status.kind === 'ok' ? (
        <svg
          className="set-ai-status-icon"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="6.3" fill="currentColor" opacity="0.16" />
          <path
            d="M4.2 7.3l1.9 1.9 3.7-4.3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      ) : (
        <svg
          className="set-ai-status-icon"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="6.3" fill="currentColor" opacity="0.16" />
          <path d="M7 3.8v3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="7" cy="10.1" r="1" fill="currentColor" />
        </svg>
      )}
      <span className="set-ai-status-text">{status.text}</span>
    </span>
  )
}

/** AI model pane: provider / model / key / base URL, saved to userData/ai-settings.json */
function AiModelPane({ lang }: { lang: string }) {
  // the model settings live inline in this pane (no second window, no extra
  // heading — the section nav names it); the page's own panes handle scrolling
  const bridge = useMemo(() => windowChatOfficeBridge(), [])
  return (
    <div className="set-model-settings">
      <ModelSettingsPage bridge={bridge} lang={lang} variant="inline" />
    </div>
  )
}

function DefaultModelsPane({ lang }: { lang: string }) {
  const { t } = useI18n()
  const bridge = useMemo(() => windowChatOfficeBridge(), [])
  return (
    <>
      <h3 className="set-pane-title">{t('setSecDefaultModels')}</h3>
      <ModelDefaultsPage bridge={bridge} lang={lang} />
    </>
  )
}

/** the v2 settings page over the shell-wide ai:* channels */
function windowChatOfficeBridge(): ModelSettingsBridge {
  return {
    getSettings: () => window.chatOffice.getAiSettings(),
    saveSettings: (view) => window.chatOffice.setAiSettings(view),
    setCurrentModel: (selection) => window.chatOffice.setAiCurrentModel(selection),
    discoverModels: async (target) => {
      // Always run discovery in the main process. The shell renderer's CSP
      // (index.html: connect-src 'self' ws://localhost:*) blocks EVERY
      // cross-origin fetch, so the renderer-side attempt that used to live
      // here was dead on arrival — adding a provider with a fresh key always
      // failed while saved providers (KEEP_KEY sentinel → main) worked.
      // Main's runtime.discover goes through aiFetch: Node fetch with the
      // Electron net.fetch rescue path (Chromium TLS + stock-Chrome UA) for
      // gateways whose edge blocks non-browser traffic, and it resolves
      // KEEP_KEY sentinels to the stored key when the renderer doesn't hold
      // it. Codex needs main regardless (Node child_process for the CLI).
      return window.chatOffice.aiDiscoverModels(target)
    },
    chatofficeStatus: (withEmail) => window.chatOffice.chatofficeStatus(withEmail),
    chatofficeLogin: () => void window.chatOffice.chatofficeLogin(),
    localToolStatus: (vendorId) => window.chatOffice.aiLocalToolStatus(vendorId),
    localToolInstall: (vendorId, onLine) => window.chatOffice.aiLocalToolInstall(vendorId, onLine),
    localToolStart: (vendorId) => window.chatOffice.aiLocalToolStart(vendorId),
  }
}

/**
 * AI media & search pane: per-capability provider selection for web search,
 * image search, stock photos, AI image generation, and SVG generation.
 */
function AiMediaPane({ t }: { t: TFunc }) {
  const [settings, setSettings] = useState<AiSettingsV2 | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let alive = true
    void window.chatOffice.getAiSettings?.().then((s) => {
      if (alive && s) setSettings(s)
    })
    return () => {
      alive = false
    }
  }, [])

  if (!settings) return null

  const touch = () => {
    setDirty(true)
    setSaved(false)
  }

  const save = () => {
    window.chatOffice
      .setAiSettings?.(settings)
      .then(() => {
        setDirty(false)
        setSaved(true)
      })
      .catch((error) => {
        window.alert(error instanceof Error ? error.message : String(error))
      })
  }

  const webSearchProviders = AI_SEARCH_PROVIDERS.filter((p) => p.id !== 'openverse')
  const imageGenProviders = AI_MEDIA_PROVIDERS.filter((m) => !!m.imageProtocol)

  const search = settings.search ?? { provider: 'duckduckgo', providers: {} }
  const media = settings.media ?? {
    imageProvider: '',
    analysisProvider: '',
    videoAnalysisProvider: '',
    providers: {} as AiMediaSettings['providers'],
  }

  const setSearchProvider = (id: AiSearchProviderId) => {
    setSettings({ ...settings, search: { ...search, provider: id } })
    touch()
  }

  const setSearchKey = (id: string, key: string) => {
    const providers = { ...search.providers } as Record<string, { apiKey: string }>
    if (key) {
      providers[id] = { apiKey: key.trim() }
    } else {
      delete providers[id]
    }
    setSettings({ ...settings, search: { ...search, providers: providers as AiSearchSettings['providers'] } })
    touch()
  }

  const setImageGenProvider = (id: AiMediaProviderId) => {
    setSettings({ ...settings, media: { ...media, imageProvider: id } })
    touch()
  }

  const setImageGenKey = (id: string, key: string) => {
    const providers = { ...media.providers }
    const existing = providers[id as AiMediaProviderId] ?? {
      apiKey: '',
      imageModel: '',
      analysisModel: '',
    }
    providers[id as AiMediaProviderId] = { ...existing, apiKey: key.trim() }
    setSettings({ ...settings, media: { ...media, providers } })
    touch()
  }

  const setStockKey = (vendor: 'pexels' | 'pixabay' | 'unsplash' | 'wikimedia', key: string) => {
    setSettings({
      ...settings,
      stockApiKeys: { ...settings.stockApiKeys, [vendor]: key || undefined },
    })
    touch()
  }

  const currentWebSearchKey = (search.providers as Record<string, { apiKey?: string }>)?.[
    search.provider
  ]?.apiKey

  const currentImageGenMeta = imageGenProviders.find((m) => m.id === media.imageProvider)
  const currentImageGenKey = media.providers[media.imageProvider]?.apiKey ?? ''

  return (
    <>
      <h3 className="set-pane-title">{t('setSecAiMedia')}</h3>
      <div className="set-field-desc set-ai-note">{t('setAiSharedKeyHint')}</div>

      <section>
        <h4 className="set-pane-subtitle">{t('setAiCapWebSearch')}</h4>
        <div className="set-field">
          <div className="set-field-text">
            <label className="set-field-label">{t('setAiProvider')}</label>
          </div>
          <Dropdown
            className="set-dd"
            value={search.provider}
            ariaLabel={t('setAiCapWebSearch')}
            options={webSearchProviders.map((c) => ({
              value: c.id,
              label: c.label,
              render: (
                <>
                  <ProviderLogo id={c.id} />
                  {c.label}
                </>
              ),
            }))}
            onPick={(v) => setSearchProvider(v as AiSearchProviderId)}
          />
        </div>
        <div className="set-field-desc set-ai-note">
          {webSearchProviders.find((p) => p.id === search.provider)?.needsKey
            ? t('setAiSearchKeyRequired')
            : t('setAiSearchFreeProvider')}
        </div>
        {webSearchProviders.find((p) => p.id === search.provider)?.needsKey && (
          <div className="set-field">
            <div className="set-field-text">
              <div className="set-field-stack">
                <label className="set-field-label" htmlFor="set-ai-web-search-key">
                  {t('setAiApiKey')}
                </label>
                <div className="set-field-desc">{t('setAiKeyHint')}</div>
              </div>
            </div>
            <input
              id="set-ai-web-search-key"
              className="set-input"
              type="password"
              value={currentWebSearchKey ?? ''}
              placeholder={
                webSearchProviders.find((p) => p.id === search.provider)?.keyPlaceholder ??
                'API Key'
              }
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setSearchKey(search.provider, e.target.value)}
            />
          </div>
        )}
      </section>

      <section>
        <h4 className="set-pane-subtitle">{t('setAiCapImageSearch')}</h4>
        <div className="set-field-desc set-ai-note">{t('setAiImageSearchHint')}</div>
      </section>

      <section>
        <h4 className="set-pane-subtitle">{t('setAiCapStockPhotos')}</h4>
        <div className="set-field">
          <div className="set-field-text">
            <div className="set-field-stack">
              <label className="set-field-label" htmlFor="set-ai-pexels-key">
                Pexels API Key
              </label>
              <div className="set-field-desc">{t('setAiKeyHint')}</div>
            </div>
          </div>
          <input
            id="set-ai-pexels-key"
            className="set-input"
            type="password"
            value={settings.stockApiKeys?.pexels ?? ''}
            placeholder="Pexels API Key"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setStockKey('pexels', e.target.value.trim())}
          />
        </div>
        <div className="set-field">
          <div className="set-field-text">
            <div className="set-field-stack">
              <label className="set-field-label" htmlFor="set-ai-pixabay-key">
                Pixabay API Key
              </label>
              <div className="set-field-desc">{t('setAiKeyHint')}</div>
            </div>
          </div>
          <input
            id="set-ai-pixabay-key"
            className="set-input"
            type="password"
            value={settings.stockApiKeys?.pixabay ?? ''}
            placeholder="Pixabay API Key"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setStockKey('pixabay', e.target.value.trim())}
          />
        </div>
        <div className="set-field">
          <div className="set-field-text">
            <div className="set-field-stack">
              <label className="set-field-label" htmlFor="set-ai-unsplash-key">
                Unsplash Access Key
              </label>
              <div className="set-field-desc">{t('setAiKeyHint')}</div>
            </div>
          </div>
          <input
            id="set-ai-unsplash-key"
            className="set-input"
            type="password"
            value={settings.stockApiKeys?.unsplash ?? ''}
            placeholder="Unsplash Access Key"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setStockKey('unsplash', e.target.value.trim())}
          />
        </div>
      </section>

      <section>
        <h4 className="set-pane-subtitle">{t('setAiCapImageGen')}</h4>
        <div className="set-field">
          <div className="set-field-text">
            <label className="set-field-label">{t('setAiProvider')}</label>
          </div>
          <Dropdown
            className="set-dd"
            value={media.imageProvider || ''}
            ariaLabel={t('setAiCapImageGen')}
            options={[
              { value: '', label: t('setAiNone') },
              ...imageGenProviders.map((c) => ({
                value: c.id,
                label: c.label,
                render: (
                  <>
                    <ProviderLogo id={c.id} />
                    {c.label}
                  </>
                ),
              })),
            ]}
            onPick={(v) => setImageGenProvider(v as AiMediaProviderId)}
          />
        </div>
        {currentImageGenMeta && (
          <>
            <div className="set-field-desc set-ai-note">{currentImageGenMeta.description}</div>
            {currentImageGenMeta.needsKey !== false && (
              <div className="set-field">
                <div className="set-field-text">
                  <div className="set-field-stack">
                    <label className="set-field-label" htmlFor="set-ai-imagegen-key">
                      {t('setAiApiKey')}
                    </label>
                    <div className="set-field-desc">{t('setAiKeyHint')}</div>
                  </div>
                </div>
                <input
                  id="set-ai-imagegen-key"
                  className="set-input"
                  type="password"
                  value={currentImageGenKey}
                  placeholder={currentImageGenMeta.keyPlaceholder}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => setImageGenKey(media.imageProvider, e.target.value)}
                />
              </div>
            )}
          </>
        )}
      </section>

      <section>
        <h4 className="set-pane-subtitle">{t('setAiCapSvgGen')}</h4>
        <div className="set-field-desc set-ai-note">{t('setAiSvgGenHint')}</div>
      </section>

      <div className="set-pane-footer">
        <AiStatusPill status={saved ? { kind: 'ok', text: t('setAiSaved') } : null} />
        <button className="set-btn primary" disabled={!dirty} onClick={save}>
          {t('setAiSave')}
        </button>
      </div>
    </>
  )
}

export interface SettingsModalProps {
  status: AccountStatus | null
  loggingOut: boolean
  /** browser sign-in in progress (spinner shows on the account entry) */
  loginWaiting: boolean
  /** device auth URL while waiting — rescue actions when the browser did not auto-open */
  loginUrl: string | null
  urlCopied: boolean
  onOpenLoginUrl: () => void
  onCopyLoginUrl: () => void
  onClose: () => void
  /** closes the modal and launches the ChatOffice login flow (progress shows on the account entry) */
  onLogin: () => void
  onLogout: () => void
  /** an installed skill is older than the bundled one: dot on the Integrations entry */
  skillUpdateDue?: boolean
  onSkillUpdateDue?: (due: boolean) => void
}

export function SettingsModal({
  onClose,
  skillUpdateDue: updateDue = false,
  onSkillUpdateDue,
}: SettingsModalProps) {
  const { lang, setLang, t } = useI18n()
  const [section, setSection] = useState<SectionId>('modelSettings')
  const [theme, setTheme] = useState<UiTheme>('system')
  const [saveDir, setSaveDir] = useState('')
  const [analyticsOn, setAnalyticsOn] = useState(true)
  const [analyticsSaving, setAnalyticsSaving] = useState(false)
  const [autoSaveOn, setAutoSaveOn] = useState(false)
  const [mcpRunning, setMcpRunning] = useState(false)
  const [mcpEnabled, setMcpEnabled] = useState(false)
  const [mcpPort, setMcpPort] = useState('3093')
  const [mcpError, setMcpError] = useState('')
  const [mcpSaving, setMcpSaving] = useState(false)
  const [mcpBackground, setMcpBackground] = useState(false)
  const [mcpLogging, setMcpLogging] = useState(false)
  const [mcpCaps, setMcpCaps] = useState<string[]>(['docs'])
  const [mcpLogs, setMcpLogs] = useState<string[]>([])
  const logViewRef = useRef<HTMLPreElement | null>(null)
  const [aiPrefs, setAiPrefs] = useState<AiPanelPrefs>(DEFAULT_AI_PANEL_PREFS)
  const [channel, setChannel] = useState<'stable' | 'beta'>('stable')
  const [appVersion, setAppVersion] = useState('')
  const [githubStars, setGithubStars] = useState<number | null>(null)

  /**
   * Apply an MCP settings patch: always sends the full current snapshot plus the
   * changed field (the main process persists and applies atomically, restarting
   * the server when the port or the exposed tool set changes).
   */
  const applyMcp = (patch: {
    enabled?: boolean
    port?: number
    background?: boolean
    logging?: boolean
  }) => {
    setMcpSaving(true)
    void window.chatOffice
      .setMcpSettings({
        enabled: patch.enabled ?? mcpEnabled,
        port: patch.port ?? (Number(mcpPort) || 3093),
        background: patch.background ?? mcpBackground,
        logging: patch.logging ?? mcpLogging,
      })
      .then((s) => {
        setMcpRunning(s.running)
        setMcpEnabled(s.enabled)
        setMcpPort(String(s.port))
        setMcpBackground(s.background)
        setMcpLogging(s.logging)
        setMcpCaps(s.capabilities ?? ['docs'])
        setMcpError(s.error ?? '')
      })
      .catch(() => {})
      .finally(() => setMcpSaving(false))
  }

  /** tail of the MCP log for the in-pane viewer */
  const fetchMcpLogs = useCallback(() => {
    void window.chatOffice
      .getMcpLogs?.()
      .then((lines) => setMcpLogs(Array.isArray(lines) ? lines : []))
      .catch(() => {})
  }, [])

  // poll while the logging pane is visible: entries land as tools run
  useEffect(() => {
    if (section !== 'mcp' || !mcpLogging) return
    fetchMcpLogs()
    const timer = window.setInterval(fetchMcpLogs, 2000)
    return () => window.clearInterval(timer)
  }, [section, mcpLogging, fetchMcpLogs])

  // follow the tail (newest entries last), but never fight a reader who scrolled up
  useEffect(() => {
    const el = logViewRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) el.scrollTop = el.scrollHeight
  }, [mcpLogs])

  useEffect(() => {
    let alive = true
    void window.chatOffice.getTheme?.().then((th) => {
      if (alive) setTheme(th)
    })
    void window.chatOffice.getDefaultSaveDir?.().then((dir) => {
      if (alive && dir) setSaveDir(dir)
    })
    void window.chatOffice.getAnalyticsEnabled?.().then((on) => {
      if (alive) setAnalyticsOn(on !== false)
    })
    void window.chatOffice.getAutoSaveDefault?.().then((v) => {
      if (alive) setAutoSaveOn(v.on)
    })
    void window.chatOffice.getMcpStatus?.().then((s) => {
      if (!alive) return
      setMcpRunning(s.running)
      setMcpEnabled(s.enabled)
      setMcpPort(String(s.port))
      setMcpBackground(s.background)
      setMcpLogging(s.logging)
      setMcpCaps(s.capabilities ?? ['docs'])
      setMcpError(s.error ?? '')
    })
    void window.chatOffice.getAiPanelPrefs?.().then((prefs) => {
      if (alive) setAiPrefs(prefs)
    })
    void window.chatOffice.getUpdateChannel?.().then((ch) => {
      if (alive) setChannel(ch)
    })
    void window.chatOffice.getAppVersion?.().then((v) => {
      if (alive && v) setAppVersion(v)
    })
    void window.chatOffice.githubStars?.().then((n) => {
      if (alive && n !== null) setGithubStars(n)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const applyTheme = (next: UiTheme) => {
    setTheme(next)
    void window.chatOffice.setTheme(next)
    if (next === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', next)
  }

  const updateAiPrefs = (patch: Partial<AiPanelPrefs>) => {
    setAiPrefs((prev) => ({ ...prev, ...patch }))
    void window.chatOffice.setAiPanelPrefs(patch).then(setAiPrefs)
  }

  const changeSaveDir = () => {
    void window.chatOffice.pickDefaultSaveDir?.().then((dir) => {
      if (dir) setSaveDir(dir)
    })
  }

  return (
    <div
      className="set-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="set-dialog" role="dialog" aria-modal="true" aria-label={t('settings')}>
        <div className="set-header">
          <h2 className="set-title">{t('settings')}</h2>
          <button className="set-close" onClick={onClose} aria-label={t('cancel')}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M2 2l10 10M12 2L2 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="set-body">
          <nav className="set-nav" aria-label={t('settings')}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`set-nav-item${section === s.id ? ' active' : ''}`}
                aria-current={section === s.id}
                onClick={() => setSection(s.id)}
              >
                <SectionIcon id={s.id} />
                {t(s.labelKey)}
                {s.id === 'integrations' && updateDue && (
                  <span className="set-nav-dot" role="img" aria-label={t('intgUpdateDue')} />
                )}
              </button>
            ))}
          </nav>
          <div className="set-pane">
            {section === 'modelSettings' && <AiModelPane lang={lang} />}
            {section === 'defaultModels' && <DefaultModelsPane lang={lang} />}
            {section === 'aiMedia' && <AiMediaPane t={t} />}
            {section === 'remoteStorage' && <StoragePane />}
            {section === 'general' && (
              <>
                <h3 className="set-pane-title">{t('setSecGeneral')}</h3>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('language')}</label>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={lang}
                    ariaLabel={t('language')}
                    options={LANG_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                    onPick={(v) => setLang(v as typeof lang)}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('theme')}</label>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={theme}
                    ariaLabel={t('theme')}
                    options={THEME_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.labelKey),
                    }))}
                    onPick={(v) => applyTheme(v as UiTheme)}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('setAiFontSize')}</label>
                  </div>
                  {aiPrefs.fontSize === 'custom' && (
                    <CustomFontSizeInput
                      value={aiPrefs.customFontSize}
                      label={t('aiFontSizeCustom')}
                      onCommit={(px) => updateAiPrefs({ customFontSize: px })}
                    />
                  )}
                  <Dropdown
                    className="set-dd"
                    value={aiPrefs.fontSize}
                    ariaLabel={t('setAiFontSize')}
                    options={AI_FONT_SIZE_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.labelKey),
                    }))}
                    onPick={(v) => {
                      const fontSize = v as AiFontSize
                      // start the custom size from the preset being left so nothing jumps
                      updateAiPrefs(
                        fontSize === 'custom' && aiPrefs.fontSize !== 'custom'
                          ? { fontSize, customFontSize: aiPanelFontPx(aiPrefs) }
                          : { fontSize },
                      )
                    }}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setAiSpellcheck')}</div>
                      <div className="set-field-desc">{t('setAiSpellcheckDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={aiPrefs.spellcheck}
                    aria-label={t('setAiSpellcheck')}
                    onClick={() => updateAiPrefs({ spellcheck: !aiPrefs.spellcheck })}
                  />
                </div>
                <Field
                  label={t('saveLocation')}
                  value={saveDir || '—'}
                  valueTitle={saveDir}
                  action={
                    <button className="set-btn" onClick={changeSaveDir}>
                      {t('setChange')}
                    </button>
                  }
                />
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setAutoSave')}</div>
                      <div className="set-field-desc">{t('setAutoSaveDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={autoSaveOn}
                    aria-label={t('setAutoSave')}
                    onClick={() => {
                      const next = !autoSaveOn
                      setAutoSaveOn(next)
                      void window.chatOffice.setAutoSaveDefault?.(next).catch(() => {})
                    }}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setAnalytics')}</div>
                      <div className="set-field-desc">{t('setAnalyticsDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={analyticsOn}
                    aria-label={t('setAnalytics')}
                    disabled={analyticsSaving}
                    onClick={() => {
                      const next = !analyticsOn
                      setAnalyticsSaving(true)
                      void window.chatOffice
                        .setAnalyticsEnabled(next)
                        .then((persisted) => {
                          if (persisted) setAnalyticsOn(next)
                        })
                        .catch(() => {})
                        .finally(() => setAnalyticsSaving(false))
                    }}
                  />
                </div>
              </>
            )}
            {section === 'integrations' && (
              <IntegrationsPane t={t} onStatus={(st) => onSkillUpdateDue?.(skillUpdateDue(st))} />
            )}
            {section === 'mcp' && (
              <>
                <h3 className="set-pane-title">{t('setSecMcp')}</h3>
                <div className="set-field set-field-top">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setMcp')}</div>
                      <div className="set-field-desc">{t('setMcpDesc')}</div>
                      <div className="set-field-desc set-mcp-status">
                        <span
                          className={`set-status-dot${mcpError ? ' error' : mcpRunning ? ' running' : ''}`}
                          aria-hidden="true"
                        />
                        <span>
                          {mcpError || (mcpRunning ? t('setMcpRunning') : t('setMcpStopped'))}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={mcpEnabled}
                    aria-label={t('setMcp')}
                    disabled={mcpSaving}
                    onClick={() => applyMcp({ enabled: !mcpEnabled })}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <label className="set-field-label" htmlFor="set-mcp-port">
                        {t('setMcpPort')}
                      </label>
                    </div>
                  </div>
                  <input
                    id="set-mcp-port"
                    className="set-input"
                    type="number"
                    min={1024}
                    max={65535}
                    value={mcpPort}
                    onChange={(e) => setMcpPort(e.target.value)}
                    onBlur={() => {
                      const port = Number(mcpPort)
                      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
                        setMcpPort('3093')
                        return
                      }
                      if (!mcpEnabled) return
                      applyMcp({ port })
                    }}
                  />
                </div>
                <div className="set-field set-field-top">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setMcpBg')}</div>
                      <div className="set-field-desc">{t('setMcpBgDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={mcpBackground}
                    aria-label={t('setMcpBg')}
                    disabled={mcpSaving}
                    onClick={() => applyMcp({ background: !mcpBackground })}
                  />
                </div>
                <h4 className="set-group-title">{t('setMcpConn')}</h4>
                <Field
                  label={t('setMcpUrlHttp')}
                  value={`http://127.0.0.1:${mcpPort}/mcp`}
                  action={<CopyTextButton text={`http://127.0.0.1:${mcpPort}/mcp`} />}
                />
                <Field
                  label={t('setMcpUrlSse')}
                  value={`http://127.0.0.1:${mcpPort}/sse`}
                  action={<CopyTextButton text={`http://127.0.0.1:${mcpPort}/sse`} />}
                />
                <Field
                  label={t('setMcpHealth')}
                  value={`http://127.0.0.1:${mcpPort}/health`}
                  action={<CopyTextButton text={`http://127.0.0.1:${mcpPort}/health`} />}
                />
                <div className="set-config-block">
                  <div className="set-config-head">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setMcpConfig')}</div>
                      <div className="set-field-desc">{t('setMcpConfigDesc')}</div>
                    </div>
                    <CopyTextButton text={mcpConfigExample(mcpPort)} />
                  </div>
                  <pre className="set-code">{mcpConfigExample(mcpPort)}</pre>
                </div>
                <h4 className="set-group-title">{t('setMcpLog')}</h4>
                <div className="set-field set-field-top">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setMcpLog')}</div>
                      <div className="set-field-desc">{t('setMcpLogDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={mcpLogging}
                    aria-label={t('setMcpLog')}
                    disabled={mcpSaving}
                    onClick={() => applyMcp({ logging: !mcpLogging })}
                  />
                </div>
                {mcpLogging && (
                  <div className="set-config-block">
                    <div className="set-config-head">
                      <div className="set-field-stack">
                        <div className="set-field-label">{t('setMcpLogFile')}</div>
                        <div className="set-field-desc">mcp-log.txt</div>
                      </div>
                      <div className="set-btn-row">
                        <button className="set-btn" onClick={fetchMcpLogs}>
                          {t('setMcpLogRefresh')}
                        </button>
                        <button
                          className="set-btn"
                          onClick={() => void window.chatOffice.openMcpLogFile?.()}
                        >
                          {t('setMcpLogOpen')}
                        </button>
                        <button
                          className="set-btn"
                          onClick={() => {
                            void window.chatOffice.clearMcpLogs?.().then(fetchMcpLogs)
                          }}
                        >
                          {t('setMcpLogClear')}
                        </button>
                      </div>
                    </div>
                    <pre ref={logViewRef} className="set-code set-log">
                      {mcpLogs.length > 0 ? (
                        mcpLogs.join('\n')
                      ) : (
                        <span className="set-log-empty">{t('setMcpLogEmpty')}</span>
                      )}
                    </pre>
                  </div>
                )}
                <h4 className="set-group-title">{t('setMcpCap')}</h4>
                {(
                  [
                    ['docs', 'setMcpCapDocs', 'setMcpCapDocsDesc'],
                    ['slides', 'setMcpCapSlides', 'setMcpCapSlidesDesc'],
                    ['sheets', 'setMcpCapSheets', 'setMcpCapSheetsDesc'],
                    ['pdf', 'setMcpCapPdf', 'setMcpCapPdfDesc'],
                  ] as Array<[string, StringKey, StringKey]>
                )
                  .filter(([id]) => mcpCaps.includes(id))
                  .map(([, labelKey, descKey]) => (
                    <Field key={labelKey} label={t(labelKey)} value={t(descKey)} />
                  ))}
              </>
            )}
            {section === 'about' && (
              <>
                <h3 className="set-pane-title">{t('setSecAbout')}</h3>
                <Field label={t('versionLabel')} value={appVersion || '—'} />
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('updateChannel')}</label>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={channel}
                    ariaLabel={t('updateChannel')}
                    options={CHANNEL_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.labelKey),
                    }))}
                    onPick={(v) => {
                      const next = v === 'beta' ? 'beta' : 'stable'
                      setChannel(next)
                      void window.chatOffice.setUpdateChannel(next)
                    }}
                  />
                </div>
                <Field
                  label={t('setGithub')}
                  value={
                    githubStars === null
                      ? 'github.com/zhgyuhuii/chayuan-office'
                      : `github.com/zhgyuhuii/chayuan-office · ★ ${formatStars(githubStars)}`
                  }
                  action={
                    <button
                      className="set-btn"
                      onClick={() => void window.chatOffice.openGitHubRepo?.()}
                    >
                      {t('starOnGitHub')}
                    </button>
                  }
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

