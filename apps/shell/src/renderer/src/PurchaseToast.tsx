import { useEffect, useRef, useState } from 'react'
import { useI18n } from './locale'
import { openPurchaseDialog } from './PurchaseModal'
import './purchase-toast.css'

/**
 * Gentle purchase toast (LOCAL feature, B-zone): the bottom-right,
 * non-modal counterpart of StarPromptCard. The main-process scheduler pushes
 * {kind:'reminder'} every 30 minutes once the free period is over; the toast
 * auto-dismisses after 60 seconds and opens the purchase dialog on click.
 * {kind:'open-page'} (once-per-day popup) skips the toast and opens the
 * dialog directly. Rendered only when the Electron bridge exists — the web
 * and dsh-iframe forms never mount this component.
 */

const TOAST_TTL_MS = 60_000

export function PurchaseToast() {
  const { t } = useI18n()
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Fresh text per toast so a repeated reminder re-animates instead of
  // looking glued on.
  const [seq, setSeq] = useState(0)

  useEffect(() => {
    const bridge = window.chatOfficePurchase
    if (!bridge) return undefined
    const armTimer = () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setVisible(false), TOAST_TTL_MS)
    }
    const unsubscribe = bridge.onEvent((payload) => {
      if (payload.kind === 'open-page') {
        openPurchaseDialog()
        return
      }
      setVisible(true)
      setSeq((n) => n + 1)
      armTimer()
    })
    return () => {
      unsubscribe()
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [])

  if (!visible) return null

  return (
    <div key={seq} className="purchase-toast" role="status" data-purchase-toast>
      <button
        className="purchase-toast-close"
        aria-label={t('purchaseClose')}
        onClick={() => setVisible(false)}
        data-purchase-toast-close
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className="purchase-toast-body"
        onClick={() => {
          setVisible(false)
          openPurchaseDialog()
        }}
        data-purchase-toast-open
      >
        <span className="purchase-toast-title">{t('purchaseRemindTitle')}</span>
        <span className="purchase-toast-text">{t('purchaseRemindBody')}</span>
      </button>
    </div>
  )
}
