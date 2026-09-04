import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useI18n } from '../locale'
import type { HomeChatMessage } from '../../../shared/home-api'

/**
 * TurnNavigator — the left tick rail (ZCode-style "conversation query map").
 *
 * One tick per real user query; hovering a tick grows it (fisheye) and shows
 * a tooltip with the question (2 lines) and the assistant's answer preview
 * (3 lines); clicking smooth-scrolls the transcript to that query. The tick
 * nearest the viewport top is highlighted while scrolling. Hidden below 2
 * queries or when the transcript is narrower than 600px.
 */

export interface TurnNavEntry {
  /** the user message's id (also the scroll anchor via [data-mid]) */
  key: string
  userPreview: string
  assistantPreview: string
  /** 'running' = the answering turn is still streaming with no text yet */
  assistantState: 'text' | 'running' | 'empty'
}

const PREVIEW_CHARS = 220
const PREVIEW_PARAGRAPHS = 2

/** markdown/HTML → plain text (display-only; DOMParser loads nothing) */
export function toPlainText(text: string): string {
  const s = text.trim()
  if (!s) return ''
  if (s.startsWith('<')) {
    // block ends become paragraph breaks before the text-only extraction
    const withBreaks = s.replace(/<\/(p|h[1-3]|li|blockquote|pre|tr)>/gi, '$&\n\n')
    const body = new DOMParser().parseFromString(withBreaks, 'text/html').body
    return (body.textContent ?? '').replace(/[^\S\n]+/g, ' ').trim()
  }
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-+*]\s+/gm, '')
    .replace(/[*_~>#]+/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .trim()
}

/** ZCode-style preview: first paragraphs (split before collapsing), hard-truncated */
function previewOf(text: string, fallback: string): string {
  const raw = text.trim()
  if (!raw) return fallback
  const paras = raw
    .split(/\n\s*\n/)
    .map((p) => toPlainText(p))
    .filter(Boolean)
    .slice(0, PREVIEW_PARAGRAPHS)
  if (paras.length === 0) return fallback
  const joined = paras.join('\n')
  return joined.length > PREVIEW_CHARS
    ? `${joined.slice(0, PREVIEW_CHARS - 3).trimEnd()}...`
    : joined
}

/** pair every user message with the assistant reply that answers it */
export function deriveTurnNavEntries(
  messages: HomeChatMessage[],
  busy: boolean,
  userFallback: string,
): TurnNavEntry[] {
  const entries: TurnNavEntry[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!
    if (m.role !== 'user') continue
    let assistant: HomeChatMessage | null = null
    for (let j = i + 1; j < messages.length; j++) {
      const next = messages[j]!
      if (next.role === 'user') break
      if (next.role === 'assistant') {
        assistant = next
        break
      }
    }
    const isRunningTurn = busy && assistant !== null && messages[messages.length - 1] === assistant
    const hasText = Boolean(assistant && assistant.text && !assistant.error)
    entries.push({
      key: m.id,
      userPreview: previewOf(m.text, userFallback),
      assistantPreview: hasText ? previewOf(assistant!.text, '') : '',
      assistantState: hasText ? 'text' : isRunningTurn ? 'running' : 'empty',
    })
  }
  return entries
}

/** fisheye: hovered tick peaks, neighbors attenuate (mirrors ZCode's阶梯) */
function visualTone(
  index: number,
  hover: number | null,
  active: number,
): { scale: number; opacity: number; solid: boolean } {
  if (hover == null)
    return { scale: 1, opacity: index === active ? 0.9 : 0.58, solid: index === active }
  const d = Math.abs(index - hover)
  if (d === 0) return { scale: 2.6, opacity: 1, solid: true }
  if (d === 1) return { scale: 1.7, opacity: 0.86, solid: false }
  if (d === 2) return { scale: 1.25, opacity: 0.72, solid: false }
  return { scale: 1, opacity: 0.58, solid: false }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    onChange()
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

export function TurnNavigator({
  entries,
  listEl,
}: {
  entries: TurnNavEntry[]
  /** the scrolling transcript element (anchor lookups + scroll driving) */
  listEl: HTMLDivElement | null
}): ReactElement | null {
  const { t } = useI18n()
  const [hover, setHover] = useState<number | null>(null)
  const [active, setActive] = useState(0)
  const [narrow, setNarrow] = useState(false)
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null)
  const reduced = usePrefersReducedMotion()
  const stripRef = useRef<HTMLDivElement>(null)
  const tickRefs = useRef<Array<HTMLButtonElement | null>>([])

  // width watch: hide on narrow transcripts (three-pane squeezes the middle)
  useEffect(() => {
    if (!listEl || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setNarrow(listEl.clientWidth < 600))
    ro.observe(listEl)
    return () => ro.disconnect()
  }, [listEl])

  // active tick = the last query whose anchor sits above ~96px from the top
  useEffect(() => {
    if (!listEl) return
    let raf = 0
    const update = () => {
      raf = 0
      const listTop = listEl.getBoundingClientRect().top
      let current = 0
      for (let i = 0; i < entries.length; i++) {
        const anchor = listEl.querySelector(`[data-mid="${entries[i]!.key}"]`)
        if (!anchor) continue
        if (anchor.getBoundingClientRect().top - listTop <= 96) current = i
        else break
      }
      setActive(current)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    listEl.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      listEl.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [entries, listEl])

  // keep the active tick inside the strip's view (ZCode scrollToIndex)
  useLayoutEffect(() => {
    const strip = stripRef.current
    const btn = tickRefs.current[active]
    if (!strip || !btn || strip.scrollHeight <= strip.clientHeight) return
    const top = btn.offsetTop
    if (
      top < strip.scrollTop + 8 ||
      top + btn.offsetHeight > strip.scrollTop + strip.clientHeight - 8
    ) {
      strip.scrollTop = top - strip.clientHeight / 2
    }
  }, [active, entries.length])

  // tooltip placement: fixed, right of the tick, viewport-clamped
  useEffect(() => {
    if (hover == null) {
      setTipPos(null)
      return
    }
    const place = () => {
      const btn = tickRefs.current[hover] ?? null
      if (!btn) return
      const r = btn.getBoundingClientRect()
      setTipPos({
        left: Math.max(8, Math.min(r.right + 8, window.innerWidth - 336)),
        top: Math.max(8, Math.min(r.top - 8, window.innerHeight - 136)),
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [hover])

  const jumpTo = useCallback(
    (entry: TurnNavEntry) => {
      if (!listEl) return
      const anchor = listEl.querySelector(`[data-mid="${entry.key}"]`)
      if (!anchor) return
      const top =
        anchor.getBoundingClientRect().top -
        listEl.getBoundingClientRect().top +
        listEl.scrollTop -
        12
      listEl.scrollTo({ top: Math.max(0, top), behavior: reduced ? 'auto' : 'smooth' })
    },
    [listEl, reduced],
  )

  if (entries.length < 2 || narrow) return null

  const hovered = hover != null ? entries[hover] : null
  const assistantLine = hovered
    ? hovered.assistantState === 'text'
      ? hovered.assistantPreview
      : hovered.assistantState === 'running'
        ? t('chatNavRunning')
        : t('chatNavNoAssistant')
    : ''

  return (
    <nav className="chat-turn-nav" aria-label={t('chatNavLabel')}>
      <div className="chat-turn-strip" ref={stripRef} onPointerLeave={() => setHover(null)}>
        {entries.map((e, i) => {
          const tone = visualTone(i, hover, active)
          return (
            <button
              key={e.key}
              type="button"
              ref={(el) => {
                tickRefs.current[i] = el
              }}
              className="chat-turn-tick"
              aria-label={t('chatNavJump', { index: i + 1 })}
              aria-current={i === active ? 'location' : undefined}
              data-active={i === active ? 'true' : 'false'}
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover((cur) => (cur === i ? null : cur))}
              onClick={() => jumpTo(e)}
            >
              <span
                className="chat-turn-bar"
                style={{
                  opacity: tone.opacity,
                  transform: `scaleX(${tone.scale})`,
                  backgroundColor: tone.solid ? 'var(--text)' : 'var(--text-muted)',
                }}
              />
            </button>
          )
        })}
      </div>
      {hovered && tipPos && (
        <div
          className="chat-turn-tip"
          role="tooltip"
          style={{ left: tipPos.left, top: tipPos.top }}
        >
          <p className="chat-turn-tip-user">{hovered.userPreview}</p>
          <p
            className={`chat-turn-tip-assistant${hovered.assistantState === 'text' ? '' : ' muted'}`}
          >
            {assistantLine}
          </p>
        </div>
      )}
    </nav>
  )
}
