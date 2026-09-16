/**
 * MediaModelPicker — the insert-media dialog's model control. Mirrors the
 * composer's ModelPickerButton presentation exactly (same dropdown.css
 * classes): a trigger + popover with the 模型设置… pinned entry, kind filter
 * chips (生图/视频), collapsible vendor groups with VendorLogo headers and
 * model rows beneath. The data source differs by design: the dialog bridge's
 * MediaModelOption list (image/video only, param specs attached) instead of
 * the full AiSettingsV2.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { VENDOR_BY_ID } from '@chatoffice/ai-provider/browser'
import { useDismissablePopover } from './popover-dismiss'
import { VendorLogo } from './VendorLogo'
import './dropdown.css'
import { modelSettingsStrings } from './model-settings-strings'
import type { MediaModelOption } from './InsertImageDialog'

/** dialog kinds map onto the picker's model-type labels */
const KIND_TYPE = {
  image: 'image-generation',
  video: 'video-generation',
  svg: 'chat',
} as const
type Kind = 'image' | 'video' | 'svg'

export interface MediaModelPickerProps {
  readonly models: MediaModelOption[]
  readonly selected: { profileId: string; modelId: string } | null
  readonly onPick: (m: MediaModelOption) => void
  readonly onOpenSettings?: (() => void) | undefined
  /** trigger text while the list is empty (load error or nothing enabled) */
  readonly emptyText?: string | undefined
  readonly lang?: string | undefined
}

export function MediaModelPicker({
  models,
  selected,
  onPick,
  onOpenSettings,
  emptyText,
  lang,
}: MediaModelPickerProps): React.JSX.Element {
  const locale = lang ?? (typeof document !== 'undefined' ? document.documentElement.lang : 'zh')
  const t = useMemo(() => modelSettingsStrings(locale), [locale])
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'all' | Kind>('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const wrapRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })

  const kindsPresent = useMemo(() => {
    const s = new Set(models.map((m) => m.kind))
    return { image: s.has('image'), video: s.has('video'), svg: s.has('svg') }
  }, [models])

  // a filter can go stale when the model list changes; fall back to 全部
  useEffect(() => {
    if (kind === 'image' && !kindsPresent.image) setKind('all')
    if (kind === 'video' && !kindsPresent.video) setKind('all')
  }, [kind, kindsPresent])

  const filtered = useMemo(
    () => (kind === 'all' ? models : models.filter((m) => m.kind === kind)),
    [models, kind],
  )

  /** vendor groups (vendorId = profile.vendorId ?? profile.id); zh prefers nameZh */
  const grouped = useMemo(() => {
    const zh = locale.toLowerCase().startsWith('zh')
    const groups = new Map<string, { name: string; vendorId: string; rows: MediaModelOption[] }>()
    for (const m of filtered) {
      let g = groups.get(m.vendorId)
      if (!g) {
        const v = VENDOR_BY_ID.get(m.vendorId)
        g = {
          name: (zh ? v?.nameZh : undefined) ?? v?.name ?? m.vendorId,
          vendorId: m.vendorId,
          rows: [],
        }
        groups.set(m.vendorId, g)
      }
      g.rows.push(m)
    }
    return [...groups.entries()]
  }, [filtered, locale])

  const current = models.find(
    (m) => selected && m.profileId === selected.profileId && m.modelId === selected.modelId,
  )
  // emptyText only applies while the list is truly empty (load error / nothing enabled);
  // a loaded-but-unselected picker just shows the neutral settings label
  const currentLabel =
    current?.label ?? (models.length === 0 ? (emptyText ?? t.pickerSettings) : t.pickerSettings)

  // the dialog row sits mid-dialog: prefer opening below the trigger, flip
  // above when there is no room, clamp to the viewport
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
      const top =
        rect.bottom + pop.height + 6 <= window.innerHeight - 8
          ? rect.bottom + 6
          : Math.max(8, rect.top - pop.height - 6)
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
    popRef.current
      ?.querySelector('.ai-picker-item.is-selected')
      ?.scrollIntoView?.({ block: 'nearest' })
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
        <VendorLogo
          vendorId={current?.vendorId}
          size={14}
          {...(current ? {} : { fallback: t.pickerSettings })}
        />
        <span className="ai-model-picker-value">{currentLabel}</span>
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
          {onOpenSettings && (
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
          )}
          {kindsPresent.image && kindsPresent.video && (
            <div className="ai-picker-filters" role="tablist" aria-label={t.pickerSettings}>
              {(['all', 'image', 'video'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={kind === k}
                  className={`ai-picker-chip${kind === k ? ' is-active' : ''}`}
                  onClick={() => setKind(k)}
                >
                  {k === 'all' ? t.filterAll : (t.type[KIND_TYPE[k]] ?? k)}
                </button>
              ))}
            </div>
          )}
          <div className="ai-picker-list">
            {grouped.length === 0 && (
              <div className="ai-picker-empty">{emptyText ?? t.filterEmptyHint}</div>
            )}
            {grouped.map(([vendorId, group]) => {
              const isCollapsed = collapsed.has(vendorId)
              return (
                <div key={vendorId} className="ai-picker-vgroup" data-picker-group={vendorId}>
                  <button
                    type="button"
                    className="ai-picker-group"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev)
                        if (next.has(vendorId)) next.delete(vendorId)
                        else next.add(vendorId)
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
                    group.rows.map((m) => {
                      const sel =
                        selected?.profileId === m.profileId && selected?.modelId === m.modelId
                      return (
                        <button
                          key={`${m.profileId}::${m.modelId}`}
                          type="button"
                          role="option"
                          aria-selected={sel}
                          className={`ai-picker-item${sel ? ' is-selected' : ''}`}
                          data-picker-model={`${m.profileId}::${m.modelId}`}
                          onClick={() => {
                            setOpen(false)
                            onPick(m)
                          }}
                        >
                          <VendorLogo vendorId={m.vendorId} size={14} fallback={group.name} />
                          <span className="ai-picker-row">
                            {m.label}
                            <span className="ai-picker-kind">
                              {t.type[KIND_TYPE[m.kind]] ?? m.kind}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </span>
  )
}
