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
