/**
 * ModelSettingsPage — the v2 model settings surface, faithfully following
 * chatop's ModelSettings layout (harvested): left 240px vendor directory
 * (search + enabled group + catalog groups + add button), right config form
 * (vendor header with enable switch, URL/protocol/key fields, fetch/test/save
 * buttons, grouped model checklist with per-group toggles).
 *
 * Rendered through a portal onto document.body — the panel it opens from is
 * a positioned/transformed ancestor that would otherwise clip a fixed overlay.
 *
 * Transport is injected (ModelSettingsBridge) so the same page serves every
 * app's preload bridge and the web form's HTTP bridge.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  GENSPARK_PRESET_MODELS,
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
} from '@genoffice/ai-provider'
import { fmt, modelSettingsStrings } from './model-settings-strings'
import { VendorLogo } from './VendorLogo'
// self-contained styles: every consumer gets them with the component
import './model-settings.css'

export interface ModelSettingsBridge {
  getSettings(): Promise<AiSettingsV2>
  saveSettings(view: AiSettingsV2): Promise<void>
  setCurrentModel(selection: AiModelSelection): Promise<void>
  discoverModels(target: DiscoveryTarget): Promise<{ models: AiModelEntry[]; error?: string }>
  gskStatus?(withEmail?: boolean): Promise<{ loggedIn: boolean; email?: string }>
  gskLogin?(): void | Promise<void>
  /** web form: gsk login is desktop-only — the page hides the genspark card */
  capabilities?(): Promise<{ gskAvailable: boolean }>
}

export interface ModelSettingsPageProps {
  bridge: ModelSettingsBridge
  /** overlay variant only — an inline pane is closed by its surrounding window */
  onClose?: () => void
  /** app locale ('zh' | 'en-US' | …); defaults to document.documentElement.lang */
  lang?: string
  /** 'overlay' (default) portals a modal onto body; 'inline' renders in place inside a host pane */
  variant?: 'overlay' | 'inline'
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

export function ModelSettingsPage({ bridge, onClose, lang, variant = 'overlay' }: ModelSettingsPageProps): React.JSX.Element {
  const locale = lang ?? (typeof document !== 'undefined' ? document.documentElement.lang : 'zh')
  const t = useMemo(() => modelSettingsStrings(locale), [locale])
  const [settings, setSettings] = useState<AiSettingsV2 | null>(null)
  const [gskAvailable, setGskAvailable] = useState(true)
  const [selected, setSelected] = useState<string>('genspark')
  const [search, setSearch] = useState('')
  /** collapsed directory groups (已开启 / 国内平台 / …) in the left pane */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  /** enabled-profile rows expanded to show their model sub-lists in the left pane */
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set())
  const [gsk, setGsk] = useState<{ loggedIn: boolean; email?: string } | null>(null)

  // ── form state (rebuilt when the selected vendor changes) ──────────────
  const [apiUrl, setApiUrl] = useState('')
  const [protocol, setProtocol] = useState<AiWireProtocol>('openai-completions')
  const [apiKeyInput, setApiKeyInput] = useState('')
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

  useEffect(() => {
    void bridge.getSettings().then(setSettings).catch(() => setSettings(null))
    if (bridge.gskStatus) {
      void bridge
        .gskStatus(true)
        .then(setGsk)
        .catch(() => setGsk(null))
    }
    if (bridge.capabilities) {
      void bridge
        .capabilities()
        .then((c) => setGskAvailable(c.gskAvailable !== false))
        .catch(() => setGskAvailable(true))
    }
  }, [bridge])

