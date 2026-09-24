/**
 * KbPickerButton — the composer footer's knowledge-base control, placed next
 * to the model picker (docs/kb-integration-plan.md §7). Multi-select library
 * popover fed by kbDiscover(); selection persists via kb-api's localStorage
 * store so home chat and every editor panel share the same libraries.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KbCitation, KbInfo } from '@chatoffice/ai-provider/browser'
import { useDismissablePopover } from '../popover-dismiss'
import './kb.css'
import { fmt, kbStrings } from './kb-strings'
import {
  kbBudget,
  kbDiscover,
  kbRetrieve,
  kbSelectedIds,
  setKbBudget,
  setKbSelectedIds,
  type KbDiscoverPayload,
} from './kb-api'

export interface KbPickerButtonProps {
  lang?: string
  /** controlled selection (persisted by the shared hook below) */
  selected: string[]
  onToggle: (kbId: string) => void
}

interface DiscoverState {
  loading: boolean
  payload: KbDiscoverPayload | null
}

const BUDGET_OPTIONS = [8000, 12000, 20000, 32000]

export function KbPickerButton({
  lang,
  selected,
  onToggle,
}: KbPickerButtonProps): React.JSX.Element {
  const t = useMemo(() => kbStrings(lang), [lang])
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<DiscoverState>({ loading: false, payload: null })
  const [budget, setBudgetState] = useState(kbBudget)
  const wrapRef = useRef<HTMLSpanElement>(null)

  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })

  const refresh = (force: boolean) => {
    setState((s) => ({ ...s, loading: true }))
    void kbDiscover(force).then((payload) => setState({ loading: false, payload }))
  }

  useEffect(() => {
    if (open) refresh(true)
  }, [open])

  const kbs: KbInfo[] = state.payload?.status?.kbs ?? []
  const chain = state.payload?.status?.chain
  const embedUnavailable = chain ? !chain.cloudEmbedding && !chain.localEmbedReady : false

  return (
    <span className="kb-picker-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`kb-picker-btn${selected.length > 0 ? ' has-selection' : ''}${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.kbPickerLabel}
        data-tip={t.kbPickerLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <ellipse cx="8" cy="3.6" rx="5.2" ry="1.9" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M2.8 3.6v8.8c0 1.05 2.33 1.9 5.2 1.9s5.2-.85 5.2-1.9V3.6M2.8 8c0 1.05 2.33 1.9 5.2 1.9s5.2-.85 5.2-1.9"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        {selected.length > 0 && <span>{selected.length}</span>}
      </button>
      {open && (
        <div className="kb-picker-pop" role="menu">
          <div className="kb-picker-hint">{t.kbPickerHint}</div>
          {!state.payload?.ok ? (
            <div className="kb-picker-empty">
              <div>{t.kbPickerUnavailable}</div>
              <button type="button" className="kb-retry" onClick={() => refresh(true)}>
                {t.kbPickerRetry}
              </button>
            </div>
          ) : kbs.length === 0 ? (
            <div className="kb-picker-empty">{t.kbPickerEmpty}</div>
          ) : (
            kbs.map((kb) => {
              const docs = kb.docs ?? []
              const failed = docs.filter((d) => d.status === 'failed').length
              const isSelected = selected.includes(kb.kbId)
              return (
                <button
                  key={kb.kbId}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={isSelected}
                  className={`kb-picker-item${isSelected ? ' selected' : ''}`}
                  onClick={() => onToggle(kb.kbId)}
                >
                  <span className="kb-check" aria-hidden="true">
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2.5 6.5l2.2 2.2 4.8-5.4"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="kb-name">{kb.kbId}</span>
                  <span className="kb-meta">
                    {fmt(t.kbDocsCount, { n: docs.length })}
                    {failed > 0 ? ` · ${fmt(t.kbDocsFailed, { n: failed })}` : ''}
                  </span>
                </button>
              )
            })
          )}
          {state.payload?.ok && embedUnavailable && (
            <div className="kb-picker-warn">{t.kbEmbedWarning}</div>
          )}
          <div className="kb-picker-footer">
            <span className="kb-source" title={state.payload?.origin ?? ''}>
              {state.payload?.origin ? fmt(t.kbSource, { origin: state.payload.origin }) : ''}
            </span>
            <select
              className="kb-budget"
              value={budget}
              aria-label={t.kbBudget}
              onChange={(e) => {
                const next = Number(e.target.value)
                setBudgetState(next)
                setKbBudget(next)
              }}
            >
              {BUDGET_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {fmt(t.kbBudgetChars, { n })}
                </option>
              ))}
            </select>
            <button type="button" className="kb-refresh" onClick={() => refresh(true)}>
              {t.kbRefresh}
            </button>
          </div>
        </div>
      )}
    </span>
  )
}

/**
 * Shared selection state for any composer: localStorage-backed so the home
 * chat and all editor panels agree on the active libraries.
 */
export function useKbSelection(): {
  selected: string[]
  toggle: (kbId: string) => void
} {
  const [selected, setSelected] = useState<string[]>(() => kbSelectedIds())
  const toggle = (kbId: string) => {
    setSelected((prev) => {
      const next = prev.includes(kbId) ? prev.filter((v) => v !== kbId) : [...prev, kbId]
      setKbSelectedIds(next)
      return next
    })
  }
  return { selected, toggle }
}

/**
 * Composer augmentation helper for the editor AI panels: shared selection
 * state + a one-call text augmentor for the send path (returns the text
 * unchanged when nothing is selected or retrieval comes back empty).
 */
export function useKbAugment(): {
  selected: string[]
  toggle: (kbId: string) => void
  augment: (text: string) => Promise<string>
  /** citations from the most recent augment() call ([] when KB off/unreachable) */
  lastCitations: React.RefObject<KbCitation[]>
} {
  const { selected, toggle } = useKbSelection()
  const lastCitations = useRef<KbCitation[]>([])
  const augment = useCallback(
    async (text: string) => {
      lastCitations.current = []
      // read the shared store fresh: the picker instance that toggles the
      // selection is often a different component (panel vs host App), so the
      // hook's React state can be stale — localStorage is the single source
      const ids = kbSelectedIds()
      if (ids.length === 0) return text
      const result = await kbRetrieve(ids, text)
      if (!result) return text
      lastCitations.current = result.citations
      return `${text}\n\n${result.block}`
    },
    [],
  )
  return { selected, toggle, augment, lastCitations }
}
