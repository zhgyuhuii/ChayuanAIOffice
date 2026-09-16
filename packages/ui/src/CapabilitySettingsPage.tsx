/**
 * CapabilitySettingsPage — the 生图、媒体与搜索 settings surface: a two-pane
 * tree on the left (capability groups → platforms / vendors) and the selected
 * item's configuration on the right. Search platforms carry key / apply-key /
 * test / description; model-driven groups project the model-settings
 * profiles: per-vendor capability-filtered model lists, vendor refresh
 * (discover → merge capability models), and a radioed default per capability
 * that chats and insert dialogs follow globally.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  SEARCH_PLATFORMS,
  capabilityDefaultSelection,
  capabilityVendorRefreshable,
  capabilityVendorRows,
  findProfile,
  modelHasCapability,
  profileCapabilityModels,
  resolveCapabilityDefault,
  KEEP_KEY,
  type AiCapabilityKind,
  type AiModelEntry,
  type AiModelSelection,
  type AiProviderProfile,
  type AiSettingsV2,
  type SearchPlatformMeta,
} from '@chatoffice/ai-provider/browser'
import type { ModelSettingsBridge } from './ModelSettingsPage'
import type { AiSearchSettings } from '@chatoffice/ai-provider/browser'
import { capabilitySettingsStrings, fmtCapability } from './capability-settings-strings'
import { VendorLogo } from './VendorLogo'
import './capability-settings.css'

export interface CapabilitySettingsPageProps {
  bridge: ModelSettingsBridge
  /** app locale; defaults to document.documentElement.lang */
  lang?: string
  /** deep link into the model settings section (未启用厂商 → 去模型设置启用) */
  onOpenModelSettings?: (vendorId?: string) => void
}

type GroupId = 'search' | AiCapabilityKind

interface Selection {
  group: GroupId
  /** search platform id / vendor id; absent = the group's overview pane */
  item?: string
}

const GROUPS: Array<{
  id: GroupId
  labelKey:
    | 'groupSearch'
    | 'groupImageGen'
    | 'groupVideoGen'
    | 'groupImageUnderstanding'
    | 'groupVideoUnderstanding'
    | 'groupSvgGen'
}> = [
  { id: 'search', labelKey: 'groupSearch' },
  { id: 'imageGen', labelKey: 'groupImageGen' },
  { id: 'videoGen', labelKey: 'groupVideoGen' },
  { id: 'imageUnderstanding', labelKey: 'groupImageUnderstanding' },
  { id: 'videoUnderstanding', labelKey: 'groupVideoUnderstanding' },
  { id: 'svgGeneration', labelKey: 'groupSvgGen' },
]

