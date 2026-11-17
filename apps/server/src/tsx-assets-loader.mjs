// ESM twin of tsx-assets.cjs: serves vite-style `?raw` text imports (pptx-ops
// op-docs prompt docs) under `node --import tsx --import tsx-assets.cjs`. The
// CJS hooks there cannot see ESM loads, so raw markdown ships from here.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  // short-circuit the asset/raw specifiers before tsx's resolver sees the
  // unknown-query URL (it throws ERR_MODULE_NOT_FOUND at resolve time)
  if (specifier.includes('?asset') || specifier.includes('?raw')) {
    try {
      const u = new URL(specifier, context.parentURL ?? undefined)
      if (u.protocol === 'file:' || u.protocol === 'data:') {
        return { url: u.href, shortCircuit: true, format: 'module' }
      }
    } catch {
      /* bare package specifier: resolve the package part, then re-apply the query */
    }
    const r = await nextResolve(specifier.split('?')[0], context)
    const q = specifier.slice(specifier.indexOf('?'))
    return { url: r.url + q, shortCircuit: true, format: 'module' }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  const rawUrl = url.replace(/%3F/gi, '?')
  if (rawUrl.includes('?asset')) {
    // vite ?asset semantics: the module's default export is the file path
    const file = fileURLToPath(rawUrl.slice(0, rawUrl.indexOf('?asset')))
    return {
      format: 'module',
      source: `export default ${JSON.stringify(file)};`,
      shortCircuit: true,
    }
  }
  if (rawUrl.includes('?raw')) {
    const file = fileURLToPath(rawUrl.slice(0, rawUrl.indexOf('?raw')))
    const text = readFileSync(file, 'utf8')
    return {
      format: 'module',
      source: `export default ${JSON.stringify(text)};`,
      shortCircuit: true,
    }
  }
  return nextLoad(url, context)
}
