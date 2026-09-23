import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement, ReactNode } from 'react'
import iconDocx from './assets/file-docx.png'
import iconXlsx from './assets/file-xlsx.png'
import iconPptx from './assets/file-pptx.png'
import iconPdf from './assets/file-pdf.png'
import iconMd from './assets/file-md.png'
import iconHtml from './assets/file-html.png'
import iconDwg from './assets/file-dwg.png'
import iconMind from './assets/file-mind.png'
import type {
  AccountStatus,
  CloudProjectKind,
  CloudProjectsSnapshot,
  HomeApi,
  HomeChatSession,
  PendingUntitledDocEntry,
  ProjectHomeApi,
  ProjectSummaryEntry,
  RecentEntry,
} from '../../shared/home-api'
import { useDismissablePopover, USER_LOGIN_READY } from '@chatoffice/ui'
import { fileCountKey, chatCountKey } from './counts'
import { MonoFileIcon } from './file-icons'
import { useI18n } from './locale'
import type { I18n, StringKey } from './locale'
import { skillUpdateDue } from './IntegrationsPane'
import { ChatPanel } from './home-chat/ChatPanel'
import { FileTreePane } from './home-files/FileTreePane'
import { refreshHomeModelCache } from './home-chat/bridge'
import { useHomeChatStore } from './home-chat/store'
import { clampSidebarWidth, getHomeLayout, onHomeLayoutChange, setHomeLayout } from './home-layout'
import {
  applyRelayEvent,
  RelaySessionLink,
  relaySendCommand,
  relayStopCommand,
  resolveRelayConfirm,
} from './home-chat/relay-client'

import type { IntegrationsApi } from '../../shared/integrations-api'
import type { McpClientApi } from '../../shared/mcp-client-api'

import { SettingsModal } from './SettingsModal'
import { FeedbackModal, FeedbackQrCard } from './FeedbackModal'

declare global {
  interface Window {
    chatOffice: HomeApi
    chatOfficeProject?: ProjectHomeApi
    chatOfficeIntegrations?: IntegrationsApi
    chatOfficeMcp?: McpClientApi
  }
}

/** 弹窗期让编辑器视图让位：shell DOM 永远画在 WebContentsView 之下，全窗弹窗
 *  （设置/删除确认）必须同步 chatoffice-shell-modal 类 + setShellModalOpen IPC
 *  隐藏激活编辑器视图，否则弹窗会被视图盖住只剩树带里一条。 */
function useShellModalSurface(open: boolean): void {
  useEffect(() => {
    document.documentElement.classList.toggle('chatoffice-shell-modal', open)
    if ('chatOfficeTabs' in window) window.chatOfficeTabs.setShellModalOpen(open)
    return () => {
      document.documentElement.classList.remove('chatoffice-shell-modal')
      if ('chatOfficeTabs' in window) window.chatOfficeTabs.setShellModalOpen(false)
    }
  }, [open])
}

/** page size of the home list; scrolling to the bottom auto-loads the next page */
const PAGE_SIZE = 50

const FILE_ICONS: Record<string, string> = {
  docx: iconDocx,
  doc: iconDocx,
  xlsx: iconXlsx,
  xlsm: iconXlsx,
  xls: iconXlsx,
  csv: iconXlsx,
  pptx: iconPptx,
  pdf: iconPdf,
  md: iconMd,
  markdown: iconMd,
  html: iconHtml,
  htm: iconHtml,
  dwg: iconDwg,
  dxf: iconDwg,
  mind: iconMind,
  mindmap: iconMind,
}

/* Formats the open-local card advertises. Too long for the card at any window
   width, so it ellipsizes and a hover ScreenTip carries the full list. Keep in
   sync with the main-process open-dialog filter (OPEN_DIALOG_EXTENSIONS). */
const OPEN_LOCAL_EXTENSIONS = '.docx / .xlsx / .xlsm / .xls / .csv / .pptx / .pdf / .md / .html'

