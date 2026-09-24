/**
 * DocsCommandState: every read the ribbon makes of app + editor state, grouped
 * for when-expressions (`{ eq: ['view.viewMode', 'print'] }`) and command
 * handlers. App composes the groups with useShallowStable so group references
 * stay stable across renders that change nothing (memo invalidation key).
 *
 * Rule: state lives here, actions live in DocsCommandServices (host-services.ts).
 */
import type {
  Block,
  DocDefaults,
  HeaderFooter,
  SectionSettings,
  SourceInfo,
  StyleInfo,
  ThemeColors,
  ThemeFonts,
} from '@chatoffice/docx-engine'
import type { RibbonFormatState } from '../components/ribbon-format-state'
import type { InkPenSettings, RevisionDisplayMode, ViewMode } from '../components/ribbon-tabs'
import type { InkTool } from '../editor/ink'

/** Contextual-tab driver, derived from the format snapshot (sub-editor aware). */
export type DocsSelectionKind = 'text' | 'table' | 'image' | 'shape'

/**
 * Mirror of RibbonInner's contextual-tab triggers: a focused textbox sub-editor
 * demotes image selection (its text owns the ribbon) but not shape selection
 * (double-clicked shape text keeps Shape Format standing, like Word).
 */
export function deriveSelectionKind(format: RibbonFormatState): DocsSelectionKind {
  if (format.inTable) return 'table'
  if (!format.sub && format.imageSelected) return 'image'
  if (format.textboxSelected) return 'shape'
  return 'text'
}

export interface DocsViewState {
  readonly viewMode: ViewMode
  readonly readMode: boolean
  readonly showMarks: boolean
  readonly showRuler: boolean
  readonly showNav: boolean
  readonly showGrid: boolean
  readonly splitView: boolean
  readonly darkCanvas: boolean
  readonly spellcheck?: boolean
  readonly zoom: number
}

export interface DocsReviewState {
  readonly trackChanges: boolean
  /** trackedChanges restriction: the recorder is forced on (toggle and accept/reject disabled) */
  readonly trackChangesForced: boolean
  readonly revisionDisplay: RevisionDisplayMode
  readonly revisionCount: number
  readonly commentCount: number
  /** unresolved root comments (drives the AI resolve-comments action) */
  readonly openCommentCount: number
  readonly canComment: boolean
  readonly isProtected: boolean
  /** comments restriction: adding comments stays allowed although the body is read-only */
  readonly commentsAllowed: boolean
  /** any protection is configured (highlights the Protect Document button) */
  readonly protectActive: boolean
}

export interface DocsDocState {
  /** current document path (View → New Window opens it in another window) */
  readonly filePath: string | null
  readonly blocks: readonly Block[]
  /** document character styles, from ParsedDoc.styles (type === 'character') */
  readonly styles: Map<string, StyleInfo> | undefined
  /** document-wide text defaults from styles.xml */
  readonly docDefaults: DocDefaults | undefined
  readonly section: SectionSettings | null
  /** multi-section documents: index of the cursor's section (0-based); null for single-section */
  readonly activeSection: number | null
  readonly pageColor: string | null
  readonly watermark: string | null
  readonly themeFonts: ThemeFonts | null
  readonly themeColors: ThemeColors | null
  readonly header: HeaderFooter | null
  readonly footer: HeaderFooter | null
  /** different first page (w:titlePg) */
  readonly titlePg: boolean
  /** different odd & even pages (settings.xml w:evenAndOddHeaders) */
  readonly evenOddHf: boolean
}

export interface DocsDrawState {
  readonly inkTool: InkTool
  readonly inkPen: InkPenSettings
  readonly inkHighlighter: InkPenSettings
  readonly inkCount: number
}

export interface DocsCommandState {
  /** editor-driven format snapshot (already shallow-stable from App) */
  readonly format: RibbonFormatState
  readonly hasDoc: boolean
  /** no document or an empty one — one-click AI/edit actions grey out */
  readonly docEmpty: boolean
  /** hasDoc && format.editable — the global edit fence (read-only/protected) */
  readonly canEdit: boolean
  readonly selectionKind: DocsSelectionKind
  /** undo/redo availability from the editor history plugin */
  readonly hist: { readonly canUndo: boolean; readonly canRedo: boolean }
  readonly view: DocsViewState
  readonly review: DocsReviewState
  readonly doc: DocsDocState
  readonly draw: DocsDrawState
  readonly ai: { readonly showAi: boolean }
  readonly sources: readonly SourceInfo[]
  /** 察元 AI tab: 表单模式 pressed look (module state mirrored into React) */
  readonly chayuan: { readonly formMode: boolean }
}
