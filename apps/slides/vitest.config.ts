import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))

// pdf-main imports nativeImage for the app icon; jsdom/happy-dom has no electron
const electronMock = {
  nativeImage: { createFromPath: () => ({}) },
}

export default defineConfig({
  server: {
    fs: {
      // pptx-ops 的 prompt .md 以 ?raw 引入，位于 app 根之外——放行仓库根
      allow: [fileURLToPath(new URL('../../../', import.meta.url))],
    },
  },
  // Pin resolution to this repo's workspace sources (matches tsconfig paths)
  resolve: {
    alias: {
      // Subpath before the bare name: string aliases are prefix replacements
      '@chaoffice/pptx-engine/table-grid': resolve(
        here,
        '../../packages/pptx-engine/src/table-grid.ts',
      ),
      '@chaoffice/pptx-engine/identity': resolve(
        here,
        '../../packages/pptx-engine/src/identity.ts',
      ),
'@chaoffice/pptx-engine/named-action': resolve(
        here,
        '../../packages/pptx-engine/src/named-action.ts',
      ),
      '@chaoffice/pptx-engine/background-promote': resolve(
        here,
        '../../packages/pptx-engine/src/background-promote.ts',
      ),
      '@chaoffice/pptx-engine/custgeom': resolve(
        here,
        '../../packages/pptx-engine/src/custgeom.ts',
      ),
      '@chaoffice/pptx-engine': resolve(here, '../../packages/pptx-engine/src/index.ts'),
      '@chaoffice/pptx-ops/op-docs': resolve(here, '../../packages/pptx-ops/src/op-docs.ts'),
      '@chaoffice/pptx-ops/font-size': resolve(here, '../../packages/pptx-ops/src/font-size.ts'),
      '@chaoffice/pptx-ops': resolve(here, '../../packages/pptx-ops/src/index.ts'),
      '@chaoffice/pptx-render/preset-geometry': resolve(
        here,
        '../../packages/pptx-render/src/preset-geometry.ts',
      ),
      '@chaoffice/pptx-render': resolve(here, '../../packages/pptx-render/src/index.ts'),
      '@chaoffice/pipelines/slides/layout-audit': resolve(
        here,
        '../../packages/pipelines/src/slides/layout-audit.ts',
      ),
      '@chaoffice/pipelines/slides/cover-crop': resolve(
        here,
        '../../packages/pipelines/src/slides/cover-crop.ts',
      ),
      '@chaoffice/pipelines/slides': resolve(here, '../../packages/pipelines/src/slides/index.ts'),
      '@chaoffice/docx-engine/metafile': resolve(
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
