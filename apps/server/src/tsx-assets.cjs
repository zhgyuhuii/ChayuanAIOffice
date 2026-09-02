/**
 * Vite-style `?asset` imports under tsx. The server-sidecar contexts (web
 * server, docker image, embedded dsh sidecar) run main.ts with
 * `node --import tsx --import <this file>`: tsx resolves `x.wasm?asset` to a
 * filename that KEEPS the query (re-serialized, e.g. `x.wasm?asset=`), Node's
 * extension lookup then misses and falls through to `.js`, compiling the
 * binary as JavaScript (SyntaxError). The slides main sources the server
 * imports (harfbuzz.wasm, bundled .ttf faces) load through CJS require, so:
 *
 *   1. asset extensions export their own file path (what `?asset` yields in
 *      the bundler contexts — electron-vite, vitest — natively)
 *   2. Module#load strips the query for asset files so the extension lookup
 *      in (1) actually hits
 *
 * Must preload AFTER tsx (tsx rewrites Module._extensions at registration).
 */
const Module = require('node:module')
const { extname } = require('node:path')

const ASSET_EXTENSIONS = [
  '.wasm',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.pdf',
  '.bin',
]

const ASSET_SET = new Set(ASSET_EXTENSIONS)

function assetModule(module, filename) {
  module.exports = filename.split('?')[0]
}

for (const ext of ASSET_EXTENSIONS) {
  Module._extensions[ext] = assetModule
  require.extensions[ext] = assetModule
}

const origLoad = Module.prototype.load
Module.prototype.load = function (filename) {
  const queryAt = filename.indexOf('?')
  if (queryAt !== -1 && ASSET_SET.has(extname(filename.slice(0, queryAt)))) {
    return origLoad.call(this, filename.slice(0, queryAt))
  }
  return origLoad.call(this, filename)
}
