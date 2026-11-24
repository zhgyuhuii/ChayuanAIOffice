import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    // @chaoffice/* workspace packages ship TS source (no build step, no
    // compiled entry point) — externalizing them makes Node's ESM loader try
    // to resolve their relative imports at runtime and fail. Bundle those;
    // externalize everything else (Electron, zod, node builtins).
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@chaoffice/ai-provider',
          '@chaoffice/agent-core',
          '@chaoffice/ai-search',
          '@chaoffice/docx-engine',
          '@chaoffice/file-parse',
          '@chaoffice/electron-utils',
          '@chaoffice/i18n',
          '@chaoffice/pptx-render',
          '@chaoffice/xlsx-gateway',
        ],
      }),
    ],
  },
  preload: {
    // Sandboxed preload scripts cannot require arbitrary npm packages at
    // runtime, so the drop-open bridge and the measurement-unit channels
    // must be bundled, not externalized.
    plugins: [externalizeDepsPlugin({ exclude: ['@chaoffice/electron-utils', '@chaoffice/ui'] })],
  },
  renderer: {
    plugins: [react()],
  },
})
