import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // Always resolve to this repo's workspace sources (consistent with tsconfig paths)
  resolve: {
    alias: {
      // Subpath before the bare name: string aliases are prefix replacements
      '@chaoffice/pptx-engine/table-grid': resolve(here, '../pptx-engine/src/table-grid.ts'),
      '@chaoffice/pptx-engine/identity': resolve(here, '../pptx-engine/src/identity.ts'),
      '@chaoffice/pptx-engine/background-promote': resolve(
        here,
        '../pptx-engine/src/background-promote.ts',
      ),
      '@chaoffice/pptx-engine': resolve(here, '../pptx-engine/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
