/**
 * ModelSettingsPage — the v2 model settings surface, faithfully following
 * chatop's ModelSettings layout (harvested): left 240px vendor directory
 * (search + enabled group + catalog groups + add button), right config form
 * (vendor header with enable switch, URL/protocol/key fields, fetch/test/save
 * buttons, grouped model checklist with per-group toggles).
 *
 * First entry lands on a guide page — supported providers as cards, China
 * first then global; vendor forms and the ChatOffice sign-in card open on
 * explicit selection from the directory (or a guide card).
 *
 * Rendered through a portal onto document.body — the panel it opens from is
 * a positioned/transformed ancestor that would otherwise clip a fixed overlay.
 *
 * Transport is injected (ModelSettingsBridge) so the same page serves every
 * app's preload bridge and the web form's HTTP bridge.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CHATOFFICE_PRESET_MODELS,
  KEEP_KEY,
  NO_MODELS_API,
  VENDORS,
  VENDOR_BY_ID,
  VENDOR_GROUPS,
  groupByType,
  isImageGenModel,
  type AiModelEntry,
  type AiModelSelection,
  type AiProviderProfile,
  type AiSettingsV2,
  type AiWireProtocol,
  type DiscoveryTarget,
  type LocalToolOpResult,
  type LocalToolStatus,
  type VendorCatalogEntry,
} from '@chatoffice/ai-provider/browser'
import { fmt, modelSettingsStrings } from './model-settings-strings'
import { useDismissablePopover } from './popover-dismiss'
import { USER_LOGIN_READY } from './feature-flags'
import { VendorLogo } from './VendorLogo'
// self-contained styles: every consumer gets them with the component
import './model-settings.css'

export type { LocalToolStatus, LocalToolOpResult } from '@chatoffice/ai-provider/browser'

export interface ModelSettingsBridge {
  getSettings(): Promise<AiSettingsV2>
  saveSettings(view: AiSettingsV2): Promise<void>
  setCurrentModel(selection: AiModelSelection): Promise<void>
  discoverModels(target: DiscoveryTarget): Promise<{ models: AiModelEntry[]; error?: string }>
  chatofficeStatus?(withEmail?: boolean): Promise<{ loggedIn: boolean; email?: string }>
  chatofficeLogin?(): void | Promise<void>
  /** web form: chatoffice login is desktop-only — the page hides the chatoffice card */
  capabilities?(): Promise<{ chatofficeAvailable: boolean }>
  /** 本地与自建：探测/一键安装/启动 —— 仅桌面桥实现；web 桥不接，UI 自动隐藏 */
  localToolStatus?(vendorId: string): Promise<LocalToolStatus>
  localToolInstall?(vendorId: string, onLine?: (line: string) => void): Promise<LocalToolOpResult>
  localToolStart?(vendorId: string): Promise<LocalToolOpResult>
  /** 生图、媒体与搜索：搜索平台连通性探测（主进程执行，key 未保存也可测） */
  testSearchPlatform?(req: {
    platform: string
    key?: string
  }): Promise<{ ok: boolean; detail?: string }>
}

export interface ModelSettingsPageProps {
  bridge: ModelSettingsBridge
  /** overlay variant only — an inline pane is closed by its surrounding window */
  onClose?: () => void
  /** app locale ('zh' | 'en-US' | …); defaults to document.documentElement.lang */
  lang?: string
  /** 'overlay' (default) portals a modal onto body; 'inline' renders in place inside a host pane */
  variant?: 'overlay' | 'inline'
  /** deep link: open this vendor's config form instead of the guide page
   * (生图、媒体与搜索 → 去模型设置启用). Ignored when the vendor is unknown. */
  initialVendor?: string
}

interface DraftModel extends AiModelEntry {
  enabled: boolean
}

const PROTOCOLS: AiWireProtocol[] = [
  'anthropic-messages',
  'openai-completions',
  'openai-responses',
  'gemini-native',
]

/** vendor-directory filter (single-select dropdown before the search box) */
type TagFilter = 'all' | 'free' | 'needskey' | 'nokey' | 'tier'

const TAG_FILTERS: Array<{
  id: TagFilter
  labelKey: 'filterAll' | 'tagFree' | 'tagNeedsKey' | 'tagNoKey' | 'tagFreeTier'
}> = [
  { id: 'all', labelKey: 'filterAll' },
  { id: 'free', labelKey: 'tagFree' },
  { id: 'needskey', labelKey: 'tagNeedsKey' },
  { id: 'nokey', labelKey: 'tagNoKey' },
  { id: 'tier', labelKey: 'tagFreeTier' },
]

function matchesTagFilter(v: VendorCatalogEntry, f: TagFilter): boolean {
  switch (f) {
    case 'free':
      return !!v.free
    case 'needskey':
      return !!v.keyUrl && !v.ollamaLike
    case 'nokey':
      return !!v.ollamaLike || v.free === 'nokey'
    case 'tier':
      return v.free === 'tier'
    default:
      return true
  }
}

/** 说明页卡片精选的常用厂商 —— 国内在前、国外在后；本地/聚合等其余
 * 厂商不占卡片位，走左侧完整目录（左下角也可接任意 OpenAI 兼容服务）。 */
const GUIDE_CN_VENDORS = [
  'deepseek',
  'zhipu',
  'aliyun-bailian',
  'moonshot',
  'volcengine',
  'minimax',
  'baidu-qianfan',
  'tencent-hunyuan',
  'step-ai',
  'siliconflow',
  'modelscope',
]

const GUIDE_GLOBAL_VENDORS = [
  'openai',
  'anthropic',
  'gemini',
  'grok',
  'azure-openai',
  'mistral',
  'perplexity',
  'groq',
  'github-models',
  'openrouter',
]

