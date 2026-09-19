/**
 * ModelPickerButton — the composer footer's current-model control.
 *
 * Popover layout (chatop-style):
 *   [模型设置…  ]  — pinned entry to the settings window
 *   [全部|对话|视觉|生图|视频|语音|识别]  — kind filter chips (model-type based)
 *   vendor groups — logo + name header (click = collapse/expand), model rows
 *                   beneath with the vendor logo + model id
 *
 * Picking a model persists the global current model via the injected callback.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  VENDOR_BY_ID,
  inferModelType,
  type AiModelSelection,
  type AiModelType,
  type AiSettingsV2,
} from '@chatoffice/ai-provider/browser'
import { useDismissablePopover } from './popover-dismiss'
import { VendorLogo } from './VendorLogo'
import './dropdown.css'
import { modelSettingsStrings } from './model-settings-strings'

/** picker-relevant kinds in display order; chat+vision fold into the 对话 chip */
const PICKER_KINDS: Array<{ id: 'all' | AiModelType; types: AiModelType[] }> = [
  { id: 'all', types: [] },
  { id: 'chat', types: ['chat', 'vision'] },
  { id: 'image-generation', types: ['image-generation'] },
  { id: 'video-generation', types: ['video-generation'] },
  { id: 'tts', types: ['tts'] },
  { id: 'asr', types: ['asr'] },
]

/** chat+vision share the 对话 chip; the rest appear only when present */
const KIND_LABEL_KEY: Record<string, string> = {
  chat: 'chat',
  'image-generation': 'image-generation',
  'video-generation': 'video-generation',
  tts: 'tts',
  asr: 'asr',
}

export interface ModelPickerButtonProps {
  settings: AiSettingsV2
  /** persist + apply the picked model; the caller refreshes its settings state */
  onPick: (selection: AiModelSelection) => void
  onOpenSettings: () => void
  lang?: string
}

interface PickerModel {
  profileId: string
  modelId: string
  vendorId?: string | undefined
  profileName: string
  type: AiModelType
  /** synthetic chatop-local entries carry a live running marker */
  running?: boolean
}

