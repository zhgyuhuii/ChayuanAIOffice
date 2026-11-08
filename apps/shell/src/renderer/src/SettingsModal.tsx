import type { AiPanelPrefs, AiPanelSide } from '@chaoffice/ui/ai-panel-prefs'
import {
  aiPanelFontPx,
  AiFontSize,
  DEFAULT_AI_PANEL_PREFS,
  clampAiCustomFontSize,
  AI_CUSTOM_FONT_MIN_PX,
  AI_CUSTOM_FONT_MAX_PX,
} from '@chaoffice/ui/ai-panel-prefs'
import { AUTHOR_NAME_MAX, isCloudflareEndpoint } from '../../shared/home-api'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ModelSettingsPage } from '@chaoffice/ui/ModelSettingsPage'
import { CapabilitySettingsPage } from '@chaoffice/ui/CapabilitySettingsPage'
import type { ModelSettingsBridge } from '@chaoffice/ui/ModelSettingsPage'
import { ModelDefaultsPage } from '@chaoffice/ui/ModelDefaultsPage'
import { Dropdown } from '@chaoffice/ui'
import { useI18n } from './locale'
import type { StringKey } from './locale'
import type {
  AccountStatus,
  AuthorNameSetting,
  DefaultAppStatus,
  DocTheme,
  FileSearchSettings,
  DecisionEndpoint,
  UiTheme,
} from '../../shared/home-api'
import type { UpdateUiState } from '../../shared/update-api'
import { StoragePane } from './StoragePane'
import { IntegrationsPane, skillUpdateDue } from './IntegrationsPane'
import { FoundSkills } from './FoundSkills'
import { McpServerSettings } from './McpServerSettings'
import { McpManagePane } from './McpManagePane'
import './settings.css'

// ── Settings modal (opened from the account menu) ─────────
// ChaOffice-style two-pane dialog: section nav on the left, fields on the right.
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
  { value: 'tr', label: 'Türkçe' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'zh', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
] as const

// GenMail's option order: follow-system first, then the manual picks
const THEME_OPTIONS = [
  { value: 'system', labelKey: 'themeSystem' },
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
] as const satisfies readonly { value: UiTheme; labelKey: StringKey }[]

// Document page theme (chaoffice#1811): the canvas/paper preference the editors follow;
// 'follow' keeps the pre-existing behavior of riding the UI theme
const DOC_THEME_OPTIONS = [
  { value: 'follow', labelKey: 'docThemeFollowApp' },
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
] as const satisfies readonly { value: DocTheme; labelKey: StringKey }[]

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

/** settings-modal section ids — exported for the open-settings deep link (Home) */
export type SectionId =
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
  | 'skills'
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
  { id: 'skills', labelKey: 'setSecSkills' },
  { id: 'about', labelKey: 'setSecAbout' },
]

/** open-settings deep-link section narrowing — invalid ids fall back to the default */
export function coerceSectionId(raw: string): SectionId | undefined {
  return SECTIONS.some((s) => s.id === raw) ? (raw as SectionId) : undefined
}

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
  if (id === 'skills') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3 3.5h6.5l3.5 3.5v5.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M9.5 3.5V7H13" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M5 10.5h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
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
/** Jev 路由在前（OpenRouter 默认），其后是各家决策模型服务器。名称随上游
 *  DECISION_ENDPOINTS：tests/decision-endpoints.test.ts 按此名对表，保证
 *  下拉项与 rerank.ts 的 ENDPOINT_IDS 一一对应、不悄悄同缩。 */
