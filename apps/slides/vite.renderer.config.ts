import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// renderer-only dev server (embedded by the shell via SLIDES_RENDERER_URL for HMR; no standalone Electron)
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  optimizeDeps: {
    // pipelines 是工作区 TS 源码包，esbuild 预构建走不通：extractExportsData 对 TS 源码
    // 回退 jsx loader（import type 语法直接炸），slides/index 链上的 .md?raw 更是 vite 专属
    // 管道语法。exclude 出预构建，按源码逐请求走 vite:esbuild / vite:raw 转译即可。
    exclude: ['@chatoffice/pipelines'],
  },
  server: {
    port: Number(process.env.SLIDES_DEV_PORT) || 5175,
    strictPort: true,
  },
})
