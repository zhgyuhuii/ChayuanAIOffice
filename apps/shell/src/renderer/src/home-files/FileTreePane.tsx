/**
 * Home 左栏「文件」面板：全文搜索框 + 文件夹树 + 树内联文件。
 *
 * 文件夹树/移动选择器/同名冲突/拖拽/搜索渲染移植自上游 #757 Home（efb9247），
 * 按 2026-09-23 共识做四处本地形态调整（其余逻辑逐行照搬上游）：
 * 1) 文件内联展开在树节点下（上游是主区表格）；2) 树内文件行无多选框（窄栏，
 * 单文件操作走行菜单）；3) 搜索框在本面板头部，搜索态替换树内容（无类型过滤）；
 * 4) Jev 重排设置入口不织入（本地 V2 设置面），重排本身照常生效。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, ReactElement } from 'react'
import iconDocx from '../assets/file-docx.png'
import iconXlsx from '../assets/file-xlsx.png'
import iconPptx from '../assets/file-pptx.png'
import iconPdf from '../assets/file-pdf.png'
import iconMd from '../assets/file-md.png'
import iconHtml from '../assets/file-html.png'
import iconDwg from '../assets/file-dwg.png'
import iconMind from '../assets/file-mind.png'
import { useDismissablePopover } from '@chatoffice/ui'
import { markText } from '../../../shared/text-marks'
import { useI18n } from '../locale'
import type { I18n } from '../locale'
import type {
  FileEntry,
  FileSearchHit,
  FileSearchPage,
  FileSearchRerank,
  FolderListing,
  FolderRoot,
  MoveConflictPolicy,
  RecentEntry,
} from '../../../shared/home-api'

const TREE_STATE_KEY = 'home.folderTree'

/** 行拖拽的载荷 MIME（树行 → 文件夹行移动；渲染层自产自销，两端一致即可） */
const DRAG_PATHS_MIME = 'application/x-chatoffice-paths'
const DRAG_EXPAND_DELAY_MS = 600

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

export function FileBadge({ ext, size }: { ext: string; size: number }) {
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
        fontWeight={700}
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
      >
        {label}
      </text>
    </svg>
  )
}

function FolderIcon({ size = 16, open = false }: { size?: number; open?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.1c.44 0 .85.19 1.13.52L8.4 4.4H13A1.5 1.5 0 0 1 14.5 5.9v5.6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        fill={open ? 'currentColor' : 'none'}
        fillOpacity={open ? 0.12 : 0}
      />
    </svg>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.12s' }}
    >
      <path
        d="M4.5 2.5l4 3.5-4 3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

function MoreDots() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.2" cy="8" r="1.35" fill="currentColor" />
      <circle cx="8" cy="8" r="1.35" fill="currentColor" />
      <circle cx="12.8" cy="8" r="1.35" fill="currentColor" />
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

// ── 路径助手（上游原样） ─────────────────────────────────────

function splitPath(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean)
}

export function dirOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (cut < 0) return path
  // keep the separator on a filesystem root ("/" or "C:\") instead of an empty or bare-drive string
  const dir = path.slice(0, cut)
  return dir === '' || /^[A-Za-z]:$/.test(dir) ? path.slice(0, cut + 1) : dir
}

