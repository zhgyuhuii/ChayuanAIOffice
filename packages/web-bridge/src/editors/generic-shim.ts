/**
 * Sheets / slides web shims: full API present via the Proxy shim (every call
 * degrades explicitly with batch info; on* subscribers no-op) until the
 * server-side engines land (xlsx Rust sidecar / pptx-engine, batches 3–4).
 * The editors boot and render their UI today instead of crashing.
 */

import { BridgeClient } from '../client.js'
import { makeShim } from '../shim-factory.js'

function baseState() {
  return {
    async getLanguage(): Promise<string> {
      return (localStorage.getItem('genoffice.lang') as string) ?? 'zh'
    },
    async getTheme(): Promise<'light' | 'dark' | 'system'> {
      return 'system'
    },
    setDirty: () => undefined,
  }
}

export function installSheetsShim(client: BridgeClient): void {
  ;(window as unknown as Record<string, unknown>).desktopApi = makeShim(client, {
    impl: baseState() as unknown as Record<string, (...args: never[]) => unknown>,
    prefix: 'sheets',
  })
}

export function installSlidesShim(client: BridgeClient): void {
  ;(window as unknown as Record<string, unknown>).slidesApi = makeShim(client, {
    impl: baseState() as unknown as Record<string, (...args: never[]) => unknown>,
    prefix: 'slides',
  })
  ;(window as unknown as Record<string, unknown>).desktop = makeShim(client, { impl: {}, prefix: 'slides.desktop' })
}
