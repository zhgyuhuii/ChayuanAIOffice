// Icons for the ZCode-style chrome surfaces (home sidebar, editor side pane).
// Design-consistency project: docs/plans/2026-11-19-zcode-ui-consistency.md.
// Path data ported from lucide (ISC license, https://lucide.dev) and inlined
// here so no new runtime dependency is added; stroke geometry matches the
// 24x24 lucide grid rendered at 16px.
import type { ReactElement, ReactNode } from 'react'

function Icon({ children, size = 16 }: { children: ReactNode; size?: number | undefined }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** Left sidebar toggle — sidebar visible (lucide `panel-left-close`). */
export function PanelLeftCloseIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m16 15-3-3 3-3" />
    </Icon>
  )
}

/** Left sidebar toggle — sidebar hidden (lucide `panel-left-open`). */
export function PanelLeftOpenIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m14 9 3 3-3 3" />
    </Icon>
  )
}

/** Right side-pane toggle — pane visible (lucide `panel-right-close`). */
export function PanelRightCloseIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
      <path d="m8 9-3 3 3 3" />
    </Icon>
  )
}

/** Right side-pane toggle — pane hidden (lucide `panel-right-open`). */
export function PanelRightOpenIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
      <path d="m10 15 3-3-3-3" />
    </Icon>
  )
}

/** New-chat entry (lucide `message-circle-plus`). */
export function MessageCirclePlusIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      <path d="M12 8v6" />
      <path d="M9 11h6" />
    </Icon>
  )
}

/** List-header search affordance (lucide `search`). */
export function SearchIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Icon>
  )
}

/** List-header view filter affordance (lucide `list-filter`). */
export function ListFilterIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <path d="M3 6h18" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </Icon>
  )
}

export function ChevronDownIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  )
}

export function ChevronRightIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  )
}

/** Row overflow menu (lucide `ellipsis`). */
export function EllipsisIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </Icon>
  )
}

export function FolderIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </Icon>
  )
}

export function FolderOpenIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </Icon>
  )
}

/** Add-folder affordance in pickers/dialogs (lucide `folder-plus`). */
export function FolderPlusIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      <path d="M12 10v6" />
      <path d="M9 13h6" />
    </Icon>
  )
}

export function PlusIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Icon>
  )
}

/** Composer send glyph (lucide `arrow-up`), used inside the round send button. */
export function ArrowUpIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </Icon>
  )
}

export function XIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  )
}

/* ── file-type glyphs for the sidebar new-file rows (same lucide style) ── */

/** Word/rich-text document (lucide `file-text`). */
export function FileTextIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </Icon>
  )
}

/** Spreadsheet/workbook (lucide `file-spreadsheet` style grid in a file). */
export function FileSpreadsheetIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M8 12h8" />
      <path d="M8 17h8" />
      <path d="M12 12v5" />
      <path d="M16 12v5" />
    </Icon>
  )
}

/** Slides/presentation deck (lucide `presentation`). */
export function PresentationIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <path d="M2 3h20" />
      <path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" />
      <path d="m7 21 5-5 5 5" />
    </Icon>
  )
}

/** Markdown/markup source (lucide `file-code`). */
export function FileCodeIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="m10 13-2 2 2 2" />
      <path d="m14 17 2-2-2-2" />
    </Icon>
  )
}

/** Web page (lucide `globe`). */
export function GlobeIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </Icon>
  )
}

/** PDF/reading document (lucide `book-open`). */
export function BookOpenIcon({ size }: { size?: number | undefined }): ReactElement {
  return (
    <Icon size={size}>
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </Icon>
  )
}

/** Dispatcher: extension → the sidebar new-file row glyph (B-zone map,
 *  mirrors FileBadge's type coverage without the PNG art). */
export function FileTypeIcon({
  ext,
  size,
}: {
  readonly ext: string
  readonly size?: number | undefined
}): ReactElement {
  switch (ext) {
    case 'docx':
    case 'doc':
      return <FileTextIcon size={size} />
    case 'xlsx':
    case 'xlsm':
    case 'xls':
    case 'csv':
      return <FileSpreadsheetIcon size={size} />
    case 'pptx':
    case 'ppt':
      return <PresentationIcon size={size} />
    case 'md':
    case 'markdown':
      return <FileCodeIcon size={size} />
    case 'html':
    case 'htm':
      return <GlobeIcon size={size} />
    case 'pdf':
      return <BookOpenIcon size={size} />
    default:
      return <FileTextIcon size={size} />
  }
}