export function ModelPickerButton({
  settings,
  onPick,
  onOpenSettings,
  lang,
}: ModelPickerButtonProps): React.JSX.Element {
  const locale = lang ?? (typeof document !== 'undefined' ? document.documentElement.lang : 'zh')
  const t = useMemo(() => modelSettingsStrings(locale), [locale])
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'all' | AiModelType>('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const wrapRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })

  // every model on enabled profiles (typed), not just chat — filters expose the rest
  const models: PickerModel[] = useMemo(() => {
    const out: PickerModel[] = []
    for (const profile of settings.profiles) {
      if (!profile.enabled) continue
      for (const m of profile.models) {
        const type = m.type ?? inferModelType(m.id)
        if (
          type === 'embedding' ||
          type === 'audio-understanding' ||
          type === 'video-understanding'
        )
          continue
        out.push({
          profileId: profile.id,
          modelId: m.id,
          vendorId: profile.vendorId ?? (VENDOR_BY_ID.has(profile.id) ? profile.id : undefined),
          profileName: profile.displayName || profile.id,
          type,
          ...(m.running ? { running: true } : {}),
        })
      }
    }
    return out
  }, [settings])

  /** kinds with at least one model — chips only show for those (plus 全部) */
  const kindChips = useMemo(() => {
    const present = new Set(models.map((m) => m.type))
    const visible = PICKER_KINDS.filter(
      (k) => k.id === 'all' || k.types.some((ty) => present.has(ty)),
    )
    // the active filter can go stale when models change; fall back to 全部
    if (kind !== 'all') {
      const still = visible.find((k) => k.id !== 'all' && k.types.includes(kind as AiModelType))
      if (!still) setKind('all')
    }
    return visible
  }, [models, kind])

  const filtered = useMemo(() => {
    const chip = kindChips.find((k) => k.id === kind)
    if (!chip || chip.id === 'all') return models
    return models.filter((m) => chip.types.includes(m.type))
  }, [models, kind, kindChips])

  const current = settings.currentModel
  const currentLabel =
    models.find((m) => m.profileId === current?.profileId && m.modelId === current?.modelId)
      ?.modelId ?? t.pickerSettings

  const pick = (m: PickerModel) => {
    setOpen(false)
    onPick({ profileId: m.profileId, modelId: m.modelId })
  }

  const grouped = useMemo(() => {
    const groups = new Map<
      string,
      { name: string; vendorId?: string | undefined; rows: PickerModel[] }
    >()
    for (const m of filtered) {
      let g = groups.get(m.profileId)
      if (!g) {
        g = { name: m.profileName, vendorId: m.vendorId, rows: [] }
        groups.set(m.profileId, g)
      }
      g.rows.push(m)
    }
    return [...groups.entries()]
  }, [filtered])

  // anchor the fixed popover above the trigger (the composer footer sits at the
  // panel bottom; growing downward would clip) and clamp to the viewport
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    if (!open) {
      setPopPos(null)
      return
    }
    const place = () => {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect || !popRef.current) return
      const pop = popRef.current.getBoundingClientRect()
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - pop.width - 8))
      // prefer above the trigger; fall below when there is no room
      const top =
        rect.top - pop.height - 6 >= 8
          ? rect.top - pop.height - 6
          : Math.min(rect.bottom + 6, window.innerHeight - pop.height - 8)
      setPopPos({ left, top })
    }
    place()
    // first paint may reflow (chips wrap); place again next frame
    const raf = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
    }
  }, [open, kind])

  useEffect(() => {
    if (!open) return
    popRef.current?.querySelector('.ai-picker-row')?.scrollIntoView?.({ block: 'nearest' })
  }, [open, kind])

  return (
    <span className="ai-model-picker-wrap" ref={wrapRef}>
      <button
        type="button"
        className="ai-model-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t.pickerSettings}
        title={currentLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {(() => {
          const cur = models.find(
            (m) => m.profileId === current?.profileId && m.modelId === current?.modelId,
          )
          return (
            <>
              <VendorLogo
                vendorId={cur?.vendorId}
                size={14}
                fallback={cur?.profileName ?? t.pickerSettings}
              />
              <span className="ai-model-picker-value">{currentLabel}</span>
            </>
          )
        })()}
        <span className={`msp-chev${open ? '' : ' is-collapsed'}`} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div
          className="ai-picker-pop"
          role="listbox"
          aria-label={t.pickerSettings}
          ref={popRef}
          style={
            popPos ? { left: `${popPos.left}px`, top: `${popPos.top}px` } : { visibility: 'hidden' }
          }
        >
          <button
            type="button"
            className="ai-picker-settings"
            onClick={() => {
              setOpen(false)
              onOpenSettings()
            }}
          >
            <strong>{t.pickerSettings}…</strong>
          </button>
          <div className="ai-picker-filters" role="tablist" aria-label={t.pickerSettings}>
            {kindChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                role="tab"
                aria-selected={kind === chip.id}
                className={`ai-picker-chip${kind === chip.id ? ' is-active' : ''}`}
                data-picker-kind={chip.id}
                onClick={() => setKind(chip.id)}
              >
                {chip.id === 'all'
                  ? t.filterAll
                  : (t.type[KIND_LABEL_KEY[chip.id as string] ?? chip.id] ?? chip.id)}
              </button>
            ))}
          </div>
          <div className="ai-picker-list">
            {grouped.length === 0 && <div className="ai-picker-empty">{t.filterEmptyHint}</div>}
            {grouped.map(([profileId, group]) => {
              const isCollapsed = collapsed.has(profileId)
              return (
                <div key={profileId} className="ai-picker-vgroup" data-picker-group={profileId}>
                  <button
                    type="button"
                    className="ai-picker-group"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev)
                        if (next.has(profileId)) next.delete(profileId)
                        else next.add(profileId)
                        return next
                      })
                    }
                  >
                    <VendorLogo vendorId={group.vendorId} size={14} fallback={group.name} />
                    <span className="ai-picker-group-name">{group.name}</span>
                    <span className={`msp-chev${isCollapsed ? ' is-collapsed' : ''}`} aria-hidden>
                      ▾
                    </span>
                  </button>
                  {!isCollapsed &&
                    group.rows.map((m) => (
                      <button
                        key={`${m.profileId}::${m.modelId}`}
                        type="button"
                        role="option"
                        aria-selected={
                          current?.profileId === m.profileId && current?.modelId === m.modelId
                        }
                        className={`ai-picker-item${
                          current?.profileId === m.profileId && current?.modelId === m.modelId
                            ? ' is-selected'
                            : ''
                        }`}
                        data-picker-model={`${m.profileId}::${m.modelId}`}
                        onClick={() => pick(m)}
                      >
                        <VendorLogo vendorId={m.vendorId} size={14} fallback={m.profileName} />
                        <span className="ai-picker-row">
                          {m.modelId}
                          <span className="ai-picker-kind">{t.type[m.type] ?? m.type}</span>
                          {m.running && (
                            <span className="ai-picker-kind" style={{ color: '#22c55e' }}>
                              ● {t.pickerRunning}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </span>
  )
}
