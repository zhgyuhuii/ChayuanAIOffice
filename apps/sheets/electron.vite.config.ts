import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    // @chatoffice/* workspace packages ship TS source (no build step, no
    // compiled entry point) — externalizing them makes Node's ESM loader try
    // to resolve their relative imports at runtime and fail. Bundle those;
    // externalize everything else (Electron, zod, node builtins).
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@chatoffice/ai-provider',
          '@chatoffice/agent-core',
          '@chatoffice/ai-search',
          '@chatoffice/docx-engine',
          '@chatoffice/file-parse',
          '@chatoffice/electron-utils',
          '@chatoffice/i18n',
          '@chatoffice/pptx-render',
          '@chatoffice/xlsx-gateway',
        ],
      }),
    ],
  },
  preload: {
    // Sandboxed preload scripts cannot require arbitrary npm packages at
    // runtime, so the drop-open bridge must be bundled, not externalized.
    plugins: [externalizeDepsPlugin({ exclude: ['@chatoffice/electron-utils'] })],
  },
  renderer: {
    plugins: [react()],
  },
})
