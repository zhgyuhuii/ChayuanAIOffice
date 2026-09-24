import type { AiPanelPrefs, AiPanelSide } from '@chatoffice/ui/ai-panel-prefs'
import {
  aiPanelFontPx,
  AiFontSize,
  DEFAULT_AI_PANEL_PREFS,
  clampAiCustomFontSize,
  AI_CUSTOM_FONT_MIN_PX,
  AI_CUSTOM_FONT_MAX_PX,
} from '@chatoffice/ui/ai-panel-prefs'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ModelSettingsPage } from '@chatoffice/ui/ModelSettingsPage'
import { CapabilitySettingsPage } from '@chatoffice/ui/CapabilitySettingsPage'
import type { ModelSettingsBridge } from '@chatoffice/ui/ModelSettingsPage'
import { ModelDefaultsPage } from '@chatoffice/ui/ModelDefaultsPage'
import { Dropdown } from '@chatoffice/ui'
import { useI18n } from './locale'
import type { StringKey } from './locale'
import type {
  AccountStatus,
  FileSearchSettings,
  JevEndpoint,
  UiTheme,
} from '../../shared/home-api'
import { StoragePane } from './StoragePane'
import { IntegrationsPane, skillUpdateDue } from './IntegrationsPane'
import { McpServerSettings } from './McpServerSettings'
import { McpManagePane } from './McpManagePane'
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
  | 'fileSearch'
  | 'remoteStorage'
  | 'general'
  | 'integrations'
  | 'account'
  | 'aiModel'
  | 'aiMedia'
  | 'mcpManage'
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
  { id: 'fileSearch', labelKey: 'setAiCapFileSearch' },
  { id: 'remoteStorage', labelKey: 'setSecRemoteStorage' },
  { id: 'general', labelKey: 'setSecGeneral' },
  { id: 'integrations', labelKey: 'setSecIntegrations' },
  { id: 'mcpManage', labelKey: 'setSecMcpManage' },
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
  if (id === 'mcpManage') {
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


/** 本机文件搜索（Jev 重排）设置——上游 #757 的设置 UI 按本地 V2 结构重建
 *  （LOCAL 2026-09-23 挂账 #1 落地）：开关/端点/密钥即时持久化，测试按钮
 *  走 testFileSearchRerank 做一次双文档判定并回显结果。 */
const JEV_ENDPOINTS: { value: JevEndpoint; label: string }[] = [
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'direct', label: 'TypeSafe' },
]

