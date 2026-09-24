/**
 * Launch the shell app in dev mode pointed at the renderer vite dev servers.
 *
 * The root `dev` script needs the five *_RENDERER_URL vars set for the shell
 * process only. Inline `VAR=value cmd` syntax is POSIX-only — cmd.exe tries to
 * run it as a command name — so on Windows the env prefix must be applied here.
 */
import { spawn } from 'node:child_process'

const env = {
  ...process.env,
  // Ports follow the renderers' *_DEV_PORT overrides (vite.renderer.config.ts),
  // so e.g. DOCS_DEV_PORT=5183 npm run dev dodges another project's 5173.
  DOCS_RENDERER_URL: `http://localhost:${process.env.DOCS_DEV_PORT ?? 5173}`,
  SHEETS_RENDERER_URL: `http://localhost:${process.env.SHEETS_DEV_PORT ?? 5174}`,
  SLIDES_RENDERER_URL: `http://localhost:${process.env.SLIDES_DEV_PORT ?? 5175}`,
  PDF_RENDERER_URL: `http://localhost:${process.env.PDF_DEV_PORT ?? 5176}`,
  MARKDOWN_RENDERER_URL: `http://localhost:${process.env.MARKDOWN_DEV_PORT ?? 5177}`,
  // LOCAL(2026-09-21, d8201ad0): html 渲染端此前漏设——shell 模式下 html 编辑器会回退到
  // 旧打包产物(chatoffice-app://),dev 调试不到 vite 热更代码;与五端对齐补上
  HTML_RENDERER_URL: `http://localhost:${process.env.HTML_DEV_PORT ?? 5178}`,
  // Linux dev：electron 的 SUID chrome-sandbox 要求 root 属主+4755，开发检出装不出来
  // （FATAL: sandbox ... aborting now）。dev 一律免沙箱启动，与 e2e helpers 的先例一致；
  // 打包产物由 deb 的 after-install 脚本修 sandbox 权限，不受此影响。
  ...(process.platform === 'linux' ? { ELECTRON_DISABLE_SANDBOX: '1' } : {}),
}

// shell: true — on Windows `npm` is npm.cmd, which spawn cannot launch directly
const child = spawn('npm', ['run', 'dev', '-w', '@chatoffice/shell'], {
  stdio: 'inherit',
  env,
  shell: true,
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
child.on('close', (code) => process.exit(code ?? 1))
