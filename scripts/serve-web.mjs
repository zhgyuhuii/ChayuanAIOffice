/**
 * Zero-dependency static server for dist/web (form ② preview / self-host).
 *   node scripts/serve-web.mjs [port]
 */

import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'web')
const port = Number(process.argv[2] ?? 5180)

const MIME = {
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

if (!existsSync(root)) {
  console.error(`nothing to serve — run "npm run build:web" first (${root} missing)`)
  process.exit(1)
}

createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0])
  let file = normalize(join(root, url))
  if (!file.startsWith(root + sep) && file !== root) {
    res.writeHead(403).end('forbidden')
    return
  }
  if (!existsSync(file)) {
    file = join(root, 'index.html') // SPA fallback
  } else if (statSync(file).isDirectory()) {
    // directory request (/editors/docs/) resolves to its own index first —
    // falling through to the root SPA shell here serves the SHELL page inside
    // the editor iframe (blank editor, very misleading while debugging)
    const dirIndex = join(file, 'index.html')
    file = existsSync(dirIndex) ? dirIndex : join(root, 'index.html')
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}).listen(port, () => {
  console.log(`serving ${root} → http://localhost:${port}`)
})
