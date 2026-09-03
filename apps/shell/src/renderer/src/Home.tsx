import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import logoLockup from './assets/chatoffice-logo.svg'
import iconDocx from './assets/file-docx.svg'
import iconXlsx from './assets/file-xlsx.svg'
import iconPptx from './assets/file-pptx.svg'
import iconPdf from './assets/file-pdf.svg'
import iconMd from './assets/file-md.svg'
import type {
  AccountStatus,
  CloudProjectKind,
  CloudProjectsSnapshot,
  HomeApi,
  ProjectHomeApi,
  ProjectSummaryEntry,
  RecentEntry,
} from '../../shared/home-api'
import { useDismissablePopover } from '@chatoffice/ui'
import { fileCountKey, visiblePageCount } from './counts'
import { useI18n } from './locale'
import type { I18n, StringKey } from './locale'
import { SettingsModal } from './SettingsModal'
import { ChatPanel } from './home-chat/ChatPanel'
import { refreshHomeModelCache } from './home-chat/bridge'

declare global {
  interface Window {
    chatOffice: HomeApi
    chatOfficeProject?: ProjectHomeApi
  }
}

/** page size of the home list; scrolling to the bottom auto-loads the next page */
const PAGE_SIZE = 50

const FILE_ICONS: Record<string, string> = {
  docx: iconDocx,
  xlsx: iconXlsx,
  xlsm: iconXlsx,
  pptx: iconPptx,
  pdf: iconPdf,
  md: iconMd,
  markdown: iconMd,
}

/* Formats the open-local card advertises. Too long for the card at any window
   width, so it ellipsizes and a hover ScreenTip carries the full list. Keep in
   sync with the main-process open-dialog filter (OPEN_DIALOG_EXTENSIONS). */
const OPEN_LOCAL_EXTENSIONS = '.docx / .xlsx / .xlsm / .xls / .csv / .pptx / .pdf / .md'

function FileBadge({ ext, size }: { ext: string; size: number }) {
  const icon = FILE_ICONS[ext]
  if (icon) {
    return <img src={icon} width={size} height={size} alt="" aria-hidden="true" />
  }
  const label = ext ? ext[0].toUpperCase() : '?'
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7.5" fill="#98a2b3" />
      <text
        x="16"
        y="16.5"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize={17}
        fontWeight="700"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
      >
        {label}
      </text>
    </svg>
  )
}

function formatModified(mtimeMs: number, i18n: I18n): string {
  const date = new Date(mtimeMs)
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000)
  if (days <= 0) {
    return `${i18n.t('today')} · ${date.toLocaleTimeString(i18n.dateLocale, { hour: '2-digit', minute: '2-digit' })}`
  }
  if (days === 1) return i18n.t('yesterday')
  return date.toLocaleDateString(i18n.dateLocale, { month: 'short', day: 'numeric' })
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function baseName(entry: RecentEntry): string {
  return entry.ext ? entry.name.slice(0, -(entry.ext.length + 1)) : entry.name
}

// ── Project hooks ─────────────────────────────────────────

/** whether we are inside the shell (chatOfficeProject API available) */
function hasProjectApi(): boolean {
  return typeof window.chatOfficeProject !== 'undefined'
}

const FILTERS: { key: string; label: StringKey }[] = [
  { key: 'all', label: 'filterAll' },
  { key: 'docx', label: 'filterDocs' },
  { key: 'xlsx', label: 'filterSheets' },
  { key: 'pptx', label: 'filterSlides' },
  { key: 'pdf', label: 'filterPdf' },
  { key: 'md', label: 'filterMd' },
]

