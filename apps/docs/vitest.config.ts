import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// resolve sibling source packages by path (not via node_modules), so a git
// worktree whose node_modules is linked to another checkout still tests
// against this checkout's edits (same convention as packages/pdf2docx)
const local = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@chaoffice/docx-engine/lazy-media': local('../../packages/docx-engine/src/lazy-media.ts'),
      '@chaoffice/docx-engine': local('../../packages/docx-engine/src/index.ts'),
      '@chaoffice/font-metrics/resolve': local('../../packages/font-metrics/src/resolve.ts'),
      '@chaoffice/font-metrics/word-faces.json': local(
        '../../packages/font-metrics/word-faces.json',
      ),
      '@chaoffice/font-metrics': local('../../packages/font-metrics/src/index.ts'),
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
      '@chaoffice/ui/popover-dismiss': local('../../packages/ui/src/popover-dismiss.ts'),
      '@chaoffice/ui/shape-gallery': local('../../packages/ui/src/shape-gallery.tsx'),
      '@chaoffice/ui/InsertImageDialog': local('../../packages/ui/src/InsertImageDialog.tsx'),
      '@chaoffice/ui/image-transcode': local('../../packages/ui/src/image-transcode.ts'),
      '@chaoffice/ui/image-dialogs': local('../../packages/ui/src/image-dialogs.tsx'),
      '@chaoffice/ui/ModelSettingsPage': local('../../packages/ui/src/ModelSettingsPage.tsx'),
      '@chaoffice/ui/ModelSettingsPageLazy': local('../../packages/ui/src/ModelSettingsPageLazy.ts'),
      '@chaoffice/ui/ModelDefaultsPage': local('../../packages/ui/src/ModelDefaultsPage.tsx'),
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
