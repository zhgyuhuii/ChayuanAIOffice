import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // Pin resolution to this repo's workspace sources (matches tsconfig paths)
  resolve: {
    alias: {
      // Subpath before the bare name: string aliases are prefix replacements
      '@chatoffice/pptx-engine/table-grid': resolve(
        here,
        '../../packages/pptx-engine/src/table-grid.ts',
      ),
      '@chatoffice/pptx-engine/identity': resolve(
        here,
        '../../packages/pptx-engine/src/identity.ts',
      ),
'@chatoffice/pptx-engine/named-action': resolve(
        here,
        '../../packages/pptx-engine/src/named-action.ts',
      ),
      '@chatoffice/pptx-engine/background-promote': resolve(
        here,
        '../../packages/pptx-engine/src/background-promote.ts',
      ),
      '@chatoffice/pptx-engine/custgeom': resolve(
        here,
        '../../packages/pptx-engine/src/custgeom.ts',
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
      '@chatoffice/pipelines/slides/layout-audit': resolve(
        here,
        '../../packages/pipelines/src/slides/layout-audit.ts',
      ),
      '@chatoffice/pipelines/slides': resolve(here, '../../packages/pipelines/src/slides/index.ts'),
      '@chatoffice/docx-engine/metafile': resolve(
        here,
        '../../packages/docx-engine/src/metafile.ts',
      ),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'jsdom',
    testTimeout: 20000,
  },
})
