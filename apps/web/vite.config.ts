import { defineConfig } from 'vite'

export default defineConfig({
  // The editor dev servers live on 5173–5177 (see scripts/dev-shell.mjs);
  // the host itself takes 5180 to stay out of their way.
  server: {
    port: 5180,
  },
})
