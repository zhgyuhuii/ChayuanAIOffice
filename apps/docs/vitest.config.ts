import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// resolve sibling source packages by path (not via node_modules), so a git
// worktree whose node_modules is linked to another checkout still tests
// against this checkout's edits (same convention as packages/pdf2docx)
const local = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))

export default defineConfig({
  server: {
    fs: {
      // chart-kit 的 gl-frame.html 等资源位于 app 根之外——放行仓库根
      allow: [fileURLToPath(new URL('../../../', import.meta.url))],
    },
  },
  resolve: {
    alias: [
      {
        find: '@chaoffice/ui/popover-dismiss',
        replacement: local('../../packages/ui/src/popover-dismiss.ts'),
      },
      {
        find: '@chaoffice/docx-engine/lazy-media',
        replacement: local('../../packages/docx-engine/src/lazy-media.ts'),
      },
      {
        find: '@chaoffice/docx-engine',
        replacement: local('../../packages/docx-engine/src/index.ts'),
      },
      {
        find: '@chaoffice/font-metrics',
        replacement: local('../../packages/font-metrics/src/index.ts'),
      },
      {
        find: '@chaoffice/electron-utils/print-job',
        replacement: local('../../packages/electron-utils/src/print-job.ts'),
      },
      {
        find: '@chaoffice/electron-utils/atomic-write',
        replacement: local('../../packages/electron-utils/src/atomic-write.ts'),
      },
      {
        find: '@chaoffice/electron-utils/safe-external-url',
        replacement: local('../../packages/electron-utils/src/safe-external-url.ts'),
      },
      {
        find: '@chaoffice/electron-utils/headless-export',
        replacement: local('../../packages/electron-utils/src/headless-export.ts'),
      },
      {
        find: '@chaoffice/electron-utils',
        replacement: local('../../packages/electron-utils/src/index.ts'),
      },
      {
        find: '@chaoffice/ai-provider/browser',
        replacement: local('../../packages/ai-provider/src/browser.ts'),
      },
      {
        find: '@chaoffice/ai-provider',
        replacement: local('../../packages/ai-provider/src/index.ts'),
      },
      { find: '@chaoffice/i18n', replacement: local('../../packages/i18n/src/index.ts') },
      { find: '@chaoffice/ui/shape-gallery', replacement: local('../../packages/ui/src/shape-gallery.tsx') },
      { find: '@chaoffice/ui/InsertImageDialog', replacement: local('../../packages/ui/src/InsertImageDialog.tsx') },
      { find: '@chaoffice/ui/image-transcode', replacement: local('../../packages/ui/src/image-transcode.ts') },
      { find: '@chaoffice/ui/image-dialogs', replacement: local('../../packages/ui/src/image-dialogs.tsx') },
      { find: '@chaoffice/ui/ModelSettingsPage', replacement: local('../../packages/ui/src/ModelSettingsPage.tsx') },
      { find: '@chaoffice/ui/ModelSettingsPageLazy', replacement: local('../../packages/ui/src/ModelSettingsPageLazy.ts') },
      { find: '@chaoffice/ui/ModelDefaultsPage', replacement: local('../../packages/ui/src/ModelDefaultsPage.tsx') },
      { find: '@chaoffice/ui', replacement: local('../../packages/ui/src/index.ts') },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'jsdom',
    testTimeout: 20000,
  },
})
