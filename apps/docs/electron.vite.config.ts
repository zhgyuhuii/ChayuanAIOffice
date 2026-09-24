import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// Resolve workspace packages from this checkout's sources: in a git worktree
// node_modules is a symlink into the main checkout, so bare specifiers would
// silently bundle the other checkout's (possibly stale) code.
const localAlias = {
  '@chatoffice/docx-engine/lazy-media': resolve(
    __dirname,
    '../../packages/docx-engine/src/lazy-media.ts',
  ),
  '@chatoffice/docx-engine/zip-splice': resolve(
    __dirname,
    '../../packages/docx-engine/src/zip-splice.ts',
  ),
  '@chatoffice/docx-engine': resolve(__dirname, '../../packages/docx-engine/src/index.ts'),
}

// @chatoffice/* packages ship as raw TS source with extensionless imports, so
// every one reachable from main/preload must be bundled — externalizing any of
// them yields ERR_MODULE_NOT_FOUND under Node (same setup as apps/slides).
const BUNDLED_WORKSPACE_DEPS = [
  '@chatoffice/ai-host',
  '@chatoffice/ai-provider',
  '@chatoffice/ai-search',
  '@chatoffice/electron-utils',
  '@chatoffice/file-parse',
  '@chatoffice/font-metrics',
  '@chatoffice/i18n',
  '@chatoffice/project-store',
  '@chatoffice/storage-adapter',
]

export default defineConfig({
  // Main and preload use only electron + node builtins; bundle everything so
  // the packaged app doesn't rely on node_modules at runtime.
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@chatoffice/docx-engine', '@chatoffice/electron-utils', '@chatoffice/font-metrics'],
      }),
    ],
    resolve: { alias: localAlias },
  },
  preload: {
    // Sandboxed preload scripts cannot require arbitrary npm packages at
    // runtime, so the drop-open bridge must be bundled, not externalized.
    plugins: [externalizeDepsPlugin({ exclude: BUNDLED_WORKSPACE_DEPS })],
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: localAlias },
    server: {
      // Overridable so multiple chatoffice dev instances can coexist (default 5173).
      port: Number(process.env.DOCS_DEV_PORT) || 5173,
      strictPort: Boolean(process.env.DOCS_DEV_PORT),
    },
  },
})