const DECISION_ENDPOINTS: { value: DecisionEndpoint; label: string }[] = [
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'direct', label: 'TypeSafe' },
  { value: 'perplexity', label: 'Perplexity (v1 27B)' },
  // 上游 #2073：Perplexity/Liquid/Cloudflare 各自多发一代同 URL 模型，逐项列出
  { value: 'perplexity-v12', label: 'Perplexity (v1.2)' },
  { value: 'perplexity-flash', label: 'Perplexity (Flash v1.2)' },
  { value: 'liquid', label: 'Liquid AI (d1)' },
  { value: 'liquid-ultra', label: 'Liquid AI (d1-ultra)' },
  { value: 'openai', label: 'OpenAI (gpt-6-luna)' },
  { value: 'cloudflare', label: 'Cloudflare (Clef)' },
  { value: 'cloudflare-flash', label: 'Cloudflare (Clef-flash)' },
  { value: 'kev', label: 'Kev (local)' },
  { value: 'rizzo', label: 'Rizzo Flow (local)' },
  { value: 'custom', label: 'Custom' },
]

function FileSearchPane() {
  const { t } = useI18n()
  const [settings, setSettings] = useState<FileSearchSettings | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  useEffect(() => {
    let alive = true
    void window.chaOffice.getFileSearchSettings?.().then((v) => {
      if (alive && v) setSettings(v)
    })
    return () => {
      alive = false
    }
  }, [])

  const patch = (next: Partial<FileSearchSettings>) => {
    // optimistic merge; the persisted answer (normalized keys) wins afterwards
    void window.chaOffice.setFileSearchSettings?.(next).then((saved) => setSettings(saved))
    setSettings((prev) => (prev ? { ...prev, ...next } : prev))
  }

  const test = async () => {
    if (!settings) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.chaOffice.testFileSearchRerank?.({
        endpoint: settings.endpoint,
        apiKey: settings.keys[settings.endpoint] ?? '',
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
                  value={settings.endpoint}
                  ariaLabel={t('setSearchRerankEndpoint')}
                  options={DECISION_ENDPOINTS}
                  onPick={(v) => patch({ endpoint: v })}
                />
              </div>
              {isCloudflareEndpoint(settings.endpoint) && (
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label" htmlFor="set-search-jev-account">
                      {t('setSearchRerankAccount')}
                    </label>
                  </div>
                  <input
                    id="set-search-jev-account"
                    className="set-input"
                    type="text"
                    value={settings.cloudflareAccountId ?? ''}
                    placeholder=""
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => patch({ cloudflareAccountId: e.target.value })}
                  />
                </div>
              )}
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
                  value={settings.keys[settings.endpoint] ?? ''}
                  placeholder={settings.endpoint === 'openrouter' ? 'sk-or-…' : 'API Key'}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) =>
                    patch({
                      keys: { ...settings.keys, [settings.endpoint]: e.target.value },
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
  const bridge = useMemo(() => windowChaOfficeBridge(), [])
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
  const bridge = useMemo(() => windowChaOfficeBridge(), [])
  return (
    <>
      <h3 className="set-pane-title">{t('setSecDefaultModels')}</h3>
      <ModelDefaultsPage bridge={bridge} lang={lang} />
    </>
  )
}

/** the v2 settings page over the shell-wide ai:* channels */
function windowChaOfficeBridge(): ModelSettingsBridge {
  return {
    getSettings: () => window.chaOffice.getAiSettings(),
    saveSettings: (view) => window.chaOffice.setAiSettings(view),
    setCurrentModel: (selection) => window.chaOffice.setAiCurrentModel(selection),
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
      return window.chaOffice.aiDiscoverModels(target)
    },
    chaofficeStatus: (withEmail) => window.chaOffice.chaofficeStatus(withEmail),
    chaofficeLogin: () => void window.chaOffice.chaofficeLogin(),
    localToolStatus: (vendorId) => window.chaOffice.aiLocalToolStatus(vendorId),
    localToolInstall: (vendorId, onLine) => window.chaOffice.aiLocalToolInstall(vendorId, onLine),
    localToolStart: (vendorId) => window.chaOffice.aiLocalToolStart(vendorId),
    testSearchPlatform: (req) => window.chaOffice.aiTestSearchPlatform(req),
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
  const bridge = useMemo(() => windowChaOfficeBridge(), [])
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
  /** closes the modal and launches the ChaOffice login flow (progress shows on the account entry) */
  onLogin: () => void
  onLogout: () => void
  /** an installed skill is older than the bundled one: dot on the Integrations entry */
  skillUpdateDue?: boolean
  onSkillUpdateDue?: (due: boolean) => void
  /** landing section for this open (e.g. 'aiMedia' from the insert-image dialog's
   *  ⚙ entry); the modal remounts per open, so a plain initial state suffices */
  initialSection?: SectionId
}

export function SettingsModal({
  onClose,
  skillUpdateDue: updateDue = false,
  onSkillUpdateDue,
  initialSection,
}: SettingsModalProps) {
  const { lang, setLang, t } = useI18n()
  const [section, setSection] = useState<SectionId>(initialSection ?? 'modelSettings')
  // 生图、媒体与搜索 → 去模型设置启用：deep link onto that vendor's form
  const [aiModelVendor, setAiModelVendor] = useState<string | undefined>(undefined)
  const [theme, setTheme] = useState<UiTheme>('system')
  const [docTheme, setDocTheme] = useState<DocTheme>('follow')
  const [updateState, setUpdateState] = useState<UpdateUiState | null>(null)
  const [saveDir, setSaveDir] = useState('')
  const [analyticsOn, setAnalyticsOn] = useState(true)
  const [analyticsSaving, setAnalyticsSaving] = useState(false)
  const [autoSaveOn, setAutoSaveOn] = useState(false)
  const [tabSleepOn, setTabSleepOn] = useState(true)
  const [restoreSessionOn, setRestoreSessionOn] = useState(false)
  const [autoUpdateCheckOn, setAutoUpdateCheckOn] = useState(true)
  const [silentInstallOn, setSilentInstallOn] = useState(false)
  const [defaultApp, setDefaultApp] = useState<DefaultAppStatus | null>(null)
  const [defaultAppBusy, setDefaultAppBusy] = useState(false)
  const [defaultAppFailed, setDefaultAppFailed] = useState(false)
  const [aiPrefs, setAiPrefs] = useState<AiPanelPrefs>(DEFAULT_AI_PANEL_PREFS)
  const [authorName, setAuthorName] = useState<AuthorNameSetting>({ value: '', fallback: '' })
  const [legacyImportPrompt, setLegacyImportPrompt] = useState(true)
  const [channel, setChannel] = useState<'stable' | 'beta'>('stable')
  const [appVersion, setAppVersion] = useState('')
  const [githubStars, setGithubStars] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    void window.chaOffice.getTheme?.().then((th) => {
      if (alive) setTheme(th)
    })
    void window.chaOffice.getDocumentTheme?.().then((th) => {
      if (alive) setDocTheme(th)
    })
    void window.chaOffice.getDefaultSaveDir?.().then((dir) => {
      if (alive && dir) setSaveDir(dir)
    })
    void window.chaOffice.getAnalyticsEnabled?.().then((on) => {
      if (alive) setAnalyticsOn(on !== false)
    })
    void window.chaOffice.getAutoSaveDefault?.().then((v) => {
      if (alive) setAutoSaveOn(v.on)
    })
    void window.chaOffice.getRestoreLastSession?.().then((on) => {
      if (alive) setRestoreSessionOn(on)
    })
    void window.chaOffice.getDefaultAppStatus?.().then((st) => {
      if (alive) setDefaultApp(st)
    })
    void window.chaOffice.getAiPanelPrefs?.().then((prefs) => {
      if (alive) setAiPrefs(prefs)
    })
    void window.chaOffice.getLegacyImportPrompt?.().then((v) => {
      if (alive) setLegacyImportPrompt(v)
    })
    void window.chaOffice.getAuthorName?.().then((v) => {
      if (alive) setAuthorName(v)
    })
    void window.chaOffice.getUpdateChannel?.().then((ch) => {
      if (alive) setChannel(ch)
    })
    void window.chaOffice.getAutoUpdateCheck?.().then((on) => {
      if (alive) setAutoUpdateCheckOn(on)
    })
    void window.chaOffice.getSilentInstallUpdate?.().then((on) => {
      if (alive) setSilentInstallOn(on)
    })
    void window.chaOffice.getAppVersion?.().then((v) => {
      if (alive && v) setAppVersion(v)
    })
    // a rejected invoke (main process not ready, a shell whose preload does
    // not expose the channel) must not surface as an unhandled rejection;
    // without a known state the About row simply stays hidden
    void window.chaOffice
      .getUpdateState?.()
      .then((s) => {
        if (alive) setUpdateState(s)
      })
      .catch(() => undefined)
    void window.chaOffice.githubStars?.().then((n) => {
      if (alive && n !== null) setGithubStars(n)
    })
    return () => {
      alive = false
    }
  }, [])

  // live update state: the About row offers the update as soon as one is known
  useEffect(() => {
    const off = window.chaOffice.onUpdateStateChanged?.((s) => setUpdateState(s))
    return () => off?.()
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
    void window.chaOffice.setTheme(next)
    if (next === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', next)
  }

  const applyDocumentTheme = (next: DocTheme) => {
    setDocTheme(next)
    void window.chaOffice.setDocumentTheme(next)
  }

  // 上游快照（#2000）：作者名（导出/协作者显示兜底）；失焦/回车即保存
  const commitAuthorName = () => {
    void window.chaOffice.setAuthorName?.(authorName.value).then(setAuthorName)
  }

  // Windows only opens the system page; re-read ownership when the user comes back
  useEffect(() => {
    if (!defaultApp?.manualOnly) return
    const refresh = () => {
      void window.chaOffice.getDefaultAppStatus?.().then(setDefaultApp)
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [defaultApp?.manualOnly])

  const claimDefaultApp = () => {
    setDefaultAppBusy(true)
    setDefaultAppFailed(false)
    void window.chaOffice
      .setDefaultApp()
      .then((st) => {
        setDefaultApp(st)
        if (!st.manualOnly && st.state !== 'default') setDefaultAppFailed(true)
      })
      .catch(() => setDefaultAppFailed(true))
      .finally(() => setDefaultAppBusy(false))
  }

  const defaultAppDesc = (() => {
    if (!defaultApp) return ''
    if (defaultAppFailed) return t('setDefaultAppFailed')
    if (defaultApp.state === 'default') return t('setDefaultAppIs')
    if (defaultApp.state === 'other' && defaultApp.others.length > 0)
      return t('setDefaultAppOther', { app: defaultApp.others.join(', ') })
    return t('setDefaultAppDesc')
  })()

  const updateAiPrefs = (patch: Partial<AiPanelPrefs>) => {
    setAiPrefs((prev) => ({ ...prev, ...patch }))
    void window.chaOffice.setAiPanelPrefs(patch).then(setAiPrefs)
  }

  const changeSaveDir = () => {
    void window.chaOffice.pickDefaultSaveDir?.().then((dir) => {
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
                    <label className="set-field-label">{t('documentTheme')}</label>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={docTheme}
                    ariaLabel={t('documentTheme')}
                    options={DOC_THEME_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.labelKey),
                    }))}
                    onPick={(v) => applyDocumentTheme(v as DocTheme)}
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
                      <label className="set-field-label" htmlFor="set-author-name">
                        {t('setAuthorName')}
                      </label>
                      <div className="set-field-desc">{t('setAuthorNameDesc')}</div>
                    </div>
                  </div>
                  <input
                    id="set-author-name"
                    className="set-input"
                    type="text"
                    value={authorName.value}
                    placeholder={authorName.fallback}
                    maxLength={AUTHOR_NAME_MAX}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setAuthorName((prev) => ({ ...prev, value: e.target.value }))}
                    onBlur={commitAuthorName}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setLegacyImportPrompt')}</div>
                      <div className="set-field-desc">{t('setLegacyImportPromptDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={legacyImportPrompt}
                    aria-label={t('setLegacyImportPrompt')}
                    onClick={() => {
                      const next = !legacyImportPrompt
                      setLegacyImportPrompt(next)
                      void window.chaOffice.setLegacyImportPrompt?.(next).then(setLegacyImportPrompt)
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
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setAiShowSidebar')}</div>
                      <div className="set-field-desc">{t('setAiShowSidebarDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={aiPrefs.showAiSidebar}
                    aria-label={t('setAiShowSidebar')}
                    onClick={() => updateAiPrefs({ showAiSidebar: !aiPrefs.showAiSidebar })}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setAiOpenInNewDocs')}</div>
                      <div className="set-field-desc">{t('setAiOpenInNewDocsDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={aiPrefs.openInNewDocs}
                    aria-label={t('setAiOpenInNewDocs')}
                    onClick={() => updateAiPrefs({ openInNewDocs: !aiPrefs.openInNewDocs })}
                  />
                </div>
                {defaultApp && defaultApp.state !== 'unsupported' && (
                  <div className="set-field">
                    <div className="set-field-text">
                      <div className="set-field-stack">
                        <div className="set-field-label">{t('setDefaultApp')}</div>
                        <div className="set-field-desc">{defaultAppDesc}</div>
                      </div>
                    </div>
                    <button
                      className="set-btn"
                      disabled={defaultAppBusy || defaultApp.state === 'default'}
                      onClick={claimDefaultApp}
                    >
                      {defaultApp.manualOnly
                        ? t('setDefaultAppOpenSettings')
                        : t('setDefaultAppSet')}
                    </button>
                  </div>
                )}
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
                      void window.chaOffice.setAutoSaveDefault?.(next).catch(() => {})
                    }}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setRestoreSession')}</div>
                      <div className="set-field-desc">{t('setRestoreSessionDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={restoreSessionOn}
                    aria-label={t('setRestoreSession')}
                    onClick={() => {
                      const next = !restoreSessionOn
                      setRestoreSessionOn(next)
                      void window.chaOffice.setRestoreLastSession?.(next).catch(() => {})
                    }}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setTabSleep')}</div>
                      <div className="set-field-desc">{t('setTabSleepDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={tabSleepOn}
                    aria-label={t('setTabSleep')}
                    onClick={() => {
                      const next = !tabSleepOn
                      setTabSleepOn(next)
                      void window.chaOffice.setTabSleepEnabled?.(next).catch(() => {})
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
                      void window.chaOffice
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
            {section === 'skills' && <FoundSkills t={t} />}
            {section === 'mcpManage' && <McpManagePane t={t} />}
            {section === 'about' && (
              <>
                <h3 className="set-pane-title">{t('setSecAbout')}</h3>
                <Field label={t('versionLabel')} value={appVersion || '—'} />
                {updateState && (
                  <div className="set-field">
                    <div className="set-field-text">
                      <label className="set-field-label">{t('setUpdateAvailableLabel')}</label>
                    </div>
                    {updateState.phase === 'downloading' ? (
                      <span className="set-field-value">
                        {t('setUpdateDownloading', { percent: Math.round(updateState.percent) })}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="set-update-btn"
                        onClick={() => void window.chaOffice.openUpdateDialog?.()}
                      >
                        {updateState.phase === 'downloaded'
                          ? t('setUpdateRestart')
                          : t('setUpdateTo', { version: updateState.version })}
                      </button>
                    )}
                  </div>
                )}
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
                      void window.chaOffice.setUpdateChannel(next)
                    }}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setAutoUpdateCheck')}</div>
                      <div className="set-field-desc">{t('setAutoUpdateCheckDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={autoUpdateCheckOn}
                    aria-label={t('setAutoUpdateCheck')}
                    onClick={() => {
                      const next = !autoUpdateCheckOn
                      setAutoUpdateCheckOn(next)
                      void window.chaOffice.setAutoUpdateCheck?.(next).catch(() => {})
                    }}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setSilentInstall')}</div>
                      <div className="set-field-desc">{t('setSilentInstallDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={silentInstallOn}
                    aria-label={t('setSilentInstall')}
                    onClick={() => {
                      const next = !silentInstallOn
                      setSilentInstallOn(next)
                      void window.chaOffice.setSilentInstallUpdate?.(next).catch(() => {})
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
                      onClick={() => void window.chaOffice.openGitHubRepo?.()}
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
