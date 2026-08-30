/** Pure editor registry helpers shared by the host and tests. */

export type EditorKey = 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown'

export const EDITOR_KEYS: EditorKey[] = ['docs', 'sheets', 'slides', 'pdf', 'markdown']

/** Maps a file name to the editor that owns it; null = unsupported. */
export function editorForFile(name: string): EditorKey | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.docx')) return 'docs'
  if (lower.endsWith('.xlsx')) return 'sheets'
  if (lower.endsWith('.pptx')) return 'slides'
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown'
  return null
}
