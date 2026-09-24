import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useDismissablePopover } from '@chatoffice/ui'
import {
  DOC_ASSISTANT_DOMAINS,
  DOC_ASSISTANT_TOTAL,
  allAssistantsLoaded,
  findById,
  flattenByManifest,
  getDomainAssistants,
  loadAllAssistants,
  matchAssistant,
  type DocAssistant,
} from '../../../../../docs/src/renderer/ai/assistants'
import { useI18n } from '../locale'

/**
 * 首页助手选择器：把 4576 个领域助手库接进中栏对话。与 docs 面板的
 * AssistantBrowser 同一数据源（apps/docs 的 packs，vite 按域懒加载分块），
 * 但为首页 composer 定制：分组优先浏览 + 全库搜索 + 最近使用，选中即把
 * 助手人设挂到当前会话（persona 经 controller 的 systemSuffix 生效）。
 */
const RECENTS_KEY = 'chatoffice.assistantRecents'
const RECENTS_MAX = 8
/** search result cap — 4.6k rows would jank the popover */
const SEARCH_RESULTS_MAX = 60

interface RecentsInfo {
  icon: string
  label: string
  id: string
}

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, RECENTS_MAX)
  } catch {
    return []
  }
}

function saveRecents(ids: string[]): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(ids.slice(0, RECENTS_MAX)))
  } catch {
    // best-effort persistence
  }
}

function AssistantRow({
  a,
  onPick,
}: {
  a: DocAssistant
  onPick: (a: DocAssistant) => void
}): ReactElement {
  return (
    <button className="chat-assistant-row" onClick={() => onPick(a)} title={a.description}>
      <span className="chat-assistant-row-icon" aria-hidden>
        {a.icon}
      </span>
      <span className="chat-assistant-row-main">
        <span className="chat-assistant-row-label">{a.label}</span>
        <span className="chat-assistant-row-desc">{a.description}</span>
      </span>
    </button>
  )
}

