import type { AiPanelPrefs } from '@chatoffice/ui/ai-panel-prefs'
import {
  aiPanelFontPx,
  AiFontSize,
  DEFAULT_AI_PANEL_PREFS,
  clampAiCustomFontSize,
  AI_CUSTOM_FONT_MIN_PX,
  AI_CUSTOM_FONT_MAX_PX,
} from '@chatoffice/ui/ai-panel-prefs'
import { discoverModels, setAiUserAgent } from '@chatoffice/ai-provider/browser'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ModelSettingsPage } from '@chatoffice/ui/ModelSettingsPage'
import type { ModelSettingsBridge } from '@chatoffice/ui/ModelSettingsPage'
import { ModelDefaultsPage } from '@chatoffice/ui/ModelDefaultsPage'
import { Dropdown, USER_LOGIN_READY } from '@chatoffice/ui'
import { useI18n } from './locale'
import type { StringKey } from './locale'
import type { AccountStatus, UiTheme } from '../../shared/home-api'
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
  { id: 'remoteStorage', labelKey: 'setSecRemoteStorage' },
  { id: 'general', labelKey: 'setSecGeneral' },
  { id: 'integrations', labelKey: 'setSecIntegrations' },
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
      // Run discovery in the renderer — the renderer's fetch is Chromium's
      // native fetch with a proper browser TLS fingerprint, so Cloudflare
      // won't block it (unlike main-process fetches via Node undici or
      // Electron net.fetch).
      //
      // Two cases still need the main process:
      //  • Codex — requires Node.js child_process to find/run the CLI
      //  • profileId without apiKey — the renderer holds KEEP_KEY sentinels;
      //    the real key lives in the settings file (main-process filesystem)
      if (target.codexLike) {
        return window.chatOffice.aiDiscoverModels(target)
      }
      if (!target.apiKey && target.profileId) {
        // The renderer holds KEEP_KEY sentinels; the real API key lives in the
        // settings file. Delegate to the main process which resolves the stored
        // key internally via runtime.discover.
        return window.chatOffice.aiDiscoverModels(target)
      }
      try {
        // In the renderer, fetch is Chromium's native fetch (proper TLS
        // fingerprint), but aiFetch overrides the User-Agent to 'ChatOffice'
        // by default. Cloudflare flags the mismatch between a browser TLS
        // fingerprint and a non-browser UA. Set a stock Chrome UA so the two
        // signals agree.
        setAiUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        )
        const models = await discoverModels(target)
        return { models }
      } catch (err) {
        return { models: [], error: err instanceof Error ? err.message : String(err) }
      }
    },
    chatofficeStatus: (withEmail) => window.chatOffice.chatofficeStatus(withEmail),
    chatofficeLogin: () => void window.chatOffice.chatofficeLogin(),
    localToolStatus: (vendorId) => window.chatOffice.aiLocalToolStatus(vendorId),
    localToolInstall: (vendorId, onLine) => window.chatOffice.aiLocalToolInstall(vendorId, onLine),
    localToolStart: (vendorId) => window.chatOffice.aiLocalToolStart(vendorId),
  }
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
  status,
  loggingOut,
  loginWaiting,
  loginUrl,
  urlCopied,
  onOpenLoginUrl,
  onCopyLoginUrl,
  onClose,
  onLogin,
  onLogout,
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
  const [aiPrefs, setAiPrefs] = useState<AiPanelPrefs>(DEFAULT_AI_PANEL_PREFS)
  const [channel, setChannel] = useState<'stable' | 'beta'>('stable')
  const [appVersion, setAppVersion] = useState('')
  const [githubStars, setGithubStars] = useState<number | null>(null)

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

  const loggedIn = status?.loggedIn ?? false
  const email = status?.email ?? ''

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
                      ? 'github.com/chatoffice-ai/chatoffice'
                      : `github.com/chatoffice-ai/chatoffice · ★ ${formatStars(githubStars)}`
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
        {/* 用户登录功能未开放（USER_LOGIN_READY=false）：登录/退出入口整体隐藏 */}
        {USER_LOGIN_READY && (
          <footer className="set-footer">
            {loggedIn ? (
              <>
                <span className="set-footer-user" title={email}>
                  {email}
                </span>
                <button className="set-btn" disabled={loggingOut} onClick={onLogout}>
                  {loggingOut ? t('loggingOut') : t('logout')}
                </button>
              </>
            ) : (
              <>
                {loginWaiting && loginUrl && (
                  <>
                    <button className="set-btn" onClick={onOpenLoginUrl}>
                      {t('loginOpenManually')}
                    </button>
                    <button className="set-btn" onClick={onCopyLoginUrl}>
                      {urlCopied ? t('loginCopied') : t('loginCopyUrl')}
                    </button>
                  </>
                )}
                <button className="set-btn primary" onClick={onLogin}>
                  {loginWaiting ? t('waitingShort') : t('userLogin')}
                </button>
              </>
            )}
          </footer>
        )}
      </div>
    </div>
  )
}