function FileBadge({ ext, size }: { ext: string; size: number }) {
  const icon = FILE_ICONS[ext]
  if (icon) {
    // brand file icons are square squircle badges: scale by height, width follows
    return <img src={icon} style={{ height: size, width: 'auto' }} alt="" aria-hidden="true" />
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
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

/** 最近使用 filter chips: extension-style tech terms (all/docx/xlsx/pptx/pdf/.md),
 *  literal in every locale — they read as file formats, not UI words */
const RECENT_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'all' },
  { key: 'docx', label: 'docx' },
  { key: 'xlsx', label: 'xlsx' },
  { key: 'pptx', label: 'pptx' },
  { key: 'pdf', label: 'pdf' },
  { key: 'md', label: '.md' },
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

// ── ZCode 式左树（对话 / 项目 两分组） ──────────────────────

/** 会话在树中的顺序：置顶在前，其余按最近更新 */
function byPinnedRecent(a: HomeChatSession, b: HomeChatSession): number {
  const pin = (b.pinned === true ? 1 : 0) - (a.pinned === true ? 1 : 0)
  return pin !== 0 ? pin : b.updatedAt - a.updatedAt
}

/** 右键 / … 菜单的一个条目（divider=true 画分组线） */
interface TreeMenuItem {
  key: string
  label: string
  danger?: boolean
  disabled?: boolean
  action: () => void
}
type TreeMenuEntry = TreeMenuItem | { divider: true; key: string }
/** 一个已定位的菜单（x/y 为视口坐标，渲染时做边界钳制） */
interface TreeMenuSpec {
  x: number
  y: number
  title?: string
  items: TreeMenuEntry[]
}

/** 分组头部行尾的图标按钮（过滤 / 归档 / 新建项目），悬浮显现 */
function TreeHeadBtn({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      className={`side-head-btn${active ? ' active' : ''}`}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      {children}
    </button>
  )
}

/** 过滤按钮展开的搜索条：输入即过滤所属分组的清单（Escape 先清空再收起） */
function TreeFilterBar({
  value,
  placeholder,
  clearLabel,
  closeLabel,
  onChange,
  onClose,
}: {
  value: string
  placeholder: string
  clearLabel: string
  closeLabel: string
  onChange: (next: string) => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  return (
    <div className="tree-filter">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="4.4" stroke="currentColor" strokeWidth="1.3" />
        <path d="M10.4 10.4L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Escape') {
            if (value) onChange('')
            else onClose()
          }
        }}
      />
      <button
        className="tree-filter-clear"
        aria-label={value ? clearLabel : closeLabel}
        onClick={() => (value ? onChange('') : onClose())}
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
    </div>
  )
}
// ── Account entry (bottom-left) ──────────────────────────
// Currently the ChatOffice (chatoffice) login entry; to be upgraded to a signup/account system later.
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
  const [skillUpdate, setSkillUpdate] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  // feedback dialog (aidooo.com): probe first — online opens the form,
  // offline falls back to the follow-us QR card
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackQrOpen, setFeedbackQrOpen] = useState(false)
  const [feedbackProbing, setFeedbackProbing] = useState(false)
  useShellModalSurface(feedbackOpen || feedbackQrOpen)
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

  // login progress pushed from main (chatoffice login CLI output)
  // the skill state is a few file reads; re-probe after the modal closes so an
  // update done inside it clears the dot
  useEffect(() => {
    if (settingsOpen) return
    let alive = true
    void window.chatOfficeIntegrations?.status().then((st) => {
      if (alive) setSkillUpdate(skillUpdateDue(st))
    })
    return () => {
      alive = false
    }
  }, [settingsOpen])

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

  const handleFeedbackClick = () => {
    if (feedbackProbing || feedbackOpen || feedbackQrOpen) return
    setFeedbackProbing(true)
    // main-process probe (renderer CSP blocks cross-origin fetch)
    void Promise.resolve(window.chatOffice.feedbackProbe?.() ?? false)
      .then((online) => {
        // 在线：打开嵌入的在线客服聊天窗（与官网同一聊天界面）；离线：二维码卡片兜底
        if (online) void window.chatOffice.openChat?.()
        else setFeedbackQrOpen(true)
      })
      .catch(() => setFeedbackQrOpen(true))
      .finally(() => setFeedbackProbing(false))
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
          skillUpdateDue={skillUpdate}
          onSkillUpdateDue={setSkillUpdate}
        />
      )}
      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
      {feedbackQrOpen && <FeedbackQrCard onClose={() => setFeedbackQrOpen(false)} />}
      <div className="account-row">
        <button
          className="account-btn"
          onClick={handleClick}
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          data-tip={t('settings')}
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
            {skillUpdate && (
              <span className="account-badge" role="img" aria-label={t('intgUpdateDue')} />
            )}
          </span>
          <span className="account-text">
            <span className="account-name">{t('settings')}</span>
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
        <button
          className="account-feedback-btn"
          onClick={handleFeedbackClick}
          data-tip={t('feedback')}
          aria-label={t('feedback')}
          aria-haspopup="dialog"
          aria-expanded={feedbackOpen || feedbackQrOpen}
          data-feedback-entry
        >
          {feedbackProbing ? (
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
            /* message bubble: opens the feedback dialog / offline QR card */
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M2.5 3h11a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5H8.2L4.8 14v-3H2.5a.5.5 0 0 1-.5-.5v-7A.5.5 0 0 1 2.5 3z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}

// ── Cloud (ChatOffice web) projects view ──────────────────

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
      // 用户登录未开放（USER_LOGIN_READY=false）：不可用态复用中性「加载失败」文案，不出现登录入口
      return (
        <p className="empty proj-empty">
          <span className="empty-hint">
            {USER_LOGIN_READY ? t('cloudLoginHint') : t('cloudError')}
          </span>
          {USER_LOGIN_READY ? (
            <button className="btn btn-secondary" disabled={loginWaiting} onClick={startLogin}>
              {loginWaiting ? t('waitingShort') : t('loginChatOffice')}
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={() => startSync()}>
              {t('cloudRetry')}
            </button>
          )}
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
  // three-pane arrangement (TabBar toggles persist via home-layout)
  const layout = useSyncExternalStore(onHomeLayoutChange, getHomeLayout)
  // ── Paged list state (rows loaded for the current view + filter) ──
  const [entries, setEntries] = useState<RecentEntry[]>([])
  /** total count under the current view + filter (not just the loaded rows) */
  const [listTotal, setListTotal] = useState(0)
  /** starred files for the always-on 收藏 section (small list, no paging) */
  const [starredEntries, setStarredEntries] = useState<RecentEntry[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  // ChatOffice web projects take over the content area (the chat hides meanwhile)
  const [cloudMode, setCloudMode] = useState(false)
  const [filter, setFilter] = useState('all')
  // ── Pending-unsaved restore banner (documents that crashed before their first
  // save; created via 新建表格/PDF or AI generation, never written to disk) ──
  const [pendingUntitled, setPendingUntitled] = useState<PendingUntitledDocEntry[]>([])
  useEffect(() => {
    void window.chatOffice
      .listPendingUntitled()
      .then(setPendingUntitled)
      .catch(() => setPendingUntitled([]))
  }, [])
  const [rowMenu, setRowMenu] = useState<string | null>(null)
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const filterMenuWrapRef = useRef<HTMLSpanElement>(null)
  // actions cell (… button + menu) of the row whose menu is open — the dismissal guard root
  const rowMenuWrapRef = useRef<HTMLSpanElement>(null)
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null)
  // ── ZCode 式左树状态（对话/项目两分组 + 过滤/归档 + 右键菜单） ──
  /** 归档视图开着时取代两分组（收藏文档与归档会话都在里面） */
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [chatsFilterOpen, setChatsFilterOpen] = useState(false)
  const [chatsQuery, setChatsQuery] = useState('')
  const [projFilterOpen, setProjFilterOpen] = useState(false)
  /** 会话行内重命名（id + 草稿值） */
  const [renamingSession, setRenamingSession] = useState<{ id: string; value: string } | null>(null)
  /** 项目行内重命名 */
  const [renamingProject, setRenamingProject] = useState<{ id: string; value: string } | null>(null)
  /** 右键 / … 菜单（视口坐标定位，全树单实例） */
  const [ctxMenu, setCtxMenu] = useState<TreeMenuSpec | null>(null)
  const ctxMenuWrapRef = useRef<HTMLDivElement>(null)
  /** 删除确认：会话 / 项目（弹窗风格同文件删除） */
  const [confirmDeleteSession, setConfirmDeleteSession] = useState<HomeChatSession | null>(null)
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<ProjectSummaryEntry | null>(null)
  /** 新建项目的退回流程（目录选择器不可用的 web shim 才走名输入） */
  const [creatingProject, setCreatingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const newProjectInputRef = useRef<HTMLInputElement>(null)
  /** 待确认的磁盘删除：paths=文件，sessionIds=显式勾选的会话（执行时还会并入被删文件下的对话） */
  const [confirmDelete, setConfirmDelete] = useState<{
    paths: string[]
    sessionIds: string[]
  } | null>(null)
  // unavailable recent entry (missing flag) the user clicked — offer list removal
  const [confirmMissing, setConfirmMissing] = useState<RecentEntry | null>(null)
  // name in the greeting; omitted when logged out
  const [accountName, setAccountName] = useState('')
  // ChatOffice Projects is web-account data, so its nav entry only shows when logged in
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
  const [settingsNonce, setSettingsNonce] = useState(0)
  const handleSettingsOpenChange = useCallback((open: boolean) => {
    setSettingsOpen(open)
    // a shell modal must escape the tree strip beside a document tab: unclip
    // the frame and have the main process hide the covering editor view for
    // the dialog's lifetime
    document.documentElement.classList.toggle('chatoffice-shell-modal', open)
    if ('chatOfficeTabs' in window) window.chatOfficeTabs.setShellModalOpen(open)
    if (!open) {
      void refreshHomeModelCache()
      // ChatPanel re-reads AiSettingsV2 (composer model picker) on this bump
      setSettingsNonce((n) => n + 1)
    }
  }, [])

  // 删除确认弹窗与设置弹窗同机制：shell DOM 永远画在编辑器 WebContentsView
  // 之下，弹窗打开期间必须隐藏编辑器视图，否则对话框被盖住不可见（只剩树带
  // 一条遮罩）。关闭时恢复设置弹窗的占用状态，两者互斥不冲突。
  const shellModalBusy = confirmDelete !== null
  useEffect(() => {
    if (!shellModalBusy) return
    document.documentElement.classList.add('chatoffice-shell-modal')
    if ('chatOfficeTabs' in window) window.chatOfficeTabs.setShellModalOpen(true)
    return () => {
      document.documentElement.classList.toggle('chatoffice-shell-modal', settingsOpen)
      if ('chatOfficeTabs' in window) window.chatOfficeTabs.setShellModalOpen(settingsOpen)
    }
  }, [shellModalBusy, settingsOpen])
  // a window-level fallback: with pointer capture unavailable (or the pointer
  // released outside the 7px strip) the drag must still end
  const resizerRef = useRef<HTMLDivElement>(null)
  const endSidebarDrag = useCallback(() => {
    if (resizerRef.current) delete resizerRef.current.dataset.dragging
    document.body.classList.remove('sidebar-resizing')
  }, [])
  useEffect(() => {
    window.addEventListener('pointerup', endSidebarDrag)
    return () => window.removeEventListener('pointerup', endSidebarDrag)
  }, [endSidebarDrag])

  // ── 文件树选中的文件夹（新建文件的落点；共识 Q2：树选中=落点，未选中=默认目录） ──
  const [newFileDir, setNewFileDir] = useState<string | null>(null)

  // ── Project state ──
  const [projects, setProjects] = useState<ProjectSummaryEntry[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)

  const projectMode = hasProjectApi()

  // ── Home chat store (owned here so the left tree reads the same sessions;
  //    ChatPanel becomes a controlled view over it) ──
  const chatStore = useHomeChatStore(
    useMemo(
      () => ({
        chatSessionsLoad: async () => (await window.chatOffice.chatSessionsLoad?.()) ?? [],
        chatSessionsSave: async (sessions: HomeChatSession[]) => {
          await window.chatOffice.chatSessionsSave?.(sessions)
        },
      }),
      [],
    ),
  )
  /** nonce-bumped open request from the tree to the middle chat pane */
  const [chatOpenSignal, setChatOpenSignal] = useState<{ sessionId: string; nonce: number } | null>(
    null,
  )

  // ── Dock pane ↔ session memory (P1): the conversation remembers which
  //    right-pane editor tabs belong to it; switching back re-docks them ──
  const chatStoreRef = useRef(chatStore)
  chatStoreRef.current = chatStore
  const relayLink = useRef(new RelaySessionLink())
  const [relayBusy, setRelayBusy] = useState<Set<string>>(() => new Set())
  /** P2-6 圈选标注:激活 dock 报来的选区(中栏「针对所选」提示) */
  const [selectionHint, setSelectionHint] = useState<string | null>(null)

  // P2-3 中继事件回流:RelayEvent 镜像为所属会话的 assistant 消息(工具卡随行)
  useEffect(() => {
    const dock = window.chatOfficeDock
    if (!dock) return
    return dock.onRelayEvent((dockTabId, event) => {
      const sessionId = relayLink.current.sessionOfDock(dockTabId)
      if (!sessionId) return
      if (event.type === 'busy') {
        setRelayBusy((prev) => {
          const next = new Set(prev)
          if (event.busy) next.add(sessionId)
          else next.delete(sessionId)
          return next
        })
        // P2 追加排队:忙→闲翻转时投出队头一条(FIFO,逐轮放行);投出即
        // 乐观置忙,堵住与用户回车之间的竞态窗
        const flushed = relayLink.current.markBusy(dockTabId, event.busy)
        if (flushed !== undefined) {
          relayLink.current.markBusy(dockTabId, true)
          dock.relayCommand(dockTabId, relaySendCommand(flushed))
        }
        return
      }
      if (event.type === 'context') {
        // 圈选标注:仅当前激活会话显示提示;空 text=选区收起,清提示
        if (relayLink.current.activeDockOf(sessionId) === dockTabId) {
          setSelectionHint(event.context.text ? event.context.text : null)
        }
        return
      }
      if (event.type === 'switch-request') {
        // P2-6 残项 dock 切换:先找已停靠 tab(live 列表才有 id),找不到
        // 但目标文件在盘上则停靠打开;切换会经 onTabs 触发目标重种子
        const target = event.switch
        void dock
          .list()
          .then((live) => {
            // filePath 匹配必须显式有值:undefined===undefined 会误中第一个空白 tab
            const hit =
              (target.filePath ? live.find((t) => t.filePath === target.filePath) : undefined) ??
              (target.title ? live.find((t) => t.title === target.title) : undefined) ??
              (target.title
                ? live.find((t) => t.title.toLowerCase().includes(target.title!.toLowerCase()))
                : undefined)
            if (hit) {
              void dock.activate(hit.id)
            } else if (target.filePath) {
              void window.chatOffice.openPath(target.filePath, { dock: false })
            }
          })
          .catch(() => undefined)
        return
      }
      if (event.type === 'snapshot') return
      chatStoreRef.current.updateSession(sessionId, (s) => ({
        ...s,
        messages: applyRelayEvent(s.messages, event, Date.now()),
      }))
    })
  }, [])

  // P2-5 回流镜像:全 tab 面板完成的轮次镜像进项目主线(Q5'a:主线=唯一完整真相)
  useEffect(() => {
    const dock = window.chatOfficeDock
    if (!dock) return
    return dock.onPanelTurn((turn) => {
      if (turn.cancelled || !turn.filePath) return
      const store = chatStoreRef.current
      const sessionId = store.sessions?.find((s) =>
        s.dock?.tabs.some((t) => t.file === turn.filePath),
      )?.id
      if (!sessionId) return
      store.updateSession(sessionId, (s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: crypto.randomUUID(),
            role: 'user',
            text: turn.userText,
            ts: Date.now(),
          },
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: turn.assistantText,
            ts: Date.now() + 1,
          },
        ],
      }))
    })
  }, [])

  // P2-3 所见即所驱:有激活 dock 的会话,消息经中继转发给文档 loop
  const dockRelay = useMemo(() => {
    const dock = window.chatOfficeDock
    if (!dock) return undefined
    return {
      trySend: (sessionId: string, text: string): boolean => {
        const dockTabId = relayLink.current.activeDockOf(sessionId)
        if (!dockTabId) return false
        const full = selectionHint ? `${text}\n\n[针对文档所选片段]\n${selectionHint}` : text
        // 追加排队:忙时入队(消息照常进主线,忙→闲逐条投出)。enqueue 依据
        // 既有忙态判定,乐观置忙随后——顺序反了会把首条消息也锁进队列。
        const queued = relayLink.current.enqueue(dockTabId, full)
        relayLink.current.markBusy(dockTabId, true)
        setRelayBusy((prev) => {
          const next = new Set(prev)
          next.add(sessionId)
          return next
        })
        if (queued) return true
        dock.relayCommand(dockTabId, relaySendCommand(full))
        return true
      },
      stop: (sessionId: string): void => {
        const dockTabId = relayLink.current.activeDockOf(sessionId)
        if (!dockTabId) return
        relayLink.current.clearQueue(dockTabId)
        relayLink.current.markBusy(dockTabId, false)
        dock.relayCommand(dockTabId, relayStopCommand())
      },
      /** 该会话是否有激活 dock(有=忙时发送转为排队,而非禁用) */
      canQueue: (sessionId: string): boolean => !!relayLink.current.activeDockOf(sessionId),
      /** P2-7 确认门决议:命令发给文档 loop,确认卡原地留痕 */
      confirm: (sessionId: string, confirmId: string, approved: boolean, feedback?: string) => {
        const dockTabId = relayLink.current.activeDockOf(sessionId)
        if (dockTabId) {
          dock.relayCommand(dockTabId, { type: 'confirm', confirmId, approved, feedback })
        }
        chatStoreRef.current.updateSession(sessionId, (s) => ({
          ...s,
          messages: resolveRelayConfirm(s.messages, confirmId, approved, feedback),
        }))
      },
      busySessions: relayBusy,
      selectionHint: selectionHint ?? undefined,
      consumeSelection: () => setSelectionHint(null),
    }
  }, [relayBusy, selectionHint])

  const openChatSession = useCallback((sessionId: string) => {
    setChatOpenSignal((prev) => ({ sessionId, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])
  /** 新建任务 = a project-owned conversation shown directly under the project */
  const createTask = useCallback(
    (projectId: string) => {
      const session = chatStore.createSession({ kind: 'project', id: projectId })
      openChatSession(session.id)
    },
    [chatStore, openChatSession],
  )

  /** 左树可见会话：未归档、未移交、有内容或正是当前会话（置顶在前） */
  const liveSessions = useMemo(() => {
    const list = (chatStore.sessions ?? []).filter(
      (s) => !s.archived && !s.handedOff && (s.messages.length > 0 || s.id === chatStore.activeId),
    )
    return list.sort(byPinnedRecent)
  }, [chatStore.sessions, chatStore.activeId])

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
    void window.chatOffice.recents({ offset: 0, limit, ext }).then((page) => {
      if (seq !== requestSeq.current) return
      setEntries(page.entries)
      setListTotal(page.total)
    })
    // the always-on 收藏 section refetches alongside (small list, unfiltered)
    void window.chatOffice.starred({ offset: 0, limit: 60 }).then((page) => {
      if (seq !== requestSeq.current) return
      setStarredEntries(page.entries)
    })
    if (projectMode) {
      void window.chatOfficeProject!.listProjects().then(setProjects)
    }
  }
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  const refresh = () => {
    reloadRef.current(true)
  }

  useEffect(() => {
    reloadRef.current(false)
  }, [filter])

  useEffect(() => {
    const onFocus = () => {
      reloadRef.current(true)
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
    void window.chatOffice
      .recents({ offset: entriesLen.current, limit: PAGE_SIZE, ext })
      .then((page) => {
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
  useDismissablePopover(filterMenuOpen, () => setFilterMenuOpen(false), {
    inside: () => [filterMenuWrapRef.current],
  })

  // Escape closes the row menu, the context menu and the delete-confirm dialogs
  useEffect(() => {
    if (
      rowMenu === null &&
      confirmDelete === null &&
      confirmMissing === null &&
      ctxMenu === null &&
      confirmDeleteSession === null &&
      confirmDeleteProject === null
    )
      return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRowMenu(null)
        setConfirmDelete(null)
        setConfirmMissing(null)
        setCtxMenu(null)
        setRenamingSession(null)
        setRenamingProject(null)
        setConfirmDeleteSession(null)
        setConfirmDeleteProject(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [rowMenu, confirmDelete, confirmMissing, ctxMenu, confirmDeleteSession, confirmDeleteProject])

  // 右键 / … 菜单：统一关 dismissal + 滚动即关（固定定位弹层不能脱锚）
  useDismissablePopover(ctxMenu !== null, () => setCtxMenu(null), {
    inside: () => [ctxMenuWrapRef.current],
  })
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('scroll', close, true)
    return () => window.removeEventListener('scroll', close, true)
  }, [ctxMenu])

  // 删除确认弹窗与设置弹窗同权：弹窗期隐藏激活编辑器视图（见 useShellModalSurface）
  useShellModalSurface(
    confirmDelete !== null || confirmDeleteSession !== null || confirmDeleteProject !== null,
  )

  // ── Project files state ────────────────────────────────

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
  // 项目展开状态：各项目独立展开/折叠，互不影响；展开的项目各自加载文件
  const [expandedProjects, setExpandedProjects] = useState<string[]>([])
  const toggleProjectExpand = (id: string) => {
    setExpandedProjects((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }
  // 项目区搜索框：匹配会话标题 / 用户问题 / 文件名（跨全部项目）
  const [projQuery, setProjQuery] = useState('')

  // ── 多选删除：分区级勾选 ──
  // zone key：'proj:<项目id>' | 'recent' | 'starred'；条目 key：文件=路径、会话='chat:<sessionId>'
  const [selection, setSelection] = useState<Record<string, Set<string>>>({})
  const chatKey = (id: string) => `chat:${id}`
  const toggleSelect = (zone: string, key: string) => {
    setSelection((prev) => {
      const set = new Set(prev[zone] ?? [])
      if (set.has(key)) set.delete(key)
      else set.add(key)
      const next = { ...prev }
      if (set.size === 0) delete next[zone]
      else next[zone] = set
      return next
    })
  }
  const setZoneSelection = (zone: string, keys: string[] | null) => {
    setSelection((prev) => {
      const next = { ...prev }
      if (!keys || keys.length === 0) delete next[zone]
      else next[zone] = new Set(keys)
      return next
    })
  }
  const zoneSelected = (zone: string, key: string) => selection[zone]?.has(key) ?? false
  /** 删除/移除后把这些条目从所有分区勾选里摘掉（paths + 'chat:<id>' 混合列表） */
  const pruneSelection = (keys: string[]) => {
    if (keys.length === 0) return
    setSelection((prev) => {
      const next: Record<string, Set<string>> = {}
      for (const [zone, set] of Object.entries(prev)) {
        const remaining = new Set([...set].filter((k) => !keys.includes(k)))
        if (remaining.size > 0) next[zone] = remaining
      }
      return next
    })
  }

  const sessionMatchesQuery = (s: HomeChatSession, q: string) => {
    if (!q) return true
    if (s.title?.toLowerCase().includes(q)) return true
    return s.messages.some((m) => m.role === 'user' && m.text?.toLowerCase().includes(q))
  }

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

  /** 清理最近：removeRecent 只接受路径，先按当前筛选拉全量再整表移除 */
  const clearAllRecent = () => {
    if (listTotal === 0) return
    const ext = filter === 'all' ? undefined : filter
    void window.chatOffice
      .recents({ offset: 0, limit: listTotal, ext })
      .then((page) => removeRecent(page.entries.map((e) => e.path)))
  }

  // ── 批量操作（最近分区操作条；对话/项目两分组是 ZCode 式单行操作树）──

  const batchRemoveRecent = () => {
    const paths = [...(selection['recent'] ?? [])]
    if (paths.length === 0) return
    void window.chatOffice.removeRecent(paths).then(refresh)
    pruneSelection(paths)
  }

  const batchDeleteRecent = () => {
    const paths = [...(selection['recent'] ?? [])]
    requestDeleteSelection(paths, [])
  }
  const clearZone = (zone: string) => setZoneSelection(zone, null)

  /** 挂在待删文件下的对话会话 id（连带清理，共识：文件没了对话无意义） */
  const chatIdsUnderFiles = (paths: string[]) =>
    (chatStore.sessions ?? [])
      .filter((s) => s.scope?.kind === 'file' && paths.includes(s.scope.id) && !s.handedOff)
      .map((s) => s.id)

  const requestDeleteSelection = (paths: string[], sessionIds: string[]) => {
    if (paths.length === 0 && sessionIds.length === 0) return
    const orphan = chatIdsUnderFiles(paths).filter((id) => !sessionIds.includes(id))
    setConfirmDelete({ paths, sessionIds: [...sessionIds, ...orphan] })
  }

  const deleteFiles = (paths: string[]) => {
    setRowMenu(null)
    requestDeleteSelection(paths, [])
  }

  const confirmDeleteNow = () => {
    const pending = confirmDelete
    if (!pending) return
    setConfirmDelete(null)
    pending.sessionIds.forEach((id) => chatStore.removeSession(id))
    void window.chatOffice.deleteFiles(pending.paths).then(refresh)
    pruneSelection([...pending.paths, ...pending.sessionIds.map(chatKey)])
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
  }

  // ── New file (passes projectId when a project is selected) ──
  /** 新建落点：选中项目优先（既有行为），否则落文件树选中的文件夹（共识 Q2） */
  const newFileOpts = () =>
    selectedProjectId ? { projectId: selectedProjectId } : newFileDir ? { dir: newFileDir } : undefined

  const handleNewDoc = () => {
    void window.chatOffice.newDoc(newFileOpts())
  }

  const handleNewSheet = () => {
    void window.chatOffice.newSheet(newFileOpts())
  }

  const handleNewSlide = () => {
    void window.chatOffice.newSlide(newFileOpts())
  }

  const handleNewMarkdown = () => {
    void window.chatOffice.newMarkdown(newFileOpts())
  }

  const handleNewHtml = () => {
    void window.chatOffice.newHtml(newFileOpts())
  }

  const handleNewPdf = () => {
    void window.chatOffice.newPdf(newFileOpts())
  }

  const NEW_ITEMS = [
    { ext: 'docx', title: t('newDoc'), sub: '.docx', action: handleNewDoc },
    { ext: 'xlsx', title: t('newSheet'), sub: '.xlsx', action: handleNewSheet },
    { ext: 'pptx', title: t('newSlide'), sub: '.pptx', action: handleNewSlide },
    { ext: 'md', title: t('newMarkdown'), sub: '.md', action: handleNewMarkdown },
    { ext: 'html', title: t('newHtml'), sub: '.html', action: handleNewHtml },
    { ext: 'pdf', title: t('newPdf'), sub: '.pdf', action: handleNewPdf },
  ]

  // ── Sidebar quick actions: 「新建」collapsible group — 6 new-file rows +
  //    a divider + open-local, icon + text per row (ZCode 式分组头同款折叠) ──

  function renderSideActions() {
    return (
      <div className="side-group side-sec-new">
        <div className="side-group-head">
          <span className="side-files-title">{t('secNew')}</span>
        </div>
        <div className="side-group-body">
          <div className="side-new-grid">
            {NEW_ITEMS.map((item) => (
              <button
                key={item.ext}
                className="side-new-tile"
                title={`${item.title} (${item.sub})`}
                onClick={() => void item.action()}
              >
                <FileBadge ext={item.ext} size={22} />
                <span className="side-new-ext">{item.sub}</span>
              </button>
            ))}
          </div>
          <button
            className="side-new-browse"
            title={OPEN_LOCAL_EXTENSIONS}
            onClick={() => void window.chatOffice.browse()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M3 7a2 2 0 0 1 2-2h4.586a1 1 0 0 1 .707.293L12 7h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path d="M9 13h6M12 10v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>{t('openLocal')}</span>
          </button>
        </div>
      </div>
    )
  }

  // ── Sidebar file history (recents / starred / project files) ──

  function renderSideFileRow(
    entry: RecentEntry,
    context: 'global' | 'project',
    bare = false,
    /** which sidebar list the row belongs to — decides what the hover 删除 button does */
    list: 'recent' | 'starred' = 'recent',
    /** 多选勾选分区 key（项目树行传 'proj:<id>'；global 行由 list 推导） */
    zone?: string,
  ) {
    const isRenaming = renaming?.path === entry.path
    const otherProjects = projects.filter(
      (p) => p.id !== (context === 'project' ? selectedProjectId : undefined),
    )
    const removeLabel = list === 'starred' ? t('unstar') : t('removeFromList')
    const selectZone = zone ?? list
    const body = (
      <>
        <label className="row-check" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={zoneSelected(selectZone, entry.path)}
            onChange={() => toggleSelect(selectZone, entry.path)}
            aria-label={t('selectFile', { name: entry.name })}
          />
        </label>
        <div
          className={`side-file-main${entry.missing ? ' missing' : ''}`}
          role="button"
          tabIndex={0}
          title={
            bare
              ? `${formatModified(entry.mtimeMs, i18n)} · ${formatSize(entry.sizeBytes)} · ${entry.path}`
              : undefined
          }
          onClick={() => {
            if (!isRenaming) {
              if (entry.missing) setConfirmMissing(entry)
              else void window.chatOffice.openPath(entry.path, { dock: false })
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.target === event.currentTarget) {
              if (entry.missing) setConfirmMissing(entry)
              else void window.chatOffice.openPath(entry.path, { dock: false })
            }
          }}
        >
          <MonoFileIcon ext={entry.ext} size={16} />
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
          {/* tree rows: no inline time — the row tooltip carries time/size/path */}
          {!bare && (
            <span className="side-file-time">
              {entry.missing ? '—' : formatModified(entry.mtimeMs, i18n)}
            </span>
          )}
        </div>
        {context === 'global' && (
          <button
            className="row-remove-btn side"
            aria-label={removeLabel}
            title={removeLabel}
            onClick={(event) => {
              event.stopPropagation()
              if (list === 'starred') toggleStar(entry.path)
              else removeRecent([entry.path])
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M2.5 4h11M6 4V2.8c0-.44.36-.8.8-.8h2.4c.44 0 .8.36.8.8V4M4 4l.7 8.5c.04.55.5 1 1.05 1h4.5c.55 0 1.01-.45 1.05-1L12 4M6.6 7v4M9.4 7v4"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
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
        {bare && (
          <>
            <button
              className="row-remove-btn side"
              aria-label={t('open')}
              title={t('open')}
              onClick={(event) => {
                event.stopPropagation()
                void window.chatOffice.openPath(entry.path, { dock: false })
              }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M6.5 3.5H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 13.5h7A1.5 1.5 0 0 0 12.5 12V9.5M9.5 2.5h4v4M13 3l-5.5 5.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              className="row-remove-btn side danger"
              aria-label={t('deleteFiles')}
              title={t('deleteFiles')}
              onClick={(event) => {
                event.stopPropagation()
                deleteFiles([entry.path])
              }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M2.5 4h11M6 4V2.8c0-.44.36-.8.8-.8h2.4c.44 0 .8.36.8.8V4M4 4l.7 8.5c.04.55.5 1 1.05 1h4.5c.55 0 1.01-.45 1.05-1L12 4M6.6 7v4M9.4 7v4"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </>
        )}
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
                  void window.chatOffice.openPath(entry.path, { dock: false })
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
      </>
    )
    // bare mode: the caller adds nested chat nodes under the row — still wrap
    // in a flex .side-file row so the trailing icons stay on one line and the
    // hover-reveal selectors (`.side-file:hover …`) keep working
    return bare ? (
      <div className="side-file bare" key={entry.path}>
        {body}
      </div>
    ) : (
      <li className="side-file" key={entry.path}>
        {body}
      </li>
    )
  }

  // ── 会话树操作：归档 / 置顶 / 重命名 / 导出 / 删除 ──

  const archiveSession = (id: string) => {
    chatStore.updateSession(id, (s) => ({ ...s, archived: true }))
  }
  const unarchiveSession = (id: string) => {
    chatStore.updateSession(id, (s) => ({ ...s, archived: undefined }))
  }
  const togglePinSession = (id: string) => {
    chatStore.updateSession(id, (s) => ({ ...s, pinned: s.pinned ? undefined : true }))
  }
  const commitSessionRename = (session: HomeChatSession) => {
    const value = renamingSession?.value.trim() ?? ''
    setRenamingSession(null)
    if (!value || value === (session.title || '')) return
    chatStore.renameSession(session.id, value)
  }
  const sessionCopyText = (session: HomeChatSession): string => {
    if (session.title) return session.title
    return session.messages.find((m) => m.role === 'user')?.text ?? ''
  }
  /** assistant 文档体可能是受限 HTML：导出/复制前取纯文本 */
  const messagePlainText = (text: string): string => {
    if (!/<[a-z][\s\S]*>/i.test(text)) return text
    try {
      return new DOMParser().parseFromString(text, 'text/html').body.textContent ?? ''
    } catch {
      return text.replace(/<[^>]*>/g, '')
    }
  }
  /** 导出会话记录：整段对话转 Markdown 下载（标题做文件名） */
  const exportSessionMarkdown = (session: HomeChatSession) => {
    const lines = [`# ${session.title || t('chatUntitled')}`, '']
    for (const m of session.messages) {
      lines.push(`## ${m.role === 'user' ? t('chatExportUser') : t('chatExportAssistant')}`, '')
      lines.push((m.text ? messagePlainText(m.text) : '').trim())
      lines.push('')
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const safe = (session.title || 'chat').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
    anchor.href = url
    anchor.download = `${safe}.md`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const deleteSessionNow = () => {
    const session = confirmDeleteSession
    setConfirmDeleteSession(null)
    if (!session) return
    chatStore.removeSession(session.id)
  }

  // ── 项目树操作：新建（选本地文件夹）/ 重命名 / 删除 ──

  /** 新建项目＝选择本地文件夹（ZCode 式）：选完即以文件夹名建项目；
   *  目录选择器不可用（web shim）或选择失败时退回名输入流程 */
  const startNewProject = async () => {
    if (typeof window.chatOfficeProject?.pickFolder === 'function') {
      try {
        const picked = await window.chatOfficeProject.pickFolder()
        if (!picked) return // cancelled — nothing happens
        const name = picked.split(/[\\/]/).filter(Boolean).pop() || picked
        await window.chatOfficeProject!.createProject(name, picked)
        refresh()
        return
      } catch {
        // picker failure falls through to the name-only flow
      }
    }
    setNewProjectName('')
    setCreatingProject(true)
  }
  useEffect(() => {
    if (creatingProject) newProjectInputRef.current?.focus()
  }, [creatingProject])
  const commitNewProject = async () => {
    const name = newProjectName.trim()
    setCreatingProject(false)
    setNewProjectName('')
    if (!name) return
    try {
      await window.chatOfficeProject?.createProject(name)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
      return
    }
    refresh()
  }
  const commitProjectRename = async () => {
    if (!renamingProject) return
    const { id, value } = renamingProject
    const name = value.trim()
    setRenamingProject(null)
    if (!name) return
    try {
      await window.chatOfficeProject?.renameProject(id, name)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
      return
    }
    refresh()
  }
  const deleteProjectNow = async () => {
    const proj = confirmDeleteProject
    setConfirmDeleteProject(null)
    if (!proj) return
    try {
      await window.chatOfficeProject?.deleteProject(proj.id)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
      return
    }
    if (selectedProjectId === proj.id) setSelectedProjectId(null)
    refresh()
  }

  // ── 右键 / … 菜单 ──

  /** 打开菜单（视口坐标），底部/右缘越界时上提/左移，避免被窗口裁掉 */
  const openTreeMenu = (spec: { title?: string; items: TreeMenuEntry[] }, x: number, y: number) => {
    const rows = spec.items.filter((i) => !('divider' in i)).length
    const dividers = spec.items.length - rows
    const estHeight = (spec.title ? 30 : 0) + rows * 28 + dividers * 9 + 12
    const estWidth = 224
    const clampedY =
      y + estHeight > window.innerHeight ? Math.max(8, window.innerHeight - estHeight - 8) : y
    const clampedX =
      x + estWidth > window.innerWidth ? Math.max(8, window.innerWidth - estWidth - 8) : x
    setCtxMenu({ ...spec, x: clampedX, y: clampedY })
  }

  /** 会话菜单：打开 / 重命名 / 置顶 / 复制标题 / 导出 / 归档 / 删除 */
  function sessionMenuOf(session: HomeChatSession): { title: string; items: TreeMenuEntry[] } {
    const label = session.title || t('chatUntitled')
    return {
      title: label,
      items: [
        {
          key: 'open',
          label: t('chatOpen'),
          action: () => openChatSession(session.id),
        },
        {
          key: 'rename',
          label: t('rename'),
          action: () => setRenamingSession({ id: session.id, value: session.title || '' }),
        },
        {
          key: 'pin',
          label: session.pinned ? t('chatUnpin') : t('chatPin'),
          action: () => togglePinSession(session.id),
        },
        { divider: true, key: 'd1' },
        {
          key: 'copy',
          label: t('chatCopyTitle'),
          action: () => void navigator.clipboard.writeText(sessionCopyText(session)),
        },
        {
          key: 'export',
          label: t('chatExport'),
          action: () => exportSessionMarkdown(session),
        },
        {
          key: 'archive',
          label: session.archived ? t('chatUnarchive') : t('chatArchive'),
          action: () => (session.archived ? unarchiveSession : archiveSession)(session.id),
        },
        { divider: true, key: 'd2' },
        {
          key: 'delete',
          label: t('chatDelete'),
          danger: true,
          action: () => setConfirmDeleteSession(session),
        },
      ],
    }
  }

  /** 项目菜单：新建任务 / 查看文件 / 复制路径 / 重命名 / 删除（默认项目不可删） */
  function projectMenuOf(proj: ProjectSummaryEntry): { title: string; items: TreeMenuEntry[] } {
    const items: TreeMenuEntry[] = [
      { key: 'task', label: t('newTask'), action: () => createTask(proj.id) },
    ]
    const root = proj.rootPath
    if (root) {
      items.push({
        key: 'files',
        label: t('viewFiles'),
        action: () => void window.chatOffice.revealPath(root),
      })
      items.push({
        key: 'copypath',
        label: t('copyProjectPath'),
        action: () => void navigator.clipboard.writeText(root),
      })
    }
    items.push({ divider: true, key: 'd1' })
    items.push({
      key: 'rename',
      label: t('rename'),
      action: () => setRenamingProject({ id: proj.id, value: proj.name }),
    })
    if (!proj.isDefault) {
      items.push({ divider: true, key: 'd2' })
      items.push({
        key: 'delete',
        label: t('deleteProject'),
        danger: true,
        action: () => setConfirmDeleteProject(proj),
      })
    }
    return { title: proj.isDefault ? t('defaultProject') : proj.name, items }
  }

  /** 归档文档菜单：打开 / 取消归档 / 打开所在文件夹 / 复制路径 / 删除 */
  function archiveDocMenuOf(entry: RecentEntry): { title: string; items: TreeMenuEntry[] } {
    return {
      title: entry.name,
      items: [
        {
          key: 'open',
          label: t('open'),
          disabled: entry.missing,
          action: () => void window.chatOffice.openPath(entry.path, { dock: false }),
        },
        { key: 'unarchive', label: t('chatUnarchive'), action: () => toggleStar(entry.path) },
        { divider: true, key: 'd1' },
        {
          key: 'reveal',
          label: t('revealInFolder'),
          action: () => void window.chatOffice.revealPath(entry.path),
        },
        {
          key: 'copy',
          label: t('copyPath'),
          action: () => void navigator.clipboard.writeText(entry.path),
        },
        { divider: true, key: 'd2' },
        {
          key: 'delete',
          label: t('deleteFiles'),
          danger: true,
          action: () => deleteFiles([entry.path]),
        },
      ],
    }
  }

  /** 会话行：点击进入会话；行尾归档按钮（悬浮）；右键菜单；行内重命名 */
  function renderSessionRow(session: HomeChatSession, indent: 'chat' | 'task'): ReactElement {
    const isActive = session.id === chatStore.activeId
    const isRenaming = renamingSession?.id === session.id
    const label = session.title || t('chatUntitled')
    const owner =
      session.scope?.kind === 'project'
        ? projects.find((p) => p.id === session.scope?.id)
        : undefined
    return (
      <li key={session.id} className={`tree-chat-row${indent === 'task' ? ' task' : ''}`}>
        <div
          className={`tree-chat${isActive ? ' active' : ''}`}
          role="button"
          tabIndex={0}
          title={`${label}\n${formatModified(session.updatedAt, i18n)}${
            owner ? `\n${owner.isDefault ? t('defaultProject') : owner.name}` : ''
          }`}
          onClick={() => {
            if (!isRenaming) openChatSession(session.id)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.target === event.currentTarget && !isRenaming) {
              openChatSession(session.id)
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            openTreeMenu(sessionMenuOf(session), event.clientX, event.clientY)
          }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5A1.5 1.5 0 0 1 11.5 11H7.6L4.8 13.3a.6.6 0 0 1-1-.47V11h-.3A1.5 1.5 0 0 1 2 9.5v-5A1.5 1.5 0 0 1 3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
              transform="translate(0.5 0)"
            />
          </svg>
          {isRenaming ? (
            <input
              className="tree-chat-rename"
              value={renamingSession!.value}
              autoFocus
              onFocus={(event) => event.target.select()}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) =>
                setRenamingSession({ id: session.id, value: event.target.value })
              }
              onBlur={() => commitSessionRename(session)}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Enter') commitSessionRename(session)
                if (event.key === 'Escape') setRenamingSession(null)
              }}
            />
          ) : (
            <>
              <span className="tree-chat-title">{label}</span>
              {session.pinned && (
                <span className="tree-chat-pin" aria-label={t('chatPin')}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M4.2 11.8l1.2-3.2L11 3l2 2-5.6 5.6-3.2 1.2z"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinejoin="round"
                    />
                    <path d="M9.8 4.2l2 2" stroke="currentColor" strokeWidth="1.3" />
                  </svg>
                </span>
              )}
              <button
                className="tree-chat-archive"
                aria-label={session.archived ? t('chatUnarchive') : t('chatArchive')}
                title={session.archived ? t('chatUnarchive') : t('chatArchive')}
                onClick={(event) => {
                  event.stopPropagation()
                  if (session.archived) unarchiveSession(session.id)
                  else archiveSession(session.id)
                }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <rect
                    x="2.5"
                    y="3.2"
                    width="11"
                    height="2.4"
                    rx="0.9"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  />
                  <path
                    d="M3.7 5.6v5.6a1.2 1.2 0 0 0 1.2 1.2h6.2a1.2 1.2 0 0 0 1.2-1.2V5.6M6.5 8.4h3"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </>
          )}
        </div>
      </li>
    )
  }

  /** collapsible group header: arrow + title + count, click toggles;
   *  optional trailing controls (hover-revealed) — ZCode 式分组头 */
  function renderGroupHead(
    title: string,
    count: number,
    collapsed: boolean,
    onToggle: () => void,
    onClear?: () => void,
    clearLabel?: string,
    headExtra?: ReactElement,
    countKey: StringKey = fileCountKey(count),
  ): ReactElement {
    return (
      <div
        className="side-group-head"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.target === event.currentTarget) onToggle()
        }}
      >
        <svg
          className={`side-group-arrow${collapsed ? ' folded' : ''}`}
          width="12"
          height="12"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path
            d="M6 3.5L10.5 8L6 12.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <span className="side-files-title">{title}</span>
        <span className="side-files-count">{t(countKey, { n: count })}</span>
        {headExtra}
        {onClear && (
          <button
            className="row-remove-btn side group-clear"
            aria-label={clearLabel}
            title={clearLabel}
            onClick={(event) => {
              event.stopPropagation()
              onClear()
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M2.5 4h11M6 4V2.8c0-.44.36-.8.8-.8h2.4c.44 0 .8.36.8.8V4M4 4l.7 8.5c.04.55.5 1 1.05 1h4.5c.55 0 1.01-.45 1.05-1L12 4M6.6 7v4M9.4 7v4"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
    )
  }

  /** 「对话」tab 面板：平铺对话清单（置顶在前）；面板头部行尾 过滤+归档 两钮 */
  function renderChatsSection(): ReactElement {
    const q = chatsQuery.trim().toLowerCase()
    const visible = q ? liveSessions.filter((s) => sessionMatchesQuery(s, q)) : liveSessions
    return (
      <div
        className="side-group side-sec-chats"
        role="tabpanel"
        id="home-tree-panel-chats"
        aria-labelledby="home-tree-tab-chats"
      >
        <div className="tree-tab-head">
          <span className="tree-tab-count">
            {t(chatCountKey(visible.length), { n: visible.length })}
          </span>
          <TreeHeadBtn
            label={t('chatFilter')}
            active={chatsFilterOpen || chatsQuery !== ''}
            onClick={() => setChatsFilterOpen((v) => !v)}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M2.2 3h11.6l-4.5 5.2v4l-2.6 1.4V8.2z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
          </TreeHeadBtn>
          <TreeHeadBtn
            label={t('chatArchive')}
            active={archiveOpen}
            onClick={() => setArchiveOpen(true)}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect
                x="2.5"
                y="3.2"
                width="11"
                height="2.4"
                rx="0.9"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path
                d="M3.7 5.6v5.6a1.2 1.2 0 0 0 1.2 1.2h6.2a1.2 1.2 0 0 0 1.2-1.2V5.6M6.5 8.4h3"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </TreeHeadBtn>
        </div>
        {chatsFilterOpen && (
          <TreeFilterBar
            value={chatsQuery}
            placeholder={t('searchChats')}
            clearLabel={t('chatFilterClear')}
            closeLabel={t('chatFilterClose')}
            onChange={setChatsQuery}
            onClose={() => setChatsFilterOpen(false)}
          />
        )}
        <div className="side-group-body">
          {visible.length === 0 ? (
            <p className="side-files-empty">{q ? t('emptyChatsFiltered') : t('emptyChats')}</p>
          ) : (
            <ul className="tree-chat-list">{visible.map((s) => renderSessionRow(s, 'chat'))}</ul>
          )}
        </div>
      </div>
    )
  }

  /** 「项目」tab 面板：一级项目列表；项目行点击展开其对话清单；
   *  行尾 查看文件 / 新建任务 / 更多；面板头部 新建项目＝选择本地文件夹 */
  function renderProjectsSection(): ReactElement {
    const q = projQuery.trim().toLowerCase()
    const sessionsOf = (pid: string) =>
      liveSessions.filter((s) => s.scope?.kind === 'project' && s.scope?.id === pid)
    const visible = q
      ? projects.filter(
          (p) =>
            (p.isDefault ? t('defaultProject') : p.name).toLowerCase().includes(q) ||
            sessionsOf(p.id).some((s) => sessionMatchesQuery(s, q)),
        )
      : projects
    return (
      <div
        className="side-group side-sec-projects"
        role="tabpanel"
        id="home-tree-panel-projects"
        aria-labelledby="home-tree-tab-projects"
      >
        <div className="tree-tab-head">
          <span className="tree-tab-count">
            {t(visible.length === 1 ? 'projCountOne' : 'projCount', { n: visible.length })}
          </span>
          <TreeHeadBtn label={t('newProject')} onClick={() => void startNewProject()}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M7 1v12M1 7h12"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </TreeHeadBtn>
          <TreeHeadBtn
            label={t('chatFilter')}
            active={projFilterOpen || projQuery !== ''}
            onClick={() => setProjFilterOpen((v) => !v)}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M2.2 3h11.6l-4.5 5.2v4l-2.6 1.4V8.2z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
          </TreeHeadBtn>
          <TreeHeadBtn
            label={t('chatArchive')}
            active={archiveOpen}
            onClick={() => setArchiveOpen(true)}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect
                x="2.5"
                y="3.2"
                width="11"
                height="2.4"
                rx="0.9"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path
                d="M3.7 5.6v5.6a1.2 1.2 0 0 0 1.2 1.2h6.2a1.2 1.2 0 0 0 1.2-1.2V5.6M6.5 8.4h3"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </TreeHeadBtn>
        </div>
        {projFilterOpen && (
          <TreeFilterBar
            value={projQuery}
            placeholder={t('searchProjects')}
            clearLabel={t('chatFilterClear')}
            closeLabel={t('chatFilterClose')}
            onChange={setProjQuery}
            onClose={() => setProjFilterOpen(false)}
          />
        )}
        {creatingProject && (
          <div className="proj-new-row">
            <input
              ref={newProjectInputRef}
              className="proj-rename-input"
              placeholder={t('projectName')}
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              onBlur={() => void commitNewProject()}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Enter') void commitNewProject()
                if (event.key === 'Escape') {
                  setCreatingProject(false)
                  setNewProjectName('')
                }
              }}
            />
          </div>
        )}
        <div className="side-group-body">
          {visible.length === 0 ? (
            <p className="side-files-empty">{q ? t('emptyFiltered') : t('emptyProjects')}</p>
          ) : (
            <ul className="proj-list">
              {visible.map((proj) => {
                const projectSessions = q
                  ? sessionsOf(proj.id).filter((s) => sessionMatchesQuery(s, q))
                  : sessionsOf(proj.id)
                // 过滤命中也展开：搜索时跨项目检索，折叠的项目照样出结果
                const isExpanded =
                  expandedProjects.includes(proj.id) || (q !== '' && projectSessions.length > 0)
                const isRenaming = renamingProject?.id === proj.id
                const displayName = proj.isDefault ? t('defaultProject') : proj.name
                return (
                  <li
                    key={proj.id}
                    className={`proj-item${selectedProjectId === proj.id ? ' active' : ''}`}
                  >
                    <div
                      className="proj-item-main"
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedProjectId(proj.id)
                        toggleProjectExpand(proj.id)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && event.target === event.currentTarget) {
                          setSelectedProjectId(proj.id)
                          toggleProjectExpand(proj.id)
                        }
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        openTreeMenu(projectMenuOf(proj), event.clientX, event.clientY)
                      }}
                    >
                      <button
                        className={`proj-expand-btn${isExpanded ? ' expanded' : ''}`}
                        aria-label={isExpanded ? t('collapse') : t('expand')}
                        aria-expanded={isExpanded}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleProjectExpand(proj.id)
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                          <path
                            d="M6 3.5L10.5 8L6 12.5"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                        </svg>
                      </button>
                      {isRenaming ? (
                        <input
                          className="proj-rename-input inline"
                          value={renamingProject.value}
                          autoFocus
                          onFocus={(event) => event.target.select()}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) =>
                            setRenamingProject({ id: proj.id, value: event.target.value })
                          }
                          onBlur={() => void commitProjectRename()}
                          onKeyDown={(event) => {
                            event.stopPropagation()
                            if (event.nativeEvent.isComposing) return
                            if (event.key === 'Enter') void commitProjectRename()
                            if (event.key === 'Escape') setRenamingProject(null)
                          }}
                        />
                      ) : (
                        <span className="proj-item-name" title={displayName}>
                          {displayName}
                        </span>
                      )}
                      <span className="proj-item-meta">
                        <span className="proj-item-count">{sessionsOf(proj.id).length}</span>
                      </span>
                      {/* 行尾三钮：查看文件（绑定了文件夹才有）/ 新建任务 / 更多（右键同款菜单） */}
                      <div className="proj-menu-wrap">
                        {proj.rootPath && (
                          <button
                            className="proj-row-btn"
                            data-tip={t('viewFiles')}
                            aria-label={t('viewFiles')}
                            onClick={(event) => {
                              event.stopPropagation()
                              void window.chatOffice.revealPath(proj.rootPath!)
                            }}
                          >
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 16 16"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.1c.44 0 .85.19 1.13.52L8.4 4.4H13A1.5 1.5 0 0 1 14.5 5.9v5.6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4z"
                                stroke="currentColor"
                                strokeWidth="1.3"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        )}
                        <button
                          className="proj-row-btn"
                          data-tip={t('newTask')}
                          aria-label={t('newTask')}
                          onClick={(event) => {
                            event.stopPropagation()
                            createTask(proj.id)
                          }}
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 16 16"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="M3 4.2A1.2 1.2 0 0 1 4.2 3h7.6A1.2 1.2 0 0 1 13 4.2v4.9a1.2 1.2 0 0 1-1.2 1.2H7.9L5.6 12.4a.55.55 0 0 1-.9-.43v-1.67h-.5A1.2 1.2 0 0 1 3 9.1V4.2z"
                              stroke="currentColor"
                              strokeWidth="1.2"
                              strokeLinejoin="round"
                            />
                            <path
                              d="M8 5.4v2.6M6.7 6.7h2.6"
                              stroke="currentColor"
                              strokeWidth="1.2"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                        <button
                          className="proj-more-btn"
                          aria-label={t('projMoreActions', { name: displayName })}
                          aria-haspopup="menu"
                          onClick={(event) => {
                            event.stopPropagation()
                            const rect = event.currentTarget.getBoundingClientRect()
                            openTreeMenu(projectMenuOf(proj), rect.left, rect.bottom + 4)
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                            <circle cx="3.2" cy="8" r="1.35" fill="currentColor" />
                            <circle cx="8" cy="8" r="1.35" fill="currentColor" />
                            <circle cx="12.8" cy="8" r="1.35" fill="currentColor" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="proj-children">
                        {projectSessions.length === 0 ? (
                          <p className="side-files-empty">
                            {q ? t('emptyChatsFiltered') : t('projChatsEmpty')}
                          </p>
                        ) : (
                          <ul className="tree-chat-list">
                            {projectSessions.map((s) => renderSessionRow(s, 'task'))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    )
  }

  /** 归档视图（头部归档按钮进入）：归档的文档（原收藏）+ 归档的会话 */
  function renderArchiveView(): ReactElement {
    const archivedSessions = (chatStore.sessions ?? [])
      .filter((s) => s.archived)
      .sort(byPinnedRecent)
    return (
      <div className="archive-view">
        <div className="archive-head">
          <button
            className="archive-back"
            aria-label={t('archiveBack')}
            onClick={() => setArchiveOpen(false)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M10 3.5L5.5 8l4.5 4.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span className="archive-title">{t('archiveViewTitle')}</span>
        </div>
        <div className="archive-group">
          <div className="archive-sub">{t('archivedDocs')}</div>
          {starredEntries.length === 0 ? (
            <p className="side-files-empty">{t('archiveDocsEmpty')}</p>
          ) : (
            <ul className="side-file-list">
              {starredEntries.map((entry) => renderArchiveDocRow(entry))}
            </ul>
          )}
        </div>
        <div className="archive-group">
          <div className="archive-sub">{t('archivedChats')}</div>
          {archivedSessions.length === 0 ? (
            <p className="side-files-empty">{t('archiveChatsEmpty')}</p>
          ) : (
            <ul className="tree-chat-list">
              {archivedSessions.map((s) => renderSessionRow(s, 'chat'))}
            </ul>
          )}
        </div>
      </div>
    )
  }

  /** 归档文档行：点击打开（停靠右栏），行尾取消归档，右键菜单 */
  function renderArchiveDocRow(entry: RecentEntry): ReactElement {
    return (
      <li key={entry.path} className="archive-doc-row">
        <div
          className={`archive-doc-main${entry.missing ? ' missing' : ''}`}
          role="button"
          tabIndex={0}
          title={`${formatModified(entry.mtimeMs, i18n)} · ${formatSize(entry.sizeBytes)} · ${entry.path}`}
          onClick={() => {
            if (!entry.missing) void window.chatOffice.openPath(entry.path, { dock: false })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.target === event.currentTarget && !entry.missing) {
              void window.chatOffice.openPath(entry.path, { dock: false })
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            openTreeMenu(archiveDocMenuOf(entry), event.clientX, event.clientY)
          }}
        >
          <MonoFileIcon ext={entry.ext} size={16} />
          <span className="archive-doc-name">{entry.name}</span>
          <button
            className="tree-chat-archive"
            aria-label={t('chatUnarchive')}
            title={t('chatUnarchive')}
            onClick={(event) => {
              event.stopPropagation()
              toggleStar(entry.path)
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect
                x="2.5"
                y="3.2"
                width="11"
                height="2.4"
                rx="0.9"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path
                d="M3.7 5.6v5.6a1.2 1.2 0 0 0 1.2 1.2h6.2a1.2 1.2 0 0 0 1.2-1.2V5.6M8 9.6V7.2M6.9 8.3L8 7.2l1.1 1.1"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </li>
    )
  }
  /** always-on 最近使用 section (collapsible group; extension-style filter chips) */
  function renderRecentSection(asTab = false) {
    const selCount = selection['recent']?.size ?? 0
    return (
      <div
        className={`side-files side-sec-recent${asTab ? '' : ` side-group${layout.recentCollapsed ? ' collapsed' : ''}`}${
          selCount > 0 ? ' selecting' : ''
        }`}
      >
        {asTab ? (
          // 胶囊 Tab 形态：标题已由 Tab 表达，头部只留 计数+过滤+清空（无折叠）
          <div className="side-group-head side-seg-head">
            <span className="side-files-title">{t('secRecent')}</span>
            <span className="nav-count">{listTotal}</span>
            <span className="funnel-anchor" ref={filterMenuWrapRef}>
              <button
                className={`side-head-btn funnel${filter !== 'all' ? ' active' : ''}${filterMenuOpen ? ' open' : ''}`}
                aria-label={t('filterAria')}
                title={t('filterAria')}
                onClick={(event) => {
                  event.stopPropagation()
                  setFilterMenuOpen((v) => !v)
                }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M2.2 3h11.6l-4.5 5.2v4l-2.6 1.4V8.2z"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {filterMenuOpen && (
                <div className="funnel-menu" role="menu">
                  {RECENT_FILTERS.map((f) => (
                    <button
                      key={f.key}
                      role="menuitem"
                      className={`funnel-item${filter === f.key ? ' active' : ''}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        changeFilter(f.key)
                        setFilterMenuOpen(false)
                      }}
                    >
                      <span className="funnel-check">{filter === f.key ? '✓' : ''}</span>
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
            </span>
            <button className="side-head-btn" title={t('clearRecent')} onClick={clearAllRecent}>
              {t('clearRecent')}
            </button>
          </div>
        ) : (
        renderGroupHead(
          t('secRecent'),
          listTotal,
          layout.recentCollapsed,
          () => setHomeLayout({ recentCollapsed: !layout.recentCollapsed }),
          clearAllRecent,
          t('clearRecent'),
          <span className="funnel-anchor" ref={filterMenuWrapRef}>
            <button
              className={`side-head-btn funnel${filter !== 'all' ? ' active' : ''}${filterMenuOpen ? ' open' : ''}`}
              aria-label={t('filterAria')}
              title={t('filterAria')}
              onClick={(event) => {
                event.stopPropagation()
                setFilterMenuOpen((v) => !v)
              }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M2.2 3h11.6l-4.5 5.2v4l-2.6 1.4V8.2z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {filterMenuOpen && (
              <div className="funnel-menu" role="menu">
                {RECENT_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    role="menuitem"
                    className={`funnel-item${filter === f.key ? ' active' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      changeFilter(f.key)
                      setFilterMenuOpen(false)
                    }}
                  >
                    <span className="funnel-check">{filter === f.key ? '✓' : ''}</span>
                    {f.label}
                  </button>
                ))}
              </div>
            )}
            </span>,
        ))}
        <div className="side-group-body">
          {selCount > 0 && (
            <div className="zone-toolbar">
              <span className="zone-toolbar-label">{t('selectedCount', { n: selCount })}</span>
              <button className="zone-toolbar-btn" onClick={batchRemoveRecent}>
                {t('removeFromList')}
              </button>
              <button className="zone-toolbar-btn danger" onClick={batchDeleteRecent}>
                {t('deleteFiles')}
              </button>
              <button className="zone-toolbar-btn" onClick={() => clearZone('recent')}>
                {t('cancel')}
              </button>
            </div>
          )}
          {entries.length === 0 ? (
            <p className="side-files-empty">
              {listTotal === 0 ? t('emptyRecent') : t('emptyFiltered')}
            </p>
          ) : (
            <div className="side-files-scroll">
              <ul className="side-file-list">
                {entries.map((entry) => renderSideFileRow(entry, 'global', false, 'recent'))}
              </ul>
              {hasMore && (
                <div ref={sentinelRef} className="load-more" aria-hidden="true">
                  <span className="load-more-spinner" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`home${layout.leftCollapsed ? ' pane-left-collapsed' : ''}`}>
      {pendingUntitled.length > 0 && (
        <div className="pending-untitled-banner" role="status">
          <span>{t('unsavedDocsBanner', { count: pendingUntitled.length })}</span>
          <span className="pending-untitled-actions">
            <button
              onClick={() => {
                for (const doc of pendingUntitled)
                  void window.chatOffice.restorePendingUntitled(doc.tempPath)
                setPendingUntitled([])
              }}
            >
              {t('restoreAll')}
            </button>
            <button
              onClick={() => {
                for (const doc of pendingUntitled)
                  void window.chatOffice.discardPendingUntitled(doc.tempPath)
                setPendingUntitled([])
              }}
            >
              {t('discardAll')}
            </button>
          </span>
        </div>
      )}
      <aside
        className={`sidebar${layout.sidebarWidth < 210 ? ' narrow' : ''}`}
        style={{ width: layout.sidebarWidth }}
      >
        {renderSideActions()}

        {loggedIn && (
          <nav className="sidebar-nav">
            <button
              className={`side-sec-head-row cloud-head${cloudMode ? ' active' : ''}`}
              onClick={() => {
                setCloudMode(!cloudMode)
                setRowMenu(null)
              }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M8 1.8l1.55 4.65L14.2 8l-4.65 1.55L8 14.2 6.45 9.55 1.8 8l4.65-1.55z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="side-files-title">{t('navCloud')}</span>
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
          </nav>
        )}

        {/* ZCode 式左树：对话 | 项目 双 Tab + 最近；整体单滚动。
            归档视图打开时取代 Tab 区（收藏文档与归档会话集中于此） */}
        <div className="sidebar-scroll">
          {archiveOpen ? (
            renderArchiveView()
          ) : (
            <>
              {/* 胶囊三段 Tab：最近 | 对话 | 项目（用户 2026-09-23 明令：靠左、随文字自适应宽度） */}
              <div className="sidebar-seg" role="tablist" aria-label={t('sidebarTabList')}>
                <button
                  role="tab"
                  id="home-tree-tab-chats"
                  aria-selected={layout.activeTab === 'chats'}
                  aria-controls="home-tree-panel-chats"
                  className={`sidebar-seg-item${layout.activeTab === 'chats' ? ' active' : ''}`}
                  onClick={() => setHomeLayout({ activeTab: 'chats' })}
                >
                  {t('secChats')}
                </button>
                {projectMode && (
                  <button
                    role="tab"
                    id="home-tree-tab-projects"
                    aria-selected={layout.activeTab === 'projects'}
                    aria-controls="home-tree-panel-projects"
                    className={`sidebar-seg-item${layout.activeTab === 'projects' ? ' active' : ''}`}
                    onClick={() => setHomeLayout({ activeTab: 'projects' })}
                  >
                    {t('projects')}
                  </button>
                )}
                <button
                  role="tab"
                  id="home-tree-tab-recent"
                  aria-selected={layout.activeTab === 'recent'}
                  aria-controls="home-tree-panel-recent"
                  className={`sidebar-seg-item${layout.activeTab === 'recent' ? ' active' : ''}`}
                  onClick={() => setHomeLayout({ activeTab: 'recent' })}
                >
                  {t('secRecent')}
                </button>
              </div>
              {layout.activeTab === 'recent'
                ? renderRecentSection(true)
                : layout.activeTab === 'projects' && projectMode
                  ? renderProjectsSection()
                  : renderChatsSection()}
              {/* 上游 #757 文件树（树内联文件+全文搜索）；LOCAL: 移植进新组件，见 home-files/FileTreePane.tsx */}
              <FileTreePane selectedFolder={newFileDir} onSelectFolder={setNewFileDir} />
            </>
          )}
        </div>

        <AccountEntry
          onStatusChange={handleAccountStatus}
          settingsOpen={settingsOpen}
          onSettingsOpenChange={handleSettingsOpenChange}
        />
      </aside>

      {/* drag handle between the tree strip and the chat pane; hidden with the
          tree itself (pane-left-collapsed) via the sibling selector in CSS.
          Active state rides on the element class (not hasPointerCapture, which
          synthetic PointerEvents never satisfy) and release also listens on the
          window so a pointerup outside the 7px strip still ends the drag. */}
      <div
        ref={resizerRef}
        className="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          // capture needs an active pointer (synthetic events have none and it
          // throws NotFoundError) — it's an optimization, not a requirement:
          // the window-level pointerup below ends the drag regardless
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            /* no active pointer: drag still works, release cleanup is on window */
          }
          event.currentTarget.dataset.dragging = '1'
          document.body.classList.add('sidebar-resizing')
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.dataset.dragging) return
          setHomeLayout({ sidebarWidth: clampSidebarWidth(event.clientX) })
        }}
        onPointerUp={endSidebarDrag}
        onLostPointerCapture={endSidebarDrag}
      />

      {cloudMode ? (
        <CloudProjectsView />
      ) : (
        <>
          <div className="chat-pane">
            <ChatPanel
              store={chatStore}
              dockRelay={dockRelay}
              projectId={selectedProjectId}
              accountName={accountName}
              onOpenSettings={() => handleSettingsOpenChange(true)}
              activeScope={
                selectedProjectId ? { kind: 'project', id: selectedProjectId } : undefined
              }
              openSignal={chatOpenSignal}
              settingsRefreshNonce={settingsNonce}
              projects={projects}
            />
          </div>
        </>
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
              {confirmDelete.paths.length === 0
                ? t('deleteWithChats', { n: confirmDelete.sessionIds.length })
                : confirmDelete.paths.length === 1
                  ? t('deleteConfirmOne', { name: fileName(confirmDelete.paths[0]) })
                  : t('deleteConfirmMany', { n: confirmDelete.paths.length })}
            </p>
            {confirmDelete.sessionIds.length > 0 && confirmDelete.paths.length > 0 && (
              <p className="modal-chat-note">
                {t('deleteWithChats', { n: confirmDelete.sessionIds.length })}
              </p>
            )}
            {confirmDelete.paths.length > 1 && (
              <ul className="modal-file-list">
                {confirmDelete.paths.slice(0, 6).map((p) => (
                  <li key={p}>{fileName(p)}</li>
                ))}
                {confirmDelete.paths.length > 6 && (
                  <li>{t('deleteMoreCount', { n: confirmDelete.paths.length })}</li>
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

      {confirmMissing && (
        <div className="modal-overlay" onClick={() => setConfirmMissing(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('missingFileTitle')}
            onClick={(event) => event.stopPropagation()}
          >
            <h3>{t('missingFileTitle')}</h3>
            <p>{t('missingFileBody', { name: confirmMissing.name })}</p>
            <div className="modal-buttons">
              <button
                className="btn btn-secondary"
                autoFocus
                onClick={() => setConfirmMissing(null)}
              >
                {t('cancel')}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  // main drops the star of an unavailable entry with the row
                  removeRecent([confirmMissing.path])
                  setConfirmMissing(null)
                }}
              >
                {t('removeFromList')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 右键 / … 菜单（全树单实例，固定定位 + 边界钳制） */}
      {ctxMenu && (
        <div
          className="tree-ctx-menu"
          role="menu"
          ref={ctxMenuWrapRef}
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          {ctxMenu.title && <div className="tree-ctx-title">{ctxMenu.title}</div>}
          {ctxMenu.items.map((item) =>
            'divider' in item ? (
              <div key={item.key} className="row-menu-divider" />
            ) : (
              <button
                key={item.key}
                role="menuitem"
                className={item.danger ? 'danger' : undefined}
                disabled={item.disabled}
                onClick={() => {
                  setCtxMenu(null)
                  item.action()
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}

      {/* 删除会话确认（locale 串 "title?\nbody" 跨标题/正文拆开） */}
      {confirmDeleteSession &&
        (() => {
          const [sessionTitle, ...sessionBody] = t('chatDeleteConfirm', {
            name: confirmDeleteSession.title || t('chatUntitled'),
          }).split('\n')
          return (
            <div className="modal-overlay" onClick={() => setConfirmDeleteSession(null)}>
              <div
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-label={sessionTitle}
                onClick={(event) => event.stopPropagation()}
              >
                <h3>{sessionTitle}</h3>
                <p>{sessionBody.join('\n')}</p>
                <div className="modal-buttons">
                  <button
                    className="btn btn-secondary"
                    autoFocus
                    onClick={() => setConfirmDeleteSession(null)}
                  >
                    {t('cancel')}
                  </button>
                  <button className="btn btn-danger" onClick={deleteSessionNow}>
                    {t('delete')}
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

      {/* 删除项目确认 */}
      {confirmDeleteProject &&
        (() => {
          const [projTitle, ...projBody] = t('deleteProjectConfirm').split('\n')
          return (
            <div className="modal-overlay" onClick={() => setConfirmDeleteProject(null)}>
              <div
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-label={projTitle}
                onClick={(event) => event.stopPropagation()}
              >
                <h3>{projTitle}</h3>
                <p>{projBody.join('\n')}</p>
                <div className="modal-buttons">
                  <button
                    className="btn btn-secondary"
                    autoFocus
                    onClick={() => setConfirmDeleteProject(null)}
                  >
                    {t('cancel')}
                  </button>
                  <button className="btn btn-danger" onClick={() => void deleteProjectNow()}>
                    {t('delete')}
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

      <DropToOpenOverlay />
    </div>
  )
}
