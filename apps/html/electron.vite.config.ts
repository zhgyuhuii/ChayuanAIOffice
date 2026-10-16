import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  // @chaoffice/i18n and @chaoffice/electron-utils ship as TS source — must be bundled
  main: {
    plugins: [externalizeDepsPlugin({
        exclude: [
          '@chaoffice/i18n',
          '@chaoffice/electron-utils',
          // LOCAL(2026-09-21, d8201ad0): ai-host 的 exports 指向 TS 源码,外置后沙箱
          // preload 的 require 解析失败致整页空白——内联(markdown/pdf 未声明该依赖,
          // 实际行为即内联,此处对齐)
          '@chaoffice/ai-host',
          '@chaoffice/ai-host/kb-channels',
        ],
      })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({
        exclude: [
          '@chaoffice/i18n',
          '@chaoffice/electron-utils',
          // LOCAL(2026-09-21, d8201ad0): ai-host 的 exports 指向 TS 源码,外置后沙箱
          // preload 的 require 解析失败致整页空白——内联(markdown/pdf 未声明该依赖,
          // 实际行为即内联,此处对齐)
          '@chaoffice/ai-host',
          '@chaoffice/ai-host/kb-channels',
        ],
      })],
  },
  renderer: {
    plugins: [react()],
    server: {
      port: Number(process.env.HTML_DEV_PORT) || 5178,
      strictPort: Boolean(process.env.HTML_DEV_PORT),
    },
  },
})
