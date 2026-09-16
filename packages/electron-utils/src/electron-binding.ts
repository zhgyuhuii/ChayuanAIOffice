/**
 * Lazy electron binding accessor. Node-only hosts (the BFF server and the
 * dsh sidecar) reach electron-utils through package-root re-exports
 * (ai-search → media-tools → index); a top-level `import 'electron'` would
 * crash plain Node before any code runs. The binding is required on first
 * use by preload-world callers (drop-open), never at module scope.
 *
 * Isolated in its own module so tests can `vi.mock('./electron-binding')`
 * without touching the real require pipeline.
 *
 * The resolve must stay inside the function: a module-scope
 * `createRequire` from 'node:module' gets bundled into the sandboxed shell
 * preload (drop-open is part of its graph), and node:module is NOT on the
 * sandbox whitelist — the preload then fails to load and the shell window
 * comes up blank. Plain require('electron') from within a preload bundle is
 * whitelisted; real ESM hosts never call this function.
 */
declare const require: (id: string) => unknown

export function electronBinding(): typeof import('electron') {
  return require('electron') as typeof import('electron')
}
