import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // The host runs on 5180 in dev (editors keep 5173–5177, BFF 8787).
  server: { port: 5180 },
})
