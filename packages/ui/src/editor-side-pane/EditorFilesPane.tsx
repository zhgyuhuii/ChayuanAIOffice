// ZCode-style collapsible file pane for the editors — hosts the shared
// FilesPane in a right-hand drawer with a PanelRightClose/Open toggle
// (visual-consistency project, docs/plans/2026-11-19-zcode-ui-consistency.md).
// The `window.filesPaneApi` preload bridge already ships in every editor; on
// hosts without it (web/dsh shim forms) the pane degrades to nothing instead
// of crashing the boot.
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { Lang } from '@chaoffice/i18n'
import { FilesPane } from '../files-pane/FilesPane'
import { tFilesPane } from '../files-pane/strings'
import type { FilesPaneApi } from '../files-pane/types'
import { PanelRightCloseIcon, PanelRightOpenIcon } from '../zcode-icons'

function storageKeyFor(app: string): string {
  return `chaoffice.editorSidePane.${app}`
}

/** the pane dictionaries degrade en → zh → key, so an out-of-union locale is
 * safe at runtime; this cast only satisfies the signature */
function narrowLang(lang: string): Lang {
  return lang as Lang
}

/** pane header label for the host's toggle button (no new host i18n keys) */
export function editorSidePaneTitle(lang: string): string {
  return tFilesPane(narrowLang(lang), 'title')
}

/** persisted open state, owned by the host app so the ribbon toggle and the
 * drawer stay in sync (ZCode persists the same preference per workspace) */
export function useEditorSidePane(app: string): [boolean, (next: boolean) => void] {
  const key = storageKeyFor(app)
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(key) === 'open'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, open ? 'open' : 'closed')
    } catch {
      /* storage unavailable: state stays session-only */
    }
  }, [key, open])
  return [open, setOpen]
}

/** ghost icon button (ZCode WorkspaceSidePaneToggleButton twin): PanelRightClose
 * while open, PanelRightOpen while closed, --active-bg while open. Hosts whose
 * ribbon has no trailing slot render it floating via `className="zc-side-fab"`. */
export function SidePaneToggleButton({
  open,
  onToggle,
  title,
  className,
}: {
  readonly open: boolean
  readonly onToggle: () => void
  readonly title: string
  readonly className?: string | undefined
}): ReactElement {
  const ToggleIcon = open ? PanelRightCloseIcon : PanelRightOpenIcon
  return (
    <button
      type="button"
      className={`zc-icon-btn${open ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      onClick={onToggle}
      title={title}
      aria-label={title}
      aria-pressed={open}
    >
      <ToggleIcon size={16} />
    </button>
  )
}

export function EditorFilesPane({
  lang,
  currentPath,
  // reserved for per-app pane customization; persistence lives with the host
  // (useEditorSidePane), so the value itself is intentionally unused
  storageKey: _storageKey,
  open,
  onOpenChange,
}: {
  readonly lang: string
  /** the document open in this editor; highlighted and revealed in the tree */
  readonly currentPath: string | null
  /** app-scoped storage suffix (e.g. "docs") */
  readonly storageKey: string
  readonly open: boolean
  readonly onOpenChange: (next: boolean) => void
}): ReactElement | null {
  const api = (globalThis as { filesPaneApi?: FilesPaneApi }).filesPaneApi
  if (!api || !open) return null
  return (
    <aside className="editor-side-pane">
      <FilesPane
        api={api}
        lang={narrowLang(lang)}
        currentPath={currentPath}
        onClose={() => onOpenChange(false)}
      />
    </aside>
  )
}
