import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const here = dirname(fileURLToPath(import.meta.url))

// Pin resolution to this repo's workspace sources (matches tsconfig paths;
// avoids bundling stale implementations when node_modules links point elsewhere)
const workspaceAlias = {
  // Subpath before the bare name: string aliases are prefix replacements
  '@chatoffice/pptx-engine/table-grid': resolve(
    here,
    '../../packages/pptx-engine/src/table-grid.ts',
  ),
  '@chatoffice/pptx-engine/identity': resolve(here, '../../packages/pptx-engine/src/identity.ts'),
  '@chatoffice/pptx-engine/named-action': resolve(
    here,
    '../../packages/pptx-engine/src/named-action.ts',
  ),
  '@chatoffice/pptx-engine/custgeom': resolve(here, '../../packages/pptx-engine/src/custgeom.ts'),
  '@chatoffice/pptx-engine/background-promote': resolve(
    here,
    '../../packages/pptx-engine/src/background-promote.ts',
  ),
  '@chatoffice/pptx-engine': resolve(here, '../../packages/pptx-engine/src/index.ts'),
  '@chatoffice/pptx-ops/op-docs': resolve(here, '../../packages/pptx-ops/src/op-docs.ts'),
  '@chatoffice/pptx-ops/font-size': resolve(here, '../../packages/pptx-ops/src/font-size.ts'),
  '@chatoffice/pptx-ops': resolve(here, '../../packages/pptx-ops/src/index.ts'),
  '@chatoffice/pptx-render/preset-geometry': resolve(
    here,
    '../../packages/pptx-render/src/preset-geometry.ts',
  ),
  '@chatoffice/pptx-render': resolve(here, '../../packages/pptx-render/src/index.ts'),
  '@chatoffice/pipelines/slides/cover-crop': resolve(
    here,
    '../../packages/pipelines/src/slides/cover-crop.ts',
  ),
  '@chatoffice/pipelines/slides/layout-audit': resolve(
    here,
    '../../packages/pipelines/src/slides/layout-audit.ts',
  ),
  '@chatoffice/pipelines/slides': resolve(here, '../../packages/pipelines/src/slides/index.ts'),
  // Metafile (EMF/WMF) rasterizer shared with the docs engine (renderer-only: needs canvas)
  '@chatoffice/docx-engine/metafile': resolve(here, '../../packages/docx-engine/src/metafile.ts'),
}

export default defineConfig({
  // Main process/preload must bundle @chatoffice/* sources (they are pulled in as TS
  // source with extensionless relative imports; externalizing them under Node
  // yields ERR_MODULE_NOT_FOUND).
  main: {
    resolve: { alias: workspaceAlias },
    // Bundle opentype.js too (the packaged app ships only out/**, so external deps are unresolvable at runtime)
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@chatoffice/pptx-engine',
          '@chatoffice/pptx-ops',
          '@chatoffice/pptx-render',
          '@chatoffice/pipelines',
          '@chatoffice/ai-search',
          '@chatoffice/file-parse',
          '@chatoffice/electron-utils',
          'opentype.js',
        ],
      }),
    ],
  },
  preload: {
    // electron-utils ships raw TS source — must be bundled, not left external
    plugins: [externalizeDepsPlugin({ exclude: ['@chatoffice/electron-utils'] })],
  },
  renderer: {
    resolve: { alias: workspaceAlias },
    plugins: [react()],
    server: {
      port: Number(process.env.SLIDES_DEV_PORT) || 5175,
      strictPort: Boolean(process.env.SLIDES_DEV_PORT),
    },
  },
})
