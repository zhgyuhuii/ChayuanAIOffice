/**
 * Account pane of the settings modal (LOCAL): WeChat scan-code login backed by
 * the aidooo.com website. This fills the previously-blank section behind the
 * bottom-left 「账户」 button. Flow mirrors the website's WxLoginModal:
 * qr-start → 2s poll loop → ok / expired; the 公众号 scene-QR mode enforces
 * "follow the official account to sign in" server-side, the pane only shows
 * the matching hint per mode. Fresh accounts carry an anonymous nickname, so
 * the signed-in view offers the snsapi_userinfo "complete profile" QR and
 * auto-refreshes the session while it stays incomplete.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WxLoginQr } from '../../../shared/home-api'
import { useI18n } from '../locale'
import { refreshWxAccount, useWxAccount, useWxAccountResolved } from './useWxAccount'
import './account-pane.css'

type LoginPhase = 'idle' | 'qr' | 'expired' | 'error'

const POLL_INTERVAL_MS = 2_000
/** server ticket TTL is 10 min; give up slightly earlier like the website modal */
const QR_WINDOW_MS = 9 * 60 * 1000
/** while the profile is incomplete, re-check /me at this cadence (bounded) */
const PROFILE_REFRESH_MS = 3_000
const PROFILE_REFRESH_WINDOW_MS = 5 * 60 * 1000

/** WeChat double-bubble glyph (same path the website login modal uses) */
function WechatGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
      <path d="M8.69 3.5C4.98 3.5 2 6.05 2 9.2c0 1.77.95 3.35 2.44 4.4l-.61 1.9 2.2-1.13c.53.15 1.1.23 1.66.25a5.6 5.6 0 0 1-.13-1.2c0-3.04 2.9-5.5 6.47-5.5.22 0 .43.01.64.03C14.63 5.5 11.97 3.5 8.69 3.5zm-2.4 3.1a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8zm4.57 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8zM14.4 8.8c-3.2 0-5.8 2.13-5.8 4.76 0 2.63 2.6 4.76 5.8 4.76.48 0 .95-.05 1.4-.15l1.9.97-.53-1.63c1.3-.87 2.13-2.24 2.13-3.95 0-2.63-2.7-4.76-4.9-4.76zm-1.85 2.5a.78.78 0 1 1 0 1.56.78.78 0 0 1 0-1.56zm3.7 0a.78.78 0 1 1 0 1.56.78.78 0 0 1 0-1.56z" />
    </svg>
  )
}

