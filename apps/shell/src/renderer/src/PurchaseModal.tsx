import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from './locale'
import wxpayQr from './assets/wxpay.png'
import alipayQr from './assets/alipay.png'
import './purchase.css'

/**
 * Purchase / license dialog (LOCAL feature, B-zone). Opened by the
 * `chatoffice-purchase-open` window event, which three sources funnel into:
 * the main-process once-per-day scheduler (via PurchaseToast), the toast
 * click, and nothing else — the shell has no other purchase entry on
 * purpose. Content: status line, four duration tiers (display only — the
 * real quote is whatever support charges), the offline WeChat/Alipay
 * collection QRs, the machine fingerprint with copy, and the serial
 * activation form. Activation verifies locally in the main process
 * (main/purchase.ts) and never touches the network.
 */

export const PURCHASE_OPEN_EVENT = 'chatoffice-purchase-open'

declare global {
  interface Window {
    /** Present only in the Electron shell (preload bridge); the web/dsh
     * iframe forms lack it, which is what keeps purchase UI silent there. */
    chatOfficePurchase?: {
      state(): Promise<import('../../shared/purchase-api').PurchaseSnapshot>
      activate(serial: string): Promise<import('../../shared/purchase-api').PurchaseActivateResult>
      onEvent(listener: (payload: import('../../shared/purchase-api').PurchaseEventPayload) => void): () => void
    }
  }
}

/** Consensus price ladder for Chayuan AI Office (fen). Display only. */
const TIERS: Array<{ id: 'month' | 'quarter' | 'half' | 'year'; priceFen: number; recommended?: boolean }> = [
  { id: 'month', priceFen: 9900 },
  { id: 'quarter', priceFen: 23900 },
  { id: 'half', priceFen: 39900 },
  { id: 'year', priceFen: 69900, recommended: true },
]

