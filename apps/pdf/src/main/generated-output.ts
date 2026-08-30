import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Pick a safe, unused PDF path inside the configured GenOffice save directory. */
export function uniqueGeneratedPdfPath(
  dir: string,
  suggestedName: string,
  pathExists: (path: string) => boolean = existsSync,
): string {
  // Control characters are intentionally rejected from generated file names.
  // eslint-disable-next-line no-control-regex
  const invalidFileNameCharacters = /[/\\:*?"<>|\u0000-\u001f]/g
  // Take the last path segment by hand (not path.basename): win32.basename
  // eats the 'a:' device prefix of 'a:b.pdf', and sanitizing before basename
  // would turn '../x' into '.._x' and smuggle traversal back in.
  const segments = String(suggestedName || 'merged.pdf').split(/[/\\]/)
  let fileName = (segments.at(-1) ?? '').replace(invalidFileNameCharacters, '_').trim()
  if (!fileName || fileName === '.' || fileName === '..') fileName = 'merged.pdf'
  if (!/\.pdf$/i.test(fileName)) fileName += '.pdf'

  const stem = fileName.slice(0, -4)
  let candidate = join(dir, fileName)
  for (let i = 2; pathExists(candidate); i++) candidate = join(dir, `${stem}-${i}.pdf`)
  return candidate
}
