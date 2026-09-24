import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { useI18n } from '../locale'
import { pickWelcomePrompt } from './welcome-prompts'
import {
  WELCOME_PLAZA_BADGES_KEY,
  WELCOME_PLAZA_DESC_KEY,
  WELCOME_PLAZA_NAME_KEY,
  WELCOME_PLAZA_URL,
  WELCOME_PRODUCTS,
} from './welcome-products'

/** the landing screen's product-family showcase. Owns the greeting (moved
 * here from ChatPanel), the typing sub-greeting, the five product cards and
 * the plaza banner. The landing footer (QR codes + star) stays in ChatPanel
 * so the exiting fade can be driven by the same landingPhase state. */

/** typing animation plays once per app run: repeat landings (new session,
 * switching back to an empty one) show the full line immediately */
let typedOnce = false

function WelcomeIcon({ id }: { id: string }): ReactElement {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': true as const,
  }
  if (id === 'os') {
    return (
      <svg {...common}>
        <rect
          x="2"
          y="2.5"
          width="12"
          height="8.5"
          rx="1.2"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path
          d="M5.5 13.8h5M8 11v2.8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (id === 'office') {
    return (
      <svg {...common}>
        <path
          d="M3 2.5h7l3 3v8a1 1 0 0 1-1 1H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M10 2.5v3h3M5 8h5M5 10.5h3.5"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (id === 'assistant') {
    return (
      <svg {...common}>
        <path
          d="M3.5 1.8h6l3.2 3.2v9.2H3.5z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M9.5 1.8V5h3.2" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        <path
          d="M5.6 9.2l1.7 1.7 3.2-3.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (id === 'pod') {
    return (
      <svg {...common}>
        <path
          d="M4.4 11.5h7.1a2.9 2.9 0 0 0 .5-5.77A4.1 4.1 0 0 0 4.2 5.1a3.2 3.2 0 0 0 .2 6.4z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M5.8 8.6h1.4M8.8 8.6h1.4M5.8 10.3h1.4M8.8 10.3h1.4"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (id === 'cmd') {
    return (
      <svg {...common}>
        <circle cx="3.4" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="12.4" cy="6.4" r="1.5" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="5.6" cy="12.2" r="1.5" stroke="currentColor" strokeWidth="1.2" />
        <path
          d="M4.8 4.7l6.2 1M4.4 5.4l.8 5.3M11 7.8l-4.3 3.3"
          stroke="currentColor"
          strokeWidth="1.1"
        />
      </svg>
    )
  }
  // plaza globe
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M2 8h12M8 2c-2.6 1.9-2.6 10.2 0 12M8 2c2.6 1.9 2.6 10.2 0 12"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  )
}

export function WelcomeLanding({
  accountName,
  exiting,
}: {
  accountName: string
  /** true while the domino exit plays: the message list is already visible
   * underneath and the landing unmounts when the animation finishes */
  exiting: boolean
}): ReactElement {
  const { t, lang } = useI18n()

  // time-of-day greeting (unchanged behavior, relocated from ChatPanel)
  const hour = new Date().getHours()
  const greetKey =
    hour < 6
      ? 'greetEvening'
      : hour < 12
        ? 'greetMorning'
        : hour < 18
          ? 'greetAfternoon'
          : 'greetEvening'
  const cjk = lang === 'zh' || lang === 'zh-TW' || lang === 'ja'
  const greeting = `${t(greetKey)}${accountName ? (cjk ? '，' : ', ') + accountName : ''}${cjk ? '。' : '. '}`

  // combo sub-greeting + first-run-only streaming reveal. t is a fresh closure
  // per render, so the memo keys on lang: one pick per landing, re-picked on
  // language switch (the already-streamed line then snaps to the new language)
  const prompt = useMemo(
    () => pickWelcomePrompt(t),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang],
  )
  const [typed, setTyped] = useState(() => (typedOnce ? prompt : ''))
  useEffect(() => {
    if (typedOnce) setTyped(prompt)
  }, [prompt])
  useEffect(() => {
    if (typedOnce || exiting) return
    // AI-reply-style streaming: characters flow out linearly over ~1.6s
    // (no caret — the motion itself signals the line is live). The once-flag
    // is set only when the line fully streamed: StrictMode's double mount
    // cancels (not completes) the first run, so the remount restarts the
    // stream instead of skipping it and dumping the full text at once.
    let raf = 0
    const start = performance.now()
    const perChar = Math.max(16, Math.round(1600 / Math.max(1, prompt.length)))
    const step = (now: number) => {
      const count = Math.min(prompt.length, Math.floor((now - start) / perChar))
      setTyped(prompt.slice(0, count))
      if (count < prompt.length) {
        raf = requestAnimationFrame(step)
        return
      }
      typedOnce = true
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [prompt, exiting])

  // "coming soon" toast for the unbuilt platform card
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const openExternal = (url: string) => {
    void window.chatOffice.openExternal?.(url)
  }

  const onCardClick = (id: string, url: string | null) => {
    if (!url) {
      const product = WELCOME_PRODUCTS.find((p) => p.id === id)
      setToast(t('welcomeSoonToast', { name: t(product?.nameKey ?? 'welcomeCmdName') }))
      return
    }
    openExternal(url)
  }

  return (
    <div className={`chat-landing welcome${exiting ? ' exiting' : ''}`}>
      <h1 className="chat-greet">
        {greeting}
        <span className="welcome-sub">{typed}</span>
      </h1>

      <div className="welcome-cards">
        {WELCOME_PRODUCTS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`welcome-card${p.soon ? ' soon' : ''}`}
            data-id={p.id}
            onClick={() => onCardClick(p.id, p.url)}
          >
            <span className="welcome-card-icon">
              <WelcomeIcon id={p.id} />
            </span>
            <span className="welcome-card-name">{t(p.nameKey)}</span>
            <span className="welcome-card-desc">{t(p.descKey)}</span>
            <span className="welcome-card-chips">
              {t(p.chipsKey)
                .split('|')
                .map((chip) => (
                  <span key={chip} className="welcome-chip">
                    {chip}
                  </span>
                ))}
            </span>
            {p.soon && <span className="welcome-card-soon">{t('welcomeSoonBadge')}</span>}
          </button>
        ))}

        {/* 第六卡：察元AI智能广场（2026-09-23 共识：六卡同构同尺寸，徽章降级为 chips，整卡可点） */}
        <button
          type="button"
          className="welcome-card plaza"
          onClick={() => openExternal(WELCOME_PLAZA_URL)}
        >
          <span className="welcome-card-icon">
            <WelcomeIcon id="plaza" />
          </span>
          <span className="welcome-card-name">{t(WELCOME_PLAZA_NAME_KEY)}</span>
          <span className="welcome-card-desc">{t(WELCOME_PLAZA_DESC_KEY)}</span>
          <span className="welcome-card-chips">
            {t(WELCOME_PLAZA_BADGES_KEY)
              .split('|')
              .map((badge, i) => (
                <span key={badge} className={`welcome-chip pb${i}`}>
                  {badge}
                </span>
              ))}
          </span>
          <span className="welcome-card-go" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <path
                d="M2.5 6h7M6.5 2.5L10 6l-3.5 3.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>
      </div>

      {toast && (
        <div className="welcome-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
