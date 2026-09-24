/**
 * AssistantBrowser — the docs 助手 tab's assistant library browser.
 *
 * Group-first like the wps dialog it migrates from: the 230 domain groups
 * (with counts) render instantly from a static manifest, each domain's
 * assistant list loads as its own small chunk on demand, and a search box
 * covers the whole library once all packs are loaded in the background.
 * Running an assistant goes through buildAssistantInstruction (the unified
 * run rules) and hands the instruction to the panel's agent loop.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ALL_ASSISTANT_DOMAINS,
  ALL_ASSISTANTS_TOTAL,
  buildAssistantInstruction,
  flattenByManifest,
  getDomainAssistants,
  loadAllAssistants,
  matchAssistant,
  type DocAssistant,
} from './assistants'
import { useI18n, type StringKey } from '../i18n/locale'

const RECENTS_KEY = 'aidocs.assistantRecents'
const RECENTS_MAX = 10
/** cap search results — 4.6k rows would jank the panel */
const SEARCH_RESULTS_MAX = 80

interface QuickItem {
  id: string
  label: string
  desc: string
  icon: React.ReactNode
  disabled?: boolean
  run: () => void
}

export interface AssistantRun {
  instruction: string
  display: string
}

interface Props {
  quickItems: QuickItem[]
  getSelectionText: () => string
  docEmpty?: boolean
  onRun: (run: AssistantRun) => void
  hidden?: boolean
}

function readRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function SectionHeader({ label }: { label: string }): React.JSX.Element {
  return <div className="ai-assist-section">{label}</div>
}

export function AssistantBrowser({
  quickItems,
  getSelectionText,
  docEmpty = false,
  onRun,
  hidden,
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [domainKey, setDomainKey] = useState<string | null>(null)
  const [all, setAll] = useState<Map<string, DocAssistant[]> | null>(null)
  const [singleDomain, setSingleDomain] = useState<DocAssistant[] | null>(null)
  const [recents, setRecents] = useState<string[]>(readRecents)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<number>(0)

  // load the whole library once in the background (search + recents need it);
  // single-domain browsing works without it via its own chunk
  useEffect(() => {
    let alive = true
    loadAllAssistants().then((m) => {
      if (alive) setAll(m)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (domainKey === null) {
      setSingleDomain(null)
      return
    }
    let alive = true
    const cached = all?.get(domainKey)
    if (cached) {
      setSingleDomain(cached)
      return
    }
    setSingleDomain(null)
    getDomainAssistants(domainKey).then((list) => {
      if (alive) setSingleDomain(list)
    })
    return () => {
      alive = false
    }
  }, [domainKey, all])

  const domainLabel = useMemo(() => new Map(ALL_ASSISTANT_DOMAINS.map((d) => [d.key, d.label])), [])

  const showNotice = (key: StringKey) => {
    window.clearTimeout(noticeTimer.current)
    setNotice(t(key))
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000)
  }

  const runAssistant = (doc: DocAssistant) => {
    const selection = docEmpty ? '' : getSelectionText()
    const plan = buildAssistantInstruction(doc, selection)
    if (!plan.ok) {
      showNotice('aiAssistantNeedSelection')
      return
    }
    setRecents((prev) => {
      const next = [doc.id, ...prev.filter((id) => id !== doc.id)].slice(0, RECENTS_MAX)
      try {
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
      } catch {
        // private mode etc. — recents are best-effort
      }
      return next
    })
    onRun({ instruction: plan.instruction, display: plan.display })
  }

  const searchResults = useMemo(() => {
    if (!all || query.trim() === '') return null
    const flat = flattenByManifest(all)
    const out: Array<{ doc: DocAssistant; via?: string }> = []
    for (const doc of flat) {
      if (matchAssistant(doc, domainLabel.get(doc.domain) ?? '', query)) {
        out.push({ doc })
        if (out.length >= SEARCH_RESULTS_MAX) break
      }
    }
    return out
  }, [all, query, domainLabel])

  const recentDocs = useMemo(() => {
    if (!all || recents.length === 0) return []
    const byId = new Map(flattenByManifest(all).map((d) => [d.id, d]))
    return recents.map((id) => byId.get(id)).filter((d): d is DocAssistant => d !== undefined)
  }, [all, recents])

  const activeDomain = domainKey ? ALL_ASSISTANT_DOMAINS.find((d) => d.key === domainKey) : null

  const assistantRow = (doc: DocAssistant) => (
    <button
      key={doc.id}
      type="button"
      className="ai-assist-item"
      disabled={docEmpty}
      title={doc.description}
      onClick={() => runAssistant(doc)}
    >
      <span className="ai-assist-icon" aria-hidden>
        {doc.icon}
      </span>
      <span className="ai-assist-text">
        <span className="ai-assist-name">
          {doc.label}
          {query.trim() !== '' ? (
            <span className="ai-assist-domain"> · {domainLabel.get(doc.domain) ?? doc.domain}</span>
          ) : null}
        </span>
        <span className="ai-assist-desc">{doc.description}</span>
      </span>
    </button>
  )

  return (
    <div className="ai-assistant" style={hidden ? { display: 'none' } : undefined}>
      <div className="ai-assist-toolbar">
        {activeDomain ? (
          <button
            type="button"
            className="ai-assist-back"
            onClick={() => setDomainKey(null)}
            aria-label={t('aiAssistantBack')}
          >
            ‹
          </button>
        ) : null}
        <input
          type="search"
          className="ai-assist-search"
          placeholder={all ? t('aiAssistantSearch') : t('aiAssistantLoading')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setDomainKey(null)
          }}
          disabled={!all}
        />
      </div>

      {notice ? <div className="ai-assist-notice">{notice}</div> : null}

      {searchResults ? (
        searchResults.length > 0 ? (
          <div className="ai-assist-list">{searchResults.map(({ doc }) => assistantRow(doc))}</div>
        ) : (
          <div className="ai-assist-empty">{t('aiAssistantNoMatch')}</div>
        )
      ) : activeDomain ? (
        <div className="ai-assist-list">
          <SectionHeader
            label={`${activeDomain.label} · ${t('aiAssistantCount', { count: activeDomain.count })}`}
          />
          {singleDomain === null ? (
            <div className="ai-assist-empty">{t('aiAssistantLoading')}</div>
          ) : (
            singleDomain.map(assistantRow)
          )}
        </div>
      ) : (
        <>
          {recentDocs.length > 0 ? (
            <div className="ai-assist-list">
              <SectionHeader label={t('aiAssistantRecent')} />
              {recentDocs.map(assistantRow)}
            </div>
          ) : null}
          <div className="ai-assist-list">
            <SectionHeader label={t('aiAssistantCommon')} />
            {quickItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="ai-assist-item"
                disabled={item.disabled}
                onClick={item.run}
              >
                <span className="ai-assist-icon" aria-hidden>
                  {item.icon}
                </span>
                <span className="ai-assist-text">
                  <span className="ai-assist-name">{item.label}</span>
                  <span className="ai-assist-desc">{item.desc}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="ai-assist-list">
            <SectionHeader label={`${t('aiAssistantAll')} · ${ALL_ASSISTANTS_TOTAL}`} />
            {ALL_ASSISTANT_DOMAINS.map((d) => (
              <button
                key={d.key}
                type="button"
                className="ai-assist-item ai-assist-group"
                onClick={() => {
                  setQuery('')
                  setDomainKey(d.key)
                }}
              >
                <span className="ai-assist-text">
                  <span className="ai-assist-name">{d.label}</span>
                </span>
                <span className="ai-assist-count">{t('aiAssistantCount', { count: d.count })}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
