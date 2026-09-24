/**
 * Static web hosting inside the BFF (single-artifact form ②, decision #9):
 * when CHATOFFICE_STATIC_DIR points at the build:web output, this image
 * serves the editor SPA bundle alongside the API — one container, one port.
 *
 * Registered AFTER the API routes so /healthz, /rpc/* and /ai/* always win.
 */

import type { FastifyInstance } from 'fastify'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

export function attachStatic(app: FastifyInstance, root: string): void {
  if (!existsSync(root)) {
    app.log?.warn?.(`[static] CHATOFFICE_STATIC_DIR missing: ${root}`)
    return
  }

  app.setNotFoundHandler((request, reply) => {
    // API prefixes must 404 as JSON, never fall through to the SPA.
    const url = (request.url ?? '/').split('?')[0]
    if (url.startsWith('/rpc') || url.startsWith('/ai') || url.startsWith('/ws')) {
      reply.code(404).send({ error: 'not found' })
      return
    }
    const decoded = decodeURIComponent(url)
    let file = normalize(join(root, decoded))
    if (file !== root && !file.startsWith(root + sep)) {
      reply.code(403).send('forbidden')
      return
    }
    if (!existsSync(file)) {
      file = join(root, 'index.html') // SPA fallback
    } else if (statSync(file).isDirectory()) {
      const dirIndex = join(file, 'index.html')
      file = existsSync(dirIndex) ? dirIndex : join(root, 'index.html')
    }
    reply.header('content-type', MIME[extname(file)] ?? 'application/octet-stream')
    // html 与桥脚本必须总是最新（无 hash 的入口文件），其余可缓存
    if (/\.html?$/.test(file) || file.endsWith('bridge-shim.js')) {
      reply.header('cache-control', 'no-cache')
    }
    reply.send(createReadStream(file))
  })
}