export function AssistantPicker({
  activeId,
  onPick,
  onClear,
}: {
  /** currently active assistant id (session-scoped); null = none */
  activeId: string | null
  onPick: (a: DocAssistant) => void
  onClear: () => void
}): ReactElement {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  /** selected domain key; null = group overview */
  const [domain, setDomain] = useState<string | null>(null)
  const [domainList, setDomainList] = useState<DocAssistant[] | null>(null)
  const [searchResults, setSearchResults] = useState<DocAssistant[] | null>(null)
  const [recents, setRecents] = useState<RecentsInfo[]>([])
  const [recentsIds, setRecentsIds] = useState<string[]>([])
  const wrapRef = useRef<HTMLSpanElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useDismissablePopover(
    open,
    () => {
      setOpen(false)
      setQuery('')
      setDomain(null)
      setDomainList(null)
      setSearchResults(null)
    },
    { inside: () => [wrapRef.current] },
  )

  useEffect(() => {
    if (!open) return
    setRecentsIds(loadRecents())
    // background-load the whole library so the search box covers everything;
    // the group grid renders instantly from the static manifest either way
    if (!allAssistantsLoaded()) void loadAllAssistants().catch(() => undefined)
    searchRef.current?.focus()
  }, [open])

  // recents need the packs: resolve each id through the loaded library once
  // it arrives (domain prefix = pack key, one small chunk per id)
  useEffect(() => {
    if (!open || recentsIds.length === 0) return
    let alive = true
    void (async () => {
      const all = await loadAllAssistants().catch(() => null)
      if (!alive || !all) return
      const flat = flattenByManifest(all)
      setRecents(
        recentsIds
          .map((id) => findById(flat, id))
          .filter((a): a is DocAssistant => !!a)
          .map((a) => ({ id: a.id, icon: a.icon, label: a.label })),
      )
    })()
    return () => {
      alive = false
    }
  }, [open, recentsIds])

  // search over the whole library (only once the background load finished)
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setSearchResults(null)
      return
    }
    let alive = true
    void loadAllAssistants()
      .then((all) => {
        if (!alive) return
        const domainLabel = new Map(DOC_ASSISTANT_DOMAINS.map((d) => [d.key, d.label]))
        const hits = flattenByManifest(all)
          .filter((a) => matchAssistant(a, domainLabel.get(a.domain) ?? '', q))
          .slice(0, SEARCH_RESULTS_MAX)
        setSearchResults(hits)
      })
      .catch(() => setSearchResults([]))
    return () => {
      alive = false
    }
  }, [open, query])

  // domain drill-in: that pack loads as its own chunk
  useEffect(() => {
    if (!open || !domain) return
    let alive = true
    setDomainList(null)
    void getDomainAssistants(domain)
      .then((list) => {
        if (alive) setDomainList(list)
      })
      .catch(() => {
        if (alive) setDomainList([])
      })
    return () => {
      alive = false
    }
  }, [open, domain])

  const pick = (a: DocAssistant) => {
    const next = [a.id, ...loadRecents().filter((id) => id !== a.id)]
    saveRecents(next)
    setRecentsIds(next)
    onPick(a)
    setOpen(false)
    setQuery('')
    setDomain(null)
    setDomainList(null)
    setSearchResults(null)
  }

  const domainInfo = domain ? DOC_ASSISTANT_DOMAINS.find((d) => d.key === domain) : null
  const searching = query.trim() !== ''

  return (
    <span className="chat-assistant-wrap" ref={wrapRef}>
      <button
        className={`chat-tool-btn chat-assistant-btn${activeId ? ' active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('chatAssistant')}
        data-tip={t('chatAssistantHint')}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8 1.5l1.3 3.2L12.5 6l-3.2 1.3L8 10.5 6.7 7.3 3.5 6l3.2-1.3L8 1.5z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path
            d="M12.5 9.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z"
            fill="currentColor"
          />
        </svg>
        <span className="chat-mode-value">{t('chatAssistant')}</span>
      </button>
      {open && (
        <div className="chat-assistant-pop" role="menu">
          <div className="chat-assistant-search">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4.4" stroke="currentColor" strokeWidth="1.3" />
              <path
                d="M10.4 10.4L14 14"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
            <input
              ref={searchRef}
              value={query}
              placeholder={t('chatAssistantSearch', { n: DOC_ASSISTANT_TOTAL })}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            {query && (
              <button
                className="proj-search-clear"
                aria-label={t('cancel')}
                onClick={() => setQuery('')}
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path
                    d="M3 3l6 6M9 3l-6 6"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>
          {activeId && (
            <button className="chat-assistant-clear" role="menuitem" onClick={onClear}>
              {t('chatAssistantClear')}
            </button>
          )}
          {searching ? (
            searchResults === null ? (
              <p className="chat-assistant-hint">{t('chatAssistantLoading')}</p>
            ) : searchResults.length === 0 ? (
              <p className="chat-assistant-hint">{t('chatAssistantNoMatch')}</p>
            ) : (
              <div className="chat-assistant-list" role="listbox">
                {searchResults.map((a) => (
                  <AssistantRow key={a.id} a={a} onPick={pick} />
                ))}
              </div>
            )
          ) : domain ? (
            <>
              <button
                className="chat-assistant-back"
                role="menuitem"
                onClick={() => setDomain(null)}
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path
                    d="M8 2L4 6l4 4"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {domainInfo ? domainInfo.label : ''} · {t('chatAssistantBack')}
              </button>
              {domainList === null ? (
                <p className="chat-assistant-hint">{t('chatAssistantLoading')}</p>
              ) : (
                <div className="chat-assistant-list" role="listbox">
                  {domainList.map((a) => (
                    <AssistantRow key={a.id} a={a} onPick={pick} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="chat-assistant-groups">
              {recents.length > 0 && (
                <>
                  <div className="chat-assistant-sec">{t('chatAssistantRecent')}</div>
                  <div className="chat-assistant-recents">
                    {recents.map((r) => (
                      <button
                        key={r.id}
                        className="chat-assistant-recent-chip"
                        title={r.label}
                        onClick={() => {
                          void getDomainAssistants(r.id.split('.')[0] ?? '')
                            .then((list) => {
                              const full = findById(list, r.id)
                              if (full) pick(full)
                            })
                            .catch(() => undefined)
                        }}
                      >
                        <span aria-hidden>{r.icon}</span>
                        {r.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="chat-assistant-sec">{t('chatAssistantAll')}</div>
              <div className="chat-assistant-domains" role="listbox">
                {DOC_ASSISTANT_DOMAINS.map((d) => (
                  <button
                    key={d.key}
                    className="chat-assistant-domain"
                    role="option"
                    aria-selected={false}
                    onClick={() => setDomain(d.key)}
                  >
                    <span className="chat-assistant-domain-label">{d.label}</span>
                    <span className="chat-assistant-domain-count">
                      {t('chatAssistantCount', { n: d.count })}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </span>
  )
}

/** session-assistant identity shown in the composer (chip with a clear ×) */
export function AssistantChip({
  icon,
  label,
  onClear,
}: {
  icon: string
  label: string
  onClear: () => void
}): ReactElement {
  const { t } = useI18n()
  return (
    <div className="chat-assistant-chip">
      <span className="chat-assistant-chip-icon" aria-hidden>
        {icon}
      </span>
      <span className="chat-assistant-chip-label">{label}</span>
      <button
        className="chat-assistant-chip-clear"
        aria-label={t('chatAssistantClear')}
        title={t('chatAssistantClear')}
        onClick={onClear}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path
            d="M2 2l6 6M8 2l-6 6"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  )
}
