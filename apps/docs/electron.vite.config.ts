import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// Resolve workspace packages from this checkout's sources: in a git worktree
// node_modules is a symlink into the main checkout, so bare specifiers would
// silently bundle the other checkout's (possibly stale) code.
const localAlias = {
  '@chaoffice/docx-engine/giant': resolve(
    __dirname,
    '../../packages/docx-engine/src/giant.ts',
  ),
  '@chaoffice/docx-engine/lazy-media': resolve(
    __dirname,
    '../../packages/docx-engine/src/lazy-media.ts',
  ),
  '@chaoffice/docx-engine/zip-splice': resolve(
    __dirname,
    '../../packages/docx-engine/src/zip-splice.ts',
  ),
  '@chaoffice/docx-engine': resolve(__dirname, '../../packages/docx-engine/src/index.ts'),
}

// @chaoffice/* packages ship as raw TS source with extensionless imports, so
// every one reachable from main/preload must be bundled — externalizing any of
// them yields ERR_MODULE_NOT_FOUND under Node (same setup as apps/slides).
const BUNDLED_WORKSPACE_DEPS = [
  '@chaoffice/ai-host',
  '@chaoffice/ai-provider',
  '@chaoffice/ai-search',
  '@chaoffice/electron-utils',
  '@chaoffice/file-parse',
  '@chaoffice/font-metrics',
  '@chaoffice/i18n',
  '@chaoffice/project-store',
  '@chaoffice/storage-adapter',
]

export default defineConfig({
  // Main and preload use only electron + node builtins; bundle everything so
  // the packaged app doesn't rely on node_modules at runtime.
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@chaoffice/docx-engine', '@chaoffice/electron-utils', '@chaoffice/font-metrics', '@chaoffice/xlsx-gateway'],      }),
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
      // Overridable so multiple chaoffice dev instances can coexist (default 5173).
      port: Number(process.env.DOCS_DEV_PORT) || 5173,
      strictPort: Boolean(process.env.DOCS_DEV_PORT),
    },
  },
})
