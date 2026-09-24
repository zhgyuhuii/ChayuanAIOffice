/**
 * ModelDefaultsPage — the 默认模型 settings pane: one default pick per model
 * kind (chat / image / video / tts / asr). Each row offers the enabled models
 * of that kind across providers plus an "auto" option: unset picks fall back
 * to the first enabled model of the kind detected at run time
 * (resolveDefaultModel), so nothing here is mandatory.
 *
 * Chat rides on settings.currentModel and image on settings.imageModel (the
 * legacy dedicated fields); the rest live in settings.modelDefaults.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_KIND_TYPES,
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_MAX_OUTPUT_TOKENS,
  MIN_MAX_OUTPUT_TOKENS,
  clampMaxOutputTokens,
  enabledChatModels,
  findProfile,
  inferModelType,
  resolveDefaultModel,
  type AiDefaultKind,
  type AiImageSource,
  type AiModelSelection,
  type AiSettingsV2,
} from '@chatoffice/ai-provider/browser'
import type { ModelSettingsBridge } from './ModelSettingsPage'
import { modelSettingsStrings } from './model-settings-strings'

export interface ModelDefaultsPageProps {
  bridge: ModelSettingsBridge
  lang?: string
}

const KINDS: AiDefaultKind[] = ['chat', 'generation', 'qc', 'image', 'videoGeneration', 'tts', 'asr']

const IMAGE_SOURCES: AiImageSource[] = ['auto', 'web', 'model', 'local', 'svg']

export function ModelDefaultsPage({ bridge, lang }: ModelDefaultsPageProps): React.JSX.Element {
  const locale = lang ?? (typeof document !== 'undefined' ? document.documentElement.lang : 'zh')
  const t = useMemo(() => modelSettingsStrings(locale), [locale])
  const [settings, setSettings] = useState<AiSettingsV2 | null>(null)

  useEffect(() => {
    void bridge.getSettings().then(setSettings).catch(() => setSettings(null))
  }, [bridge])

  /** free-typed value of the output-cap field; committed (and clamped) on blur */
  const [maxTokensDraft, setMaxTokensDraft] = useState<string | null>(null)
  const commitMaxTokens = () => {
    if (!settings || maxTokensDraft === null) return
    const raw = Number(maxTokensDraft)
    setMaxTokensDraft(null)
    const next: AiSettingsV2 = { ...settings }
    if (Number.isFinite(raw) && maxTokensDraft.trim() !== '') {
      next.maxOutputTokens = clampMaxOutputTokens(Math.round(raw))
    } else {
      delete next.maxOutputTokens
    }
    if (next.maxOutputTokens === settings.maxOutputTokens) return
    setSettings(next)
    void bridge.saveSettings(next)
  }

  /** enabled models of one kind across all enabled profiles */
  const kindOptions = (kind: AiDefaultKind): Array<{ value: string; label: string }> => {
    if (!settings) return []
    if (kind === 'chat') {
      return enabledChatModels(settings).map((m) => ({
        value: `${m.profileId}::${m.modelId}`,
        label: `${findProfile(settings, m.profileId)?.displayName ?? m.profileId} · ${m.modelId}`,
      }))
    }
    const types = DEFAULT_KIND_TYPES[kind]
    const out: Array<{ value: string; label: string }> = []
    for (const profile of settings.profiles) {
      if (!profile.enabled) continue
      for (const m of profile.models) {
        if (types.includes(m.type ?? inferModelType(m.id))) {
          out.push({ value: `${profile.id}::${m.id}`, label: `${profile.displayName} · ${m.id}` })
        }
      }
    }
    return out
  }

  const explicitValue = (kind: AiDefaultKind): string => {
    if (!settings) return ''
    const explicit =
      kind === 'chat' ? settings.currentModel : kind === 'image' ? settings.imageModel : settings.modelDefaults?.[kind]
    return explicit ? `${explicit.profileId}::${explicit.modelId}` : ''
  }

  const effectiveLabel = (kind: AiDefaultKind): string | undefined => {
    if (!settings) return undefined
    const effective = resolveDefaultModel(settings, kind)
    if (!effective) return undefined
    const isExplicit = explicitValue(kind) === `${effective.profileId}::${effective.modelId}`
    if (isExplicit) return undefined
    const profile = findProfile(settings, effective.profileId)
    return `${t.defaultsAutoUsing} ${profile?.displayName ?? effective.profileId} · ${effective.modelId}`
  }

  const pick = async (kind: AiDefaultKind, value: string) => {
    if (!settings) return
    const selection: AiModelSelection | undefined =
      value === '' ? undefined : (() => {
        const [profileId, modelId] = value.split('::')
        return profileId && modelId ? { profileId, modelId } : undefined
      })()
    const next: AiSettingsV2 = { ...settings }
    if (kind === 'chat') {
      if (selection) next.currentModel = selection
      else delete next.currentModel
    } else if (kind === 'image') {
      if (selection) next.imageModel = selection
      else delete next.imageModel
    } else {
      const defaults = { ...(next.modelDefaults ?? {}) }
      if (selection) defaults[kind] = selection
      else delete defaults[kind]
      if (Object.keys(defaults).length > 0) next.modelDefaults = defaults
      else delete next.modelDefaults
    }
    await bridge.saveSettings(next)
    setSettings(next)
  }

  const pickImageSource = async (value: string) => {
    if (!settings) return
    const next: AiSettingsV2 = { ...settings, imageSource: value as AiImageSource }
    await bridge.saveSettings(next)
    setSettings(next)
  }

  return (
    <div className="msp-defaults" data-model-defaults>
      <p className="msp-note">{t.defaultsNote}</p>
      <label className="msp-field msp-defaults-field">
        <span className="msp-label">{t.defaultsImageSourceLabel}</span>
        <select
          className="msp-input msp-select"
          data-image-source
          value={settings?.imageSource ?? 'auto'}
          onChange={(e) => void pickImageSource(e.target.value)}
        >
          {IMAGE_SOURCES.map((s) => (
            <option key={s} value={s}>
              {t.imageSourceOpts[s]}
            </option>
          ))}
        </select>
        <span className="msp-note">{t.defaultsImageSourceNote}</span>
      </label>
      <label className="msp-field msp-defaults-field">
        <span className="msp-label">{t.maxTokensLabel}</span>
        <input
          className="msp-input"
          data-default-kind="max-tokens"
          type="number"
          min={MIN_MAX_OUTPUT_TOKENS}
          max={MAX_MAX_OUTPUT_TOKENS}
          step={1024}
          value={maxTokensDraft ?? String(settings?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS)}
          disabled={!settings}
          onChange={(e) => setMaxTokensDraft(e.target.value)}
          onBlur={commitMaxTokens}
        />
        <span className="msp-note">{t.maxTokensDesc}</span>
      </label>
      {KINDS.map((kind) => {
        const options = kindOptions(kind)
        const effective = effectiveLabel(kind)
        return (
          <label key={kind} className="msp-field msp-defaults-field">
            <span className="msp-label">{t.defaultsKind[kind]}</span>
            <select
              className="msp-input msp-select"
              data-default-kind={kind}
              value={explicitValue(kind)}
              disabled={options.length === 0}
              onChange={(e) => void pick(kind, e.target.value)}
            >
              <option value="">{options.length ? t.defaultsAuto : t.defaultsNoneAvailable}</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {effective && <span className="msp-note">{effective}</span>}
          </label>
        )
      })}
    </div>
  )
}
