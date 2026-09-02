/**
 * ModelPickerButton — the AI panel header's current-model control: quick
 * switch across every enabled chat model (grouped by profile), with the
 * model-settings entry pinned at the top. Switching persists the global
 * current model through the injected callback.
 */
import React, { useMemo, useState } from 'react'
import {
  VENDOR_BY_ID,
  enabledChatModels,
  findProfile,
  type AiModelSelection,
  type AiSettingsV2,
} from '@genoffice/ai-provider'
import { Dropdown, type DropdownOption } from './dropdown'
import { VendorLogo } from './VendorLogo'
import './dropdown.css'
import { modelSettingsStrings } from './model-settings-strings'

const SETTINGS_VALUE = '__model_settings__'

export interface ModelPickerButtonProps {
  settings: AiSettingsV2
  /** persist + apply the picked model; the caller refreshes its settings state */
  onPick: (selection: AiModelSelection) => void
  onOpenSettings: () => void
  lang?: string
}

export function ModelPickerButton({
  settings,
  onPick,
  onOpenSettings,
  lang,
}: ModelPickerButtonProps): React.JSX.Element {
  const locale = lang ?? (typeof document !== 'undefined' ? document.documentElement.lang : 'zh')
  const t = useMemo(() => modelSettingsStrings(locale), [locale])
  const chat = enabledChatModels(settings)
  /** vendor groups collapsed in the dropdown (click a group header to toggle) */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const options: DropdownOption[] = useMemo(() => {
    const out: DropdownOption[] = [
      { value: SETTINGS_VALUE, label: t.pickerSettings, render: <strong>{t.pickerSettings}…</strong> },
    ]
    let lastProfile = ''
    for (const m of chat) {
      if (m.profileId !== lastProfile) {
        lastProfile = m.profileId
        const profile = findProfile(settings, m.profileId)
        const vendorId = profile?.vendorId ?? (VENDOR_BY_ID.has(m.profileId) ? m.profileId : undefined)
        const name = profile?.displayName ?? m.profileId
        const isCollapsed = collapsed.has(m.profileId)
        // vendor group header: logo + name + chevron; clicking collapses/expands
        out.push({
          value: `__hdr__${m.profileId}`,
          label: name,
          disabled: true,
          onDisabledClick: () =>
            setCollapsed((prev) => {
              const next = new Set(prev)
              if (next.has(m.profileId)) next.delete(m.profileId)
              else next.add(m.profileId)
              return next
            }),
          render: (
            <span className="ai-picker-group">
              <VendorLogo vendorId={vendorId} size={14} fallback={name} />
              <span className="ai-picker-group-name">{name}</span>
              <span className={`msp-chev${isCollapsed ? ' is-collapsed' : ''}`} aria-hidden>
                ▾
              </span>
            </span>
          ),
        })
      }
      if (collapsed.has(m.profileId)) continue
      const vendorId = findProfile(settings, m.profileId)?.vendorId ?? m.profileId
      // render (trigger + row) shows the vendor icon + model id; `label` stays fully accessible
      out.push({
        value: `${m.profileId}::${m.modelId}`,
        label: m.label,
        render: (
          <span className="ai-picker-row">
            <VendorLogo vendorId={VENDOR_BY_ID.has(vendorId) ? vendorId : undefined} size={14} fallback={vendorId} />
            {m.modelId}
          </span>
        ),
      })
    }
    return out
  }, [chat, settings, t, collapsed])

  const current = settings.currentModel
  const currentKey = current ? `${current.profileId}::${current.modelId}` : SETTINGS_VALUE

  return (
    <Dropdown
      className="ai-model-picker"
      value={currentKey}
      options={options}
      ariaLabel={t.pickerSettings}
      onPick={(value) => {
        if (value === SETTINGS_VALUE) {
          onOpenSettings()
          return
        }
        const [profileId, modelId] = value.split('::')
        if (profileId && modelId) onPick({ profileId, modelId })
      }}
    />
  )
}
