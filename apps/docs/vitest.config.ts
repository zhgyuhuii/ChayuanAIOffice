import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// resolve sibling source packages by path (not via node_modules), so a git
// worktree whose node_modules is linked to another checkout still tests
// against this checkout's edits (same convention as packages/pdf2docx)
const local = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // subpath before the bare name: string aliases are prefix replacements
      '@chaoffice/electron-utils/headless-export': local(
        '../../packages/electron-utils/src/headless-export.ts',
      ),
      '@chaoffice/electron-utils/atomic-write': local(
        '../../packages/electron-utils/src/atomic-write.ts',
      ),
      '@chaoffice/electron-utils/safe-external-url': local(
        '../../packages/electron-utils/src/safe-external-url.ts',
      ),
      '@chaoffice/electron-utils/print-job': local(
        '../../packages/electron-utils/src/print-job.ts',
      ),
      '@chaoffice/electron-utils': local('../../packages/electron-utils/src/index.ts'),
      '@chaoffice/ai-provider/browser': local('../../packages/ai-provider/src/browser.ts'),
      '@chaoffice/ai-provider': local('../../packages/ai-provider/src/index.ts'),
      '@chaoffice/i18n': local('../../packages/i18n/src/index.ts'),
      '@chaoffice/ui': local('../../packages/ui/src/index.ts'),
      '@chaoffice/xlsx-gateway/*': local('../../packages/xlsx-gateway/src/*'),
    },
  },

  test: {
    include: ['tests/**/*.test.ts'],
    // the engine's display-only `effective` keys stay out of saved-model toEqual
    setupFiles: [local('../../packages/docx-engine/tests/setup-equality.ts')],
    environment: 'jsdom',
    testTimeout: 20000,
  },
})