export function ModelSettingsPage({
  bridge,
  onClose,
  lang,
  variant = 'overlay',
  initialVendor,
}: ModelSettingsPageProps): React.JSX.Element {
  const locale = lang ?? (typeof document !== 'undefined' ? document.documentElement.lang : 'zh')
  const t = useMemo(() => modelSettingsStrings(locale), [locale])
  const [settings, setSettings] = useState<AiSettingsV2 | null>(null)
  const [chatofficeAvailable, setChatOfficeAvailable] = useState(true)
  /** '' = 说明页（初次进入的落地）；厂商 id = 该厂商的配置表单 */
  const [selected, setSelected] = useState<string>(
    initialVendor && VENDOR_BY_ID.has(initialVendor) ? initialVendor : '',
  )
  const [search, setSearch] = useState('')
  /** 目录过滤（单选下拉）：全部 / 免费 / 需要 Key / 无需 Key / 免费额度 */
  const [tagFilter, setTagFilter] = useState<TagFilter>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterWrapRef = useRef<HTMLDivElement>(null)
  useDismissablePopover(filterOpen, () => setFilterOpen(false), {
    inside: () => [filterWrapRef.current],
  })
  /** entering the page surfaces a hint about the free-vendor filter, until any interaction */
  const [showFilterHint, setShowFilterHint] = useState(true)
  /** collapsed directory groups (已开启 / 国内平台 / …) in the left pane */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  /** enabled-profile rows expanded to show their model sub-lists in the left pane */
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set())
  const [chatoffice, setChatOffice] = useState<{ loggedIn: boolean; email?: string } | null>(null)
  /** 本地与自建：一键安装/探测状态（仅桌面桥实现） */
  const [tool, setTool] = useState<LocalToolStatus | null>(null)
  const [toolProbing, setToolProbing] = useState(false)
  const [toolBusy, setToolBusy] = useState<'install' | 'start' | ''>('')
  const [toolLine, setToolLine] = useState('')
  const [toolProbeTick, setToolProbeTick] = useState(0)
  /** 安装/启动失败的持久提示（含手动下载兜底）；成功或重新操作时清除 */
  const [toolNote, setToolNote] = useState<string | null>(null)

  // ── form state (rebuilt when the selected vendor changes) ──────────────
  const [apiUrl, setApiUrl] = useState('')
  const [protocol, setProtocol] = useState<AiWireProtocol>('openai-completions')
  const [apiKeyInput, setApiKeyInput] = useState('')
  /** multi-field credentials (vendor.keyFields, e.g. kling accessKey/secretKey):
   * per-field drafts folded into the single stored key on save */
  const [keyFieldValues, setKeyFieldValues] = useState<Record<string, string>>({})
  const [keyConfigured, setKeyConfigured] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<DraftModel[]>([])
  const [modelsFromPreset, setModelsFromPreset] = useState(false)
  /** model-type groups the user collapsed in the checklist */
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'fetch' | 'test' | 'save' | ''>('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const flash = (kind: 'ok' | 'err', text: string) => {
    setMsg({ kind, text })
    window.setTimeout(() => setMsg(null), 4000)
  }

  // the entering hint fades on any interaction or after a while
  useEffect(() => {
    if (!showFilterHint) return
    const hide = () => setShowFilterHint(false)
    window.addEventListener('pointerdown', hide, { once: true })
    const timer = window.setTimeout(hide, 8000)
    return () => {
      window.removeEventListener('pointerdown', hide)
      window.clearTimeout(timer)
    }
  }, [showFilterHint])

  useEffect(() => {
    // 挂载拉取带小步重试：对话框打开瞬间可能撞上 sidecar 抖动/冷启动，
    // 一次失败就把视图钉死在「尚未启用任何模型」（目录无本地模型组）
    let alive = true
    const fetchSettings = async () => {
      for (let i = 0; ; i++) {
        try {
          const s = await bridge.getSettings()
          if (alive) setSettings(s)
          return
        } catch {
          if (!alive || i >= 3) {
            if (alive) setSettings(null)
            return
          }
          await new Promise((r) => setTimeout(r, 1500))
        }
      }
    }
    void fetchSettings()
    const onFocus = () => void fetchSettings()
    window.addEventListener('focus', onFocus)
    if (bridge.chatofficeStatus) {
      void bridge
        .chatofficeStatus(true)
        .then(setChatOffice)
        .catch(() => setChatOffice(null))
    }
    if (bridge.capabilities) {
      void bridge
        .capabilities()
        .then((c) => setChatOfficeAvailable(c.chatofficeAvailable !== false))
        .catch(() => setChatOfficeAvailable(true))
    }
    return () => {
      alive = false
      window.removeEventListener('focus', onFocus)
    }
  }, [bridge])

  const profiles = settings?.profiles ?? []
  const enabledProfiles = profiles.filter((p) => p.enabled)
  const selectedProfile = profiles.find((p) => p.id === selected)
  const selectedVendor = VENDOR_BY_ID.get(selected)
  /** single secret the save/test paths see: fields joined per the catalog
   * declaration (kling folds accessKey + ':' + secretKey) */
  const keyFieldsDef = selectedVendor?.keyFields
  const keyJoiner = keyFieldsDef?.find((f) => f.join)?.join ?? ''
  const apiKeyEffective =
    keyFieldsDef && keyFieldsDef.length > 1
      ? keyFieldsDef
          .map((f) => (keyFieldValues[f.id] ?? '').trim())
          .filter(Boolean)
          .join(keyJoiner)
      : apiKeyInput
  const isChatOffice = selected === 'chatoffice'
  /** 登录功能未开放（USER_LOGIN_READY=false）时，ChatOffice 视同不可用：
   * 目录行、已启用列表与登录卡整体隐藏 */
  const chatofficeUsable = USER_LOGIN_READY && chatofficeAvailable
  /** 本地与自建厂商（排除自定义兼容入口）才探测本地安装 */
  const localToolVendor =
    selectedVendor?.group === 'local' && selectedVendor.id !== 'openai-compatible' ? selected : ''

  /** vendor rows not currently enabled (a disabled profile still prefills its stored values) */
  const catalogRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const match = (name: string, nameZh: string | undefined, id: string) =>
      !q ||
      name.toLowerCase().includes(q) ||
      (nameZh?.toLowerCase().includes(q) ?? false) ||
      id.includes(q)
    return VENDOR_GROUPS.map((group) => ({
      ...group,
      label: locale === 'zh' ? group.labelZh : group.label,
      vendors: VENDORS.filter(
        (v) =>
          v.group === group.id &&
          !(!chatofficeUsable && v.id === 'chatoffice') &&
          !enabledProfiles.some((p) => (p.vendorId ?? p.id) === v.id) &&
          matchesTagFilter(v, tagFilter) &&
          match(v.name, v.nameZh, v.id),
      ),
    })).filter((g) => g.vendors.length > 0)
  }, [enabledProfiles, search, tagFilter, chatofficeUsable, locale])

  // ── form seeding on vendor switch ─────────────────────────────────────
  useEffect(() => {
    setMsg(null)
    setBusy('')
    setShowKey(false)
    setCollapsedTypes(new Set())
    if (!selectedProfile) {
      const vendor = selectedVendor
      // a disabled profile with this vendor keeps its stored values
      const stored = profiles.find((p) => (p.vendorId ?? p.id) === selected && !p.enabled)
      setApiUrl(stored?.baseUrl ?? vendor?.defaultUrl ?? '')
      setProtocol(stored?.protocol ?? vendor?.api ?? 'openai-completions')
      setModels(
        (stored?.models ?? ((vendor?.presets ?? []) as AiModelEntry[])).map((m) => ({
          ...m,
          enabled: true,
        })),
      )
      setModelsFromPreset(!!vendor?.presets?.length && !stored?.models.length)
      setApiKeyInput('')
      setKeyFieldValues({})
      setKeyConfigured(!!stored?.apiKey || !!stored?.apiKeyRef)
      return
    }
    setApiUrl(selectedProfile.baseUrl)
    setProtocol(selectedProfile.protocol)
    setModels(selectedProfile.models.map((m) => ({ ...m, enabled: true })))
    setModelsFromPreset(false)
    setApiKeyInput('')
    setKeyFieldValues({})
    // harness-managed profiles carry only a key reference (the secret lives in
    // the host's credential store) — treat them as configured
    setKeyConfigured(!!selectedProfile.apiKey || !!selectedProfile.apiKeyRef)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only on vendor switch
  }, [selected])

  // 本地工具探测：切到本地厂商（或点「重新检测」）时查安装/运行状态
  useEffect(() => {
    if (!localToolVendor || typeof bridge.localToolStatus !== 'function') {
      setTool(null)
      setToolProbing(false)
      return
    }
    let alive = true
    setToolProbing(true)
    bridge.localToolStatus(localToolVendor).then(
      (s) => {
        if (!alive) return
        setTool(s)
        setToolProbing(false)
      },
      () => {
        if (!alive) return
        setTool(null)
        setToolProbing(false)
      },
    )
    return () => {
      alive = false
    }
  }, [localToolVendor, bridge, toolProbeTick])

  const installLocalTool = async () => {
    if (!bridge.localToolInstall) return
    setToolBusy('install')
    setToolLine('')
    setToolNote(null)
    try {
      const r = await bridge.localToolInstall(selected, (line) => setToolLine(line))
      if (r.ok) {
        flash('ok', r.message || t.localInstallDone)
        setToolProbeTick((n) => n + 1)
      } else {
        setToolNote(r.message ?? '')
        flash('err', fmt(t.localInstallFailed, { message: r.message ?? '' }))
      }
    } catch (error) {
      const message = errorText(error)
      setToolNote(message)
      flash('err', fmt(t.localInstallFailed, { message }))
    } finally {
      setToolBusy('')
    }
  }

  const startLocalTool = async () => {
    if (!bridge.localToolStart) return
    setToolBusy('start')
    setToolNote(null)
    try {
      const r = await bridge.localToolStart(selected)
      if (r.ok) {
        flash('ok', r.message || t.localStartOk)
        setToolProbeTick((n) => n + 1)
      } else {
        setToolNote(r.message ?? '')
        flash('err', fmt(t.localInstallFailed, { message: r.message ?? '' }))
      }
    } catch (error) {
      const message = errorText(error)
      setToolNote(message)
      flash('err', fmt(t.localInstallFailed, { message }))
    } finally {
      setToolBusy('')
    }
  }

  const vendorName = (id: string): string => {
    const v = VENDOR_BY_ID.get(id)
    if (!v) return id
    return locale === 'zh' && v.nameZh ? v.nameZh : v.name
  }

  /** 徽标：需不需要 Key / 是否免费 —— 目录行与说明页卡片共用 */
  const vendorTags = (id: string): Array<{ kind: string; label: string }> => {
    const meta = VENDOR_BY_ID.get(id)
    const tags: Array<{ kind: string; label: string }> = []
    if (meta?.ollamaLike) tags.push({ kind: 'nokey', label: t.tagNoKey })
    else if (meta?.keyUrl) tags.push({ kind: 'key', label: t.tagNeedsKey })
    if (meta?.free === 'nokey' || meta?.free === 'freekey')
      tags.push({ kind: 'free', label: t.tagFree })
    else if (meta?.free === 'tier') tags.push({ kind: 'tier', label: t.tagFreeTier })
    return tags
  }

  // ── fetch / test / save / disable ─────────────────────────────────────
  const discoveryTarget = (): DiscoveryTarget => ({
    protocol,
    baseUrl: apiUrl.trim(),
    apiKey:
      apiKeyEffective.trim() ||
      (keyConfigured || selectedVendor?.ollamaLike || selectedProfile?.ollamaLike ? '' : ''),
    ...(selectedVendor?.ollamaLike || selectedProfile?.ollamaLike ? { ollamaLike: true } : {}),
    ...(selectedVendor?.codexLike ? { codexLike: true } : {}),
    ...(selectedProfile && !apiKeyEffective.trim() ? { profileId: selectedProfile.id } : {}),
  })

  const fetchModels = async () => {
    if (!apiUrl.trim() && !selectedVendor?.codexLike) return flash('err', t.errApiUrl)
    setBusy('fetch')
    try {
      const found = await bridge.discoverModels(discoveryTarget())
      if (found.error) throw new Error(found.error)
      if (!found.models.length) throw new Error(t.errNoModelsParsed)
      const previous = new Map(models.map((m) => [m.id, m.enabled]))
      setModels(found.models.map((m) => ({ ...m, enabled: previous.get(m.id) ?? false })))
      setModelsFromPreset(false)
      flash('ok', fmt(t.modelsFound, { n: found.models.length }))
    } catch (error) {
      const vendor = selectedVendor
      if (vendor?.presets?.length) {
        setModels(vendor.presets.map((m) => ({ ...m, enabled: false })))
        setModelsFromPreset(true)
        flash('ok', fmt(t.modelsFound, { n: vendor.presets.length }))
      } else {
        flash('err', fmt(t.fetchFailed, { message: errorText(error) }))
      }
    } finally {
      setBusy('')
    }
  }

  const testConnection = async () => {
    if (!apiUrl.trim()) return flash('err', t.errApiUrl)
    setBusy('test')
    try {
      const found = await bridge.discoverModels(discoveryTarget())
      if (found.error) throw new Error(found.error)
      flash('ok', t.connectionOk)
    } catch (error) {
      flash('err', fmt(t.testFailed, { message: errorText(error) }))
    } finally {
      setBusy('')
    }
  }

  const persist = async (next: AiSettingsV2) => {
    await bridge.saveSettings(next)
    setSettings(next)
  }

  const sanitize = (next: AiSettingsV2): AiSettingsV2 => {
    if (next.currentModel === undefined) delete next.currentModel
    if (next.imageModel === undefined) delete next.imageModel
    return next
  }

  const saveProfile = async () => {
    if (!apiUrl.trim()) return flash('err', t.errApiUrl)
    const ollama = selectedVendor?.ollamaLike
    const codex = selectedVendor?.codexLike
    const effectiveKey = apiKeyEffective.trim()
    if (!effectiveKey && !keyConfigured && !ollama && !codex) return flash('err', t.errApiKey)
    const enabledModels = models.filter((m) => m.enabled)
    if (enabledModels.length === 0) return flash('err', t.errPickModel)
    setBusy('save')
    try {
      // protocol validation: the endpoint must answer a model-list call over the
      // chosen protocol before anything is saved — a wrong protocol never persists
      const vendorId0 = selectedVendor?.id ?? selectedProfile?.vendorId ?? selected
      if (!NO_MODELS_API.has(vendorId0)) {
        try {
          const probe = await bridge.discoverModels(discoveryTarget())
          if (probe.error) throw new Error(probe.error)
        } catch (error) {
          return flash('err', fmt(t.saveValidateFailed, { message: errorText(error) }))
        }
      }
      const vendorId = selectedVendor?.id ?? selectedProfile?.vendorId ?? selected
      const profile: AiProviderProfile = {
        id: vendorId,
        vendorId,
        displayName: vendorName(vendorId),
        protocol,
        baseUrl: apiUrl.trim(),
        // untouched key → KEEP_KEY so the backend keeps the stored secret
        apiKey: effectiveKey || (keyConfigured ? KEEP_KEY : 'local'),
        auth: 'api-key',
        ...(ollama ? { ollamaLike: true } : {}),
        enabled: true,
        models: enabledModels.map((m) => ({
          id: m.id,
          ...(m.name && m.name !== m.id ? { name: m.name } : {}),
        })),
        updatedAt: new Date().toISOString(),
      }
      const nextProfiles = [
        ...profiles.filter((p) => p.id !== profile.id && (p.vendorId ?? p.id) !== vendorId),
        profile,
      ]
      const next: AiSettingsV2 = { ...(settings ?? { version: 2 }), profiles: nextProfiles }
      // first usable chat model becomes the current selection when none is set
      const chatPick = enabledModels.find(
        (m) => !isImageGenModel(m) && (m.type ?? 'chat') !== 'embedding',
      )
      if (
        (!next.currentModel || !nextProfiles.some((p) => p.id === next.currentModel!.profileId)) &&
        chatPick
      ) {
        next.currentModel = { profileId: profile.id, modelId: chatPick.id }
      }
      await persist(sanitize(next))
      setApiKeyInput('')
      setKeyFieldValues({})
      setKeyConfigured(true)
      setSelected(vendorId)
      flash('ok', t.enabledOk)
    } catch (error) {
      flash('err', fmt(t.enableFailed, { message: errorText(error) }))
    } finally {
      setBusy('')
    }
  }

  const disableProfile = async () => {
    if (!selectedProfile) return
    setBusy('save')
    try {
      const nextProfiles = profiles.map((p) =>
        p.id === selectedProfile.id ? { ...p, enabled: false } : p,
      )
      const next: AiSettingsV2 = { ...settings!, profiles: nextProfiles }
      // current model falling off → first enabled chat model
      if (
        next.currentModel &&
        !nextProfiles.some((p) => p.enabled && p.id === next.currentModel!.profileId)
      ) {
        const fallback = nextProfiles
          .filter((p) => p.enabled)
          .flatMap((p) =>
            p.models
              .filter((m) => !isImageGenModel(m) && (m.type ?? 'chat') !== 'embedding')
              .map((m) => ({ profileId: p.id, modelId: m.id })),
          )
        if (fallback[0]) next.currentModel = fallback[0]
        else delete next.currentModel
      }
      await persist(sanitize(next))
      flash('ok', t.disabled)
    } catch (error) {
      flash('err', fmt(t.saveFailed, { message: errorText(error) }))
    } finally {
      setBusy('')
    }
  }

  const toggleChatOfficeModel = async (modelId: string, on: boolean) => {
    const profile = profiles.find((p) => p.id === 'chatoffice')
    if (!profile) return
    const currentIds = new Set(profile.models.map((m) => m.id))
    const nextModels = on
      ? CHATOFFICE_PRESET_MODELS.filter((id) => currentIds.has(id) || id === modelId).map((id) => ({
          id,
        }))
      : profile.models.filter((m) => m.id !== modelId)
    // picking a model is the explicit act that enables the login-backed profile
    const nextProfiles = profiles.map((p) =>
      p.id === 'chatoffice' ? { ...p, enabled: true, models: nextModels } : p,
    )
    const next: AiSettingsV2 = { ...settings!, profiles: nextProfiles }
    if (
      next.currentModel?.profileId === 'chatoffice' &&
      !nextModels.some((m) => m.id === next.currentModel!.modelId)
    ) {
      if (nextModels[0]) next.currentModel = { profileId: 'chatoffice', modelId: nextModels[0].id }
      else delete next.currentModel
    }
    await persist(sanitize(next))
  }

  // ── chatop-shaped pieces ──────────────────────────────────────────────
  const enabledList = chatofficeUsable
    ? enabledProfiles.filter((p) => p.id !== 'chatoffice' || p.models.length > 0)
    : enabledProfiles.filter((p) => p.id !== 'chatoffice')

  const VendorRow = ({ id, name, active }: { id: string; name: string; active?: boolean }) => {
    const profile = active ? profiles.find((p) => p.id === id) : undefined
    const expanded = expandedVendors.has(id)
    const tags = vendorTags(profile?.vendorId ?? id)
    return (
      <div
        className={`msp-vendor-wrap${selected === id ? ' is-selected' : ''}${active && expanded ? ' is-open' : ''}`}
        data-vendor-row-wrap={id}
      >
        <button
          type="button"
          className={`msp-vendor${selected === id ? ' is-selected' : ''}`}
          data-vendor-row={id}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setSelected(id)}
        >
          <VendorLogo vendorId={VENDOR_BY_ID.has(id) ? id : undefined} size={18} fallback={name} />
          <span className="msp-vendor-name">{name}</span>
          {tags.length > 0 && (
            <span className="msp-tags" data-vendor-tags={id}>
              {tags.map((tag) => (
                <span key={tag.kind} className={`msp-tag is-${tag.kind}`}>
                  {tag.label}
                </span>
              ))}
            </span>
          )}
          {active && profile && (
            <span
              className={`msp-chev${expanded ? '' : ' is-collapsed'}`}
              role="button"
              tabIndex={0}
              aria-expanded={expanded}
              aria-label={t.toggleVendorModels}
              onClick={(e) => {
                e.stopPropagation()
                setExpandedVendors((prev) => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.currentTarget.click()
                }
              }}
            >
              ▾
            </span>
          )}
          {(active || selected === id) && <span className="msp-dot" aria-hidden />}
        </button>
        {active && profile && expanded && (
          <div className="msp-vendor-models" data-vendor-models={id}>
            {profile.models.map((m) => (
              <span key={m.id} className="msp-vendor-model" title={m.id}>
                {m.name && m.name !== m.id ? m.name : m.id}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  const VendorGroupEl = ({
    id,
    label,
    rows,
  }: {
    id: string
    label: string
    rows: React.ReactNode
  }) =>
    rows ? (
      <div className="msp-group" data-vendor-group={id}>
        <button
          type="button"
          className="msp-group-head"
          aria-expanded={!collapsedGroups.has(id)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            setCollapsedGroups((prev) => {
              const next = new Set(prev)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })
          }
        >
          <span className={`msp-chev${collapsedGroups.has(id) ? ' is-collapsed' : ''}`} aria-hidden>
            ▾
          </span>
          {label}
        </button>
        {!collapsedGroups.has(id) && rows}
      </div>
    ) : null

  const enabledRows = enabledList.map((p) => (
    <VendorRow key={p.id} id={p.id} name={p.displayName || p.id} active />
  ))

  /** model checklist card — chatop's ModelList: per-type groups with group toggle */
  const ModelList = ({
    entries,
    onToggle,
    onToggleMany,
  }: {
    entries: DraftModel[]
    onToggle?: (id: string, enabled: boolean) => void
    onToggleMany?: (ids: string[], enabled: boolean) => void
  }) => {
    if (entries.length === 0) {
      return (
        <div className="msp-list is-empty" data-model-list-empty>
          <button
            type="button"
            className="msp-btn"
            onClick={() => void fetchModels()}
            disabled={busy !== ''}
          >
            {busy === 'fetch' ? t.fetching : t.fetchModels}
          </button>
        </div>
      )
    }
    return (
      <div className="msp-list" data-model-list>
        {modelsFromPreset && <div className="msp-note">{t.presetModelsHint}</div>}
        {groupByType(entries).map((group) => {
          const allOn = group.models.every((m) => m.enabled)
          const collapsed = collapsedTypes.has(group.type)
          return (
            <div key={group.type} data-model-type-group={group.type}>
              <div className="msp-type-title">
                <button
                  type="button"
                  className="msp-type-collapse"
                  data-model-type-collapse={group.type}
                  aria-expanded={!collapsed}
                  onClick={() =>
                    setCollapsedTypes((prev) => {
                      const next = new Set(prev)
                      if (next.has(group.type)) next.delete(group.type)
                      else next.add(group.type)
                      return next
                    })
                  }
                >
                  <span className={`msp-chev${collapsed ? ' is-collapsed' : ''}`} aria-hidden>
                    ▾
                  </span>
                  <span className="msp-type-name">
                    {t.type[group.type] ?? group.type} · {group.models.length}
                  </span>
                </button>
                {onToggleMany && (
                  <button
                    type="button"
                    className="msp-type-toggle"
                    data-model-group-toggle={group.type}
                    onClick={() =>
                      onToggleMany(
                        group.models.map((m) => m.id),
                        !allOn,
                      )
                    }
                  >
                    {allOn ? t.selectNone : t.selectAll}
                  </button>
                )}
              </div>
              {!collapsed &&
                group.models.map((m) => (
                  <label key={m.id} className="msp-model-row" data-model-toggle={m.id}>
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      onChange={(e) => onToggle?.(m.id, e.target.checked)}
                    />
                    <span className="msp-model-name">{m.name || m.id}</span>
                    {m.name && m.name !== m.id && <span className="msp-model-id">{m.id}</span>}
                  </label>
                ))}
            </div>
          )
        })}
      </div>
    )
  }

  const header =
    variant === 'overlay' ? (
      <header className="msp-header">
        <h2 className="msp-title">{t.title}</h2>
        <button
          type="button"
          className="msp-close"
          onClick={onClose}
          aria-label={t.close}
          title={t.close}
        >
          ✕
        </button>
      </header>
    ) : null

  const body = (
    <div className="msp-body">
      {/* 左：厂商目录（chatop 版式） */}
      <aside className="msp-left">
        <div className="msp-search-wrap">
          <div className="msp-filter" ref={filterWrapRef}>
            <button
              type="button"
              className={`msp-filter-btn${tagFilter !== 'all' ? ' is-active' : ''}`}
              data-model-filter
              aria-haspopup="menu"
              aria-expanded={filterOpen}
              title={t.filterHint}
              onClick={() => {
                setFilterOpen((v) => !v)
                setShowFilterHint(false)
              }}
            >
              <span className="msp-filter-label">
                {t[TAG_FILTERS.find((f) => f.id === tagFilter)!.labelKey]}
              </span>
              <span className={`msp-chev${filterOpen ? '' : ' is-collapsed'}`} aria-hidden>
                ▾
              </span>
            </button>
            {filterOpen && (
              <div className="msp-filter-menu" role="menu" data-model-filter-menu>
                {TAG_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={tagFilter === f.id}
                    data-model-filter-item={f.id}
                    className={`msp-filter-item${tagFilter === f.id ? ' is-active' : ''}`}
                    onClick={() => {
                      setTagFilter(f.id)
                      setFilterOpen(false)
                      setShowFilterHint(false)
                    }}
                  >
                    <span>{t[f.labelKey]}</span>
                    {tagFilter === f.id && <span className="msp-filter-check">✓</span>}
                  </button>
                ))}
              </div>
            )}
            {showFilterHint && !filterOpen && (
              <div className="msp-filter-hint" data-model-filter-hint>
                {t.filterHint}
              </div>
            )}
          </div>
          <input
            className="msp-input"
            type="search"
            data-model-search
            placeholder={t.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="msp-scroll">
          {/* 「已启用」分组只在确实有已启用厂商时出现；空态不占位 */}
          {enabledRows.length > 0 && (
            <VendorGroupEl
              id="enabled"
              label={`${t.enabledGroup} · ${enabledList.length}`}
              rows={enabledRows}
            />
          )}
          {catalogRows.map((group) => (
            <VendorGroupEl
              key={group.id}
              id={group.id}
              label={group.label}
              rows={
                <>
                  {group.vendors.map((v) => (
                    <VendorRow
                      key={v.id}
                      id={v.id}
                      name={locale === 'zh' && v.nameZh ? v.nameZh : v.name}
                    />
                  ))}
                </>
              }
            />
          ))}
        </div>
        <div className="msp-left-footer">
          <button
            type="button"
            className="msp-btn msp-btn-block"
            data-model-add-vendor
            onClick={() => setSelected('openai-compatible')}
          >
            ＋ {t.addVendor}
          </button>
        </div>
      </aside>

      {/* 右：配置表单（初次进入 = 说明页） */}
      <section className="msp-right" data-model-pane={selected}>
        <div className="msp-form">
          {selected === '' ? (
            /* 说明页：支持的模型服务以卡片列出，国内在前、国外在后；
             * 登录卡片与厂商表单只在左侧目录显式选中后出现 */
            <div className="msp-guide-page" data-model-guide-page>
              {[
                { id: 'cn', label: t.guideCnTitle, ids: GUIDE_CN_VENDORS },
                { id: 'global', label: t.guideGlobalTitle, ids: GUIDE_GLOBAL_VENDORS },
              ].map((section) => (
                <div key={section.id} className="msp-guide-section" data-guide-section={section.id}>
                  <div className="msp-guide-section-title">{section.label}</div>
                  <div className="msp-cards">
                    {section.ids.map((id) => {
                      if (!VENDOR_BY_ID.has(id)) return null
                      const enabled = enabledProfiles.some((p) => (p.vendorId ?? p.id) === id)
                      return (
                        <button
                          key={id}
                          type="button"
                          className="msp-card"
                          data-guide-card={id}
                          title={t.guideCardHint}
                          onClick={() => setSelected(id)}
                        >
                          <span className="msp-card-head">
                            <VendorLogo vendorId={id} size={20} fallback={vendorName(id)} />
                            <span className="msp-card-name">{vendorName(id)}</span>
                            {enabled && (
                              <span className="msp-card-on" data-guide-card-enabled={id}>
                                {t.enabledBadge}
                              </span>
                            )}
                          </span>
                          <span className="msp-card-tags">
                            {vendorTags(id).map((tag) => (
                              <span key={tag.kind} className={`msp-tag is-${tag.kind}`}>
                                {tag.label}
                              </span>
                            ))}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
              <p className="msp-note">{t.guideMore}</p>
            </div>
          ) : isChatOffice ? (
            <>
              <div className="msp-pane-head">
                <span className="msp-avatar is-big" aria-hidden>
                  G
                </span>
                <div className="msp-pane-titles">
                  <div className="msp-pane-name">{t.chatofficeLoginTitle}</div>
                  <div className="msp-pane-status">{t.chatofficeLoginDesc}</div>
                </div>
              </div>
              {msg && (
                <p className={`msp-msg ${msg.kind}`} data-model-msg>
                  {msg.text}
                </p>
              )}
              <div className="msp-chatoffice-row">
                <span
                  className={`msp-dot is-big${chatoffice?.loggedIn ? ' is-on' : ''}`}
                  aria-hidden
                />
                <span className="msp-chatoffice-state">
                  {chatoffice?.loggedIn
                    ? chatoffice.email
                      ? fmt(t.chatofficeLoggedIn, { email: chatoffice.email })
                      : t.chatofficeLoggedInNoEmail
                    : t.chatofficeLoggedOut}
                </span>
                {!chatoffice?.loggedIn && bridge.chatofficeLogin && (
                  <button
                    type="button"
                    className="msp-btn msp-btn-primary"
                    onClick={() => void bridge.chatofficeLogin?.()}
                  >
                    {t.chatofficeLoginBtn}
                  </button>
                )}
              </div>
              <ModelList
                entries={CHATOFFICE_PRESET_MODELS.map((id) => ({
                  id,
                  enabled: selectedProfile?.models.some((m) => m.id === id) ?? false,
                }))}
                onToggle={(id, on) => void toggleChatOfficeModel(id, on)}
              />
            </>
          ) : (
            <>
              <div className="msp-pane-head">
                <span className="msp-avatar is-big" aria-hidden>
                  {vendorName(
                    selectedVendor?.id ??
                      selectedProfile?.vendorId ??
                      selectedProfile?.id ??
                      selected,
                  )
                    .slice(0, 1)
                    .toUpperCase()}
                </span>
                <div className="msp-pane-titles">
                  <div className="msp-pane-name">
                    {vendorName(
                      selectedVendor?.id ??
                        selectedProfile?.vendorId ??
                        selectedProfile?.id ??
                        selected,
                    )}
                  </div>
                  <div className="msp-pane-status">
                    {selectedProfile?.enabled ? t.statusEnabled : t.statusNotEnabled}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!selectedProfile?.enabled}
                  className={`msp-switch${selectedProfile?.enabled ? ' is-on' : ''}`}
                  onClick={() =>
                    selectedProfile?.enabled ? void disableProfile() : void saveProfile()
                  }
                  disabled={busy !== ''}
                />
              </div>

              {/* 本地与自建：安装/运行状态卡（桌面桥才渲染） */}
              {localToolVendor && typeof bridge.localToolStatus === 'function' && (
                <div className="msp-local-tool" data-local-tool={selected}>
                  {toolBusy === 'install' ? (
                    <>
                      <p className="msp-note" data-local-tool-installing>
                        {t.localInstalling}
                      </p>
                      {toolLine && (
                        <p className="msp-note msp-local-line" data-local-tool-line>
                          {toolLine}
                        </p>
                      )}
                    </>
                  ) : toolProbing && !tool ? (
                    <p className="msp-note">{t.localDetecting}</p>
                  ) : !tool || !tool.supported ? null : tool.running ? (
                    <div className="msp-local-state">
                      <span className="msp-dot is-big is-on" aria-hidden />
                      <span className="msp-local-text" data-local-tool-running>
                        {t.localRunning}
                        {tool.version ? ` · v${tool.version}` : ''}
                      </span>
                      <button
                        type="button"
                        className="msp-btn msp-btn-mini"
                        data-local-tool-redetect
                        disabled={toolBusy !== '' || toolProbing}
                        onClick={() => {
                          setToolNote(null)
                          setToolProbeTick((n) => n + 1)
                        }}
                      >
                        {t.localRedetect}
                      </button>
                    </div>
                  ) : tool.installed ? (
                    <div className="msp-local-state">
                      <span className="msp-dot is-big is-off" aria-hidden />
                      <span className="msp-local-text" data-local-tool-installed>
                        {t.localInstalledNoServer}
                      </span>
                      {tool.startable && bridge.localToolStart && (
                        <button
                          type="button"
                          className="msp-btn"
                          data-local-tool-start
                          disabled={toolBusy !== ''}
                          onClick={() => void startLocalTool()}
                        >
                          {toolBusy === 'start' ? t.localStarting : t.localStartBtn}
                        </button>
                      )}
                      <button
                        type="button"
                        className="msp-btn msp-btn-mini"
                        data-local-tool-redetect
                        disabled={toolBusy !== '' || toolProbing}
                        onClick={() => {
                          setToolNote(null)
                          setToolProbeTick((n) => n + 1)
                        }}
                      >
                        {t.localRedetect}
                      </button>
                    </div>
                  ) : tool.installable && bridge.localToolInstall ? (
                    <div className="msp-local-state">
                      <span className="msp-local-text" data-local-tool-missing>
                        {t.localNotInstalled}
                      </span>
                      <button
                        type="button"
                        className="msp-btn msp-btn-primary"
                        data-local-tool-install
                        disabled={toolBusy !== ''}
                        onClick={() => void installLocalTool()}
                      >
                        {t.localInstallBtn}
                      </button>
                      <span className="msp-note">{t.localInstallHint}</span>
                    </div>
                  ) : null}
                  {toolNote && (
                    <p className="msp-note msp-local-note" data-local-tool-note>
                      {toolNote}
                    </p>
                  )}
                </div>
              )}

              {msg && (
                <p className={`msp-msg ${msg.kind}`} data-model-msg>
                  {msg.text}
                </p>
              )}

              <label className="msp-field">
                <span className="msp-label">{t.apiUrl}</span>
                <input
                  className="msp-input"
                  data-model-base=""
                  value={apiUrl}
                  placeholder={selectedVendor?.defaultUrl || t.apiUrlPlaceholder}
                  onChange={(e) => setApiUrl(e.target.value)}
                />
              </label>

              <label className="msp-field">
                <span className="msp-label">{t.protocol}</span>
                <select
                  className="msp-input msp-select"
                  data-model-api=""
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value as AiWireProtocol)}
                >
                  {PROTOCOLS.map((p) => (
                    <option key={p} value={p}>
                      {t.protocolHint[p]}
                    </option>
                  ))}
                </select>
                <span className="msp-note">{t.protocolFooter}</span>
              </label>

              <div className="msp-field">
                <span className="msp-label">
                  {t.apiKey}
                  {keyConfigured ? ` · ${t.apiKeyConfigured}` : ''}
                  {selectedVendor?.ollamaLike || selectedProfile?.ollamaLike
                    ? ` · ${t.ollamaHint}`
                    : ''}
                </span>
                <div className="msp-key-row">
                  {keyFieldsDef && keyFieldsDef.length > 1 ? (
                    // multi-field credentials (kling AK/SK): one input per field,
                    // folded into the single stored key on save
                    <div className="msp-key-fields">
                      {keyFieldsDef.map((f) => (
                        <label key={f.id} className="msp-key-field">
                          <span>{locale === 'zh' && f.labelZh ? f.labelZh : f.label}</span>
                          <input
                            className="msp-input"
                            data-model-key=""
                            type={showKey ? 'text' : 'password'}
                            value={keyFieldValues[f.id] ?? ''}
                            placeholder={keyConfigured ? t.apiKeyPlaceholder : f.label}
                            onChange={(e) =>
                              setKeyFieldValues({ ...keyFieldValues, [f.id]: e.target.value })
                            }
                            autoComplete="off"
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <input
                      className="msp-input"
                      data-model-key=""
                      type={showKey ? 'text' : 'password'}
                      value={apiKeyInput}
                      placeholder={keyConfigured ? t.apiKeyPlaceholder : 'sk-…'}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      autoComplete="off"
                    />
                  )}
                  {selectedVendor?.keyUrl && (
                    <a
                      className="msp-btn msp-btn-link"
                      href={selectedVendor.keyUrl}
                      target="_blank"
                      rel="noreferrer"
                      data-model-keyurl
                    >
                      {t.getKey}
                    </a>
                  )}
                  <button type="button" className="msp-btn" onClick={() => setShowKey((v) => !v)}>
                    {showKey ? t.hideKey : t.showKey}
                  </button>
                </div>
              </div>

              <div className="msp-actions">
                <button
                  type="button"
                  className="msp-btn"
                  onClick={() => void fetchModels()}
                  disabled={busy !== ''}
                  data-model-fetch
                >
                  {busy === 'fetch' ? t.fetching : t.fetchModels}
                </button>
                <button
                  type="button"
                  className="msp-btn"
                  onClick={() => void testConnection()}
                  disabled={busy !== ''}
                  data-model-test
                >
                  {busy === 'test' ? t.testing : t.testConnection}
                </button>
                <button
                  type="button"
                  className="msp-btn msp-btn-primary"
                  onClick={() => void saveProfile()}
                  disabled={busy !== ''}
                  data-model-enable
                >
                  {selectedProfile?.enabled ? t.saveChanges : t.saveEnable}
                </button>
                {selectedProfile?.enabled && (
                  <button
                    type="button"
                    className="msp-btn msp-btn-danger"
                    onClick={() => void disableProfile()}
                    disabled={busy !== ''}
                    data-model-disable
                  >
                    {t.disable}
                  </button>
                )}
              </div>

              {models.length > 0 && (
                <div className="msp-select-bar" data-model-select-bar>
                  <button
                    type="button"
                    className="msp-btn msp-btn-mini"
                    data-model-select-all
                    onClick={() => setModels((ms) => ms.map((m) => ({ ...m, enabled: true })))}
                  >
                    {t.selectAll}
                  </button>
                  <button
                    type="button"
                    className="msp-btn msp-btn-mini"
                    data-model-select-none
                    onClick={() => setModels((ms) => ms.map((m) => ({ ...m, enabled: false })))}
                  >
                    {t.selectNone}
                  </button>
                </div>
              )}

              <ModelList
                entries={models}
                onToggle={(id, enabled) =>
                  setModels((prev) => prev.map((x) => (x.id === id ? { ...x, enabled } : x)))
                }
                onToggleMany={(ids, enabled) =>
                  setModels((prev) => prev.map((x) => (ids.includes(x.id) ? { ...x, enabled } : x)))
                }
              />

              <p className="msp-note">{t.pickerHint}</p>
            </>
          )}
        </div>
      </section>
    </div>
  )

  const nothingEnabled = enabledProfiles.length === 0

  const pane = (
    <div className={variant === 'overlay' ? 'msp-dialog' : 'msp-inline-dialog'} data-model-settings>
      {header}
      {/* 说明页本身就是引导，横幅只在进入具体厂商表单时补充提示 */}
      {nothingEnabled && selected !== '' && (
        <div className="msp-guide" data-model-guide>
          {/* 登录未开放时横幅文案不含登录入口 */}
          {USER_LOGIN_READY ? t.noModelsGuide : t.noModelsGuideNoLogin}
        </div>
      )}
      {body}
    </div>
  )

  if (variant === 'inline') return pane

  const overlay = (
    <div className="msp-overlay" role="dialog" aria-modal="true" aria-label={t.title}>
      {pane}
    </div>
  )

  return createPortal(overlay, document.body)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