/** Check glyph marking the selected sort option; invisible on the others so labels stay aligned */
function SortCheck({ visible }: { visible: boolean }): ReactElement {
  return (
    <svg
      className="cloud-sort-check"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={visible ? undefined : { visibility: 'hidden' }}
    >
      <path
        d="M3 8.5L6.5 12L13 4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── Project sidebar component ────────────────────────────

interface ProjectPanelProps {
  projects: ProjectSummaryEntry[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onRefresh: () => void
}

function ProjectPanel({ projects, selectedId, onSelect, onRefresh }: ProjectPanelProps) {
  const { t } = useI18n()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  // open menu id + fixed-position anchor (viewport coords), so the popup can
  // escape the scrollable project list without the list losing overflow-y
  const [projMenu, setProjMenu] = useState<{ id: string; top: number; right: number } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const newInputRef = useRef<HTMLInputElement>(null)
  // wrap (… button + popup) of the row whose menu is open — the dismissal guard root
  const projMenuWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (creating && newInputRef.current) newInputRef.current.focus()
  }, [creating])

  // unified dismissal: outside press, window blur, chrome press (tab strip / window drag)
  useDismissablePopover(projMenu !== null, () => setProjMenu(null), {
    inside: () => [projMenuWrapRef.current],
  })

  // also close on any scroll (the fixed-position popup would otherwise detach
  // from its row while the list scrolls)
  useEffect(() => {
    if (!projMenu) return
    const close = () => setProjMenu(null)
    window.addEventListener('scroll', close, true)
    return () => window.removeEventListener('scroll', close, true)
  }, [projMenu])

  const commitCreate = async () => {
    const name = newName.trim()
    setCreating(false)
    setNewName('')
    if (!name) return
    try {
      await window.chatOfficeProject?.createProject(name)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
      return
    }
    onRefresh()
  }

  const commitRename = async () => {
    if (!renaming) return
    const name = renaming.value.trim()
    const id = renaming.id
    setRenaming(null)
    if (!name) return
    try {
      await window.chatOfficeProject?.renameProject(id, name)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
      return
    }
    onRefresh()
  }

  // in-app confirm dialog (same style as the delete-files modal), not window.confirm
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const doDelete = (id: string) => {
    setProjMenu(null)
    setConfirmDeleteId(id)
  }

  const confirmDeleteNow = async () => {
    const id = confirmDeleteId
    setConfirmDeleteId(null)
    if (!id) return
    try {
      await window.chatOfficeProject?.deleteProject(id)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
      return
    }
    if (selectedId === id) onSelect(null)
    onRefresh()
  }

  useEffect(() => {
    if (!confirmDeleteId) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmDeleteId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmDeleteId])

  return (
    <div className="proj-panel">
      <div className="proj-panel-head">
        <span className="proj-panel-title">{t('projects')}</span>
        <button
          className="proj-add-btn"
          data-tip={t('newProject')}
          onClick={() => setCreating(true)}
          aria-label={t('newProject')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M7 1v12M1 7h12"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {creating && (
        <div className="proj-new-row">
          <input
            ref={newInputRef}
            className="proj-rename-input"
            placeholder={t('projectName')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={() => void commitCreate()}
            onKeyDown={(e) => {
              // IME (e.g. pinyin): Enter/Escape during composition only affects
              // the composition, it must not commit or cancel the field
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') void commitCreate()
              if (e.key === 'Escape') {
                setCreating(false)
                setNewName('')
              }
            }}
          />
        </div>
      )}

      <ul className="proj-list">
        {projects.map((proj) => {
          const isActive = selectedId === proj.id
          const isRenaming = renaming?.id === proj.id
          return (
            <li key={proj.id} className={`proj-item${isActive ? ' active' : ''}`}>
              <div
                className="proj-item-main"
                role="button"
                tabIndex={0}
                onClick={() => onSelect(isActive ? null : proj.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSelect(isActive ? null : proj.id)
                }}
              >
                <span className="proj-item-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.1c.44 0 .85.19 1.13.52L8.4 4.4H13A1.5 1.5 0 0 1 14.5 5.9v5.6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4z"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                {isRenaming ? (
                  <input
                    className="proj-rename-input inline"
                    value={renaming.value}
                    autoFocus
                    onFocus={(e) => e.target.select()}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenaming({ id: proj.id, value: e.target.value })}
                    onBlur={() => void commitRename()}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.nativeEvent.isComposing) return
                      if (e.key === 'Enter') void commitRename()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                  />
                ) : (
                  <span className="proj-item-name">
                    {proj.isDefault ? t('defaultProject') : proj.name}
                  </span>
                )}
                <span className="proj-item-meta">
                  <span className="proj-item-count">{proj.fileCount}</span>
                </span>
              </div>

              {!proj.isDefault && (
                <div
                  className="proj-menu-wrap"
                  ref={projMenu?.id === proj.id ? projMenuWrapRef : undefined}
                >
                  <button
                    className="proj-more-btn"
                    aria-label={t('projMoreActions', { name: proj.name })}
                    aria-expanded={projMenu?.id === proj.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (projMenu?.id === proj.id) {
                        setProjMenu(null)
                        return
                      }
                      const rect = e.currentTarget.getBoundingClientRect()
                      setProjMenu({
                        id: proj.id,
                        top: rect.bottom + 4,
                        right: window.innerWidth - rect.right,
                      })
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                      <circle cx="3.2" cy="8" r="1.35" fill="currentColor" />
                      <circle cx="8" cy="8" r="1.35" fill="currentColor" />
                      <circle cx="12.8" cy="8" r="1.35" fill="currentColor" />
                    </svg>
                  </button>
                  {projMenu?.id === proj.id && (
                    <div
                      className="proj-menu"
                      role="menu"
                      style={{ top: projMenu.top, right: projMenu.right }}
                    >
                      <button
                        role="menuitem"
                        onClick={(e) => {
                          e.stopPropagation()
                          setProjMenu(null)
                          setRenaming({ id: proj.id, value: proj.name })
                        }}
                      >
                        {t('rename')}
                      </button>
                      <div className="row-menu-divider" />
                      <button
                        role="menuitem"
                        className="danger"
                        onClick={(e) => {
                          e.stopPropagation()
                          doDelete(proj.id)
                        }}
                      >
                        {t('deleteProject')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {confirmDeleteId &&
        (() => {
          // locale string is "title?\nbody" — split it across the dialog
          const [confirmTitle, ...confirmBody] = t('deleteProjectConfirm').split('\n')
          return (
            <div className="modal-overlay" onClick={() => setConfirmDeleteId(null)}>
              <div
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-label={confirmTitle}
                onClick={(event) => event.stopPropagation()}
              >
                <h3>{confirmTitle}</h3>
                <p>{confirmBody.join('\n')}</p>
                <div className="modal-buttons">
                  <button
                    className="btn btn-secondary"
                    autoFocus
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    {t('cancel')}
                  </button>
                  <button className="btn btn-danger" onClick={() => void confirmDeleteNow()}>
                    {t('delete')}
                  </button>
                </div>
              </div>
            </div>
          )
        })()}
    </div>
  )
}

// ── Account entry (bottom-left) ──────────────────────────
// Currently the Genspark (gsk) login entry; to be upgraded to a signup/account system later.
// Clicking it opens the settings modal directly (SettingsModal.tsx), which hosts
// login/logout plus preferences (language, theme, save location, update channel).

const LOGIN_POLL_MS = 2500
/** fallback deadline when the CLI does not report expires_in (device codes live ~300s) */
const LOGIN_MAX_WAIT_MS = 300_000

function AccountEntry({
  onStatusChange,
  settingsOpen,
  onSettingsOpenChange,
}: {
  onStatusChange?: (status: AccountStatus | null) => void
  /** controlled: the home chat's setup card opens the same modal */
  settingsOpen: boolean
  onSettingsOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  const [status, setStatus] = useState<AccountStatus | null>(null)

  useEffect(() => {
    onStatusChange?.(status)
  }, [status, onStatusChange])
  const [waiting, setWaiting] = useState(false)
  // incremented on login retry, resetting the polling timer
  const [loginNonce, setLoginNonce] = useState(0)
  // auth URL reported by the login CLI — rescue entry when the browser did not open
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [urlCopied, setUrlCopied] = useState(false)
  const loginDeadline = useRef(0)
  const [loggingOut, setLoggingOut] = useState(false)
  // bumped on logout so an in-flight status refresh (which can still
  // report logged-in) is discarded instead of resurrecting the UI
  const statusSeq = useRef(0)

  // query login state once on mount
  useEffect(() => {
    let alive = true
    void window.chatOffice.accountStatus?.().then((s) => {
      if (alive) setStatus(s)
    })
    return () => {
      alive = false
    }
  }, [])

  // login progress pushed from main (gsk login CLI output)
  useEffect(() => {
    const off = window.chatOffice.onAccountLogin?.((ev) => {
      if (ev.phase === 'url') {
        if (ev.url) setAuthUrl(ev.url)
        if (ev.expiresInSec) loginDeadline.current = Date.now() + ev.expiresInSec * 1000
      } else if (ev.phase === 'success') {
        void window.chatOffice.accountStatus().then((s) => {
          if (s.loggedIn) {
            setStatus(s)
            setWaiting(false)
            setAuthUrl(null)
          }
        })
      } else if (ev.phase === 'error') {
        setWaiting(false)
        setAuthUrl(null)
      }
    })
    return off
  }, [])

  // config-file polling stays as the fallback success path (works even if progress events are lost)
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => {
      void window.chatOffice.accountStatus().then((s) => {
        if (s.loggedIn) {
          setStatus(s)
          setWaiting(false)
          setAuthUrl(null)
        } else if (Date.now() > loginDeadline.current) {
          setWaiting(false)
          setAuthUrl(null)
        }
      })
    }, LOGIN_POLL_MS)
    return () => clearInterval(timer)
  }, [waiting, loginNonce])

  const loggedIn = status?.loggedIn ?? false
  const email = status?.email ?? ''

  const doLogout = () => {
    setLoggingOut(true)
    statusSeq.current++
    void window.chatOffice.accountLogout().then(() => {
      setLoggingOut(false)
      setStatus({ loggedIn: false })
    })
  }

  const startLogin = () => {
    // clicking again while waiting = relaunch the login (main kills the stale CLI, so the new device code is the live one)
    setWaiting(true)
    setAuthUrl(null)
    setUrlCopied(false)
    loginDeadline.current = Date.now() + LOGIN_MAX_WAIT_MS
    setLoginNonce((n) => n + 1)
    void window.chatOffice.accountLogin().then((launched) => {
      if (!launched) setWaiting(false)
    })
  }

  const openLoginUrl = () => void window.chatOffice.openLoginUrl?.()

  const copyLoginUrl = () => {
    if (!authUrl) return
    void navigator.clipboard.writeText(authUrl).then(() => {
      setUrlCopied(true)
      window.setTimeout(() => setUrlCopied(false), 2000)
    })
  }

  const handleClick = () => {
    // refresh the login state / credit balance; drop the response
    // when a logout happened while it was in flight
    const seq = statusSeq.current
    void window.chatOffice.accountStatus?.().then((s) => {
      if (seq === statusSeq.current) setStatus(s)
    })
    onSettingsOpenChange(true)
  }

  return (
    <div className="account-entry">
      {settingsOpen && (
        <SettingsModal
          status={status}
          loggingOut={loggingOut}
          loginWaiting={waiting}
          loginUrl={authUrl}
          urlCopied={urlCopied}
          onOpenLoginUrl={openLoginUrl}
          onCopyLoginUrl={copyLoginUrl}
          onClose={() => onSettingsOpenChange(false)}
          onLogin={() => {
            onSettingsOpenChange(false)
            startLogin()
          }}
          onLogout={doLogout}
        />
      )}
      {!settingsOpen && waiting && authUrl && (
        <div className="login-hint" role="status">
          <button className="login-hint-open" onClick={openLoginUrl}>
            {t('loginOpenShort')}
          </button>
          <button
            className={`login-hint-copy${urlCopied ? ' copied' : ''}`}
            onClick={copyLoginUrl}
            // static tip: screentips are suppressed from pointerdown until the pointer
            // leaves the control, so a swapped-in "copied" tip would never show — the
            // check-mark icon is the visible feedback
            data-tip={t('loginCopyUrl')}
            aria-label={urlCopied ? t('loginCopied') : t('loginCopyUrl')}
          >
            {urlCopied ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="m3.5 8.5 3 3 6-7"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect
                  x="5.5"
                  y="5.5"
                  width="7"
                  height="7"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path
                  d="M3.5 10.5V5a1.5 1.5 0 0 1 1.5-1.5h5.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>
        </div>
      )}
      <button
        className="account-btn"
        onClick={handleClick}
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        data-tip={loggedIn && email ? email : t('settings')}
        aria-label={t('settings')}
      >
        <span className={`account-avatar${waiting ? ' waiting' : ''}`}>
          {waiting ? (
            <svg
              className="account-spinner"
              width="14"
              height="14"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <circle
                cx="8"
                cy="8"
                r="6"
                stroke="currentColor"
                strokeWidth="1.8"
                fill="none"
                strokeDasharray="26"
                strokeDashoffset="18"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            /* gear: this entry opens the settings window */
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          )}
        </span>
        <span className="account-text">
          <span className="account-name">{t('settings')}</span>
          {loggedIn && email && <span className="account-sub">{email}</span>}
        </span>
        <svg
          className="account-chevron"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M5 6.2 8 3.4l3 2.8M5 9.8l3 2.8 3-2.8"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}

// ── Cloud (Genspark web) projects view ──────────────────

/** kind filter segments; labels shared with the recents type filter */
const CLOUD_FILTERS = [
  { key: 'all', label: 'filterAll' },
  { key: 'docs', label: 'filterDocs' },
  { key: 'sheets', label: 'filterSheets' },
  { key: 'slides', label: 'filterSlides' },
] as const satisfies readonly { key: 'all' | CloudProjectKind; label: StringKey }[]

/** module kind → file icon extension */
const CLOUD_KIND_EXT: Record<string, string> = { docs: 'docx', sheets: 'xlsx', slides: 'pptx' }

/** rows revealed per "load more" step; purely client-side over the local snapshot */
const CLOUD_REVEAL_STEP = 100

function CloudProjectsView() {
  const i18n = useI18n()
  const { t } = i18n
  const [snapshot, setSnapshot] = useState<CloudProjectsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [loginWaiting, setLoginWaiting] = useState(false)
  const [kind, setKind] = useState<'all' | CloudProjectKind>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'oldest'>('recent')
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [revealed, setRevealed] = useState(CLOUD_REVEAL_STEP)
  const sortRef = useRef<HTMLDivElement>(null)

  // the local store paints instantly; a background sync replaces it when done.
  // a failed sync keeps whatever is shown; with nothing shown the
  // !snapshot && !loading branch below renders the retry state
  const startSync = () => {
    setSyncing(true)
    void window.chatOffice.cloudProjectsSync?.().then((synced) => {
      setSyncing(false)
      setLoading(false)
      if (synced) setSnapshot(synced)
    })
  }
  const startSyncRef = useRef(startSync)
  startSyncRef.current = startSync

  useEffect(() => {
    let cancelled = false
    void window.chatOffice.cloudProjectsCached?.().then((stored) => {
      if (cancelled || !stored) return
      setSnapshot((prev) => prev ?? stored)
      setLoading(false)
    })
    startSyncRef.current()
    return () => {
      cancelled = true
    }
  }, [])

  // the sign-in button reuses the account login flow; sync once it lands
  useEffect(() => {
    const off = window.chatOffice.onAccountLogin?.((ev) => {
      if (ev.phase === 'success') {
        setLoginWaiting(false)
        startSyncRef.current()
      } else if (ev.phase === 'error') {
        setLoginWaiting(false)
      }
    })
    return off
  }, [])

  // unified dismissal: outside press, window blur, chrome press (tab strip / window drag)
  useDismissablePopover(sortMenuOpen, () => setSortMenuOpen(false), {
    inside: () => [sortRef.current],
  })

  const startLogin = () => {
    setLoginWaiting(true)
    void window.chatOffice.accountLogin?.().then((ok) => {
      if (!ok) setLoginWaiting(false)
    })
  }

  const changeKind = (k: 'all' | CloudProjectKind) => {
    if (k === kind) return
    setKind(k)
    setRevealed(CLOUD_REVEAL_STEP)
  }

  const openProject = (projectUrl: string) => {
    void window.chatOffice.openCloudProject?.(projectUrl)
  }

  // filter / search / sort are all local over the snapshot — no requests
  const q = query.trim().toLowerCase()
  let list = snapshot?.projects.filter((proj) => kind === 'all' || proj.kind === kind) ?? []
  if (q) list = list.filter((proj) => proj.title.toLowerCase().includes(q))
  if (sort === 'oldest') list = [...list].reverse()
  const visible = list.slice(0, revealed)

  const renderRows = () => {
    const items: ReactElement[] = []
    for (const proj of visible) {
      items.push(
        <li key={proj.projectId}>
          <button
            className="cloud-row"
            data-tip={t('cloudOpenInBrowser')}
            data-tip-anchor=".cloud-row-external"
            data-tip-place="right"
            onClick={() => openProject(proj.projectUrl)}
          >
            <FileBadge ext={CLOUD_KIND_EXT[proj.kind] ?? ''} size={24} />
            <span className="cloud-row-main">
              <span className="cloud-row-title">{proj.title || t('untitled')}</span>
              <svg
                className="cloud-row-external"
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M6.5 3.5H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 13.5h7A1.5 1.5 0 0 0 12.5 12V9.5M9.5 2.5h4v4M13 3l-5.5 5.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="cloud-row-time">
              {proj.ctimeMs ? formatModified(proj.ctimeMs, i18n) : ''}
            </span>
          </button>
        </li>,
      )
    }
    return items
  }

  const renderBody = () => {
    if (snapshot && !snapshot.available) {
      return (
        <p className="empty proj-empty">
          <span className="empty-hint">{t('cloudLoginHint')}</span>
          <button className="btn btn-secondary" disabled={loginWaiting} onClick={startLogin}>
            {loginWaiting ? t('waitingShort') : t('loginGenspark')}
          </button>
        </p>
      )
    }
    if (!snapshot) {
      if (loading || syncing) {
        return (
          <div className="load-more" aria-hidden="true">
            <span className="load-more-spinner" />
          </div>
        )
      }
      return (
        <p className="empty proj-empty">
          <span className="empty-hint">{t('cloudError')}</span>
          <button className="btn btn-secondary" onClick={() => startSync()}>
            {t('cloudRetry')}
          </button>
        </p>
      )
    }
    if (list.length === 0) {
      return (
        <p className="empty proj-empty">
          <span className="empty-hint">
            {t(q ? 'cloudNoResults' : kind === 'all' ? 'cloudEmpty' : 'emptyFiltered')}
          </span>
        </p>
      )
    }
    return (
      <div className="cloud-scroll">
        <div className="cloud-table">
          <div className="cloud-columns">
            <span className="col-name">{t('colName')}</span>
            <div className="cloud-col-sort" ref={sortRef}>
              <button
                className="cloud-col-sort-btn"
                aria-haspopup="menu"
                aria-expanded={sortMenuOpen}
                onClick={() => setSortMenuOpen((o) => !o)}
              >
                {t('colModified')}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                  style={sort === 'oldest' ? { transform: 'rotate(180deg)' } : undefined}
                >
                  <path
                    d="M8 3v10M4.5 9.5L8 13l3.5-3.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {sortMenuOpen && (
                <div className="cloud-sort-menu" role="menu">
                  {(['recent', 'oldest'] as const).map((key) => (
                    <button
                      key={key}
                      className={sort === key ? 'active' : ''}
                      role="menuitemradio"
                      aria-checked={sort === key}
                      onClick={() => {
                        setSort(key)
                        setSortMenuOpen(false)
                        setRevealed(CLOUD_REVEAL_STEP)
                      }}
                    >
                      <SortCheck visible={sort === key} />
                      {t(key === 'recent' ? 'cloudSortRecent' : 'cloudSortOldest')}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <ul className="cloud-list">{renderRows()}</ul>
        </div>
        {list.length > revealed && (
          <div className="load-more">
            <button
              className="btn btn-secondary"
              onClick={() => setRevealed((n) => n + CLOUD_REVEAL_STEP)}
            >
              {t('cloudLoadMore')}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <main className="content">
      <section className="cloud-projects" aria-label={t('navCloud')}>
        <header className="cloud-hero">
          <div className="cloud-hero-top">
            <h1 className="cloud-title">{t('navCloud')}</h1>
          </div>
          <p className="cloud-subtitle">{t('cloudSubtitle')}</p>
          {snapshot?.available && (
            <div className="cloud-controls">
              <div className="cloud-seg" role="tablist" aria-label={t('filterAria')}>
                {CLOUD_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    className={kind === f.key ? 'active' : ''}
                    role="tab"
                    aria-selected={kind === f.key}
                    onClick={() => changeKind(f.key)}
                  >
                    {t(f.label)}
                  </button>
                ))}
              </div>
              <button
                className={`cloud-refresh-btn${syncing ? ' syncing' : ''}`}
                data-tip={t('cloudRefresh')}
                aria-label={t('cloudRefresh')}
                disabled={syncing}
                onClick={() => startSync()}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M13.6 8a5.6 5.6 0 1 1-1.64-3.96M13.6 2.4v3.2h-3.2"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <div className="cloud-search">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.4" />
                  <path
                    d="M10.5 10.5L14 14"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
                <input
                  value={query}
                  placeholder={t('cloudSearchPlaceholder', { n: snapshot.projects.length })}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setRevealed(CLOUD_REVEAL_STEP)
                  }}
                />
              </div>
            </div>
          )}
        </header>
        {renderBody()}
      </section>
    </main>
  )
}

// ── Drop-to-open overlay ────────────────────────────────

/**
 * Full-window affordance while OS files hover over Home. Purely visual — the
 * actual open is owned by the preload drop bridge (installDropOpenBridge), so
 * this overlay stays pointer-events:none and never handles events itself.
 * Visibility tracks a dragenter/dragleave depth counter: `dragover` stops
 * being delivered while the cursor is stationary (macOS), so a debounce would
 * hide the overlay mid-drag. Enter fires before the matching leave when
 * moving between elements, so the depth never dips to zero inside the window.
 */
function DropToOpenOverlay(): ReactElement | null {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (ev: DragEvent): boolean => ev.dataTransfer?.types.includes('Files') ?? false
    // NB: the preload drop bridge also listens here and cancels file drags, so
    // defaultPrevented can't discriminate anything at this layer — only zones
    // that stopPropagation (none on Home) would keep us out entirely.
    const onDragEnter = (ev: DragEvent) => {
      if (!hasFiles(ev)) return
      depth += 1
      setVisible(true)
    }
    const onDragLeave = (ev: DragEvent) => {
      if (!hasFiles(ev)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setVisible(false)
    }
    // drop/blur reset the depth outright: leaving the window mid-drag can eat
    // a dragleave, and a stuck overlay would be worse than a re-shown one
    const onHide = () => {
      depth = 0
      setVisible(false)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onHide)
    window.addEventListener('blur', onHide)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onHide)
      window.removeEventListener('blur', onHide)
    }
  }, [])
  const { t } = useI18n()
  if (!visible) return null
  return (
    <div className="home-drop-overlay" aria-hidden="true">
      <div className="home-drop-card">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3.5v11M7.5 10.5l4.5 4.5 4.5-4.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4 16.5v2A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-2"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        <h2>{t('dropToOpenTitle')}</h2>
        <p>{OPEN_LOCAL_EXTENSIONS}</p>
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────

export function Home() {
  const i18n = useI18n()
  const { t } = i18n
  // ── Paged list state (rows loaded for the current view + filter) ──
  const [entries, setEntries] = useState<RecentEntry[]>([])
  /** total count under the current view + filter (not just the loaded rows) */
  const [listTotal, setListTotal] = useState(0)
  /** sidebar Recent / Starred counts under the active type filter */
  const [navCounts, setNavCounts] = useState({ recent: 0, starred: 0 })
  const [loadingMore, setLoadingMore] = useState(false)
  const [view, setView] = useState<'recent' | 'starred'>('recent')
  // Genspark web projects take over the content area (the chat hides meanwhile)
  const [cloudMode, setCloudMode] = useState(false)
  const [filter, setFilter] = useState('all')
  const [rowMenu, setRowMenu] = useState<string | null>(null)
  // actions cell (… button + menu) of the row whose menu is open — the dismissal guard root
  const rowMenuWrapRef = useRef<HTMLSpanElement>(null)
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null)
  // name in the greeting; omitted when logged out
  const [accountName, setAccountName] = useState('')
  // Genspark Projects is web-account data, so its nav entry only shows when logged in
  const [loggedIn, setLoggedIn] = useState(false)
  // single source of account state: AccountEntry reports every change (initial
  // load, login, logout), keeping the greeting name and the nav entry in sync
  const handleAccountStatus = useCallback((s: AccountStatus | null) => {
    const on = s?.loggedIn ?? false
    setLoggedIn(on)
    if (!on) setCloudMode(false)
    const name = on ? (s?.email ?? '').split('@')[0] : ''
    setAccountName(name ? name[0].toUpperCase() + name.slice(1) : '')
  }, [])
  // the settings modal lives in the sidebar's account entry, but the home
  // chat's setup-required card opens it too; closing it may have changed the
  // AI model, so refresh the chat bridge's cached selection
  const [settingsOpen, setSettingsOpen] = useState(false)
  const handleSettingsOpenChange = useCallback((open: boolean) => {
    setSettingsOpen(open)
    if (!open) void refreshHomeModelCache()
  }, [])

  // ── Project state ──
  const [projects, setProjects] = useState<ProjectSummaryEntry[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)

  const projectMode = hasProjectApi()

  // ── Paged loading ──
  // stale responses are dropped via a request sequence number (when views/filters switch quickly)
  const requestSeq = useRef(0)
  const entriesLen = useRef(0)
  entriesLen.current = entries.length

  /** reload the list; keepCount keeps the loaded row count (refresh), otherwise back to page one */
  const reload = (keepCount: boolean) => {
    const seq = ++requestSeq.current
    const ext = filter === 'all' ? undefined : filter
    const limit = keepCount ? Math.max(entriesLen.current, PAGE_SIZE) : PAGE_SIZE
    const primary = view === 'recent' ? window.chatOffice.recents : window.chatOffice.starred
    const secondary = view === 'recent' ? window.chatOffice.starred : window.chatOffice.recents
    void primary({ offset: 0, limit, ext }).then((page) => {
      if (seq !== requestSeq.current) return
      setEntries(page.entries)
      setListTotal(page.total)
      setNavCounts((prev) =>
        view === 'recent'
          ? { ...prev, recent: visiblePageCount(page) }
          : { ...prev, starred: visiblePageCount(page) },
      )
    })
    // The other view fetches only its count under the same active filter.
    void secondary({ offset: 0, limit: 0, ext }).then((page) => {
      if (seq !== requestSeq.current) return
      setNavCounts((prev) =>
        view === 'recent'
          ? { ...prev, starred: visiblePageCount(page) }
          : { ...prev, recent: visiblePageCount(page) },
      )
    })
    if (projectMode) {
      void window.chatOfficeProject!.listProjects().then(setProjects)
    }
  }
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  // refresh signal for project-view data (re-pull file stats after file changes)
  const [projectTick, setProjectTick] = useState(0)

  const refresh = () => {
    reloadRef.current(true)
    setProjectTick((n) => n + 1)
  }

  useEffect(() => {
    reloadRef.current(false)
  }, [view, filter])

  useEffect(() => {
    const onFocus = () => {
      reloadRef.current(true)
      setProjectTick((n) => n + 1)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const hasMore = entries.length < listTotal

  const loadMore = () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    const seq = requestSeq.current
    const ext = filter === 'all' ? undefined : filter
    const api = view === 'recent' ? window.chatOffice.recents : window.chatOffice.starred
    void api({ offset: entriesLen.current, limit: PAGE_SIZE, ext }).then((page) => {
      setLoadingMore(false)
      if (seq !== requestSeq.current) return
      setEntries((prev) => [...prev, ...page.entries])
      setListTotal(page.total)
    })
  }
  const loadMoreRef = useRef(loadMore)
  loadMoreRef.current = loadMore

  // Load the next page once the bottom sentinel enters the viewport (240px early);
  // depending on entries.length rebuilds the observer after each page — observe fires an immediate
  // callback, so while the sentinel stays in view we keep loading until full or exhausted
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((r) => r.isIntersecting)) loadMoreRef.current()
      },
      { rootMargin: '240px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, entries.length])

  // unified dismissal: outside press, window blur, chrome press (tab strip / window drag)
  useDismissablePopover(rowMenu !== null, () => setRowMenu(null), {
    inside: () => [rowMenuWrapRef.current],
  })

  // Escape closes the row menu and the delete-confirm dialog
  useEffect(() => {
    if (rowMenu === null && confirmDelete === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRowMenu(null)
        setConfirmDelete(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [rowMenu, confirmDelete])

  // ── Project files state ────────────────────────────────

  const [projectFileEntries, setProjectFileEntries] = useState<RecentEntry[]>([])
  const [moveFileMenu, setMoveFileMenu] = useState<string | null>(null)
  // submenu opens rightward by default; flips left when the window edge is too close
  const [moveMenuFlip, setMoveMenuFlip] = useState(false)
  // hover-open/close delays: avoid flashing the submenu while the pointer passes
  // through, and keep it open while crossing the 4px gap into it
  const moveMenuTimers = useRef<{ open: number | null; close: number | null }>({
    open: null,
    close: null,
  })
  // wrap (trigger + submenu) of the row whose move submenu is open — the dismissal guard root
  const moveMenuWrapRef = useRef<HTMLDivElement>(null)

  const openMoveMenu = (path: string) => {
    setMoveMenuFlip(false)
    setMoveFileMenu(path)
  }

  // ref runs pre-paint, so measuring the real width (long project names exceed
  // the min-width) and flipping never flashes; once flipped the check no longer hits
  const measureSubmenu = (el: HTMLDivElement | null) => {
    if (el && el.getBoundingClientRect().right > document.documentElement.clientWidth - 8) {
      setMoveMenuFlip(true)
    }
  }

  const clearMoveMenuTimer = (kind: 'open' | 'close') => {
    const timers = moveMenuTimers.current
    if (timers[kind] !== null) {
      window.clearTimeout(timers[kind])
      timers[kind] = null
    }
  }
  useEffect(() => {
    if (!projectMode || !selectedProjectId) {
      setProjectFileEntries([])
      return
    }
    let active = true
    const api = window.chatOfficeProject!
    void api.listFiles(selectedProjectId).then(async (paths) => {
      const stats = await window.chatOffice.statPaths(paths)
      if (!active) return
      setProjectFileEntries(stats.sort((a, b) => b.mtimeMs - a.mtimeMs))
    })
    return () => {
      active = false
    }
  }, [projectMode, selectedProjectId, projectTick])

  // the submenu lives inside the row menu: when that closes, drop the stale
  // submenu state and any pending hover timers so it doesn't reopen expanded
  useEffect(() => {
    if (rowMenu === null) {
      clearMoveMenuTimer('open')
      clearMoveMenuTimer('close')
      setMoveFileMenu(null)
    }
  }, [rowMenu])

  // move-file submenu: unified dismissal (outside press, window blur, chrome press)
  useDismissablePopover(moveFileMenu !== null, () => setMoveFileMenu(null), {
    inside: () => [moveMenuWrapRef.current],
  })

  // ── Sidebar file-list row interactions (the table view is gone) ──
  const changeView = (next: 'recent' | 'starred') => {
    setView(next)
    setRowMenu(null)
  }

  const changeFilter = (key: string) => {
    setFilter(key)
    setRowMenu(null)
  }

  const toggleStar = (path: string) => {
    void window.chatOffice.toggleStar(path).then(refresh)
  }

  const removeRecent = (paths: string[]) => {
    setRowMenu(null)
    void window.chatOffice.removeRecent(paths).then(refresh)
  }

  const deleteFiles = (paths: string[]) => {
    setRowMenu(null)
    setConfirmDelete(paths)
  }

  const confirmDeleteNow = () => {
    const paths = confirmDelete ?? []
    setConfirmDelete(null)
    void window.chatOffice.deleteFiles(paths).then(refresh)
  }

  const duplicateFile = (path: string) => {
    setRowMenu(null)
    void window.chatOffice.duplicateFile(path).then(refresh)
  }

  const startRename = (entry: RecentEntry) => {
    setRowMenu(null)
    setRenaming({ path: entry.path, value: baseName(entry) })
  }

  const commitRename = (entry: RecentEntry) => {
    const value = renaming?.value.trim() ?? ''
    setRenaming(null)
    if (!value || value === baseName(entry)) return
    const newName = entry.ext ? `${value}.${entry.ext}` : value
    void window.chatOffice.renameFile(entry.path, newName).then((result) => {
      if (!result.ok) window.alert(result.error ?? t('renameFailed'))
      refresh()
    })
  }

  const moveFileTo = async (filePath: string, targetProjectId: string) => {
    setMoveFileMenu(null)
    setRowMenu(null)
    try {
      await window.chatOfficeProject?.moveFile(filePath, targetProjectId)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
      return
    }
    refresh()
    if (selectedProjectId) {
      setProjectFileEntries((prev) => prev.filter((e) => e.path !== filePath))
    }
  }

  // ── New file (passes projectId when a project is selected) ──
  const handleNewDoc = () => {
    void window.chatOffice.newDoc(selectedProjectId ? { projectId: selectedProjectId } : undefined)
  }

  const handleNewSheet = () => {
    void window.chatOffice.newSheet(
      selectedProjectId ? { projectId: selectedProjectId } : undefined,
    )
  }

  const handleNewSlide = () => {
    void window.chatOffice.newSlide(
      selectedProjectId ? { projectId: selectedProjectId } : undefined,
    )
  }

  const handleNewMarkdown = () => {
    void window.chatOffice.newMarkdown(
      selectedProjectId ? { projectId: selectedProjectId } : undefined,
    )
  }

  const handleNewPdf = () => {
    void window.chatOffice.newPdf(selectedProjectId ? { projectId: selectedProjectId } : undefined)
  }

  const NEW_ITEMS = [
    { ext: 'docx', title: t('newDoc'), sub: '.docx', action: handleNewDoc },
    { ext: 'xlsx', title: t('newSheet'), sub: '.xlsx', action: handleNewSheet },
    { ext: 'pptx', title: t('newSlide'), sub: '.pptx', action: handleNewSlide },
    { ext: 'md', title: t('newMarkdown'), sub: '.md', action: handleNewMarkdown },
    { ext: 'pdf', title: t('newPdf'), sub: '.pdf', action: handleNewPdf },
  ]

  // ── Sidebar quick actions (top-left launcher: new/open) ──

  function renderSideActions() {
    return (
      <div className="side-actions">
        {NEW_ITEMS.map((item) => (
          <button
            key={item.ext}
            className="side-action"
            onClick={() => void item.action()}
            data-tip={item.sub}
          >
            <FileBadge ext={item.ext} size={22} />
            <span className="side-action-label">{item.title}</span>
          </button>
        ))}
        <button
          className="side-action"
          onClick={() => void window.chatOffice.browse()}
          data-tip={OPEN_LOCAL_EXTENSIONS}
        >
          <span className="side-action-folder" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path
                d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.1c.44 0 .85.19 1.13.52L8.4 4.4H13A1.5 1.5 0 0 1 14.5 5.9v5.6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="side-action-label">{t('openLocal')}</span>
        </button>
      </div>
    )
  }

  // ── Sidebar file history (recents / starred / project files) ──

  function renderSideFileRow(entry: RecentEntry, context: 'global' | 'project') {
    const isRenaming = renaming?.path === entry.path
    const otherProjects = projects.filter(
      (p) => p.id !== (context === 'project' ? selectedProjectId : undefined),
    )
    return (
      <li className="side-file" key={entry.path}>
        <div
          className="side-file-main"
          role="button"
          tabIndex={0}
          onClick={() => {
            if (!isRenaming) void window.chatOffice.openPath(entry.path)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.target === event.currentTarget) {
              void window.chatOffice.openPath(entry.path)
            }
          }}
        >
          <FileBadge ext={entry.ext} size={18} />
          {isRenaming ? (
            <input
              className="rename-input side"
              value={renaming.value}
              autoFocus
              onFocus={(event) => event.target.select()}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setRenaming({ path: entry.path, value: event.target.value })}
              onBlur={() => commitRename(entry)}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Enter') commitRename(entry)
                if (event.key === 'Escape') setRenaming(null)
              }}
            />
          ) : (
            <span className="side-file-name" title={entry.name}>
              {entry.name}
            </span>
          )}
          <span className="side-file-time">{formatModified(entry.mtimeMs, i18n)}</span>
        </div>
        <button
          className={`star-btn side${entry.starred ? ' starred' : ''}`}
          aria-label={entry.starred ? t('unstar') : t('star')}
          onClick={(event) => {
            event.stopPropagation()
            toggleStar(entry.path)
          }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M8 1.9l1.9 3.85 4.25.62-3.07 3 .72 4.23L8 11.6l-3.8 2 .72-4.23-3.07-3 4.25-.62z"
              fill={entry.starred ? '#f5a623' : 'none'}
              stroke={entry.starred ? '#f5a623' : 'currentColor'}
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span
          className="side-file-actions"
          ref={rowMenu === entry.path ? rowMenuWrapRef : undefined}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="more-btn side"
            aria-label={t('moreActions')}
            aria-expanded={rowMenu === entry.path}
            onClick={() => setRowMenu(rowMenu === entry.path ? null : entry.path)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="3.2" cy="8" r="1.4" fill="currentColor" />
              <circle cx="8" cy="8" r="1.4" fill="currentColor" />
              <circle cx="12.8" cy="8" r="1.4" fill="currentColor" />
            </svg>
          </button>
          {rowMenu === entry.path && (
            <div className="row-menu side" role="menu">
              <button
                role="menuitem"
                onClick={() => {
                  setRowMenu(null)
                  void window.chatOffice.openPath(entry.path)
                }}
              >
                {t('open')}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setRowMenu(null)
                  void window.chatOffice.revealPath(entry.path)
                }}
              >
                {t('revealInFolder')}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setRowMenu(null)
                  void navigator.clipboard.writeText(entry.path)
                }}
              >
                {t('copyPath')}
              </button>
              {projectMode && otherProjects.length > 0 && (
                <>
                  <div className="row-menu-divider" />
                  <div
                    className="move-menu-wrap"
                    ref={moveFileMenu === entry.path ? moveMenuWrapRef : undefined}
                    onMouseEnter={() => {
                      clearMoveMenuTimer('close')
                      if (moveFileMenu === entry.path) return
                      clearMoveMenuTimer('open')
                      moveMenuTimers.current.open = window.setTimeout(
                        () => openMoveMenu(entry.path),
                        160,
                      )
                    }}
                    onMouseLeave={() => {
                      clearMoveMenuTimer('open')
                      clearMoveMenuTimer('close')
                      moveMenuTimers.current.close = window.setTimeout(
                        () => setMoveFileMenu(null),
                        140,
                      )
                    }}
                  >
                    <button
                      role="menuitem"
                      className="submenu-trigger"
                      onClick={(e) => {
                        e.stopPropagation()
                        clearMoveMenuTimer('open')
                        clearMoveMenuTimer('close')
                        if (moveFileMenu === entry.path) setMoveFileMenu(null)
                        else openMoveMenu(entry.path)
                      }}
                    >
                      {t('moveToProject')}
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 12 12"
                        aria-hidden="true"
                        style={{ marginLeft: 'auto' }}
                      >
                        <path
                          d="M4.5 2.5l4 3.5-4 3.5"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinecap="round"
                          fill="none"
                        />
                      </svg>
                    </button>
                    {moveFileMenu === entry.path && (
                      <div
                        className={`submenu${moveMenuFlip ? ' submenu-left' : ''}`}
                        role="menu"
                        ref={measureSubmenu}
                      >
                        {otherProjects.map((p) => (
                          <button
                            key={p.id}
                            role="menuitem"
                            onClick={() => void moveFileTo(entry.path, p.id)}
                          >
                            {p.isDefault ? t('defaultProject') : p.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
              <div className="row-menu-divider" />
              <button role="menuitem" onClick={() => startRename(entry)}>
                {t('rename')}
              </button>
              <button role="menuitem" onClick={() => duplicateFile(entry.path)}>
                {t('duplicate')}
              </button>
              {context === 'global' && (
                <>
                  <div className="row-menu-divider" />
                  <button role="menuitem" onClick={() => removeRecent([entry.path])}>
                    {t('removeFromList')}
                  </button>
                  <button
                    role="menuitem"
                    className="danger"
                    onClick={() => deleteFiles([entry.path])}
                  >
                    {t('deleteFiles')}
                  </button>
                </>
              )}
            </div>
          )}
        </span>
      </li>
    )
  }

  function renderSideFiles() {
    // a selected project wins over the recent/starred nav, mirroring the old
    // content-area precedence
    const inProject = projectMode && !!selectedProjectId
    const list = inProject ? projectFileEntries : entries
    const title = inProject
      ? (projects.find((p) => p.id === selectedProjectId)?.name ?? '')
      : view === 'starred'
        ? t('secStarred')
        : t('secRecent')
    const total = inProject ? projectFileEntries.length : listTotal
    return (
      <div className="side-files">
        <div className="side-files-head">
          <span className="side-files-title">{title}</span>
          <span className="side-files-count">{t(fileCountKey(total), { n: total })}</span>
        </div>
        {!inProject && (
          <div className="side-filters" role="tablist" aria-label={t('filterAria')}>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`side-filter${filter === f.key ? ' active' : ''}`}
                onClick={() => changeFilter(f.key)}
              >
                {t(f.label)}
              </button>
            ))}
          </div>
        )}
        {list.length === 0 ? (
          <p className="side-files-empty">
            {inProject
              ? t('projEmptyHint')
              : view === 'starred'
                ? t('emptyStarred')
                : navCounts.recent === 0
                  ? t('emptyRecent')
                  : t('emptyFiltered')}
          </p>
        ) : (
          <div className="side-files-scroll">
            <ul className="side-file-list">
              {list.map((entry) => renderSideFileRow(entry, inProject ? 'project' : 'global'))}
            </ul>
            {!inProject && hasMore && (
              <div ref={sentinelRef} className="load-more" aria-hidden="true">
                <span className="load-more-spinner" />
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="home">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img className="logo-lockup" src={logoLockup} alt="ChatOffice" />
        </div>

        {renderSideActions()}

        <nav className="sidebar-nav">
          <button
            className={`nav-item${view === 'recent' && !selectedProjectId && !cloudMode ? ' active' : ''}`}
            onClick={() => {
              changeView('recent')
              setSelectedProjectId(null)
              setCloudMode(false)
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
              <path
                d="M8 4.8V8l2.2 1.6"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
            <span className="nav-label">{t('navRecent')}</span>
            <span className="nav-count">{navCounts.recent}</span>
          </button>
          <button
            className={`nav-item${view === 'starred' && !selectedProjectId && !cloudMode ? ' active' : ''}`}
            onClick={() => {
              changeView('starred')
              setSelectedProjectId(null)
              setCloudMode(false)
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 1.9l1.9 3.85 4.25.62-3.07 3 .72 4.23L8 11.6l-3.8 2 .72-4.23-3.07-3 4.25-.62z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
            <span className="nav-label">{t('navStarred')}</span>
            <span className="nav-count">{navCounts.starred}</span>
          </button>
          {loggedIn && (
            <button
              className={`nav-item${cloudMode && !selectedProjectId ? ' active' : ''}`}
              onClick={() => {
                setCloudMode(true)
                setSelectedProjectId(null)
                setRowMenu(null)
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M8 1.8l1.55 4.65L14.2 8l-4.65 1.55L8 14.2 6.45 9.55 1.8 8l4.65-1.55z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="nav-label">{t('navCloud')}</span>
              <svg
                className="nav-external"
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M6.5 3.5H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 13.5h7A1.5 1.5 0 0 0 12.5 12V9.5M9.5 2.5h4v4M13 3l-5.5 5.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </nav>

        {/* project sidebar: the file history below follows the selected project */}
        {projectMode && (
          <>
            <div className="sidebar-divider" />
            <ProjectPanel
              projects={projects}
              selectedId={selectedProjectId}
              onSelect={(id) => {
                setSelectedProjectId(id)
                setRowMenu(null)
              }}
              onRefresh={refresh}
            />
          </>
        )}

        {!cloudMode && renderSideFiles()}

        <AccountEntry
          onStatusChange={handleAccountStatus}
          settingsOpen={settingsOpen}
          onSettingsOpenChange={handleSettingsOpenChange}
        />
      </aside>

      {cloudMode ? (
        <CloudProjectsView />
      ) : (
        <ChatPanel
          projectId={selectedProjectId}
          accountName={accountName}
          onOpenSettings={() => handleSettingsOpenChange(true)}
        />
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('deleteModalTitle')}
            onClick={(event) => event.stopPropagation()}
          >
            <h3>{t('deleteModalTitle')}</h3>
            <p>
              {confirmDelete.length === 1
                ? t('deleteConfirmOne', { name: fileName(confirmDelete[0]) })
                : t('deleteConfirmMany', { n: confirmDelete.length })}
            </p>
            {confirmDelete.length > 1 && (
              <ul className="modal-file-list">
                {confirmDelete.slice(0, 6).map((p) => (
                  <li key={p}>{fileName(p)}</li>
                ))}
                {confirmDelete.length > 6 && (
                  <li>{t('deleteMoreCount', { n: confirmDelete.length })}</li>
                )}
              </ul>
            )}
            <div className="modal-buttons">
              <button
                className="btn btn-secondary"
                autoFocus
                onClick={() => setConfirmDelete(null)}
              >
                {t('cancel')}
              </button>
              <button className="btn btn-danger" onClick={confirmDeleteNow}>
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      <DropToOpenOverlay />
    </div>
  )
}
