// DocOpsDialogHost — App mounts exactly one of these; the ribbon command
// services set the active kind. Each dialog owns its own state and closes by
// clearing the kind.
import type { Editor } from '@tiptap/core'
import type { StyleInfo } from '@chatoffice/docx-engine'
import type { DeclassifySidecar } from '../declassify'
import type { CompleteText } from '../model-complete'
import { DeleteTextDialog, AppendReplaceTextDialog, ManualColWidthDialog, TableStyleDialog, CaptionDialog } from './TableDialogs'
import { UniformImageFormatDialog } from './ImageDialogs'
import { StyleStatisticsDialog, UnusedStylesDialog } from './StyleDialogs'
import { DeclassifyDialog, DeclassifyRestoreDialog } from './DeclassifyDialogs'
import { FormContentDialog } from './FormContentDialog'

export type DocOpsDialogKind =
  | 'deleteTextRow'
  | 'deleteTextColumn'
  | 'appendReplace'
  | 'manualColWidth'
  | 'firstColStyle'
  | 'firstRowStyle'
  | 'tableCaption'
  | 'imageCaption'
  | 'uniformImageFormat'
  | 'styleStatistics'
  | 'unusedStyles'
  | 'declassify'
  | 'declassifyRestore'
  | 'formContent'

export interface DocOpsDialogHostProps {
  kind: DocOpsDialogKind | null
  editor: Editor
  styles: Map<string, StyleInfo>
  docPath: string | null
  complete: CompleteText
  /** removed styleIds ride the next save (SaveOptions.styleDeletes) */
  onStyleRemove: (styleIds: string[]) => void
  onDeclassified: (sidecar: DeclassifySidecar) => void
  onDeclassifyRestored: () => void
  onClearKind: () => void
}

export function DocOpsDialogHost(props: DocOpsDialogHostProps) {
  const { kind, editor, styles, docPath, complete, onStyleRemove, onDeclassified, onDeclassifyRestored, onClearKind } = props
  if (!kind) return null
  const onClose = onClearKind
  switch (kind) {
    case 'deleteTextRow':
      return <DeleteTextDialog editor={editor} mode="row" onClose={onClose} />
    case 'deleteTextColumn':
      return <DeleteTextDialog editor={editor} mode="column" onClose={onClose} />
    case 'appendReplace':
      return <AppendReplaceTextDialog editor={editor} onClose={onClose} />
    case 'manualColWidth':
      return <ManualColWidthDialog editor={editor} onClose={onClose} />
    case 'firstColStyle':
      return <TableStyleDialog editor={editor} target="column" onClose={onClose} />
    case 'firstRowStyle':
      return <TableStyleDialog editor={editor} target="row" onClose={onClose} />
    case 'tableCaption':
      return <CaptionDialog editor={editor} kind="table" onClose={onClose} />
    case 'imageCaption':
      return <CaptionDialog editor={editor} kind="image" onClose={onClose} />
    case 'uniformImageFormat':
      return <UniformImageFormatDialog editor={editor} onClose={onClose} />
    case 'styleStatistics':
      return <StyleStatisticsDialog editor={editor} styles={styles} onClose={onClose} />
    case 'unusedStyles':
      return (
        <UnusedStylesDialog
          editor={editor}
          styles={styles}
          onRemove={onStyleRemove}
          onClose={onClose}
        />
      )
    case 'declassify':
      return (
        <DeclassifyDialog
          editor={editor}
          docPath={docPath}
          complete={complete}
          onDeclassified={onDeclassified}
          onClose={onClose}
        />
      )
    case 'declassifyRestore':
      return (
        <DeclassifyRestoreDialog
          editor={editor}
          docPath={docPath}
          onRestored={onDeclassifyRestored}
          onClose={onClose}
        />
      )
    case 'formContent':
      return <FormContentDialog editor={editor} onClose={onClose} />
    default:
      return null
  }
}