  const profiles = settings?.profiles ?? []
  const enabledProfiles = profiles.filter((p) => p.enabled)
  const selectedProfile = profiles.find((p) => p.id === selected)
  const selectedVendor = VENDOR_BY_ID.get(selected)
  const isGenspark = selected === 'genspark'

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
          !enabledProfiles.some((p) => (p.vendorId ?? p.id) === v.id) &&
          match(v.name, v.nameZh, v.id),
      ),
    })).filter((g) => g.vendors.length > 0)
  }, [enabledProfiles, search, locale])

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
        (stored?.models ?? (vendor?.presets ?? []) as AiModelEntry[]).map((m) => ({
          ...m,
          enabled: true,
        })),
      )
      setModelsFromPreset(!!vendor?.presets?.length && !stored?.models.length)
      setApiKeyInput('')
      setKeyConfigured(!!stored?.apiKey)
      return
    }
    setApiUrl(selectedProfile.baseUrl)
    setProtocol(selectedProfile.protocol)
    setModels(selectedProfile.models.map((m) => ({ ...m, enabled: true })))
    setModelsFromPreset(false)
    setApiKeyInput('')
    setKeyConfigured(!!selectedProfile.apiKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only on vendor switch
  }, [selected, settings])

  // web form: no genspark card — land on the first enabled profile instead
  useEffect(() => {
    if (!gskAvailable && selected === 'genspark') {
      const first = enabledProfiles.find((p) => p.id !== 'genspark')
      setSelected(first?.id ?? 'openai')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gskAvailable, settings])

  const vendorName = (id: string): string => {
    const v = VENDOR_BY_ID.get(id)
    if (!v) return id
    return locale === 'zh' && v.nameZh ? v.nameZh : v.name
  }

  // ── fetch / test / save / disable ─────────────────────────────────────
  const discoveryTarget = (): DiscoveryTarget => ({
    protocol,
    baseUrl: apiUrl.trim(),
    apiKey:
      apiKeyInput.trim() ||
      (keyConfigured || selectedVendor?.ollamaLike || selectedProfile?.ollamaLike ? '' : ''),
    ...(selectedVendor?.ollamaLike || selectedProfile?.ollamaLike ? { ollamaLike: true } : {}),
    ...(selectedProfile && !apiKeyInput.trim() ? { profileId: selectedProfile.id } : {}),
  })

  const fetchModels = async () => {
    if (!apiUrl.trim()) return flash('err', t.errApiUrl)
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
    if (next.gskToolsEnabled === undefined) delete next.gskToolsEnabled
    return next
  }

  const saveProfile = async () => {
    if (!apiUrl.trim()) return flash('err', t.errApiUrl)
    const ollama = selectedVendor?.ollamaLike
    const effectiveKey = apiKeyInput.trim()
    if (!effectiveKey && !keyConfigured && !ollama) return flash('err', t.errApiKey)
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
        models: enabledModels.map((m) => ({ id: m.id, ...(m.name && m.name !== m.id ? { name: m.name } : {}) })),
        updatedAt: new Date().toISOString(),
      }
      const nextProfiles = [
        ...profiles.filter((p) => p.id !== profile.id && (p.vendorId ?? p.id) !== vendorId),
        profile,
      ]
      const next: AiSettingsV2 = { ...(settings ?? { version: 2 }), profiles: nextProfiles }
      // first usable chat model becomes the current selection when none is set
      const chatPick = enabledModels.find((m) => !isImageGenModel(m) && (m.type ?? 'chat') !== 'embedding')
      if ((!next.currentModel || !nextProfiles.some((p) => p.id === next.currentModel!.profileId)) && chatPick) {
        next.currentModel = { profileId: profile.id, modelId: chatPick.id }
      }
      await persist(sanitize(next))
      setApiKeyInput('')
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
      if (next.currentModel && !nextProfiles.some((p) => p.enabled && p.id === next.currentModel!.profileId)) {
        const fallback = nextProfiles
          .filter((p) => p.enabled)
          .flatMap((p) => p.models.filter((m) => !isImageGenModel(m) && (m.type ?? 'chat') !== 'embedding').map((m) => ({ profileId: p.id, modelId: m.id })))
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

  const toggleGensparkModel = async (modelId: string, on: boolean) => {
    const profile = profiles.find((p) => p.id === 'genspark')
    if (!profile) return
    const currentIds = new Set(profile.models.map((m) => m.id))
    const nextModels = on
      ? GENSPARK_PRESET_MODELS.filter((id) => currentIds.has(id) || id === modelId).map((id) => ({ id }))
      : profile.models.filter((m) => m.id !== modelId)
    const nextProfiles = profiles.map((p) => (p.id === 'genspark' ? { ...p, models: nextModels } : p))
    const next: AiSettingsV2 = { ...settings!, profiles: nextProfiles }
    if (next.currentModel?.profileId === 'genspark' && !nextModels.some((m) => m.id === next.currentModel!.modelId)) {
      if (nextModels[0]) next.currentModel = { profileId: 'genspark', modelId: nextModels[0].id }
      else delete next.currentModel
    }
    await persist(sanitize(next))
  }

  // ── chatop-shaped pieces ──────────────────────────────────────────────
  const enabledList = gskAvailable
    ? enabledProfiles.filter((p) => p.id !== 'genspark' || p.models.length > 0)
    : enabledProfiles.filter((p) => p.id !== 'genspark')

  const VendorRow = ({ id, name, active }: { id: string; name: string; active?: boolean }) => {
    const profile = active ? profiles.find((p) => p.id === id) : undefined
    const expanded = expandedVendors.has(id)
    return (
      <div className={`msp-vendor-wrap${selected === id ? ' is-selected' : ''}${active && expanded ? ' is-open' : ''}`} data-vendor-row-wrap={id}>
        <button
          type="button"
          className={`msp-vendor${selected === id ? ' is-selected' : ''}`}
          data-vendor-row={id}
          onClick={() => setSelected(id)}
        >
          <VendorLogo vendorId={VENDOR_BY_ID.has(id) ? id : undefined} size={18} fallback={name} />
          <span className="msp-vendor-name">{name}</span>
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

  const enabledRows = enabledList.length
    ? enabledList.map((p) => (
        <VendorRow key={p.id} id={p.id} name={p.displayName || p.id} active />
      ))
    : null

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
          <button type="button" className="msp-btn" onClick={() => void fetchModels()} disabled={busy !== ''}>
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
                    onClick={() => onToggleMany(group.models.map((m) => m.id), !allOn)}
                  >
                    {allOn ? t.selectNone : t.selectAll}
                  </button>
                )}
              </div>
              {!collapsed && group.models.map((m) => (
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
        <button type="button" className="msp-close" onClick={onClose} aria-label={t.close} title={t.close}>
          ✕
        </button>
      </header>
    ) : null

  const body = (
<div className="msp-body">
      {/* 左：厂商目录（chatop 版式） */}
      <aside className="msp-left">
        <div className="msp-search-wrap">
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
          <VendorGroupEl id="enabled" label={`${t.enabledGroup} · ${enabledList.length}`} rows={enabledRows} />
          {catalogRows.map((group) => (
            <VendorGroupEl
              key={group.id}
              id={group.id}
              label={group.label}
              rows={
                <>
                  {group.vendors.map((v) => (
                    <VendorRow key={v.id} id={v.id} name={locale === 'zh' && v.nameZh ? v.nameZh : v.name} />
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

      {/* 右：配置表单 */}
      <section className="msp-right" data-model-pane={selected}>
        <div className="msp-form">
          {isGenspark ? (
            <>
              <div className="msp-pane-head">
                <span className="msp-avatar is-big" aria-hidden>
                  G
                </span>
                <div className="msp-pane-titles">
                  <div className="msp-pane-name">{t.gskLoginTitle}</div>
                  <div className="msp-pane-status">{t.gskLoginDesc}</div>
                </div>
              </div>
              {msg && <p className={`msp-msg ${msg.kind}`} data-model-msg>{msg.text}</p>}
              <div className="msp-gsk-row">
                <span className={`msp-dot is-big${gsk?.loggedIn ? ' is-on' : ''}`} aria-hidden />
                <span className="msp-gsk-state">
                  {gsk?.loggedIn
                    ? gsk.email
                      ? fmt(t.gskLoggedIn, { email: gsk.email })
                      : t.gskLoggedInNoEmail
                    : t.gskLoggedOut}
                </span>
                {!gsk?.loggedIn && bridge.gskLogin && (
                  <button type="button" className="msp-btn msp-btn-primary" onClick={() => void bridge.gskLogin?.()}>
                    {t.gskLoginBtn}
                  </button>
                )}
              </div>
              <ModelList
                entries={GENSPARK_PRESET_MODELS.map((id) => ({
                  id,
                  enabled: selectedProfile?.models.some((m) => m.id === id) ?? false,
                }))}
                onToggle={(id, on) => void toggleGensparkModel(id, on)}
              />
            </>
          ) : (
            <>
              <div className="msp-pane-head">
                <span className="msp-avatar is-big" aria-hidden>
                  {vendorName(
                    selectedVendor?.id ?? selectedProfile?.vendorId ?? selectedProfile?.id ?? selected,
                  ).slice(0, 1).toUpperCase()}
                </span>
                <div className="msp-pane-titles">
                  <div className="msp-pane-name">
                    {vendorName(
                      selectedVendor?.id ?? selectedProfile?.vendorId ?? selectedProfile?.id ?? selected,
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
                  onClick={() => (selectedProfile?.enabled ? void disableProfile() : void saveProfile())}
                  disabled={busy !== ''}
                />
              </div>

              {msg && <p className={`msp-msg ${msg.kind}`} data-model-msg>{msg.text}</p>}

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
                  {(selectedVendor?.ollamaLike || selectedProfile?.ollamaLike) ? ` · ${t.ollamaHint}` : ''}
                </span>
                <div className="msp-key-row">
                  <input
                    className="msp-input"
                    data-model-key=""
                    type={showKey ? 'text' : 'password'}
                    value={apiKeyInput}
                    placeholder={keyConfigured ? t.apiKeyPlaceholder : 'sk-…'}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    autoComplete="off"
                  />
                  {selectedVendor?.keyUrl && (
                    <a className="msp-btn msp-btn-link" href={selectedVendor.keyUrl} target="_blank" rel="noreferrer" data-model-keyurl>
                      {t.getKey}
                    </a>
                  )}
                  <button type="button" className="msp-btn" onClick={() => setShowKey((v) => !v)}>
                    {showKey ? t.hideKey : t.showKey}
                  </button>
                </div>
              </div>

              <div className="msp-actions">
                <button type="button" className="msp-btn" onClick={() => void fetchModels()} disabled={busy !== ''} data-model-fetch>
                  {busy === 'fetch' ? t.fetching : t.fetchModels}
                </button>
                <button type="button" className="msp-btn" onClick={() => void testConnection()} disabled={busy !== ''} data-model-test>
                  {busy === 'test' ? t.testing : t.testConnection}
                </button>
                <button type="button" className="msp-btn msp-btn-primary" onClick={() => void saveProfile()} disabled={busy !== ''} data-model-enable>
                  {selectedProfile?.enabled ? t.saveChanges : t.saveEnable}
                </button>
                {selectedProfile?.enabled && (
                  <button type="button" className="msp-btn msp-btn-danger" onClick={() => void disableProfile()} disabled={busy !== ''} data-model-disable>
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

  const pane = (
    <div className={variant === 'overlay' ? 'msp-dialog' : 'msp-inline-dialog'} data-model-settings>
      {header}
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