/** letter-mark badge for search platforms (no brand assets shipped) */
function PlatformMark({ label }: { label: string }): React.JSX.Element {
  return (
    <span className="csp-mark" aria-hidden>
      {label.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function CapabilitySettingsPage({
  bridge,
  lang,
  onOpenModelSettings,
}: CapabilitySettingsPageProps): React.JSX.Element {
  const locale = lang ?? (typeof document !== 'undefined' ? document.documentElement.lang : 'zh')
  const t = useMemo(() => capabilitySettingsStrings(locale), [locale])
  const isZh = locale.toLowerCase().startsWith('zh')
  const [settings, setSettings] = useState<AiSettingsV2 | null>(null)
  const [selected, setSelected] = useState<Selection>({ group: 'search' })
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  /** typed key drafts: platform id → value ('' allowed to clear) */
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [testing, setTesting] = useState('')
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; detail?: string } | null>(
    null,
  )
  const [refreshing, setRefreshing] = useState('')

  const flash = (kind: 'ok' | 'err', text: string) => {
    setMsg({ kind, text })
    window.setTimeout(() => setMsg(null), 4000)
  }

  useEffect(() => {
    void bridge
      .getSettings()
      .then(setSettings)
      .catch(() => setSettings(null))
  }, [bridge])

  const persist = async (next: AiSettingsV2): Promise<void> => {
    await bridge.saveSettings(next)
    setSettings(next)
  }

  // ── search platforms ─────────────────────────────────────────────────
  const searchSettings = settings?.search
  const searchProviders = (searchSettings?.providers ?? {}) as Record<
    string,
    { apiKey?: string } | undefined
  >
  const stockKeys = settings?.stockApiKeys ?? {}

  /** stored (sentinel-aware) key state: '' | value | '__keep__' */
  const storedKey = (p: SearchPlatformMeta): string => {
    if (p.kind === 'stock') return stockKeys[p.id as 'pexels' | 'pixabay' | 'unsplash'] ?? ''
    return searchProviders[p.id]?.apiKey ?? ''
  }
  const draftKey = (p: SearchPlatformMeta): string | undefined => keyDrafts[p.id]
  const keyConfigured = (p: SearchPlatformMeta): boolean => {
    const v = draftKey(p) ?? storedKey(p)
    return !!v && v !== KEEP_KEY
  }
  const setKey = (p: SearchPlatformMeta, value: string): void => {
    setKeyDrafts((prev) => ({ ...prev, [p.id]: value }))
    setDirty(true)
    setSaved(false)
  }

  const saveKeys = async (): Promise<void> => {
    if (!settings) return
    let next = settings
    for (const [id, value] of Object.entries(keyDrafts)) {
      const p = SEARCH_PLATFORMS.find((x) => x.id === id)
      if (!p) continue
      if (p.kind === 'stock') {
        const stock = { ...(next.stockApiKeys ?? {}) }
        const v = value.trim()
        if (v) stock[id as 'pexels' | 'pixabay' | 'unsplash'] = v
        else delete stock[id as 'pexels' | 'pixabay' | 'unsplash']
        next = { ...next, stockApiKeys: stock }
      } else {
        const providers = {
          ...((next.search?.providers ?? {}) as Record<string, { apiKey: string }>),
        }
        const v = value.trim()
        if (v) providers[id] = { apiKey: v }
        else delete providers[id]
        next = {
          ...next,
          search: {
            provider: next.search?.provider ?? 'duckduckgo',
            providers: providers as AiSearchSettings['providers'],
          },
        }
      }
    }
    try {
      await persist(next)
      setKeyDrafts({})
      setDirty(false)
      setSaved(true)
    } catch (error) {
      flash('err', fmtCapability(t.saveFailed, { message: errText(error) }))
    }
  }

  const testPlatform = async (p: SearchPlatformMeta): Promise<void> => {
    if (testing || !bridge.testSearchPlatform) return
    setTesting(p.id)
    setTestResult(null)
    try {
      const draft = draftKey(p)
      const r = await bridge.testSearchPlatform({
        platform: p.id,
        ...(draft !== undefined && draft.trim() ? { key: draft.trim() } : {}),
      })
      setTestResult({ id: p.id, ok: r.ok, ...(r.detail ? { detail: r.detail } : {}) })
    } catch (error) {
      setTestResult({ id: p.id, ok: false, detail: errText(error) })
    } finally {
      setTesting('')
    }
  }

  const setDefaultSearchPlatform = async (id: string): Promise<void> => {
    if (!settings) return
    try {
      await persist({
        ...settings,
        search: {
          provider: id as AiSearchSettings['provider'],
          providers: (settings.search?.providers ?? {}) as AiSearchSettings['providers'],
        },
      })
    } catch (error) {
      flash('err', fmtCapability(t.saveFailed, { message: errText(error) }))
    }
  }

  // ── model capabilities ───────────────────────────────────────────────
  const vendorRows = (kind: AiCapabilityKind) =>
    settings ? capabilityVendorRows(settings, kind) : []

  /** the profile backing a vendor row (svgGeneration rows pass profile ids directly) */
  const rowProfile = (kind: AiCapabilityKind, vendorId: string) =>
    settings?.profiles.find((p) =>
      kind === 'svgGeneration' ? p.id === vendorId : (p.vendorId ?? p.id) === vendorId,
    )

  const capabilityDefault = (kind: AiCapabilityKind): AiModelSelection | undefined =>
    settings ? resolveCapabilityDefault(settings, kind) : undefined

  const defaultVendorOf = (kind: AiCapabilityKind): string | undefined => {
    const sel = capabilityDefault(kind)
    if (!sel || !settings) return undefined
    const profile = findProfile(settings, sel.profileId)
    return kind === 'svgGeneration' ? sel.profileId : (profile?.vendorId ?? profile?.id)
  }

  const pickDefaultModel = async (
    kind: AiCapabilityKind,
    profileId: string,
    modelId: string,
  ): Promise<void> => {
    if (!settings) return
    const next: AiSettingsV2 = { ...settings }
    if (kind === 'imageGen') next.imageModel = { profileId, modelId }
    else {
      const defaults = { ...(next.modelDefaults ?? {}) }
      defaults[kind] = { profileId, modelId }
      next.modelDefaults = defaults
    }
    try {
      await persist(next)
    } catch (error) {
      flash('err', fmtCapability(t.saveFailed, { message: errText(error) }))
    }
  }

  const clearDefaultModel = async (kind: AiCapabilityKind): Promise<void> => {
    if (!settings) return
    const next: AiSettingsV2 = { ...settings }
    if (kind === 'imageGen') delete next.imageModel
    else {
      const defaults = { ...(next.modelDefaults ?? {}) }
      delete defaults[kind]
      if (Object.keys(defaults).length > 0) next.modelDefaults = defaults
      else delete next.modelDefaults
    }
    try {
      await persist(next)
      flash('ok', t.defaultCleared)
    } catch (error) {
      flash('err', fmtCapability(t.saveFailed, { message: errText(error) }))
    }
  }

  /** refresh one vendor's capability models from its /models endpoint */
  const refreshVendorModels = async (kind: AiCapabilityKind, vendorId: string): Promise<void> => {
    if (!settings || refreshing) return
    const profile = rowProfile(kind, vendorId)
    if (!profile) return
    if (!capabilityVendorRefreshable(vendorId)) {
      flash('ok', t.refreshUnsupported)
      return
    }
    setRefreshing(vendorId)
    try {
      const found = await bridge.discoverModels({
        protocol: profile.protocol,
        baseUrl: profile.baseUrl,
        apiKey: '',
        profileId: profile.id,
      })
      if (found.error) throw new Error(found.error)
      const existing = new Set(profile.models.map((m) => m.id))
      const added = found.models.filter(
        (m) => !existing.has(m.id) && profileQualifies(kind, profile, m.id),
      )
      if (added.length === 0) {
        flash('ok', t.refreshNone)
        return
      }
      const nextProfiles = settings.profiles.map((p) =>
        p.id === profile.id
          ? {
              ...p,
              models: [
                ...p.models,
                ...added.map((m) => ({ id: m.id, ...(m.name ? { name: m.name } : {}) })),
              ],
            }
          : p,
      )
      await persist({ ...settings, profiles: nextProfiles })
      flash('ok', fmtCapability(t.refreshOk, { n: added.length }))
    } catch (error) {
      flash('err', fmtCapability(t.refreshFailed, { message: errText(error) }))
    } finally {
      setRefreshing('')
    }
  }

  /** capability check by bare model id (refresh path — entries come from discovery) */
  const profileQualifies = (
    kind: AiCapabilityKind,
    profile: AiProviderProfile,
    modelId: string,
  ): boolean => {
    if (kind === 'imageGen') {
      return /gpt-image|dall-e|imagen|cogview|seedream|qwen-image|image-01|flux|sdxl|stable-diffusion|ideogram|recraft|image-generation|banana/i.test(
        modelId,
      )
    }
    if (kind === 'videoGen') {
      return /video-generation|text-to-video|txt2video|veo|sora|kling|vidu|pixverse|runway|luma|hailuo|seaweed|video/i.test(
        modelId,
      )
    }
    if (kind === 'svgGeneration') return true
    const entry: AiModelEntry = { id: modelId }
    return modelHasCapability(kind, profile, entry)
  }

  // ── tree rendering ───────────────────────────────────────────────────
  const groupLabel = (id: GroupId): string => t[GROUPS.find((g) => g.id === id)!.labelKey]

  const groupChildrenCount = (id: GroupId): number => {
    if (id === 'search') return SEARCH_PLATFORMS.length
    return vendorRows(id).length
  }

  const selectGroup = (group: GroupId): void => {
    setSelected({ group })
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.delete(group)
      return next
    })
  }

  const capabilityDesc = (kind: AiCapabilityKind): string =>
    kind === 'imageGen'
      ? t.capImageGenDesc
      : kind === 'videoGen'
        ? t.capVideoGenDesc
        : kind === 'imageUnderstanding'
          ? t.capImageUnderstandingDesc
          : kind === 'videoUnderstanding'
            ? t.capVideoUnderstandingDesc
            : t.capSvgGenDesc

  const defaultModelLabel = (kind: AiCapabilityKind): string | undefined => {
    const sel = capabilityDefault(kind)
    if (!sel || !settings) return undefined
    const profile = findProfile(settings, sel.profileId)
    if (!profile) return undefined
    return `${profile.displayName} · ${sel.modelId}`
  }

  const isExplicitDefault = (kind: AiCapabilityKind): boolean => {
    if (!settings) return false
    return kind === 'imageGen'
      ? !!settings.imageModel
      : !!capabilityDefaultSelection(settings, kind)
  }

  // ── right panes ──────────────────────────────────────────────────────
  const renderSearchPane = (p: SearchPlatformMeta): React.JSX.Element => {
    const draft = draftKey(p)
    const shown = draft !== undefined ? draft : storedKey(p) === KEEP_KEY ? '' : storedKey(p)
    const configured = keyConfigured(p)
    const isDefault = searchSettings?.provider === p.id
    const result = testResult?.id === p.id ? testResult : null
    return (
      <div className="csp-pane" data-capability-platform={p.id}>
        <div className="csp-head">
          <PlatformMark label={p.label} />
          <div className="csp-head-titles">
            <div className="csp-head-name">
              {p.label}
              {p.kind === 'stock' && <span className="csp-tag">{t.stockTag}</span>}
            </div>
            <div className="csp-head-desc">{isZh ? p.descZh : p.descEn}</div>
          </div>
          {p.kind === 'web' && (
            <button
              type="button"
              className={`csp-btn${isDefault ? ' is-on' : ''}`}
              disabled={isDefault}
              onClick={() => void setDefaultSearchPlatform(p.id)}
              data-capability-set-default={p.id}
            >
              {isDefault ? t.isDefault : t.setDefault}
            </button>
          )}
        </div>

        {p.needsKey ? (
          <>
            <label className="csp-field">
              <span className="csp-label">
                {p.id === 'searxng' ? t.keyLabelSearxng : t.keyLabel}
                {configured ? ` · ${t.keyConfigured}` : ''}
              </span>
              <div className="csp-key-row">
                <input
                  className="csp-input"
                  type="password"
                  data-capability-key={p.id}
                  value={shown}
                  placeholder={configured ? t.keyConfigured : p.label}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => setKey(p, e.target.value)}
                />
                {p.keyUrl && (
                  <a
                    className="csp-btn csp-btn-link"
                    href={p.keyUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t.getKey}
                  </a>
                )}
                {bridge.testSearchPlatform && (
                  <button
                    type="button"
                    className="csp-btn"
                    disabled={testing === p.id}
                    onClick={() => void testPlatform(p)}
                    data-capability-test={p.id}
                  >
                    {testing === p.id ? t.testing : t.testKey}
                  </button>
                )}
              </div>
            </label>
            {result && (
              <p
                className={`csp-msg ${result.ok ? 'ok' : 'err'}`}
                data-capability-test-result={result.ok ? 'ok' : 'err'}
              >
                {result.ok
                  ? t.testOk
                  : `${t.testFail}${result.detail ? ` — ${result.detail}` : ''}`}
              </p>
            )}
          </>
        ) : (
          <p className="csp-note">{t.keyFree}</p>
        )}
      </div>
    )
  }

  const renderVendorPane = (kind: AiCapabilityKind, vendorId: string): React.JSX.Element => {
    const row = vendorRows(kind).find((r) => r.vendorId === vendorId)
    const name = row ? (isZh && row.nameZh ? row.nameZh : row.name) : vendorId
    const profile = rowProfile(kind, vendorId)
    const enabled = !!profile?.enabled
    const models = settings && profile ? profileCapabilityModels(settings, kind, profile.id) : []
    const sel = capabilityDefault(kind)
    return (
      <div className="csp-pane" data-capability-vendor={vendorId}>
        <div className="csp-head">
          <VendorLogo
            vendorId={kind === 'svgGeneration' ? undefined : vendorId}
            size={22}
            fallback={name}
          />
          <div className="csp-head-titles">
            <div className="csp-head-name">{name}</div>
            <div className="csp-head-desc">
              {enabled ? (
                <>
                  <span className={`csp-dot${enabled ? ' is-on' : ''}`} aria-hidden />
                  {t.vendorEnabled}
                  {profile?.baseUrl ? ` · ${profile.baseUrl}` : ''}
                </>
              ) : (
                t.vendorNotEnabled
              )}
            </div>
          </div>
          {enabled && capabilityVendorRefreshable(vendorId) && (
            <button
              type="button"
              className="csp-btn"
              disabled={refreshing !== ''}
              onClick={() => void refreshVendorModels(kind, vendorId)}
              data-capability-refresh={vendorId}
            >
              {refreshing === vendorId ? t.refreshing : t.refreshModels}
            </button>
          )}
        </div>

        {msg && <p className={`csp-msg ${msg.kind}`}>{msg.text}</p>}

        {!enabled ? (
          <div className="csp-empty">
            <p className="csp-note">{t.enableHint}</p>
            {onOpenModelSettings && (
              <button
                type="button"
                className="csp-btn csp-btn-primary"
                onClick={() => onOpenModelSettings(kind === 'svgGeneration' ? undefined : vendorId)}
                data-capability-open-model-settings
              >
                {t.enableInModelSettings}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="csp-list-head">
              <span className="csp-label">
                {t.modelsTitle} · {models.length}
              </span>
              <button
                type="button"
                className="csp-btn csp-btn-mini"
                onClick={() => void clearDefaultModel(kind)}
                disabled={!isExplicitDefault(kind)}
                data-capability-clear-default
              >
                {t.clearDefault}
              </button>
            </div>
            {models.length === 0 ? (
              <div className="csp-empty">
                <p className="csp-note">{t.noModels}</p>
                {capabilityVendorRefreshable(vendorId) && (
                  <button
                    type="button"
                    className="csp-btn"
                    disabled={refreshing !== ''}
                    onClick={() => void refreshVendorModels(kind, vendorId)}
                  >
                    {refreshing === vendorId ? t.refreshing : t.refreshModels}
                  </button>
                )}
              </div>
            ) : (
              <div className="csp-models" data-capability-models={vendorId}>
                {models.map((m) => {
                  const isDefault = sel?.profileId === profile!.id && sel?.modelId === m.id
                  return (
                    <label
                      key={m.id}
                      className={`csp-model${isDefault ? ' is-default' : ''}`}
                      data-capability-model={m.id}
                    >
                      <input
                        type="radio"
                        name={`csp-default-${kind}`}
                        checked={isDefault}
                        onChange={() => void pickDefaultModel(kind, profile!.id, m.id)}
                      />
                      <span className="csp-model-name">
                        {m.name && m.name !== m.id ? m.name : m.id}
                      </span>
                      {isDefault && <span className="csp-default-badge">{t.defaultLabel}</span>}
                      {m.name && m.name !== m.id && <span className="csp-model-id">{m.id}</span>}
                    </label>
                  )
                })}
              </div>
            )}
            {!isExplicitDefault(kind) && sel && (
              <p className="csp-note">
                {fmtCapability(t.autoDefault, {
                  name: `${findProfile(settings!, sel.profileId)?.displayName ?? sel.profileId} · ${sel.modelId}`,
                })}
                {'　'}
                {t.defaultHint}
              </p>
            )}
          </>
        )}
      </div>
    )
  }

  const renderOverview = (group: GroupId): React.JSX.Element => {
    const desc =
      group === 'search'
        ? t.searchOverview
        : group === 'svgGeneration'
          ? t.svgOverview
          : t.modelOverview
    const autoDefault =
      group !== 'search' && !isExplicitDefault(group) ? defaultModelLabel(group) : undefined
    return (
      <div className="csp-pane" data-capability-overview={group}>
        <div className="csp-head">
          <div className="csp-head-titles">
            <div className="csp-head-name">{groupLabel(group)}</div>
            <div className="csp-head-desc">{group !== 'search' ? capabilityDesc(group) : ''}</div>
          </div>
        </div>
        <p className="csp-note">{desc}</p>
        {group !== 'search' && (
          <p className="csp-note">
            {autoDefault
              ? fmtCapability(t.autoDefault, { name: autoDefault })
              : `${t.defaultHint}。`}
          </p>
        )}
      </div>
    )
  }

  const rightPane = !settings ? (
    <div className="csp-pane" />
  ) : !selected.item ? (
    renderOverview(selected.group)
  ) : selected.group === 'search' ? (
    renderSearchPane(SEARCH_PLATFORMS.find((p) => p.id === selected.item)!)
  ) : (
    renderVendorPane(selected.group, selected.item)
  )

  return (
    <div className="csp-root" data-capability-settings>
      <div className="csp-body">
        {/* 左：能力分组树 */}
        <aside className="csp-left">
          <div className="csp-scroll">
            {GROUPS.map((g) => {
              const isCollapsed = collapsed.has(g.id)
              const kind: AiCapabilityKind | null = g.id === 'search' ? null : g.id
              return (
                <div key={g.id} className="csp-group" data-capability-group={g.id}>
                  <div className="csp-group-row">
                    <button
                      type="button"
                      className={`csp-group-head${selected.group === g.id && !selected.item ? ' is-selected' : ''}`}
                      onClick={() => selectGroup(g.id)}
                    >
                      <span className="csp-group-label">{groupLabel(g.id)}</span>
                      <span className="csp-group-count">{groupChildrenCount(g.id)}</span>
                    </button>
                    <button
                      type="button"
                      className={`csp-chev${isCollapsed ? ' is-collapsed' : ''}`}
                      aria-expanded={!isCollapsed}
                      aria-label={groupLabel(g.id)}
                      onClick={() =>
                        setCollapsed((prev) => {
                          const next = new Set(prev)
                          if (next.has(g.id)) next.delete(g.id)
                          else next.add(g.id)
                          return next
                        })
                      }
                    >
                      ▾
                    </button>
                  </div>
                  {!isCollapsed && (
                    <div className="csp-children">
                      {g.id === 'search'
                        ? SEARCH_PLATFORMS.map((p) => {
                            const isSel = selected.group === 'search' && selected.item === p.id
                            const isDefault = searchSettings?.provider === p.id
                            return (
                              <button
                                key={p.id}
                                type="button"
                                className={`csp-item${isSel ? ' is-selected' : ''}`}
                                data-capability-item={p.id}
                                onClick={() => setSelected({ group: 'search', item: p.id })}
                              >
                                <PlatformMark label={p.label} />
                                <span className="csp-item-name">{p.label}</span>
                                {p.kind === 'stock' && (
                                  <span className="csp-tag">{t.stockTag}</span>
                                )}
                                {keyConfigured(p) && (
                                  <span
                                    className="csp-dot is-on"
                                    aria-hidden
                                    title={t.keyConfigured}
                                  />
                                )}
                                {isDefault && (
                                  <span className="csp-default-badge">{t.defaultLabel}</span>
                                )}
                              </button>
                            )
                          })
                        : vendorRows(kind!).map((row) => {
                            const isSel = selected.group === g.id && selected.item === row.vendorId
                            const hasDefault = defaultVendorOf(kind!) === row.vendorId
                            return (
                              <button
                                key={row.vendorId}
                                type="button"
                                className={`csp-item${isSel ? ' is-selected' : ''}`}
                                data-capability-item={row.vendorId}
                                onClick={() => setSelected({ group: g.id, item: row.vendorId })}
                              >
                                <VendorLogo
                                  vendorId={g.id === 'svgGeneration' ? undefined : row.vendorId}
                                  size={16}
                                  fallback={row.name}
                                />
                                <span className="csp-item-name">
                                  {isZh && row.nameZh ? row.nameZh : row.name}
                                </span>
                                {row.enabled ? (
                                  <span
                                    className="csp-dot is-on"
                                    aria-hidden
                                    title={t.vendorEnabled}
                                  />
                                ) : (
                                  <span className="csp-dot" aria-hidden />
                                )}
                                {hasDefault && (
                                  <span className="csp-default-badge">{t.defaultLabel}</span>
                                )}
                              </button>
                            )
                          })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </aside>

        {/* 右：选中项配置 */}
        <section className="csp-right">{rightPane}</section>
      </div>
      {(dirty || saved) && (
        <footer className="csp-footer">
          <span className={`csp-msg ${saved ? 'ok' : ''}`}>{saved ? t.saved : ''}</span>
          <button
            type="button"
            className="csp-btn csp-btn-primary"
            disabled={!dirty}
            onClick={() => void saveKeys()}
          >
            {t.save}
          </button>
        </footer>
      )}
    </div>
  )
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
