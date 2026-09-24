import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useI18n } from './locale'
import './purchase.css'

/**
 * Purchase / license dialog (LOCAL feature, B-zone), mirroring the
 * chayuan-desktop-own LicenseDialog flow. Opened by the
 * `chatoffice-purchase-open` window event, which the main-process scheduler
 * (via PurchaseToast) and the toast click funnel into — the shell has no
 * other purchase entry on purpose.
 *
 * Content: status line; a locally generated QR of the buy page
 * ({base}/buy?app=office&mid={fingerprint}) — the phone picks the tier and
 * pays there, so NO prices or tiers live in this client — plus a share tab
 * ({base}/share?mid={fp}), open-in-browser and copy-link affordances, the
 * machine fingerprint with copy, and the serial activation form. The serial
 * the buy page hands back after payment is verified locally in the main
 * process (main/purchase.ts); its module bitmap + duration tell the user
 * what they bought (office bit = this app, OS bit = one-way coverage).
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
  buyUrl: string
  shareUrl: string
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
    buyUrl: s.buyUrl,
    shareUrl: s.shareUrl,
  }))
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
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
  const [qrTab, setQrTab] = useState<'buy' | 'share'>('buy')
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState<'fp' | 'link' | null>(null)
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

  // Local QR generation (same as the reference LicenseDialog): the code is
  // just the buy/share URL, rendered to a data URL entirely offline.
  const activeUrl = qrTab === 'buy' ? state?.buyUrl : state?.shareUrl
  useEffect(() => {
    if (!open || !activeUrl) {
      setQr('')
      return undefined
    }
    let alive = true
    QRCode.toDataURL(activeUrl, { margin: 1, width: 220 })
      .then((dataUrl) => {
        if (alive) setQr(dataUrl)
      })
      .catch(() => {
        if (alive) setQr('')
      })
    return () => {
      alive = false
    }
  }, [open, activeUrl])

  useEffect(() => {
    if (!open) return undefined
    refresh()
    setResult(null)
    setQrTab('buy')
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

  const flashCopied = (what: 'fp' | 'link') => {
    setCopied(what)
    setTimeout(() => setCopied(null), 1500)
  }

  const copyFingerprint = async () => {
    if (!state?.fingerprint) return
    if (await copyText(state.fingerprint)) flashCopied('fp')
  }

  const copyActiveLink = async () => {
    if (!activeUrl) return
    if (await copyText(activeUrl)) flashCopied('link')
  }

  const openInBrowser = () => {
    if (!activeUrl) return
    void window.chatOffice?.openExternal?.(activeUrl)
  }

  const grantText = (modules: number, days: number): string => {
    const product =
      modules & (1 << 12) ? t('purchaseProductOffice') : modules & (1 << 11) ? t('purchaseProductOs') : ''
    return product ? `${product} · ${t('purchaseGrantRenew', { n: days })}` : t('purchaseGrantRenew', { n: days })
  }

  const activate = async () => {
    const trimmed = serial.trim()
    if (!bridge || !trimmed || busy) return
    setBusy(true)
    setResult(null)
    try {
      const r = await bridge.activate(trimmed)
      if (r.ok) {
        // The serial itself tells what was bought: module bitmap + duration.
        setResult({
          ok: true,
          text: `${t('purchaseActivateOk', { date: fmtDate(r.expireAt) })} · ${grantText(r.modules, r.days)}`,
        })
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
    ? t('purchaseUnavailable')
    : entitled
      ? t('purchaseEntitledUntil', { date: fmtDate(state?.expireAt ?? null) })
      : state && state.freeDaysLeft > 0
        ? t('purchaseFreeLeft', { n: state.freeDaysLeft })
        : t('purchaseExpired')

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

          <div className="purchase-qr-tabs" role="tablist" data-purchase-tabs>
            <button
              role="tab"
              aria-selected={qrTab === 'buy'}
              className={`purchase-qr-tab${qrTab === 'buy' ? ' purchase-qr-tab-active' : ''}`}
              onClick={() => setQrTab('buy')}
              data-purchase-tab="buy"
            >
              {t('purchaseTabBuy')}
            </button>
            <button
              role="tab"
              aria-selected={qrTab === 'share'}
              className={`purchase-qr-tab${qrTab === 'share' ? ' purchase-qr-tab-active' : ''}`}
              onClick={() => setQrTab('share')}
              data-purchase-tab="share"
            >
              {t('purchaseTabShare')}
            </button>
          </div>

          <div className="purchase-qr-row">
            {qr ? (
              <img
                className="purchase-qr-img"
                src={qr}
                alt={qrTab === 'buy' ? t('purchaseTabBuy') : t('purchaseTabShare')}
                width={220}
                height={220}
                draggable={false}
                data-purchase-qr
              />
            ) : (
              <div className="purchase-qr-placeholder" data-purchase-qr-placeholder />
            )}
            <span className="purchase-qr-caption" data-purchase-qr-caption>
              {qrTab === 'buy' ? t('purchaseScanCaption') : t('purchaseShareCaption')}
            </span>
          </div>

          <div className="purchase-link-row">
            <button className="purchase-copy" onClick={() => void openInBrowser()} data-purchase-open-link>
              {t('purchaseOpenInBrowser')}
            </button>
            <button className="purchase-copy" onClick={() => void copyActiveLink()} data-purchase-copy-link>
              {copied === 'link' ? t('purchaseCopied') : t('purchaseCopyLink')}
            </button>
          </div>

          <div className="purchase-fingerprint" data-purchase-fingerprint>
            <span className="purchase-fingerprint-label">{t('purchaseFingerprint')}</span>
            <code data-purchase-fingerprint-code>{state?.fingerprint ?? '—'}</code>
            <button className="purchase-copy" onClick={() => void copyFingerprint()} data-purchase-fp-copy>
              {copied === 'fp' ? t('purchaseCopied') : t('purchaseCopy')}
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
