/**
 * Web/dsh-form knowledge-base bridge (docs/kb-integration-plan.md §5.1):
 * exposes the same `window.chatOfficeKb` contract the desktop preloads
 * install, backed by same-origin fetches against the sidecar's /kb/* proxy.
 * The base keeps the /chatoffice-app prefix when running behind the dsh
 * plugin's reverse proxy so both the shell page and editor pages resolve.
 */

export interface KbFetchBridge {
  discover(): Promise<unknown>
  search(args: { kbIds: string[]; q: string; topK?: number }): Promise<unknown>
  doc(args: { kbId: string; docId: string }): Promise<unknown>
  file(args: { kbId: string; docId: string }): Promise<unknown>
  getSource(): Promise<unknown>
  setOrigin(origin: string | null): Promise<unknown>
}

/** '' in the plain web form; '/chatoffice-app' behind the dsh plugin proxy */
export function kbApiBase(pathname = window.location.pathname): string {
  const marker = '/chatoffice-app'
  const idx = pathname.indexOf(marker)
  return idx >= 0 ? pathname.slice(0, idx + marker.length) : ''
}

/** same-origin download URL for a citation's source file (browser handles it) */
export function kbFileUrl(args: { kbId: string; docId: string }, baseUrl = kbApiBase()): string {
  const url = new URL(`${baseUrl}/kb/file`, window.location.origin)
  url.searchParams.set('kbId', args.kbId)
  url.searchParams.set('docId', args.docId)
  return url.toString()
}

export function createKbFetchBridge(baseUrl = kbApiBase()): KbFetchBridge {
  const call = async (path: string, query?: Record<string, string>): Promise<unknown> => {
    const url = new URL(`${baseUrl}/kb/${path}`, window.location.origin)
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v)
    const response = await fetch(url)
    return (await response.json()) as unknown
  }
  return {
    discover: () => call('discover'),
    search: (args) =>
      call('search', {
        kbIds: args.kbIds.join(','),
        q: args.q,
        ...(args.topK ? { topK: String(args.topK) } : {}),
      }),
    doc: (args) => call('doc', { kbId: args.kbId, docId: args.docId }),
    // the payload is the file itself, not JSON: hand back the download URL and
    // let the browser's navigation download handle auth-free same-origin I/O
    file: (args) => Promise.resolve({ ok: true, url: kbFileUrl(args, baseUrl) }),
    getSource: () => call('getSource').catch(() => ({})),
    setOrigin: () => call('setOrigin').catch(() => ({})),
  }
}

/** idempotent: install only when no real preload bridge is present */
export function installKbFetchBridge(): void {
  const w = window as unknown as { chatOfficeKb?: unknown }
  if (w.chatOfficeKb) return
  w.chatOfficeKb = createKbFetchBridge()
}