function FileSearchPane() {
  const { t } = useI18n()
  const [settings, setSettings] = useState<FileSearchSettings | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  useEffect(() => {
    let alive = true
    void window.chatOffice.getFileSearchSettings?.().then((v) => {
      if (alive && v) setSettings(v)
    })
    return () => {
      alive = false
    }
  }, [])

  const patch = (next: Partial<FileSearchSettings>) => {
    // optimistic merge; the persisted answer (normalized keys) wins afterwards
    void window.chatOffice.setFileSearchSettings?.(next).then((saved) => setSettings(saved))
    setSettings((prev) => (prev ? { ...prev, ...next } : prev))
  }

  const test = async () => {
    if (!settings) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.chatOffice.testFileSearchRerank?.({
        endpoint: settings.jevEndpoint,
        apiKey: settings.jevKeys[settings.jevEndpoint] ?? '',
      })
      setTestResult(result)
    } catch (err) {
      setTestResult({ ok: false, error: String(err instanceof Error ? err.message : err) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <h3 className="set-pane-title">{t('setAiCapFileSearch')}</h3>
      {settings && (
        <>
          <div className="set-field">
            <div className="set-field-text">
              <div className="set-field-stack">
                <div className="set-field-label">{t('setSearchRerank')}</div>
                <div className="set-field-desc">{t('setSearchRerankDesc')}</div>
              </div>
            </div>
            <button
              className="set-switch"
              role="switch"
              aria-checked={settings.rerank}
              aria-label={t('setSearchRerank')}
              onClick={() => patch({ rerank: !settings.rerank })}
            />
          </div>
          {settings.rerank && (
            <>
              <div className="set-field">
                <div className="set-field-text">
                  <label className="set-field-label">{t('setSearchRerankEndpoint')}</label>
                </div>
                <Dropdown
                  className="set-dd"
                  value={settings.jevEndpoint}
                  ariaLabel={t('setSearchRerankEndpoint')}
                  options={JEV_ENDPOINTS}
                  onPick={(v) => patch({ jevEndpoint: v === 'direct' ? 'direct' : 'openrouter' })}
                />
              </div>
              <div className="set-field">
                <div className="set-field-text">
                  <label className="set-field-label" htmlFor="set-search-jev-key">
                    {t('setAiApiKey')}
                  </label>
                </div>
                <input
                  id="set-search-jev-key"
                  className="set-input"
                  type="password"
                  value={settings.jevKeys[settings.jevEndpoint] ?? ''}
                  placeholder={settings.jevEndpoint === 'openrouter' ? 'sk-or-…' : 'API Key'}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) =>
                    patch({
                      jevKeys: { ...settings.jevKeys, [settings.jevEndpoint]: e.target.value },
                    })
                  }
                />
              </div>
              <div className="set-field">
                <button className="set-btn" disabled={testing} onClick={() => void test()}>
                  {t('setAiTest')}
                </button>
                <span className="set-field-desc" role="status">
                  {testing
                    ? t('setAiTesting')
                    : testResult
                      ? testResult.ok
                        ? t('setAiTestOk')
                        : `⚠ ${testResult.error || t('setAiTestFail')}`
                      : ''}
                </span>
              </div>
            </>
          )}
        </>
      )}
    </>
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
function AiModelPane({ lang, initialVendor }: { lang: string; initialVendor?: string }) {
  // the model settings live inline in this pane (no second window, no extra
  // heading — the section nav names it); the page's own panes handle scrolling
  const bridge = useMemo(() => windowChatOfficeBridge(), [])
  return (
    <div className="set-model-settings">
      <ModelSettingsPage
        bridge={bridge}
        lang={lang}
        variant="inline"
        initialVendor={initialVendor}
      />
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
    testSearchPlatform: (req) => window.chatOffice.aiTestSearchPlatform(req),
  }
}

/**
 * 生图、媒体与搜索 pane: the capability tree (search platforms + model
 * capability groups) over the same ai:* settings channels. Deep links into
 * 模型设置 for vendors that are not enabled yet.
 */
function AiMediaPane({
  lang,
  onOpenModelSettings,
}: {
  lang: string
  onOpenModelSettings: (vendorId?: string) => void
}) {
  const bridge = useMemo(() => windowChatOfficeBridge(), [])
  return (
    <div className="set-capability-settings">
      <CapabilitySettingsPage
        bridge={bridge}
        lang={lang}
        onOpenModelSettings={onOpenModelSettings}
      />
    </div>
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
  // 生图、媒体与搜索 → 去模型设置启用：deep link onto that vendor's form
  const [aiModelVendor, setAiModelVendor] = useState<string | undefined>(undefined)
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
    void window.chatOffice.getAutoSaveDefault?.().then((v) => {
      if (alive) setAutoSaveOn(v.on)
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
            {section === 'modelSettings' && (
              <AiModelPane lang={lang} initialVendor={aiModelVendor} />
            )}
            {section === 'defaultModels' && <DefaultModelsPane lang={lang} />}
            {section === 'aiMedia' && (
              <AiMediaPane
                lang={lang}
                onOpenModelSettings={(vendorId) => {
                  setAiModelVendor(vendorId)
                  setSection('modelSettings')
                }}
              />
            )}
            {section === 'fileSearch' && <FileSearchPane />}
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
                    <label className="set-field-label">{t('setAiPanelSide')}</label>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={aiPrefs.side}
                    ariaLabel={t('setAiPanelSide')}
                    options={[
                      { value: 'left', label: t('aiPanelSideLeft') },
                      { value: 'right', label: t('aiPanelSideRight') },
                    ]}
                    onPick={(side) => updateAiPrefs({ side: side as AiPanelSide })}
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
              <>
                <IntegrationsPane t={t} onStatus={(st) => onSkillUpdateDue?.(skillUpdateDue(st))} />
                <div className="set-intg-divider" />
                <McpServerSettings />
              </>
            )}
            {section === 'mcpManage' && <McpManagePane t={t} />}
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
                      ? 'github.com/zhgyuhuii/ChayuanAIOffice'
                      : `github.com/zhgyuhuii/ChayuanAIOffice · ★ ${formatStars(githubStars)}`
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