export function isUnder(root: string, path: string): boolean {
  if (path === root) return true
  // a root that already ends with a separator ("/" or "C:\") must not get a second one
  if (/[\\/]$/.test(root)) return path.startsWith(root)
  return path.startsWith(root + '/') || path.startsWith(root + '\\')
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** the root that holds `path`; the deepest one when roots nest */
export function rootOf(path: string, roots: readonly FolderRoot[]): FolderRoot | null {
  let best: FolderRoot | null = null
  for (const root of roots) {
    if (isUnder(root.path, path) && (!best || root.path.length > best.path.length)) best = root
  }
  return best
}

/** "Clients / Contracts" for a file under a root; the parent folder name elsewhere */
export function locationLabel(path: string, roots: readonly FolderRoot[]): string {
  const dir = dirOf(path)
  const owner = rootOf(dir, roots)
  if (owner) {
    if (dir === owner.path) return owner.name
    return splitPath(dir.slice(owner.path.length)).join(' / ')
  }
  const parts = splitPath(path)
  return parts[parts.length - 2] ?? ''
}

/** the folders between root and `dir` (inclusive) */
function crumbsOf(root: FolderRoot, dir: string): Array<{ path: string; name: string }> {
  const crumbs = [{ path: root.path, name: root.name }]
  if (dir === root.path) return crumbs
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  let acc = root.path
  for (const part of splitPath(dir.slice(root.path.length))) {
    acc = `${acc}${sep}${part}`
    crumbs.push({ path: acc, name: part })
  }
  return crumbs
}

/** wrap every matched fragment of a name or folder label in the shared search-hit mark */
function highlightText(text: string, needles: readonly string[]): ReactElement[] | string {
  const marks = markText(text, needles)
  if (!marks.some((m) => m.hit)) return text
  return marks.map((m, i) =>
    m.hit ? (
      <mark key={i} className="search-hit">
        {m.text}
      </mark>
    ) : (
      <span key={i}>{m.text}</span>
    ),
  )
}

// ── Folder tree state (shared by the sidebar and the move picker) ──

interface TreeState {
  expanded: string[]
  /** the root the layout was saved for; a layout for another root is not applied */
  root: string | null
}

function readTreeState(): TreeState {
  try {
    const raw = JSON.parse(localStorage.getItem(TREE_STATE_KEY) ?? 'null') as TreeState | null
    if (raw && Array.isArray(raw.expanded)) {
      return {
        expanded: raw.expanded.filter((p): p is string => typeof p === 'string'),
        root: typeof raw.root === 'string' ? raw.root : null,
      }
    }
  } catch {
    // corrupt or absent: start collapsed
  }
  return { expanded: [], root: null }
}

function writeTreeState(state: TreeState): void {
  try {
    localStorage.setItem(TREE_STATE_KEY, JSON.stringify(state))
  } catch {
    // quota / private mode: the tree just forgets its layout
  }
}

/**
 * Lazily loaded folder listings keyed by directory. Listing a folder that is
 * already cached is a no-op; `invalidate` drops entries so the next render
 * refetches them (the main process reports changed directories via watch).
 */
function useFolderListings() {
  const [listings, setListings] = useState<ReadonlyMap<string, FolderListing>>(new Map())
  // dir → whether a reload was requested while its request was in flight (the
  // in-flight answer may predate the change, so it is fetched once more)
  const inflight = useRef(new Map<string, boolean>())

  const load = useCallback((dir: string, force = false) => {
    if (inflight.current.has(dir)) {
      if (force) inflight.current.set(dir, true)
      return
    }
    inflight.current.set(dir, false)
    void window.chatOffice
      .listFolder(dir)
      .then((listing) => {
        setListings((prev) => {
          const next = new Map(prev)
          next.set(dir, listing)
          return next
        })
      })
      .finally(() => {
        const again = inflight.current.get(dir)
        inflight.current.delete(dir)
        if (again) load(dir, true)
      })
  }, [])

  const invalidate = useCallback(
    (dirs: readonly string[]) => {
      setListings((prev) => {
        let changed = false
        const next = new Map(prev)
        for (const dir of dirs) {
          if (next.delete(dir)) changed = true
        }
        return changed ? next : prev
      })
      for (const dir of dirs) load(dir, true)
    },
    [load],
  )

  const reset = useCallback(() => setListings(new Map()), [])

  /** shown or currently loading: the folders a watch event should refresh */
  const tracked = useCallback(
    (dir: string) => listings.has(dir) || inflight.current.has(dir),
    [listings],
  )

  return { listings, load, invalidate, reset, tracked }
}

// ── Move-to-folder picker（上游原样） ────────────────────────

interface FolderPickerProps {
  roots: readonly FolderRoot[]
  /** folders the moved items already live in (greyed, not selectable) */
  currentDirs: ReadonlySet<string>
  /** folders being moved: they and their descendants cannot be targets */
  movingDirs: readonly string[]
  count: number
  onCancel: () => void
  onPick: (dir: string) => void
}

function FolderPicker({ roots, currentDirs, movingDirs, count, onCancel, onPick }: FolderPickerProps) {
  const { t } = useI18n()
  const { listings, load } = useFolderListings()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(roots.map((r) => r.path)),
  )
  const [picked, setPicked] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [creatingIn, setCreatingIn] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  useEffect(() => {
    for (const dir of expanded) load(dir)
  }, [expanded, load])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const disabledDir = (dir: string) =>
    currentDirs.has(dir) ||
    movingDirs.some((m) => isUnder(m, dir)) ||
    rootOf(dir, roots)?.usable === false

  // Enter or blur commits, Escape cancels; the blur an unmount may fire reads
  // the edit from a ref mirrored during render, so a finished edit is a no-op
  const creatingRef = useRef<{ parent: string; name: string } | null>(null)
  creatingRef.current = creatingIn ? { parent: creatingIn, name: newName } : null
  const commitCreate = async () => {
    const pending = creatingRef.current
    creatingRef.current = null
    setCreatingIn(null)
    setNewName('')
    const parent = pending?.parent
    const name = pending?.name.trim()
    if (!parent || !name) return
    const result = await window.chatOffice.createFolder(parent, name)
    if (!result.ok) {
      window.alert(result.error ?? t('renameFailed'))
      return
    }
    load(parent, true)
    setExpanded((prev) => new Set([...prev, parent]))
    if (result.path) setPicked(result.path)
  }

  // name search flattens the tree to every loaded folder whose name matches;
  // folders not yet expanded are loaded on the fly one level at a time
  const needle = query.trim().toLowerCase()
  const renderNode = (entry: { path: string; name: string }, depth: number): ReactElement => {
    const listing = listings.get(entry.path)
    const isOpen = expanded.has(entry.path)
    const children = listing?.folders ?? []
    const disabled = disabledDir(entry.path)
    const isCurrent = currentDirs.has(entry.path)
    return (
      <li key={entry.path}>
        <div
          className={`picker-row${picked === entry.path ? ' active' : ''}${disabled ? ' disabled' : ''}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          role="treeitem"
          aria-selected={picked === entry.path}
          aria-expanded={children.length > 0 ? isOpen : undefined}
          onClick={() => {
            if (!disabled) setPicked(entry.path)
          }}
          onDoubleClick={() => {
            if (!disabled) onPick(entry.path)
          }}
        >
          <button
            className="tree-chevron"
            tabIndex={-1}
            aria-hidden="true"
            style={{ visibility: listing && children.length === 0 ? 'hidden' : undefined }}
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((prev) => {
                const next = new Set(prev)
                if (next.has(entry.path)) next.delete(entry.path)
                else next.add(entry.path)
                return next
              })
            }}
          >
            <Chevron open={isOpen} />
          </button>
          <FolderIcon open={isOpen} />
          <span className="picker-name">{entry.name}</span>
          {isCurrent && <span className="picker-current">{t('currentFolder')}</span>}
        </div>
        {isOpen && (
          <ul role="group">
            {children.map((child) => renderNode(child, depth + 1))}
            {creatingIn === entry.path && (
              <li>
                <div className="picker-row" style={{ paddingLeft: 8 + (depth + 1) * 16 }}>
                  <span className="tree-chevron" aria-hidden="true" />
                  <FolderIcon />
                  <input
                    className="folder-rename-input inline"
                    autoFocus
                    placeholder={t('untitledFolder')}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onBlur={() => void commitCreate()}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.nativeEvent.isComposing) return
                      if (e.key === 'Enter') void commitCreate()
                      if (e.key === 'Escape') {
                        setCreatingIn(null)
                        setNewName('')
                      }
                    }}
                  />
                </div>
              </li>
            )}
          </ul>
        )}
      </li>
    )
  }

  const renderSearch = (): ReactElement => {
    const hits: Array<{ path: string; name: string; rel: string }> = []
    for (const listing of listings.values()) {
      for (const f of listing.folders) {
        if (f.name.toLowerCase().includes(needle)) {
          hits.push({ path: f.path, name: f.name, rel: locationLabel(f.path + '/x', roots) })
        }
        if (!listings.has(f.path)) load(f.path)
      }
    }
    hits.sort((a, b) => a.name.localeCompare(b.name))
    if (hits.length === 0) return <p className="picker-empty">{t('noMatchingFolders')}</p>
    return (
      <ul role="tree">
        {hits.map((h) => {
          const disabled = disabledDir(h.path)
          return (
            <li key={h.path}>
              <div
                className={`picker-row${picked === h.path ? ' active' : ''}${disabled ? ' disabled' : ''}`}
                role="treeitem"
                aria-selected={picked === h.path}
                onClick={() => {
                  if (!disabled) setPicked(h.path)
                }}
                onDoubleClick={() => {
                  if (!disabled) onPick(h.path)
                }}
              >
                <span className="tree-chevron" aria-hidden="true" />
                <FolderIcon />
                <span className="picker-name">{h.name}</span>
                <span className="picker-rel">{h.rel}</span>
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal picker-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('moveToFolderTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{t('moveToFolderTitle')}</h3>
        <input
          className="picker-search"
          type="search"
          placeholder={t('searchFolders')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="picker-tree">
          {needle ? (
            renderSearch()
          ) : (
            <ul role="tree">{roots.map((root) => renderNode(root, 0))}</ul>
          )}
        </div>
        <div className="modal-buttons picker-buttons">
          <button
            className="btn btn-secondary picker-new"
            onClick={() => {
              const parent = picked ?? roots.find((r) => r.usable)?.path
              if (!parent) return
              setExpanded((prev) => new Set([...prev, parent]))
              setCreatingIn(parent)
              setNewName('')
            }}
          >
            {t('newFolder')}
          </button>
          <span className="picker-spacer" />
          <button className="btn btn-secondary" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!picked || disabledDir(picked)}
            onClick={() => {
              if (picked) onPick(picked)
            }}
          >
            {t('moveCount', { n: count })}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Same-name conflict prompt（上游原样） ────────────────────

interface ConflictPromptProps {
  names: string[]
  onChoose: (policy: MoveConflictPolicy) => void
}

function ConflictPrompt({ names, onChoose }: ConflictPromptProps) {
  const { t } = useI18n()
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onChoose('skip')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onChoose])
  return (
    <div className="modal-overlay" onClick={() => onChoose('skip')}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('conflictTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{t('conflictTitle')}</h3>
        <p>
          {names.length === 1
            ? t('conflictBodyOne', { name: names[0] })
            : t('conflictBodyMany', { n: names.length })}
        </p>
        {names.length > 1 && (
          <ul className="modal-file-list">
            {names.slice(0, 6).map((n) => (
              <li key={n}>{n}</li>
            ))}
            {names.length > 6 && <li>{t('deleteMoreCount', { n: names.length })}</li>}
          </ul>
        )}
        <div className="modal-buttons">
          <button className="btn btn-secondary" autoFocus onClick={() => onChoose('skip')}>
            {t('cancel')}
          </button>
          <button className="btn btn-secondary" onClick={() => onChoose('keepBoth')}>
            {t('conflictKeepBoth')}
          </button>
          <button className="btn btn-danger" onClick={() => onChoose('replace')}>
            {t('conflictReplace')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 主组件 ───────────────────────────────────────────────

export interface FileTreePaneProps {
  /** 树内选中的文件夹（新建文件落点，状态由 Home 持有） */
  selectedFolder: string | null
  onSelectFolder: (dir: string | null) => void
}

export function FileTreePane({ selectedFolder, onSelectFolder }: FileTreePaneProps) {
  const i18n = useI18n()
  const { t } = i18n
  // the default save folder first, then the folders the user added; `root` is the default one
  const [roots, setRoots] = useState<FolderRoot[]>([])
  const root = roots[0] ?? null
  const canMove = roots.some((r) => r.usable)
  const editableAt = (path: string) => rootOf(path, roots)?.usable !== false
  const [panelDrop, setPanelDrop] = useState(false)
  const [treeState] = useState(readTreeState)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(treeState.expanded))
  // a root without a saved layout of its own is opened once when first seen
  const seededRoot = useRef<string | null>(null)
  const {
    listings,
    load: loadFolder,
    invalidate: invalidateFolders,
    reset: resetFolders,
    tracked: trackedFolder,
  } = useFolderListings()
  // open folder menu: path + fixed-position anchor (viewport coords), so the
  // popup can escape the scrollable tree without the tree losing overflow-y
  const [folderMenu, setFolderMenu] = useState<{
    path: string
    top: number
    right: number
  } | null>(null)
  const menuOpenAt = (path: string) => folderMenu?.path === path
  const folderMenuWrapRef = useRef<HTMLDivElement>(null)
  const [folderRenaming, setFolderRenaming] = useState<{ path: string; value: string } | null>(null)
  // inline "new folder" input in the tree, under this parent
  const [creating, setCreating] = useState<{ parent: string } | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<string | null>(null)
  // move-to-folder picker for these paths; then the conflict prompt for the ones that collided
  const [movePicker, setMovePicker] = useState<string[] | null>(null)
  const [conflict, setConflict] = useState<{ paths: string[]; targetDir: string } | null>(null)
  // folder row currently hovered by a drag
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const dragExpandTimer = useRef<number | null>(null)
  // file row whose … menu is open + inline file rename state
  const [fileMenu, setFileMenu] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null)
  useDismissablePopover(folderMenu !== null, () => setFolderMenu(null), {
    inside: () => (folderMenuWrapRef.current ? [folderMenuWrapRef.current] : []),
  })
  // 文件行菜单与文件夹菜单共用 wrap ref：点击菜单项本身不得触发 dismiss
  // （否则 mousedown 先卸载菜单，onClick 永远不达——e2e 实测踩中）
  useDismissablePopover(fileMenu !== null, () => setFileMenu(null), {
    inside: () => (folderMenuWrapRef.current ? [folderMenuWrapRef.current] : []),
  })

  const loadRoot = useCallback(() => {
    void window.chatOffice.folderRoots().then((next) => {
      setRoots((prev) => {
        if (prev[0] && prev[0].path !== next[0]?.path) {
          // the default save folder changed in settings: the old tree is meaningless
          resetFolders()
          onSelectFolder(null)
          setExpanded(new Set(next.map((r) => r.path)))
        } else if (prev.length > 0) {
          // a folder just added opens so its contents show right away
          const known = new Set(prev.map((r) => r.path))
          const added = next.filter((r) => !known.has(r.path)).map((r) => r.path)
          if (added.length > 0) setExpanded((e) => new Set([...e, ...added]))
        }
        return next
      })
    })
  }, [resetFolders, onSelectFolder])

  useEffect(loadRoot, [loadRoot])

  useEffect(() => {
    if (root?.usable) writeTreeState({ expanded: [...expanded], root: root.path })
  }, [expanded, root])

  useEffect(() => {
    if (!root?.usable) return
    if (seededRoot.current !== root.path) {
      seededRoot.current = root.path
      if (treeState.root !== root.path) {
        // a layout saved for another root is not ours: start from the root rows
        setExpanded(new Set(roots.map((r) => r.path)))
        return
      }
    }
    for (const dir of expanded) loadFolder(dir)
  }, [root, roots, expanded, loadFolder, treeState])

  useEffect(() => {
    if (selectedFolder) loadFolder(selectedFolder)
  }, [selectedFolder, loadFolder])

  // a remembered selection that no longer exists (deleted in Finder) falls back to nothing
  useEffect(() => {
    if (!selectedFolder || roots.length === 0) return
    const owner = rootOf(selectedFolder, roots)
    if (!owner?.readable) {
      onSelectFolder(null)
      return
    }
    if (listings.get(selectedFolder)?.missing) {
      onSelectFolder(selectedFolder === owner.path ? null : dirOf(selectedFolder))
    }
  }, [roots, selectedFolder, listings, onSelectFolder])

  useEffect(() => {
    return window.chatOffice.onFolderChanged((dirs) => {
      invalidateFolders(dirs.filter(trackedFolder))
    })
  }, [invalidateFolders, trackedFolder])

  /** anything on-disk change drops every cached listing and reloads the roots */
  const refresh = () => {
    loadRoot()
    invalidateFolders([...listings.keys()])
  }

  const selectFolder = (dir: string) => {
    onSelectFolder(dir)
    setFolderMenu(null)
    setFileMenu(null)
  }

  const toggleExpanded = (dir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  }

  const expandTo = (dir: string) => {
    const owner = rootOf(dir, roots)
    if (!owner) return
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const crumb of crumbsOf(owner, dir)) next.add(crumb.path)
      return next
    })
  }

  const addFolderRoot = () => {
    void window.chatOffice.addFolderRoot().then((added) => {
      if (added) loadRoot()
    })
  }

  /** the folder leaves the list only; whatever it held on disk stays where it is */
  const removeFolderRoot = (path: string) => {
    setFolderMenu(null)
    if (selectedFolder && isUnder(path, selectedFolder)) onSelectFolder(null)
    setExpanded((prev) => new Set([...prev].filter((dir) => !isUnder(path, dir))))
    void window.chatOffice.removeFolderRoot(path).then(loadRoot)
  }

  // folders dragged in from the OS join the tree in place; documents open as they do anywhere else
  const panelDropProps = {
    onDragOver: (event: ReactDragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'link'
      if (!panelDrop) setPanelDrop(true)
    },
    onDragLeave: (event: ReactDragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      setPanelDrop(false)
    },
    onDrop: (event: ReactDragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      setPanelDrop(false)
      const paths = Array.from(event.dataTransfer.files)
        .map((file) => window.chatOffice.pathForFile(file))
        .filter(Boolean)
      if (paths.length === 0) return
      void window.chatOffice.dropFolderRoots(paths).then((added) => {
        if (added.length > 0) loadRoot()
      })
    },
  }

  // ── Folder actions（上游原样） ──

  const startCreateFolder = (parent: string) => {
    setFolderMenu(null)
    expandTo(parent)
    setCreating({ parent })
    setNewFolderName('')
  }

  // inline inputs commit on Enter or blur and cancel on Escape; the blur an
  // unmount may fire reads the edit from refs mirrored during render, so a
  // finished or cancelled edit is a no-op (see FolderPicker.commitCreate)
  const creatingFolderRef = useRef<{ parent: string; name: string } | null>(null)
  creatingFolderRef.current = creating ? { parent: creating.parent, name: newFolderName } : null
  const folderRenamingRef = useRef(folderRenaming)
  folderRenamingRef.current = folderRenaming

  const commitCreateFolder = async () => {
    const pending = creatingFolderRef.current
    creatingFolderRef.current = null
    const name = pending?.name.trim()
    setCreating(null)
    setNewFolderName('')
    if (!pending || !name) return
    const result = await window.chatOffice.createFolder(pending.parent, name)
    if (!result.ok) {
      window.alert(result.error ?? t('renameFailed'))
      return
    }
    invalidateFolders([pending.parent])
  }

  const startRenameFolder = (entry: { path: string; name: string }) => {
    setFolderMenu(null)
    setFolderRenaming({ path: entry.path, value: entry.name })
  }

  const commitRenameFolder = async () => {
    const pending = folderRenamingRef.current
    folderRenamingRef.current = null
    setFolderRenaming(null)
    if (!pending) return
    const value = pending.value.trim()
    if (!value || value === fileName(pending.path)) return
    const result = await window.chatOffice.renameFolder(pending.path, value)
    if (!result.ok) {
      window.alert(result.error ?? t('renameFailed'))
      return
    }
    if (result.path) {
      const renamed = result.path
      // selection / expansion follow the renamed folder (and anything inside it)
      const rebase = (p: string) =>
        p === pending.path || isUnder(pending.path, p) ? renamed + p.slice(pending.path.length) : p
      setExpanded((prev) => new Set([...prev].map(rebase)))
      if (selectedFolder) onSelectFolder(rebase(selectedFolder))
    }
    refresh()
  }

  const confirmDeleteFolderNow = async () => {
    const dir = confirmDeleteFolder
    setConfirmDeleteFolder(null)
    if (!dir) return
    await window.chatOffice.deleteFolder(dir)
    if (selectedFolder && (selectedFolder === dir || isUnder(dir, selectedFolder))) {
      onSelectFolder(dirOf(dir))
    }
    refresh()
  }

  const startMove = (paths: string[]) => {
    setFolderMenu(null)
    setFileMenu(null)
    if (paths.length > 0) setMovePicker(paths)
  }

  const doMove = async (paths: string[], targetDir: string, policy: MoveConflictPolicy) => {
    setMovePicker(null)
    setConflict(null)
    const result = await window.chatOffice.movePaths(paths, targetDir, policy)
    if (result.moved.length > 0 && selectedFolder) {
      // a moved folder that held the selection drags the selection along
      for (const { from, to } of result.moved) {
        if (selectedFolder === from || isUnder(from, selectedFolder)) {
          onSelectFolder(to + selectedFolder.slice(from.length))
        }
      }
    }
    refresh()
    if (result.failed.length > 0) window.alert(result.failed[0].error)
    if (result.conflicts.length > 0) setConflict({ paths: result.conflicts, targetDir })
  }

  // ── File row actions ──

  const duplicateFile = (path: string) => {
    setFileMenu(null)
    void window.chatOffice.duplicateFile(path).then(refresh)
  }

  const deleteFiles = (paths: string[]) => {
    setFileMenu(null)
    void window.chatOffice.deleteFiles(paths).then(refresh)
  }

  const toggleStar = (path: string) => {
    void window.chatOffice.toggleStar(path).then(refresh)
  }

  const commitRename = async (entry: RecentEntry) => {
    const pending = renaming
    setRenaming(null)
    if (!pending || pending.value.trim() === entry.name) return
    const result = await window.chatOffice.renameFile(entry.path, pending.value.trim())
    if (!result.ok) {
      window.alert(result.error ?? t('renameFailed'))
      return
    }
    refresh()
  }

  // ── Drag & drop (rows → folder rows)（上游原样） ──

  const onRowDragStart = (event: ReactDragEvent, paths: string[]) => {
    event.dataTransfer.setData(DRAG_PATHS_MIME, JSON.stringify(paths))
    event.dataTransfer.effectAllowed = 'move'
    setFileMenu(null)
    setFolderMenu(null)
  }

  const readDragPaths = (event: ReactDragEvent): string[] => {
    try {
      const raw = JSON.parse(event.dataTransfer.getData(DRAG_PATHS_MIME)) as unknown
      return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : []
    } catch {
      return []
    }
  }

  const clearDragExpand = () => {
    if (dragExpandTimer.current !== null) {
      window.clearTimeout(dragExpandTimer.current)
      dragExpandTimer.current = null
    }
  }

  const folderDropProps = (dir: string, { autoExpand }: { autoExpand: boolean }) => ({
    onDragOver: (event: ReactDragEvent) => {
      if (rootOf(dir, roots)?.usable === false) return
      if (!event.dataTransfer.types.includes(DRAG_PATHS_MIME)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (dropTarget !== dir) {
        setDropTarget(dir)
        clearDragExpand()
        if (autoExpand && !expanded.has(dir)) {
          dragExpandTimer.current = window.setTimeout(() => {
            setExpanded((prev) => new Set([...prev, dir]))
          }, DRAG_EXPAND_DELAY_MS)
        }
      }
    },
    onDragLeave: (event: ReactDragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      if (dropTarget === dir) setDropTarget(null)
      clearDragExpand()
    },
    onDrop: (event: ReactDragEvent) => {
      event.preventDefault()
      setDropTarget(null)
      clearDragExpand()
      const paths = readDragPaths(event).filter((p) => p !== dir && !isUnder(p, dir))
      if (paths.length > 0) void doMove(paths, dir, 'ask')
    },
  })

  // ── File search（上游原样；ext 恒为全部） ──

  const [searchQuery, setSearchQuery] = useState('')
  const [searchPage, setSearchPage] = useState<FileSearchPage | null>(null)
  const [rerank, setRerank] = useState<{ key: string; result: FileSearchRerank } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // IME composition: wait for the committed text instead of searching each keystroke
  const composingRef = useRef(false)
  const searchSeq = useRef(0)
  const searchActive = searchQuery.trim().length > 0
  const q = searchQuery.trim()

  useEffect(() => {
    if (!q) {
      searchSeq.current++
      setSearchPage(null)
      return
    }
    let timer = 0
    const run = () => {
      if (composingRef.current) {
        timer = window.setTimeout(run, 150)
        return
      }
      const seq = ++searchSeq.current
      void window.chatOffice.searchFiles({ q, limit: 100 }).then((page) => {
        if (seq !== searchSeq.current) return
        setSearchPage(page)
        // results grow while the background index catches up
        if (page.index.pending > 0 || page.index.scanning) timer = window.setTimeout(run, 1500)
      })
    }
    timer = window.setTimeout(run, 150)
    return () => window.clearTimeout(timer)
  }, [q])

  // Jev judges the top local hits once they settle; the main process answers
  // null when reranking is off (设置入口不织入，读用户手改的设置文件)
  const rerankKey =
    q && searchPage && searchPage.hits.length >= 2
      ? [q, ...searchPage.hits.slice(0, 20).map((h) => h.path)].join('\n')
      : ''
  useEffect(() => {
    if (!rerankKey) return
    const key = rerankKey
    const paths = key.split('\n').slice(1)
    const timer = window.setTimeout(() => {
      void window.chatOffice.rerankSearch({ q, paths }).then((result) => {
        if (result) setRerank({ key, result })
        else setRerank((cur) => (cur && cur.key === key ? null : cur))
      })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [q, rerankKey])

  const clearSearch = () => {
    setSearchQuery('')
    searchInputRef.current?.focus()
  }

  /** judged hits in Jev's order, then the rest in local order */
  const orderedSearchHits = (hits: readonly FileSearchHit[]): FileSearchHit[] => {
    if (!rerank || rerank.key !== rerankKey) return [...hits]
    const rank = new Map(rerank.result.order.map((path, i) => [path, i]))
    return [...hits].sort((a, b) => (rank.get(a.path) ?? Infinity) - (rank.get(b.path) ?? Infinity))
  }

  // ── Tree rendering（上游原样 + 树内联文件行） ──

  const renderFolderMenu = (entry: { path: string; name: string }, rootEntry?: FolderRoot) => (
    <div
      className="folder-menu-wrap"
      ref={menuOpenAt(entry.path) ? folderMenuWrapRef : undefined}
    >
      <button
        className="folder-more-btn"
        aria-label={t('folderMoreActions', { name: entry.name })}
        aria-expanded={menuOpenAt(entry.path)}
        onClick={(e) => {
          e.stopPropagation()
          setFileMenu(null)
          if (menuOpenAt(entry.path)) {
            setFolderMenu(null)
            return
          }
          const rect = e.currentTarget.getBoundingClientRect()
          setFolderMenu({
            path: entry.path,
            top: rect.bottom + 4,
            right: window.innerWidth - rect.right,
          })
        }}
      >
        <MoreDots />
      </button>
      {folderMenu && menuOpenAt(entry.path) && (
        <div
          className="folder-menu"
          role="menu"
          style={{ top: folderMenu.top, right: folderMenu.right }}
        >
          {editableAt(entry.path) && (
            <button role="menuitem" onClick={() => startCreateFolder(entry.path)}>
              {t('newSubfolder')}
            </button>
          )}
          {!rootEntry && editableAt(entry.path) && (
            <button role="menuitem" onClick={() => startRenameFolder(entry)}>
              {t('rename')}
            </button>
          )}
          {!rootEntry && editableAt(entry.path) && (
            <button role="menuitem" onClick={() => startMove([entry.path])}>
              {t('moveToFolder')}
            </button>
          )}
          {(rootEntry?.readable ?? true) && (
            <button
              role="menuitem"
              onClick={() => {
                setFolderMenu(null)
                void window.chatOffice.revealPath(entry.path)
              }}
            >
              {t('revealInFolder')}
            </button>
          )}
          {!rootEntry && editableAt(entry.path) && (
            <>
              <div className="row-menu-divider" />
              <button
                role="menuitem"
                className="danger"
                onClick={() => {
                  setFolderMenu(null)
                  setConfirmDeleteFolder(entry.path)
                }}
              >
                {t('deleteFolder')}
              </button>
            </>
          )}
          {rootEntry?.removable && (
            <>
              <div className="row-menu-divider" />
              <button role="menuitem" onClick={() => removeFolderRoot(entry.path)}>
                {t('removeFolderRoot')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )

  const renderNewFolderInput = (depth: number) => (
    <li className="tree-item">
      <div className="tree-row" style={{ paddingLeft: 8 + depth * 14 }}>
        <span className="tree-chevron" aria-hidden="true" />
        <span className="tree-icon" aria-hidden="true">
          <FolderIcon />
        </span>
        <input
          className="folder-rename-input inline"
          autoFocus
          placeholder={t('untitledFolder')}
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onBlur={() => void commitCreateFolder()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') void commitCreateFolder()
            if (e.key === 'Escape') {
              setCreating(null)
              setNewFolderName('')
            }
          }}
        />
      </div>
    </li>
  )

  /** 树内联文件行（上游主区文件行收窄为窄栏形态；操作菜单逐项照搬） */
  const renderTreeFileRow = (entry: FileEntry | RecentEntry, depth: number) => {
    const isRenaming = renaming?.path === entry.path
    const editable = editableAt(entry.path)
    return (
      <li className="tree-item" key={entry.path}>
        <div
          className={`tree-row tree-file-row${entry.missing ? ' missing' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          role="button"
          tabIndex={0}
          title={entry.missing ? t('missingFileTitle') : entry.path}
          draggable={!isRenaming && !entry.missing}
          onDragStart={(e) => onRowDragStart(e, [entry.path])}
          onClick={() => {
            if (isRenaming || entry.missing) return
            void window.chatOffice.openPath(entry.path)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.target === e.currentTarget && !entry.missing) {
              void window.chatOffice.openPath(entry.path)
            }
          }}
        >
          <span className="tree-icon" aria-hidden="true">
            <FileBadge ext={entry.ext} size={16} />
          </span>
          {isRenaming ? (
            <input
              className="folder-rename-input inline"
              value={renaming?.value ?? ''}
              autoFocus
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenaming({ path: entry.path, value: e.target.value })}
              onBlur={() => void commitRename(entry)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.nativeEvent.isComposing) return
                if (e.key === 'Enter') void commitRename(entry)
                if (e.key === 'Escape') setRenaming(null)
              }}
            />
          ) : (
            <span className="tree-name">{entry.name}</span>
          )}
          <span
            className="tree-file-actions"
            onClick={(e) => e.stopPropagation()}
            ref={fileMenu === entry.path ? folderMenuWrapRef : undefined}
          >
            <button
              className="folder-more-btn"
              aria-label={t('moreActions')}
              aria-expanded={fileMenu === entry.path}
              onClick={() => {
              setFolderMenu(null)
              setFileMenu(fileMenu === entry.path ? null : entry.path)
            }}
            >
              <MoreDots />
            </button>
            {fileMenu === entry.path && (
              <div className="folder-menu tree-file-menu" role="menu">
                {!entry.missing && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      setFileMenu(null)
                      void window.chatOffice.openPath(entry.path)
                    }}
                  >
                    {t('open')}
                  </button>
                )}
                {!entry.missing && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      setFileMenu(null)
                      void window.chatOffice.revealPath(entry.path)
                    }}
                  >
                    {t('revealInFolder')}
                  </button>
                )}
                <button
                  role="menuitem"
                  onClick={() => {
                    setFileMenu(null)
                    void navigator.clipboard.writeText(entry.path)
                  }}
                >
                  {t('copyPath')}
                </button>
                {canMove && editable && !entry.missing && (
                  <>
                    <div className="row-menu-divider" />
                    <button role="menuitem" onClick={() => startMove([entry.path])}>
                      {t('moveToFolder')}
                    </button>
                  </>
                )}
                {editable && !entry.missing && (
                  <>
                    <div className="row-menu-divider" />
                    <button role="menuitem" onClick={() => setRenaming({ path: entry.path, value: entry.name })}>
                      {t('rename')}
                    </button>
                    <button role="menuitem" onClick={() => duplicateFile(entry.path)}>
                      {t('duplicate')}
                    </button>
                  </>
                )}
                <div className="row-menu-divider" />
                <button
                  role="menuitem"
                  onClick={() => {
                    setFileMenu(null)
                    toggleStar(entry.path)
                  }}
                >
                  {entry.starred ? t('unstar') : t('star')}
                </button>
                {editable && (
                  <button role="menuitem" className="danger" onClick={() => deleteFiles([entry.path])}>
                    {t('deleteFiles')}
                  </button>
                )}
              </div>
            )}
          </span>
        </div>
      </li>
    )
  }

  function renderTreeNode(
    entry: { path: string; name: string; hasSubfolders: boolean },
    depth: number,
  ): ReactElement {
    const rootEntry = roots.find((r) => r.path === entry.path)
    const isRoot = rootEntry !== undefined
    const unavailable = rootEntry !== undefined && !rootEntry.readable
    const isOpen = expanded.has(entry.path) && !unavailable
    const listing = listings.get(entry.path)
    const children = listing?.folders ?? []
    const files = listing?.files ?? []
    const isActive = selectedFolder === entry.path
    const isRenaming = folderRenaming?.path === entry.path
    const showChevron = !unavailable && (isRoot || entry.hasSubfolders || children.length > 0)
    return (
      <li key={entry.path} className="tree-item">
        <div
          className={`tree-row${isActive ? ' active' : ''}${dropTarget === entry.path ? ' drop-target' : ''}${unavailable ? ' unavailable' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          role="treeitem"
          aria-selected={isActive}
          aria-expanded={showChevron ? isOpen : undefined}
          tabIndex={0}
          title={isRoot ? entry.path : undefined}
          onClick={() => {
            if (!unavailable) {
              selectFolder(entry.path)
              toggleExpanded(entry.path)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !unavailable) selectFolder(entry.path)
            if (e.key === 'ArrowRight' && !isOpen) toggleExpanded(entry.path)
            if (e.key === 'ArrowLeft' && isOpen) toggleExpanded(entry.path)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            setFileMenu(null)
            setFolderMenu({ path: entry.path, top: e.clientY + 2, right: window.innerWidth - e.clientX })
          }}
          draggable={!isRoot && !isRenaming}
          onDragStart={(e) => onRowDragStart(e, [entry.path])}
          {...folderDropProps(entry.path, { autoExpand: true })}
        >
          <button
            className="tree-chevron"
            tabIndex={-1}
            aria-hidden="true"
            style={{ visibility: showChevron ? undefined : 'hidden' }}
            onClick={(e) => {
              e.stopPropagation()
              toggleExpanded(entry.path)
            }}
          >
            <Chevron open={isOpen} />
          </button>
          <span className="tree-icon" aria-hidden="true">
            <FolderIcon open={isOpen} />
          </span>
          {isRenaming ? (
            <input
              className="folder-rename-input inline"
              value={folderRenaming.value}
              autoFocus
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setFolderRenaming({ path: entry.path, value: e.target.value })}
              onBlur={() => void commitRenameFolder()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.nativeEvent.isComposing) return
                if (e.key === 'Enter') void commitRenameFolder()
                if (e.key === 'Escape') setFolderRenaming(null)
              }}
            />
          ) : (
            <span className="tree-name">{entry.name}</span>
          )}
          {unavailable && <span className="tree-hint">{t('rootUnavailable')}</span>}
          {renderFolderMenu(entry, rootEntry)}
        </div>
        {isOpen && (children.length > 0 || files.length > 0 || creating?.parent === entry.path) && (
          <ul className="tree-children" role="group">
            {creating?.parent === entry.path && renderNewFolderInput(depth + 1)}
            {children.map((child) => renderTreeNode(child, depth + 1))}
            {files.map((file) => renderTreeFileRow(file, depth + 1))}
          </ul>
        )}
      </li>
    )
  }

  function renderFolderPanel() {
    const createIn = selectedFolder ?? root?.path
    const canCreate = createIn !== undefined && rootOf(createIn ?? '', roots)?.usable === true
    return (
      <div className={`folder-panel${panelDrop ? ' drop-target' : ''}`} {...panelDropProps}>
        <div className="folder-panel-head">
          <span className="folder-panel-title">{t('folders')}</span>
          <div className="folder-panel-actions">
            {roots.length > 0 && (
              <button
                className="folder-add-btn folder-add-root-btn"
                data-tip={t('addFolderRoot')}
                aria-label={t('addFolderRoot')}
                onClick={addFolderRoot}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1" />
                  <path d="M2 13h10" />
                  <path d="m9 16 3-3-3-3" />
                </svg>
              </button>
            )}
            {canCreate && (
              <button
                className="folder-add-btn folder-new-btn"
                data-tip={t('newFolder')}
                aria-label={t('newFolder')}
                onClick={() => startCreateFolder(createIn as string)}
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
            )}
          </div>
        </div>
        <ul className="tree" role="tree">
          {root && !root.usable ? (
            <li className="folder-unusable">
              <p>{t('rootUnusable')}</p>
              <button
                className="btn btn-secondary"
                onClick={() => void window.chatOffice.pickDefaultSaveDir().then(() => loadRoot())}
              >
                {t('pickSaveDir')}
              </button>
            </li>
          ) : (
            root && renderTreeNode({ path: root.path, name: root.name, hasSubfolders: true }, 0)
          )}
          {roots
            .slice(1)
            .map((r) =>
              renderTreeNode({ path: r.path, name: r.name, hasSubfolders: r.readable }, 0),
            )}
        </ul>
      </div>
    )
  }

  // ── Search rendering（上游原样，窄栏样式类复用） ──

  const renderSearchRow = (hit: FileSearchHit) => (
    <li
      key={hit.path}
      className="search-row"
      role="button"
      tabIndex={0}
      onClick={() => void window.chatOffice.openPath(hit.path)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void window.chatOffice.openPath(hit.path)
      }}
    >
      <span className="search-icon">
        <FileBadge ext={hit.ext} size={20} />
      </span>
      <div className="search-main">
        <div className="search-head">
          <span className="search-name">{highlightText(hit.name, hit.needles)}</span>
        </div>
        <span className="search-path" title={dirOf(hit.path)}>
          {highlightText(locationLabel(hit.path, roots), hit.needles)}
        </span>
        {hit.snippet && (
          <p className="search-snippet">
            {hit.snippet.map((part, i) =>
              part.hit ? (
                <mark key={i} className="search-hit">
                  {part.text}
                </mark>
              ) : (
                <span key={i}>{part.text}</span>
              ),
            )}
          </p>
        )}
      </div>
      <span className="search-time">{formatModified(hit.mtimeMs, i18n)}</span>
    </li>
  )

  const renderSearchResults = () => {
    const page = searchPage
    const busy = !!page && (page.index.pending > 0 || page.index.scanning)
    const rerankApplied = rerank && rerank.key === rerankKey ? rerank.result : null
    const total = page?.total ?? 0
    return (
      <div className="search-results" aria-live="polite">
        <div className="search-status">
          {rerankApplied && (
            <span className="search-rerank-badge" title={t('searchRerankedBy')}>
              Jev
            </span>
          )}
          {busy && (
            <>
              <span className="load-more-spinner" />
              {t('searchIndexing', { n: page?.index.pending ?? 0 })}
            </>
          )}
          <span className="search-count">
            {t(total === 1 ? 'searchResultCountOne' : 'searchResultCount', { n: total })}
          </span>
        </div>
        {page && page.hits.length === 0 && !busy ? (
          <p className="search-empty">{t('searchNoResults', { q })}</p>
        ) : (
          page && <ul className="search-list">{orderedSearchHits(page.hits).map(renderSearchRow)}</ul>
        )}
      </div>
    )
  }

  const renderSearchBox = () => (
    <div className={`file-search${searchActive ? ' active' : ''}`}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
        <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        ref={searchInputRef}
        type="search"
        value={searchQuery}
        placeholder={t('searchFilesPlaceholder')}
        aria-label={t('searchFilesPlaceholder')}
        spellCheck={false}
        onChange={(e) => setSearchQuery(e.target.value)}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false
          setSearchQuery(e.currentTarget.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && searchQuery) {
            e.stopPropagation()
            clearSearch()
          }
        }}
      />
      {searchQuery && (
        <button className="file-search-clear" aria-label={t('searchClear')} onClick={clearSearch}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M2 2l8 8M10 2l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  )

  const movingDirs = (paths: string[]) =>
    paths.filter((p) => {
      // a folder being moved: its own listing is cached, or it is a known sub-folder
      if (listings.has(p)) return true
      const parent = listings.get(dirOf(p))
      return parent?.folders.some((f) => f.path === p) ?? false
    })

  return (
    <div className="file-tree-pane">
      {renderSearchBox()}
      {searchActive ? renderSearchResults() : renderFolderPanel()}
      {confirmDeleteFolder && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteFolder(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('deleteFolderTitle')}
            onClick={(event) => event.stopPropagation()}
          >
            <h3>{t('deleteFolderTitle')}</h3>
            <p>{t('deleteFolderConfirm', { name: fileName(confirmDeleteFolder) })}</p>
            <div className="modal-buttons">
              <button className="btn btn-secondary" autoFocus onClick={() => setConfirmDeleteFolder(null)}>
                {t('cancel')}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  void confirmDeleteFolderNow()
                }}
              >
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
      {movePicker && canMove && (
        <FolderPicker
          roots={roots}
          currentDirs={new Set(movePicker.map((p) => dirOf(p)))}
          movingDirs={movingDirs(movePicker)}
          count={movePicker.length}
          onCancel={() => setMovePicker(null)}
          onPick={(dir) => void doMove(movePicker, dir, 'ask')}
        />
      )}
      {conflict && (
        <ConflictPrompt
          names={conflict.paths.map(fileName)}
          onChoose={(policy) => {
            if (policy === 'skip') setConflict(null)
            else void doMove(conflict.paths, conflict.targetDir, policy)
          }}
        />
      )}
    </div>
  )
}
