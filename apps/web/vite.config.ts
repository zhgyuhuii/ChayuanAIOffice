import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const distWeb = join(repoRoot, 'dist', 'web')
const bff = process.env.CHATOFFICE_BFF_URL ?? 'http://localhost:52587'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
}

/**
 * Dev-form editor assets: serve the BUILT editors (`dist/web/editors/*`) and
 * their `bridge-shim.js` from this origin. Without it the SPA fallback would
 * answer `/editors/<kind>/` with the host's own index.html — the iframe then
 * renders a nested copy of the shell instead of an editor. Editors keep their
 * own HMR story on ports 5173–5177 (dev:web runs those); this host serves the
 * production-shaped builds so the embedded topology stays same-origin.
 */
function devEditorAssets(): Plugin {
  return {
    name: 'chatoffice-dev-editor-assets',
    configureServer(server) {
      if (!existsSync(join(distWeb, 'editors'))) {
        server.config.logger.warn(
          'dist/web/editors 不存在:先跑一次 `npm run build:web`,否则编辑器标签无法加载真实编辑器。',
        )
      }
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '/').split('?')[0] ?? '/'
        let file: string
        if (url.startsWith('/editors/')) {
          const rel = decodeURIComponent(url.slice('/editors/'.length))
          file = resolve(distWeb, 'editors', rel, rel.endsWith('/') ? 'index.html' : '')
        } else if (url === '/bridge-shim.js') {
          file = join(distWeb, 'bridge-shim.js')
        } else {
          return next()
        }
        if (!file.startsWith(distWeb + sep)) {
          res.statusCode = 403
          res.end()
          return
        }
        if (!existsSync(file)) return next()
        res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream')
        // 入口文件无 hash,构建后必须总是拿最新的
        if (/\.html?$/.test(file) || file.endsWith('bridge-shim.js')) {
          res.setHeader('cache-control', 'no-cache')
        }
        res.end(readFileSync(file))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), devEditorAssets()],
  // The host runs on 5180 in dev (editors 5173–5177 as standalone dev servers,
  // BFF 8787 — proxied here so the page stays single-origin). CHATOFFICE_BFF_URL
  // overrides the target when 8787 is held by something else (e.g. the legacy
  // docker stack) and the BFF runs on another port.
  server: {
    port: 5180,
    proxy: {
      '/ai': bff,
      '/rpc': bff,
      '/healthz': bff,
    },
  },
})
