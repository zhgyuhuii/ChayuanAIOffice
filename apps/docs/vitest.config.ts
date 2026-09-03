import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// resolve sibling source packages by path (not via node_modules), so a git
// worktree whose node_modules is linked to another checkout still tests
// against this checkout's edits (same convention as packages/pdf2docx)
const local = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@chatoffice/ui/popover-dismiss',
        replacement: local('../../packages/ui/src/popover-dismiss.ts'),
      },
      {
        find: '@chatoffice/docx-engine',
        replacement: local('../../packages/docx-engine/src/index.ts'),
      },
      {
        find: '@chatoffice/font-metrics',
        replacement: local('../../packages/font-metrics/src/index.ts'),
      },
      {
        find: '@chatoffice/electron-utils',
        replacement: local('../../packages/electron-utils/src/index.ts'),
      },
      {
        find: '@chatoffice/ai-provider',
        replacement: local('../../packages/ai-provider/src/index.ts'),
      },
      { find: '@chatoffice/i18n', replacement: local('../../packages/i18n/src/index.ts') },
      { find: '@chatoffice/ui', replacement: local('../../packages/ui/src/index.ts') },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'jsdom',
    testTimeout: 20000,
  },
})
