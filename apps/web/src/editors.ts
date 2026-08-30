/** Pure editor registry shared by the host shell and tests. */

export type EditorKey = 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown'

export interface EditorSpec {
  key: EditorKey
  label: string
  url: string
}

export const EDITOR_KEYS: EditorKey[] = ['docs', 'sheets', 'slides', 'pdf', 'markdown']

const LABELS: Record<EditorKey, string> = {
  docs: 'Docs',
  sheets: 'Sheets',
  slides: 'Slides',
  pdf: 'PDF',
  markdown: 'Markdown',
}

const DEV_PORTS: Record<EditorKey, number> = {
  docs: 5173,
  sheets: 5174,
  slides: 5175,
  pdf: 5176,
  markdown: 5177,
}

/**
 * Resolves editor URLs from an injected map (production packaging) with
 * dev-server fallbacks (scripts/dev-shell.mjs ports).
 */
export function resolveEditors(
  injected?: Partial<Record<EditorKey, string>> | null,
  devOrigin = 'http://localhost',
): EditorSpec[] {
  return EDITOR_KEYS.map((key) => ({
    key,
    label: LABELS[key],
    url: injected?.[key] ?? `${devOrigin}:${DEV_PORTS[key]}`,
  }))
}
