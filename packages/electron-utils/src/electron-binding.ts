/**
 * Lazy electron binding accessor. Node-only hosts (the BFF server and the
 * dsh sidecar) reach electron-utils through package-root re-exports
 * (ai-search → media-tools → index); a top-level `import 'electron'` would
 * crash plain Node before any code runs. The binding is required on first
 * use by preload-world callers (drop-open), never at module scope.
 *
 * Isolated in its own module so tests can `vi.mock('./electron-binding')`
 * without touching the real require pipeline.
 */
import { createRequire } from 'node:module'

const requireElectron = createRequire(import.meta.url)

export function electronBinding(): typeof import('electron') {
  return requireElectron('electron') as typeof import('electron')
}
