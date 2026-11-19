// ZCode-style "new project" dialog — the visual twin of ZCode's ProjectEditor
// (name input + folder section with an embedded directory browser + footer;
// see docs/plans/2026-11-19-zcode-ui-consistency.md). Creation goes through
// the existing `chaOfficeProject.createProject(name, rootPath)` IPC; the
// browser lists directories via the home tree's `chaOffice.listFolder`
// starting at the configured folder roots (same trust boundary as the home
// FileTreePane), with the native picker as the escape hatch for paths
// outside the roots.
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../locale'
import { ChevronRightIcon, FolderIcon, FolderPlusIcon } from '@chaoffice/ui'

type FolderListing = Awaited<ReturnType<typeof window.chaOffice.listFolder>>

/** parent path string, or null at a filesystem/drive root */
function parentOf(dir: string): string | null {
  const normalized = dir.replace(/[\\/]+$/, '')
  const cut = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  if (cut <= 0) return null
  return normalized.slice(0, cut)
}

function isWithin(dir: string, root: string): boolean {
  return dir === root || dir.startsWith(`${root}/`) || dir.startsWith(`${root}\\`)
}

export function ProjectCreationDialog({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void
  /** called after the project was created (Home refreshes the tree) */
  readonly onCreated: () => void
}) {
  const { t } = useI18n()
  const nameRef = useRef<HTMLInputElement | null>(null)
  const [name, setName] = useState('')
  const [roots, setRoots] = useState<{ path: string; name: string }[]>([])
  const [currentDir, setCurrentDir] = useState<string | null>(null)
  const [listing, setListing] = useState<FolderListing | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    nameRef.current?.focus()
    let cancelled = false
    void (async () => {
      try {
        const list = await window.chaOffice.folderRoots()
        if (cancelled) return
        const usable = list.filter((r) => r.usable).map((r) => ({ path: r.path, name: r.name }))
        setRoots(usable)
        if (usable.length > 0) setCurrentDir(usable[0].path)
      } catch {
        /* roots unavailable: the browser stays empty, native picker still works */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!currentDir) return
    let cancelled = false
    void window.chaOffice
      .listFolder(currentDir)
      .then((l) => {
        // a late reply for a directory the user already left must not render
        if (!cancelled && l.dir === currentDir) setListing(l)
      })
      .catch(() => {
        if (!cancelled) setListing(null)
      })
    return () => {
      cancelled = true
    }
  }, [currentDir])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    if (typeof window.chaOfficeProject?.createProject !== 'function') return
    setBusy(true)
    try {
      await window.chaOfficeProject?.createProject(trimmed, currentDir ?? undefined)
      onCreated()
      onClose()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const pickViaSystem = async () => {
    if (typeof window.chaOfficeProject?.pickFolder !== 'function') return
    try {
      const picked = await window.chaOfficeProject.pickFolder()
      if (picked) {
        setCurrentDir(picked)
        setRoots((prev) =>
          prev.some((r) => r.path === picked)
            ? prev
            : [...prev, { path: picked, name: picked.split(/[\\/]/).pop() || picked }],
        )
      }
    } catch {
      /* cancelled */
    }
  }

  const canGoUp =
    currentDir !== null && roots.some((r) => parentOf(currentDir) !== null && isWithin(parentOf(currentDir) as string, r.path))

  return (
    <div className="zc-overlay" onClick={onClose}>
      {/* role=presentation wrapper: the card stops the click propagation */}
      <div
        className="zc-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('newProject')}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <h3 className="zc-dialog-title">{t('newProject')}</h3>

        <label className="zc-field">
          <span className="zc-field-label">{t('projectName')}</span>
          <input
            ref={nameRef}
            className="zc-input"
            value={name}
            placeholder={t('zcProjNamePlaceholder')}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit()
            }}
          />
        </label>

        <div className="zc-field">
          <span className="zc-field-label">{t('zcProjFolder')}</span>
          {currentDir ? (
            <div className="zc-browser">
              <div className="zc-browser-bar">
                <button
                  className="zc-icon-btn"
                  disabled={!canGoUp}
                  title={t('zcProjUp')}
                  aria-label={t('zcProjUp')}
                  onClick={() => {
                    const up = currentDir ? parentOf(currentDir) : null
                    if (up) setCurrentDir(up)
                  }}
                >
                  <ChevronRightIcon size={14} />
                </button>
                <span className="zc-browser-path" title={currentDir}>
                  {currentDir}
                </span>
              </div>
              <ul className="zc-browser-list" role="listbox" aria-label={t('zcProjFolder')}>
                {(listing?.folders ?? []).map((folder) => (
                  <li key={folder.path}>
                    <button
                      className="zc-browser-row"
                      onClick={() => setCurrentDir(folder.path)}
                      title={folder.path}
                    >
                      <FolderIcon size={15} />
                      <span className="zc-browser-name">{folder.name}</span>
                      {folder.hasSubfolders && <ChevronRightIcon size={13} />}
                    </button>
                  </li>
                ))}
                {(listing?.folders ?? []).length === 0 && (
                  <li className="zc-browser-empty">{t('zcProjNoSubfolders')}</li>
                )}
              </ul>
              <div className="zc-browser-actions">
                <button className="zc-btn" onClick={() => void pickViaSystem()}>
                  {t('zcProjBrowse')}
                </button>
              </div>
            </div>
          ) : (
            <button className="zc-add-folder" onClick={() => void pickViaSystem()}>
              <FolderPlusIcon size={15} />
              <span>{t('zcProjAddFolder')}</span>
            </button>
          )}
        </div>

        <div className="zc-dialog-footer">
          <button className="zc-btn" onClick={onClose}>
            {t('zcProjCancel')}
          </button>
          <button
            className="zc-btn zc-btn-primary"
            disabled={!name.trim() || busy}
            onClick={() => void submit()}
          >
            {t('newProject')}
          </button>
        </div>
      </div>
    </div>
  )
}
