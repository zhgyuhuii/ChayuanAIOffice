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
      '@chaoffice/docx-engine/lazy-media': local('../../packages/docx-engine/src/lazy-media.ts'),
      '@chaoffice/docx-engine/zip-splice': local('../../packages/docx-engine/src/zip-splice.ts'),
      '@chaoffice/font-metrics/resolve': local('../../packages/font-metrics/src/resolve.ts'),
      '@chaoffice/font-metrics/word-faces.json': local('../../packages/font-metrics/word-faces.json'),
      '@chaoffice/electron-utils/headless-export': local('../../packages/electron-utils/src/headless-export.ts'),
      '@chaoffice/electron-utils/safe-remote-url': local('../../packages/electron-utils/src/safe-remote-url.ts'),
      '@chaoffice/electron-utils/drop-open': local('../../packages/electron-utils/src/drop-open.ts'),
      '@chaoffice/electron-utils/generated-images': local('../../packages/electron-utils/src/generated-images.ts'),
      '@chaoffice/electron-utils/remote-image': local('../../packages/electron-utils/src/remote-image.ts'),
      '@chaoffice/electron-utils/print-cups': local('../../packages/electron-utils/src/print-cups.ts'),
      '@chaoffice/electron-utils/print-html-pdf': local('../../packages/electron-utils/src/print-html-pdf.ts'),
      '@chaoffice/electron-utils/dialog-memory': local('../../packages/electron-utils/src/dialog-memory.ts'),
      '@chaoffice/electron-utils/updater-version': local('../../packages/electron-utils/src/updater-version.ts'),
      '@chaoffice/electron-utils/atomic-write': local('../../packages/electron-utils/src/atomic-write.ts'),
      '@chaoffice/electron-utils/safe-external-url': local('../../packages/electron-utils/src/safe-external-url.ts'),
      '@chaoffice/electron-utils/print-job': local('../../packages/electron-utils/src/print-job.ts'),
      '@chaoffice/ai-provider/browser': local('../../packages/ai-provider/src/browser.ts'),
      '@chaoffice/ai-provider/media': local('../../packages/ai-provider/src/media.ts'),
      '@chaoffice/ai-provider/output-cap': local('../../packages/ai-provider/src/output-cap.ts'),
      '@chaoffice/ai-provider/codex-app-server': local('../../packages/ai-provider/src/codex-app-server.ts'),
      '@chaoffice/docx-engine': local('../../packages/docx-engine/src/index.ts'),
      '@chaoffice/font-metrics': local('../../packages/font-metrics/src/index.ts'),
      '@chaoffice/electron-utils': local('../../packages/electron-utils/src/index.ts'),
      '@chaoffice/ai-provider': local('../../packages/ai-provider/src/index.ts'),
      '@chaoffice/i18n': local('../../packages/i18n/src/index.ts'),
      '@chaoffice/ui/popover-dismiss': local('../../packages/ui/src/popover-dismiss.ts'),
      '@chaoffice/ui/shape-gallery': local('../../packages/ui/src/shape-gallery.tsx'),
      '@chaoffice/ui/InsertImageDialog': local('../../packages/ui/src/InsertImageDialog.tsx'),
      '@chaoffice/ui/image-transcode': local('../../packages/ui/src/image-transcode.ts'),
      '@chaoffice/ui/image-dialogs': local('../../packages/ui/src/image-dialogs.tsx'),
      '@chaoffice/ui/ModelSettingsPage': local('../../packages/ui/src/ModelSettingsPage.tsx'),
      '@chaoffice/ui/ModelSettingsPageLazy': local('../../packages/ui/src/ModelSettingsPageLazy.ts'),
      '@chaoffice/ui/ModelDefaultsPage': local('../../packages/ui/src/ModelDefaultsPage.tsx'),
      '@chaoffice/ui': local('../../packages/ui/src/index.ts'),
      '@chaoffice/xlsx-gateway/*': local('../../packages/xlsx-gateway/src/*'),
      '@chaoffice/ui/measurement': local('../../packages/ui/src/measurement.ts'),
    },
  },

  test: {
    include: ['tests/**/*.test.ts'],
    // the engine's display-only `effective` keys stay out of saved-model toEqual
    setupFiles: [
      local('../../packages/docx-engine/tests/setup-equality.ts'),
      // every package a test saves must read back as strict XML
      local('../../packages/docx-engine/tests/setup-strict-xml.ts'),
    ],
    environment: 'jsdom',
    testTimeout: 20000,
  },
})
