import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
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
import { fileCountKey } from './counts'
import { MonoFileIcon } from './file-icons'
import { useI18n } from './locale'
import type { I18n, StringKey } from './locale'
import { SettingsModal } from './SettingsModal'
import { ChatPanel } from './home-chat/ChatPanel'
import { refreshHomeModelCache } from './home-chat/bridge'
import { useHomeChatStore } from './home-chat/store'
import {
  clampSidebarWidth,
  clampDockWidth,
  getHomeLayout,
  onHomeLayoutChange,
  setHomeLayout,
} from './home-layout'
import { DockPane } from './DockPane'
import { restoreDockTabs, snapshotFromTabs } from './dock-session'
import {
  applyRelayEvent,
  RelaySessionLink,
  relaySeedCommand,
  relaySendCommand,
  relayStopCommand,
} from './home-chat/relay-client'
import type { DockTabSummary } from '../../shared/dock-api'

declare global {
  interface Window {
    chatOffice: HomeApi
    chatOfficeProject?: ProjectHomeApi
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

// ── Project sidebar component ────────────────────────────

interface ProjectPanelProps {
  projects: ProjectSummaryEntry[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onRefresh: () => void
  /** 新建任务: a project-owned chat session (P2 tree level 1→chat) */
  onCreateTask?: (id: string) => void
  /**
   * tree body of the selected project (its tasks + files, already indented by
   * .proj-children) — rendered inside the project's row so the project name
   * reads as the parent node of everything below it
   */
  renderChildren?: (id: string) => ReactElement | null
  /** 展开中的项目（各自独立，互不影响；展开状态由用户手动维护） */
  expandedIds: string[]
  onToggleExpand: (id: string) => void
  /** 多选：项目行级联勾选状态（半选由 indeterminate 表达） */
  projectSelect?: (id: string) => { checked: boolean; indeterminate: boolean }
  onToggleProjectSelect?: (id: string) => void
  /** 项目区批量操作条（跨项目共一条，由父级聚合渲染在标题行下） */
  toolbar?: React.ReactNode
}

function ProjectPanel({
  projects,
  selectedId,
  onSelect,
  onRefresh,
  onCreateTask,
  renderChildren,
  expandedIds,
  onToggleExpand,
  projectSelect,
  onToggleProjectSelect,
  toolbar,
}: ProjectPanelProps) {
  const { t } = useI18n()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  /** P4 folder binding awaiting the name input (null = name-only project) */
  const [pendingRootPath, setPendingRootPath] = useState<string | null>(null)
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

  const startCreating = async () => {
    // P4: binding to a real folder comes first. The OS directory picker is
    // desktop-only; when unavailable (web shim) the flow degrades to the old
    // name-only project.
    let rootPath: string | undefined
    let suggested = ''
    if (typeof window.chatOfficeProject?.pickFolder === 'function') {
      try {
        const picked = await window.chatOfficeProject.pickFolder()
        if (picked === null) return // cancelled — do not enter creating mode
        rootPath = picked
        suggested = picked.split(/[\\/]/).filter(Boolean).pop() ?? ''
      } catch {
        // picker failure falls through to the name-only flow
      }
    }
    setNewName(suggested)
    setPendingRootPath(rootPath ?? null)
    setCreating(true)
  }

  const commitCreate = async () => {
    const name = newName.trim()
    const rootPath = pendingRootPath
    setCreating(false)
    setNewName('')
    setPendingRootPath(null)
    if (!name) return
    try {
      await window.chatOfficeProject?.createProject(name, rootPath ?? undefined)
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
  // 项目节点折叠：与 收藏/最近 同级的可展开树节点（各自独立，互不影响）
  const [collapsed, setCollapsed] = useState(false)

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

  // 删除项目确认弹窗同权：弹窗期隐藏激活编辑器视图（见 useShellModalSurface）
  useShellModalSurface(confirmDeleteId !== null)

  return (
    <div className="proj-panel">
      <div
        className="proj-panel-head"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.target === event.currentTarget) {
            setCollapsed((v) => !v)
          }
        }}
      >
        <svg
          className={`proj-panel-arrow${collapsed ? ' folded' : ''}`}
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
        <span className="proj-panel-title">{t('projects')}</span>
        <button
          className="proj-add-btn"
          data-tip={t('newProject')}
          aria-label={t('newProject')}
          onClick={(event) => {
            event.stopPropagation()
            setCollapsed(false)
            void startCreating()
          }}
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

      {toolbar}

      {!collapsed && creating && (
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
                setPendingRootPath(null)
              }
            }}
          />
          {pendingRootPath && (
            <p className="proj-new-root" title={pendingRootPath}>
              {pendingRootPath}
            </p>
          )}
        </div>
      )}

      <ul className="proj-list" style={collapsed ? { display: 'none' } : undefined}>
        {projects.map((proj) => {
          const isActive = selectedId === proj.id
          const isExpanded = expandedIds.includes(proj.id)
          const isRenaming = renaming?.id === proj.id
          return (
            <li key={proj.id} className={`proj-item${isActive ? ' active' : ''}`}>
              <div
                className="proj-item-main"
                role="button"
                tabIndex={0}
                onClick={() => {
                  onSelect(proj.id)
                  onToggleExpand(proj.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onSelect(proj.id)
                    onToggleExpand(proj.id)
                  }
                }}
              >
                {projectSelect &&
                  (() => {
                    const info = projectSelect(proj.id)
                    return (
                      <input
                        ref={(el) => {
                          if (el) el.indeterminate = info.indeterminate
                        }}
                        type="checkbox"
                        className="proj-check"
                        checked={info.checked}
                        onChange={() => onToggleProjectSelect?.(proj.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={t('selectFile', {
                          name: proj.isDefault ? t('defaultProject') : proj.name,
                        })}
                      />
                    )
                  })()}
                <button
                  className={`proj-expand-btn${isExpanded ? ' expanded' : ''}`}
                  aria-label={isExpanded ? t('collapse') : t('expand')}
                  aria-expanded={isExpanded}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleExpand(proj.id)
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
                  <span
                    className="proj-item-name"
                    title={proj.isDefault ? t('defaultProject') : proj.name}
                  >
                    {proj.isDefault ? t('defaultProject') : proj.name}
                  </span>
                )}
                <span className="proj-item-meta">
                  <span className="proj-item-count">{proj.fileCount}</span>
                  {onCreateTask && (
                    <button
                      className="proj-task-btn"
                      data-tip={t('newTask')}
                      aria-label={t('newTask')}
                      onClick={(e) => {
                        e.stopPropagation()
                        onCreateTask(proj.id)
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
                  )}
                </span>
                {/* 直接可见的删除入口（共识：默认项目不可删，无图标无菜单） */}
                {!proj.isDefault && (
                  <button
                    className="proj-delete-btn"
                    data-tip={t('deleteProject')}
                    aria-label={t('deleteProject')}
                    onClick={(e) => {
                      e.stopPropagation()
                      doDelete(proj.id)
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
                {/* lives INSIDE the row (not the li) so its absolute strip only
                    covers the row itself — over the expanded children it would
                    swallow clicks meant for their trailing icons */}
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
              </div>

              {isExpanded && renderChildren && (
                <div className="proj-children">{renderChildren(proj.id)}</div>
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

  // login progress pushed from main (chatoffice login CLI output)
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
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const newMenuWrapRef = useRef<HTMLSpanElement>(null)
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const filterMenuWrapRef = useRef<HTMLSpanElement>(null)
  // actions cell (… button + menu) of the row whose menu is open — the dismissal guard root
  const rowMenuWrapRef = useRef<HTMLSpanElement>(null)
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null)
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

  // dock pane splitter: same contract as the sidebar's (active state rides on
  // the element class; a window-level pointerup ends drags that leave the strip)
  const dockResizerRef = useRef<HTMLDivElement>(null)
  const endDockDrag = useCallback(() => {
    if (dockResizerRef.current) delete dockResizerRef.current.dataset.dragging
    document.body.classList.remove('dock-resizing')
  }, [])
  useEffect(() => {
    window.addEventListener('pointerup', endDockDrag)
    return () => window.removeEventListener('pointerup', endDockDrag)
  }, [endDockDrag])

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
  const handleDockTabs = useCallback((tabs: DockTabSummary[]) => {
    const store = chatStoreRef.current
    const session = store.active
    if (!session) return
    if (tabs.length === 0) {
      if (session.dock) store.updateSession(session.id, (s) => ({ ...s, dock: undefined }))
      relayLink.current.forgetSession(session.id)
      return
    }
    store.updateSession(session.id, (s) => ({ ...s, dock: snapshotFromTabs(tabs) }))
    // 新绑定的 dock:种子化(Q4'' 铁律入口)——主线转录一次种进文档 loop
    const added = relayLink.current.setSessionDocks(
      session.id,
      tabs.map((t) => t.id),
    )
    const sessionMessages = store.sessions?.find((x) => x.id === session.id)?.messages ?? []
    // 切换激活 dock = 换中继目标:目标 loop 重种子(确定性重放)
    const nowActive = tabs.find((t) => t.active)?.id
    if (nowActive && relayLink.current.activeDockOf(session.id) !== nowActive) {
      relayLink.current.setActiveDock(nowActive)
      added.push(nowActive)
    }
    for (const dockTabId of added) {
      void window.chatOfficeDock?.relayCommand(dockTabId, relaySeedCommand(sessionMessages))
    }
  }, [])
  const dockRestoreSessionId = chatStore.activeId
  useEffect(() => {
    const dock = window.chatOfficeDock
    if (!dock || !dockRestoreSessionId) return
    const session = chatStoreRef.current.sessions?.find((s) => s.id === dockRestoreSessionId)
    if (!session?.dock) return
    // dock.open dedupes by file, so already-docked tabs are reused, not reopened
    void restoreDockTabs(dock, session.dock).catch(() => undefined)
  }, [dockRestoreSessionId])

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
        return
      }
      if (event.type === 'context') {
        // 圈选标注:仅当前激活会话显示提示(事件本就只来自其绑定的 dock)
        if (relayLink.current.activeDockOf(sessionId) === dockTabId) {
          setSelectionHint(event.context.text)
        }
        return
      }
      if (
        event.type === 'turn-finished' ||
        event.type === 'confirm-request' ||
        event.type === 'snapshot'
      )
        return
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
        dock.relayCommand(dockTabId, relaySendCommand(full))
        return true
      },
      stop: (sessionId: string): void => {
        const dockTabId = relayLink.current.activeDockOf(sessionId)
        if (dockTabId) dock.relayCommand(dockTabId, relayStopCommand())
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
  /** a conversation attached to a file (tree level 3) */
  const createFileChat = useCallback(
    (filePath: string) => {
      const session = chatStore.createSession({ kind: 'file', id: filePath })
      openChatSession(session.id)
    },
    [chatStore, openChatSession],
  )

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

  // refresh signal for project-view data (re-pull file stats after file changes)
  const [projectTick, setProjectTick] = useState(0)

  const refresh = () => {
    reloadRef.current(true)
    setProjectTick((n) => n + 1)
  }

  useEffect(() => {
    reloadRef.current(false)
  }, [filter])

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
  useDismissablePopover(newMenuOpen, () => setNewMenuOpen(false), {
    inside: () => [newMenuWrapRef.current],
  })
  useDismissablePopover(filterMenuOpen, () => setFilterMenuOpen(false), {
    inside: () => [filterMenuWrapRef.current],
  })

  // Escape closes the row menu and the delete-confirm dialog
  useEffect(() => {
    if (rowMenu === null && confirmDelete === null && confirmMissing === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRowMenu(null)
        setConfirmDelete(null)
        setConfirmMissing(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [rowMenu, confirmDelete, confirmMissing])

  // 删除确认弹窗与设置弹窗同权：弹窗期隐藏激活编辑器视图（见 useShellModalSurface）
  useShellModalSurface(confirmDelete !== null)

  // ── Project files state ────────────────────────────────

  const [projectFilesMap, setProjectFilesMap] = useState<Record<string, RecentEntry[]>>({})
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

  // 搜索时跨全部项目检索 → 需要加载所有项目的文件列表；否则只加载展开的
  const projectLoadIds = useMemo(
    () => (projQuery.trim() ? projects.map((p) => p.id) : expandedProjects),
    [projQuery, projects, expandedProjects],
  )

  useEffect(() => {
    if (!projectMode || projectLoadIds.length === 0) {
      if (projectMode && !projQuery.trim()) setProjectFilesMap({})
      return
    }
    let active = true
    const api = window.chatOfficeProject!
    for (const id of projectLoadIds) {
      void api.listFiles(id).then(async (paths) => {
        const stats = await window.chatOffice.statPaths(paths)
        if (!active) return
        setProjectFilesMap((prev) => ({
          ...prev,
          [id]: stats.sort((a, b) => b.mtimeMs - a.mtimeMs),
        }))
      })
    }
    return () => {
      active = false
    }
  }, [projectMode, projectLoadIds, projectTick, projQuery])

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

  // ── 批量操作（分区操作条）──

  /** 项目区勾选统计（跨项目聚合，文件/会话分开计数） */
  const projSelectionStats = () => {
    let files = 0
    let chats = 0
    for (const [zone, set] of Object.entries(selection)) {
      if (!zone.startsWith('proj:')) continue
      for (const k of set) {
        if (k.startsWith('chat:')) chats++
        else files++
      }
    }
    return { files, chats }
  }
  const hasProjSelection = Object.keys(selection).some((k) => k.startsWith('proj:'))

  const batchDeleteProjectSelection = () => {
    const paths: string[] = []
    const sessionIds: string[] = []
    for (const [zone, set] of Object.entries(selection)) {
      if (!zone.startsWith('proj:')) continue
      for (const k of set) {
        if (k.startsWith('chat:')) sessionIds.push(k.slice(5))
        else paths.push(k)
      }
    }
    requestDeleteSelection(paths, sessionIds)
  }

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

  const batchUnstar = () => {
    const paths = [...(selection['starred'] ?? [])]
    if (paths.length === 0) return
    void Promise.all(paths.map((p) => window.chatOffice.toggleStar(p))).then(refresh)
    pruneSelection(paths)
  }

  // ── 项目行级联勾选：勾项目 = 勾中它下面全部文件 + 任务会话 + 文件下对话 ──
  const projectCascadeKeys = (projectId: string): string[] => {
    const sessions = chatStore.sessions ?? []
    const files = (projectFilesMap[projectId] ?? []).map((e) => e.path)
    const taskKeys = sessions
      .filter((s) => s.scope?.kind === 'project' && s.scope?.id === projectId && !s.handedOff)
      .map((s) => chatKey(s.id))
    const chatKeys = sessions
      .filter((s) => s.scope?.kind === 'file' && files.includes(s.scope.id) && !s.handedOff)
      .map((s) => chatKey(s.id))
    return [...files, ...taskKeys, ...chatKeys]
  }
  const projectSelectInfo = (projectId: string) => {
    const set = selection[`proj:${projectId}`]
    const keys = projectCascadeKeys(projectId)
    const sel = keys.filter((k) => set?.has(k)).length
    return {
      checked: keys.length > 0 && sel === keys.length,
      indeterminate: sel > 0 && sel < keys.length,
    }
  }
  const toggleProjectSelect = (projectId: string) => {
    const info = projectSelectInfo(projectId)
    setZoneSelection(`proj:${projectId}`, info.checked ? null : projectCascadeKeys(projectId))
  }
  const clearProjSelection = () =>
    setSelection((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith('proj:'))),
    )
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
    if (selectedProjectId) {
      setProjectFilesMap((prev) => {
        const list = prev[selectedProjectId]
        if (!list) return prev
        return { ...prev, [selectedProjectId]: list.filter((e) => e.path !== filePath) }
      })
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

  const handleNewHtml = () => {
    void window.chatOffice.newHtml(selectedProjectId ? { projectId: selectedProjectId } : undefined)
  }

  const handleNewPdf = () => {
    void window.chatOffice.newPdf(selectedProjectId ? { projectId: selectedProjectId } : undefined)
  }

  const NEW_ITEMS = [
    { ext: 'docx', title: t('newDoc'), sub: '.docx', action: handleNewDoc },
    { ext: 'xlsx', title: t('newSheet'), sub: '.xlsx', action: handleNewSheet },
    { ext: 'pptx', title: t('newSlide'), sub: '.pptx', action: handleNewSlide },
    { ext: 'md', title: t('newMarkdown'), sub: '.md', action: handleNewMarkdown },
    { ext: 'html', title: t('newHtml'), sub: '.html', action: handleNewHtml },
    { ext: 'pdf', title: t('newPdf'), sub: '.pdf', action: handleNewPdf },
  ]

  // ── Sidebar quick actions (top-left launcher: new/open) ──

  function renderSideActions() {
    return (
      <div className="side-launcher">
        <span className="launch-anchor" ref={newMenuWrapRef}>
          <button
            className={`launch-btn primary${newMenuOpen ? ' open' : ''}`}
            aria-expanded={newMenuOpen}
            onClick={() => setNewMenuOpen((v) => !v)}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M7 1v12M1 7h12"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
            <span className="launch-label">{t('new')}</span>
            <svg
              className="launch-chevron"
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 6l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {newMenuOpen && (
            <div className="launch-menu" role="menu">
              <div className="launch-grid">
                {NEW_ITEMS.map((item) => (
                  <button
                    key={item.ext}
                    className="launch-item"
                    role="menuitem"
                    title={item.sub}
                    onClick={() => {
                      setNewMenuOpen(false)
                      void item.action()
                    }}
                  >
                    <FileBadge ext={item.ext} size={30} />
                    <span className="launch-item-label">{item.title}</span>
                    <span className="launch-item-sub">{item.sub}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </span>
        <button
          className="launch-btn secondary"
          title={OPEN_LOCAL_EXTENSIONS}
          onClick={() => void window.chatOffice.browse()}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.1c.44 0 .85.19 1.13.52L8.4 4.4H13A1.5 1.5 0 0 1 14.5 5.9v5.6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
          <span className="launch-label">{t('openLocal')}</span>
        </button>
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
              else void window.chatOffice.openPath(entry.path)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.target === event.currentTarget) {
              if (entry.missing) setConfirmMissing(entry)
              else void window.chatOffice.openPath(entry.path)
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
                void window.chatOffice.openPath(entry.path)
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
              {context === 'project' && (
                <>
                  <div className="row-menu-divider" />
                  <button role="menuitem" onClick={() => createFileChat(entry.path)}>
                    {t('newFileChat')}
                  </button>
                </>
              )}
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

  /** one chat-session node in the tree (a task under a project, or a chat under a file) */
  function renderTreeChat(
    session: HomeChatSession,
    depth: 'task' | 'chat',
    zone?: string,
  ): ReactElement {
    const activeCls = session.id === chatStore.activeId ? ' active' : ''
    return (
      <li key={session.id} className={`tree-chat-row${depth === 'task' ? ' task' : ''}`}>
        {zone && (
          <label className="row-check" onClick={(event) => event.stopPropagation()}>
            <input
              type="checkbox"
              checked={zoneSelected(zone, chatKey(session.id))}
              onChange={() => toggleSelect(zone, chatKey(session.id))}
              aria-label={t('selectFile', { name: session.title || t('chatUntitled') })}
            />
          </label>
        )}
        <button
          className={`tree-chat${activeCls}`}
          title={session.title || t('chatUntitled')}
          onClick={() => openChatSession(session.id)}
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
          <span className="tree-chat-title">{session.title || t('chatUntitled')}</span>
        </button>
      </li>
    )
  }

  /** files of an expanded project: tasks (project chats) first, then files
   *  each with its attached chats — the 项目→文件→对话 three levels. Rendered
   *  INSIDE the project's row (ProjectPanel renderChildren) so the
   *  children sit directly under the project name — no separate section head.
   *  `query` filters by session title / user question text / file name. */
  function renderProjectFiles(projectId: string, query = '') {
    if (!projectMode || !projectId) return null
    const q = query.trim().toLowerCase()
    const projectPool = (chatStore.sessions ?? []).filter(
      (s) => s.scope?.kind === 'project' && s.scope?.id === projectId && !s.handedOff,
    )
    const tasks = q
      ? projectPool.filter((s) => sessionMatchesQuery(s, q))
      : projectPool.filter((s) => s.messages.length > 0 || s.id === chatStore.activeId)
    const allFiles = projectFilesMap[projectId] ?? []
    const fileEntries = q ? allFiles.filter((e) => e.name.toLowerCase().includes(q)) : allFiles
    /** chats attached to a file node; searching looks at titles + user questions */
    const chatsFor = (path: string) => {
      const pool = (chatStore.sessions ?? []).filter(
        (s) => s.scope?.kind === 'file' && s.scope?.id === path && !s.handedOff,
      )
      if (q) return pool.filter((s) => sessionMatchesQuery(s, q))
      return pool.filter((s) => s.messages.length > 0 || s.id === chatStore.activeId)
    }
    const zone = `proj:${projectId}`
    return (
      <>
        {tasks.length > 0 && (
          <ul className="tree-chat-list">{tasks.map((s) => renderTreeChat(s, 'task', zone))}</ul>
        )}
        {fileEntries.length === 0 ? (
          tasks.length === 0 ? (
            q ? null : (
              <p className="side-files-empty">{t('projEmptyHint')}</p>
            )
          ) : null
        ) : (
          <ul className="side-file-list">
            {fileEntries.map((entry) => (
              <li key={entry.path} className="side-file-group">
                {renderSideFileRow(entry, 'project', true, 'recent', zone)}
                {(() => {
                  const chats = chatsFor(entry.path)
                  return chats.length > 0 ? (
                    <ul className="tree-chat-list nested">
                      {chats.map((s) => renderTreeChat(s, 'chat', zone))}
                    </ul>
                  ) : null
                })()}
              </li>
            ))}
          </ul>
        )}
      </>
    )
  }

  /** does the project hold anything matching the search (files, tasks, file chats)? */
  function projectHasMatch(projectId: string, q: string) {
    if (!q) return false
    const files = projectFilesMap[projectId] ?? []
    if (files.some((e) => e.name.toLowerCase().includes(q))) return true
    const sessions = chatStore.sessions ?? []
    return sessions.some(
      (s) =>
        !s.handedOff &&
        sessionMatchesQuery(s, q) &&
        (s.scope?.kind === 'project'
          ? s.scope.id === projectId
          : s.scope?.kind === 'file' && files.some((e) => e.path === s.scope?.id)),
    )
  }

  /** collapsible group header: arrow + title + count, click toggles;
   *  optional trailing 清理 button (hover-revealed) for bulk removal */
  function renderGroupHead(
    title: string,
    count: number,
    collapsed: boolean,
    onToggle: () => void,
    onClear?: () => void,
    clearLabel?: string,
    headExtra?: ReactElement,
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
        <span className="side-files-count">{t(fileCountKey(count), { n: count })}</span>
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

  /** always-on 收藏 section (collapsible group) */
  function renderStarredSection() {
    const selCount = selection['starred']?.size ?? 0
    return (
      <div
        className={`side-files side-sec-starred side-group${
          layout.starredCollapsed ? ' collapsed' : ''
        }${selCount > 0 ? ' selecting' : ''}`}
      >
        {renderGroupHead(t('secStarred'), starredEntries.length, layout.starredCollapsed, () =>
          setHomeLayout({ starredCollapsed: !layout.starredCollapsed }),
        )}
        <div className="side-group-body">
          {selCount > 0 && (
            <div className="zone-toolbar">
              <span className="zone-toolbar-label">{t('selectedCount', { n: selCount })}</span>
              <button className="zone-toolbar-btn" onClick={batchUnstar}>
                {t('unstar')}
              </button>
              <button className="zone-toolbar-btn" onClick={() => clearZone('starred')}>
                {t('cancel')}
              </button>
            </div>
          )}
          {starredEntries.length === 0 ? (
            <p className="side-files-empty">{t('emptyStarred')}</p>
          ) : (
            <ul className="side-file-list">
              {starredEntries.map((entry) => renderSideFileRow(entry, 'global', false, 'starred'))}
            </ul>
          )}
        </div>
      </div>
    )
  }

  /** always-on 最近使用 section (collapsible group; extension-style filter chips) */
  function renderRecentSection() {
    const selCount = selection['recent']?.size ?? 0
    return (
      <div
        className={`side-files side-sec-recent side-group${
          layout.recentCollapsed ? ' collapsed' : ''
        }${selCount > 0 ? ' selecting' : ''}`}
      >
        {renderGroupHead(
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
        )}
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
    <div
      className={`home${layout.leftCollapsed ? ' pane-left-collapsed' : ''}${
        layout.rightCollapsed ? ' pane-right-collapsed' : ''
      }`}
    >
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

        {/* four stacked sections; the whole stack scrolls as one so the tree
            can grow in later phases without nested scrollbars */}
        <div className="sidebar-scroll">
          {projectMode && (
            <div className={`side-sec${hasProjSelection ? ' selecting' : ''}`}>
              <div className="proj-search">
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
                  className="proj-search-input"
                  placeholder={t('projSearchPlaceholder')}
                  value={projQuery}
                  onChange={(e) => setProjQuery(e.target.value)}
                />
                {projQuery && (
                  <button
                    className="proj-search-clear"
                    aria-label={t('cancel')}
                    onClick={() => setProjQuery('')}
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
              <ProjectPanel
                projects={projects}
                selectedId={selectedProjectId}
                onSelect={(id) => {
                  setSelectedProjectId(id)
                  setRowMenu(null)
                }}
                onRefresh={refresh}
                onCreateTask={createTask}
                expandedIds={expandedProjects}
                onToggleExpand={toggleProjectExpand}
                projectSelect={projectSelectInfo}
                onToggleProjectSelect={toggleProjectSelect}
                toolbar={
                  hasProjSelection ? (
                    <div className="zone-toolbar">
                      <span className="zone-toolbar-label">
                        {(() => {
                          const s = projSelectionStats()
                          return t('selectedFilesChats', { n: s.files, m: s.chats })
                        })()}
                      </span>
                      <button
                        className="zone-toolbar-btn danger"
                        onClick={batchDeleteProjectSelection}
                      >
                        {t('deleteFiles')}
                      </button>
                      <button className="zone-toolbar-btn" onClick={clearProjSelection}>
                        {t('cancel')}
                      </button>
                    </div>
                  ) : undefined
                }
                renderChildren={(id) => {
                  const q = projQuery.trim().toLowerCase()
                  const show = expandedProjects.includes(id) || (q !== '' && projectHasMatch(id, q))
                  return show ? renderProjectFiles(id, q) : null
                }}
              />
            </div>
          )}
          {renderStarredSection()}
          {renderRecentSection()}
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
          <ChatPanel
            store={chatStore}
            dockRelay={dockRelay}
            projectId={selectedProjectId}
            accountName={accountName}
            onOpenSettings={() => handleSettingsOpenChange(true)}
            activeScope={selectedProjectId ? { kind: 'project', id: selectedProjectId } : undefined}
            openSignal={chatOpenSignal}
            settingsRefreshNonce={settingsNonce}
            projects={projects}
          />
          {/* drag handle between the conversation and the dock pane; hidden
              with the pane itself (pane-right-collapsed) via the sibling
              selector in CSS */}
          <div
            ref={dockResizerRef}
            className="dock-resizer"
            role="separator"
            aria-orientation="vertical"
            onPointerDown={(event) => {
              if (event.button !== 0) return
              try {
                event.currentTarget.setPointerCapture(event.pointerId)
              } catch {
                /* synthetic events have no active pointer — the window-level
                   pointerup below ends the drag regardless */
              }
              event.currentTarget.dataset.dragging = '1'
              document.body.classList.add('dock-resizing')
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.dataset.dragging) return
              // the pane's left edge: width = window right minus pointer x
              setHomeLayout({ dockWidth: clampDockWidth(window.innerWidth - event.clientX) })
            }}
            onPointerUp={endDockDrag}
            onLostPointerCapture={endDockDrag}
          />

          {/* right content pane: docked editor views (P1) borrow this rect —
              the editors are main-process WebContentsViews painting over the
              .dock-area element's mirrored rectangle */}
          <section
            className="content-pane"
            style={layout.dockWidth ? { width: layout.dockWidth, flex: 'none' } : undefined}
          >
            <DockPane onTabs={handleDockTabs} />
          </section>
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

      <DropToOpenOverlay />
    </div>
  )
}
