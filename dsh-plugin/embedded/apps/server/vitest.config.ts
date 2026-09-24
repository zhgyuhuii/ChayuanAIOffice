import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      // harfbuzz wasm chain is stubbed for tests (font metrics fall back to heuristics)
      { find: './shaped-metrics', replacement: resolve(here, 'tests/stubs/shaped-metrics.ts') },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // workspace-external sources (apps/slides render pipeline) must go through
    // vite so the shaped-metrics alias applies
    server: { deps: { inline: ['/slides/'] } },
  },
})
