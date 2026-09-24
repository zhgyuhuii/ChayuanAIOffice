// DocOpsModal — shared shell for the 察元 AI docops dialogs: the app's standard
// modal classes (modal-backdrop/modal/modal-actions) with esc-close handled by
// the existing useModalKeys hook, plus a compact field row helper.
import { useEffect, type ReactNode } from 'react'
import { useI18n } from '../../i18n/locale'
import { useModalKeys } from '../../components/modal-keys'

export function DocOpsModal({
  title,
  children,
  footer,
  onClose,
  width,
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  width?: number
}) {
  const modalKeys = useModalKeys(onClose)
  return (
    <div
      className="modal-backdrop"
      ref={modalKeys.ref}
      onKeyDown={modalKeys.onKeyDown}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal docops-modal" style={width ? { width } : undefined}>
        <h2>{title}</h2>
        <div className="docops-modal-body">{children}</div>
        {footer ? <div className="modal-actions docops-modal-footer">{footer}</div> : null}
      </div>
    </div>
  )
}

export function DocOpsField({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="docops-field">
      <span className="docops-field-label">{label}</span>
      {children}
      {hint ? <span className="docops-field-hint">{hint}</span> : null}
    </label>
  )
}

/** notice line inside a dialog (result counts, warnings) */
export function DocOpsNotice({ kind, text }: { kind: 'info' | 'warn'; text: string }) {
  const { t } = useI18n()
  void t
  return <div className={`docops-notice docops-notice-${kind}`}>{text}</div>
}

/** autofocus the first input on mount */
export function useAutoFocus<T extends HTMLElement>(ref: React.RefObject<T | null>) {
  useEffect(() => {
    ref.current?.focus()
  }, [ref])
}