/** Activation failures collapse into four user-facing buckets. */
function reasonKey(reason: string): string {
  switch (reason) {
    case 'signature':
      return 'purchaseReasonMismatch'
    case 'module':
    case 'kind':
      return 'purchaseReasonNotApplicable'
    case 'unknown-key':
    case 'keys_not_configured':
    case 'unavailable':
      return 'purchaseReasonUnavailable'
    default:
      return 'purchaseReasonInvalid'
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface PurchaseSnapshotLite {
  fingerprint: string
  freeDaysLeft: number
  entitled: boolean
  expireAt: string | null
  serialMasked: string | null
  keyConfigured: boolean
}

function snapshotBridge(): Promise<PurchaseSnapshotLite> | null {
  const bridge = window.chatOfficePurchase
  if (!bridge) return null
  return bridge.state().then((s) => ({
    fingerprint: s.fingerprint,
    freeDaysLeft: s.freeDaysLeft,
    entitled: s.entitled,
    expireAt: s.expireAt,
    serialMasked: s.serialMasked,
    keyConfigured: s.keyConfigured,
  }))
}

export function openPurchaseDialog(): void {
  window.dispatchEvent(new CustomEvent(PURCHASE_OPEN_EVENT))
}

export function PurchaseModal() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<PurchaseSnapshotLite | null>(null)
  const [serial, setSerial] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    const next = snapshotBridge()
    if (next instanceof Promise) void next.then(setState).catch(() => setState(null))
    else setState(null)
  }, [])

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(PURCHASE_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(PURCHASE_OPEN_EVENT, onOpen)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    refresh()
    setResult(null)
    // Same editor-view yielding contract as the settings funnel (Home's
    // useShellModalSurface): without this the dialog paints UNDER the
    // covering editor WebContentsView.
    document.documentElement.classList.add('chatoffice-shell-modal')
    if ('chatOfficeTabs' in window) void window.chatOfficeTabs.setShellModalOpen(true)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.documentElement.classList.remove('chatoffice-shell-modal')
      if ('chatOfficeTabs' in window) void window.chatOfficeTabs.setShellModalOpen(false)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, refresh])

  if (!open) return null

  const bridge = window.chatOfficePurchase
  const entitled = state?.entitled === true

  const copyFingerprint = async () => {
    if (!state?.fingerprint) return
    try {
      await navigator.clipboard.writeText(state.fingerprint)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable: the code stays selectable
    }
  }

  const activate = async () => {
    const trimmed = serial.trim()
    if (!bridge || !trimmed || busy) return
    setBusy(true)
    setResult(null)
    try {
      const r = await bridge.activate(trimmed)
      if (r.ok) {
        setResult({ ok: true, text: t('purchaseActivateOk', { date: fmtDate(r.expireAt) }) })
        setSerial('')
        refresh()
      } else {
        setResult({ ok: false, text: t(reasonKey(r.reason) as Parameters<typeof t>[0]) })
      }
    } catch {
      setResult({ ok: false, text: t('purchaseReasonUnavailable') })
    } finally {
      setBusy(false)
    }
  }

  const statusLine = !bridge
    ? t('purchaseUnavailable' as Parameters<typeof t>[0])
    : entitled
      ? t('purchaseEntitledUntil' as Parameters<typeof t>[0], { date: fmtDate(state?.expireAt ?? null) })
      : state && state.freeDaysLeft > 0
        ? t('purchaseFreeLeft' as Parameters<typeof t>[0], { n: state.freeDaysLeft })
        : t('purchaseExpired' as Parameters<typeof t>[0])

  return (
    <div className="purchase-overlay" onMouseDown={() => setOpen(false)} data-purchase-dialog>
      <div className="purchase-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="purchase-header">
          <h3 className="purchase-title" data-purchase-title>
            {t('purchaseTitle')}
          </h3>
          <button className="purchase-close" onClick={() => setOpen(false)} data-purchase-close>
            {t('purchaseClose')}
          </button>
        </div>

        <div className="purchase-body">
          <p className={`purchase-status${entitled ? ' purchase-status-ok' : ''}`} data-purchase-status>
            {statusLine}
          </p>

          <p className="purchase-section-title">{t('purchaseTiersTitle')}</p>
          <div className="purchase-tiers" data-purchase-tiers>
            {TIERS.map((tier) => (
              <div key={tier.id} className={`purchase-tier${tier.recommended ? ' purchase-tier-hot' : ''}`} data-purchase-tier={tier.id}>
                {tier.recommended && <span className="purchase-tier-badge">{t('purchaseRecommended')}</span>}
                <span className="purchase-tier-name">{t(`purchaseTier${tier.id.charAt(0).toUpperCase()}${tier.id.slice(1)}` as 'purchaseTierMonth')}</span>
                <span className="purchase-tier-price">¥{tier.priceFen / 100}</span>
              </div>
            ))}
          </div>

          <p className="purchase-section-title">{t('purchasePayTitle')}</p>
          <div className="purchase-qr-row">
            <div className="purchase-qr">
              <img src={wxpayQr} alt={t('purchasePayWechat')} width={110} height={110} draggable={false} />
              <span>{t('purchasePayWechat')}</span>
            </div>
            <div className="purchase-qr">
              <img src={alipayQr} alt={t('purchasePayAlipay')} width={110} height={110} draggable={false} />
              <span>{t('purchasePayAlipay')}</span>
            </div>
          </div>

          <div className="purchase-fingerprint" data-purchase-fingerprint>
            <span className="purchase-fingerprint-label">{t('purchaseFingerprint')}</span>
            <code data-purchase-fingerprint-code>{state?.fingerprint ?? '—'}</code>
            <button className="purchase-copy" onClick={() => void copyFingerprint()} data-purchase-fp-copy>
              {copied ? t('purchaseCopied') : t('purchaseCopy')}
            </button>
          </div>

          <p className="purchase-section-title">{t('purchaseSerialTitle')}</p>
          <div className="purchase-serial-row">
            <input
              ref={inputRef}
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void activate()
              }}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXX"
              spellCheck={false}
              className="purchase-serial-input"
              data-purchase-serial-input
            />
            <button className="purchase-activate" onClick={() => void activate()} disabled={busy || !serial.trim()} data-purchase-activate>
              {busy ? t('purchaseActivating') : t('purchaseActivate')}
            </button>
          </div>
          {result && (
            <p className={`purchase-result${result.ok ? ' purchase-result-ok' : ''}`} data-purchase-result>
              {result.text}
            </p>
          )}

          <div className="purchase-guide">
            <button className="purchase-guide-toggle" onClick={() => setGuideOpen((v) => !v)} data-purchase-guide-toggle>
              {t('purchaseGuideTitle')}
            </button>
            {guideOpen && (
              <div className="purchase-guide-body" data-purchase-guide-body>
                {t('purchaseGuideBody')}
                {'\n'}
                {t('purchaseContact')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