export function AccountPane() {
  const { t } = useI18n()
  const wx = useWxAccount()
  const resolved = useWxAccountResolved()
  const [phase, setPhase] = useState<LoginPhase>('idle')
  const [qr, setQr] = useState<WxLoginQr | null>(null)
  const [starting, setStarting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [profileQr, setProfileQr] = useState('')
  const pollTimer = useRef<number | null>(null)
  const startedAt = useRef(0)
  const profileTimer = useRef<number | null>(null)
  /** consecutive poll failures — surfaced once they stop looking transient */
  const pollErrors = useRef(0)

  const stopPoll = useCallback((): void => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  const stopProfileRefresh = useCallback((): void => {
    if (profileTimer.current !== null) {
      window.clearInterval(profileTimer.current)
      profileTimer.current = null
    }
  }, [])

  useEffect(() => {
    void refreshWxAccount(true)
    return () => {
      stopPoll()
      stopProfileRefresh()
    }
  }, [stopPoll, stopProfileRefresh])

  const start = useCallback(async (): Promise<void> => {
    stopPoll()
    setPhase('qr')
    setQr(null)
    setErrorMsg('')
    setStarting(true)
    try {
      const data = await window.chaOffice.wxQrStart()
      setQr(data)
      startedAt.current = Date.now()
      pollTimer.current = window.setInterval(() => {
        if (Date.now() - startedAt.current > QR_WINDOW_MS) {
          stopPoll()
          setPhase('expired')
          return
        }
        void window.chaOffice
          .wxPoll(data.state)
          .then((res) => {
            pollErrors.current = 0
            if (res.status === 'ok') {
              stopPoll()
              void refreshWxAccount(true)
            } else if (res.status === 'expired') {
              stopPoll()
              setPhase('expired')
            } else if (res.status === 'error') {
              // server-side rejection (bad state, outdated server without the
              // token field …) — stop polling and show it instead of silently
              // spinning until the window expires
              stopPoll()
              setErrorMsg(res.error)
              setPhase('error')
            }
            // pending keeps polling
          })
          .catch((e: unknown) => {
            // transient network errors keep polling, but persistent failures
            // (wrong/unreachable service) must become visible
            pollErrors.current += 1
            if (pollErrors.current >= 5) {
              stopPoll()
              setErrorMsg(e instanceof Error ? e.message : String(e))
              setPhase('error')
            }
          })
      }, POLL_INTERVAL_MS)
    } catch (e) {
      setPhase('error')
      setErrorMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }, [stopPoll])

  // the QR shows by default: once the session check answered "logged out",
  // start the scan flow immediately — no extra click (website modal behaviour).
  // Re-fires after logout so a fresh QR is always ready.
  useEffect(() => {
    if (resolved && !wx.loggedIn) void start()
  }, [resolved, wx.loggedIn, start])

  // became logged in mid-flow (scan landed / session restored): stop any
  // orphaned poll loop — the profile view takes over
  useEffect(() => {
    if (wx.loggedIn) stopPoll()
  }, [wx.loggedIn, stopPoll])

  const logout = useCallback(async (): Promise<void> => {
    await window.chaOffice.wxLogout()
    setPhase('idle')
    setProfileQr('')
    await refreshWxAccount(true)
  }, [])

  // signed in with an anonymous profile → show the complete-profile QR and
  // poll /me for a while so the pane updates as soon as the user authorizes
  useEffect(() => {
    if (!wx.loggedIn || !wx.profileIncomplete) {
      stopProfileRefresh()
      return
    }
    void window.chaOffice.wxProfileQr().then((data) => {
      if (data) setProfileQr(data)
    })
    const deadline = Date.now() + PROFILE_REFRESH_WINDOW_MS
    profileTimer.current = window.setInterval(() => {
      if (Date.now() > deadline) {
        stopProfileRefresh()
        return
      }
      void refreshWxAccount(true)
    }, PROFILE_REFRESH_MS)
    return stopProfileRefresh
  }, [wx.loggedIn, wx.profileIncomplete, stopProfileRefresh])

  const nickname = wx.user?.nickname || ''

  return (
    <>
      <h3 className="set-pane-title">{t('setSecAccount')}</h3>
      <p className="set-pane-desc">{t('acWxDesc')}</p>
      <div className="acx">
        {!wx.loggedIn ? (
          <>
            <div className="acx-logo" aria-hidden="true">
              <WechatGlyph />
            </div>
            {phase === 'idle' && (
              <button type="button" className="acx-btn" onClick={() => void start()} disabled={starting}>
                {t('acWxLoginBtn')}
              </button>
            )}
            {phase === 'qr' && (
              <div className="acx-qrbox">
                {qr?.qrDataUrl ? (
                  <img className="acx-qr" src={qr.qrDataUrl} alt={t('acWxTitle')} />
                ) : (
                  <div className="acx-qr-placeholder">{t('acWxWaiting')}</div>
                )}
                <p className="acx-hint">{t('acWxQrHint')}</p>
                <p className="acx-hint acx-hint-follow">
                  {qr?.mode === 'qrconnect' ? t('acWxQrHintConfirm') : t('acWxQrHintFollow')}
                </p>
                <p className="acx-waiting">{t('acWxWaiting')}</p>
              </div>
            )}
            {phase === 'expired' && (
              <div className="acx-qrbox">
                <div className="acx-qr-placeholder acx-qr-expired">{t('acWxExpired')}</div>
                <button type="button" className="acx-btn" onClick={() => void start()}>
                  {t('acWxRetry')}
                </button>
              </div>
            )}
            {phase === 'error' && (
              <div className="acx-qrbox">
                <p className="acx-error">{errorMsg || t('acWxError')}</p>
                <button type="button" className="acx-btn" onClick={() => void start()}>
                  {t('acWxRetryAction')}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="acx-profile">
              {wx.avatarDataUrl ? (
                <img className="acx-avatar" src={wx.avatarDataUrl} alt="" />
              ) : (
                <span className="acx-avatar acx-avatar-letter" aria-hidden="true">
                  {nickname.slice(0, 1).toUpperCase() || '?'}
                </span>
              )}
              <span className="acx-profile-text">
                <span className="acx-name">{nickname || t('acWxLoggedInAs')}</span>
                <span className="acx-sub">
                  {t('acWxWechat')}
                  {wx.user?.loginCount ? ` · ${t('acWxLoginCount', { n: wx.user.loginCount })}` : ''}
                </span>
              </span>
              <button type="button" className="acx-btn-secondary" onClick={() => void logout()}>
                {t('acWxLogout')}
              </button>
            </div>
            {wx.profileIncomplete && (
              <div className="acx-complete">
                <h4 className="acx-complete-title">{t('acWxComplete')}</h4>
                <p className="acx-hint">{t('acWxCompleteDesc')}</p>
                {profileQr ? (
                  <img className="acx-qr acx-qr-small" src={profileQr} alt={t('acWxComplete')} />
                ) : (
                  <div className="acx-qr-placeholder acx-qr-small">{t('acWxWaiting')}</div>
                )}
                <button
                  type="button"
                  className="acx-btn-secondary"
                  onClick={() => void refreshWxAccount(true)}
                >
                  {t('acWxRefresh')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
