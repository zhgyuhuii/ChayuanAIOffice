import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { useI18n } from './i18n/locale'

/// WPS/Excel-style collapsed range picking: a dialog field asks the App to
/// open a pick session, the dialog hides itself, the user drags over the
/// grid (cells, row/column headers, ctrl-multi, or another sheet's tab),
/// and the floating bar mirrors the selection as reference text until
/// confirmed or cancelled.

export interface RangePickRequest {
  /// What is being picked, shown in the bar (e.g. "number1" or "引用位置").
  readonly label: string
  /// Formula context: whole column/row refs, comma-joined multi selections.
  readonly formula?: boolean
  /// Only the primary cell address (Goal Seek's set/by cells).
  readonly singleCell?: boolean
  /// Current field text, so the bar starts from what the input holds.
  readonly initial?: string
}

export type RangePickHandler = (request: RangePickRequest) => Promise<string | null>

export function RangePickBar({
  label,
  value,
  onChange,
  onConfirm,
  onCancel,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onConfirm: () => void
  readonly onCancel: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  // Anchored inside the workbook area: centered over the grid it is picking
  // from, never over the Name Box band or the AI panel, and following the
  // layout when the panel toggles.
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setHost(document.querySelector('.workbook-area') as HTMLElement | null)
  }, [])
  const bar = (
    <div className="range-pick-bar" role="dialog" aria-label={t('dlgRangePickTitle')}>
      <span className="range-pick-icon" aria-hidden>
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path
            d="M2 2h12v12H2z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            opacity="0.55"
          />
          <path
            d="M2 6h12M2 10h12M6 2v12M10 2v12"
            stroke="currentColor"
            strokeWidth="0.9"
            opacity="0.4"
          />
          <rect x="6.6" y="6.6" width="4.8" height="3.8" fill="currentColor" />
        </svg>
      </span>
      <span className="range-pick-label" title={t('dlgRangePickHint')}>
        {label}
      </span>
      <input
        autoFocus
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onConfirm()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      />
      <button type="button" className="range-pick-confirm" onClick={onConfirm}>
        {t('dlgOk')}
      </button>
      <button type="button" className="range-pick-cancel" onClick={onCancel}>
        {t('dlgCancel')}
      </button>
    </div>
  )
  return host ? createPortal(bar, host) : bar
}

/// The ⌖ button next to a reference input.
export function RangePickButton({
  onPick,
  title,
}: {
  readonly onPick: () => void
  readonly title: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="range-pick-btn"
      onClick={onPick}
      title={title}
      aria-label={title}
    >
      <svg viewBox="0 0 16 16" width="14" height="14">
        <path
          d="M2 2h12v12H2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          opacity="0.55"
        />
        <path
          d="M2 6h12M2 10h12M6 2v12M10 2v12"
          stroke="currentColor"
          strokeWidth="0.9"
          opacity="0.4"
        />
        <rect x="6.6" y="6.6" width="4.8" height="3.8" fill="currentColor" />
      </svg>
    </button>
  )
}

/// Dialog-side session state: while `picking` the dialog renders nothing (the
/// App-owned bar takes over); on confirm the picked text lands via `commit`.
export function useRangePickSession(onPickRange?: RangePickHandler): {
  readonly picking: boolean
  readonly begin: (
    label: string,
    request: Omit<RangePickRequest, 'label'>,
    commit: (value: string) => void,
  ) => void
} {
  const [picking, setPicking] = useState(false)
  const begin = (
    label: string,
    request: Omit<RangePickRequest, 'label'>,
    commit: (value: string) => void,
  ): void => {
    if (!onPickRange) return
    setPicking(true)
    void onPickRange({ label, ...request }).then((value) => {
      setPicking(false)
      if (value !== null) commit(value)
    })
  }
  return { picking, begin }
}
