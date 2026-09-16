import { BrowserWindow, ipcMain } from 'electron'

/**
 * Cloudflare Bot Management blocks Node fetch (undici) and Electron net.fetch
 * because their TLS fingerprints differ from a real Chromium renderer. A hidden
 * BrowserWindow runs a genuine Chromium renderer whose fetch has the correct
 * TLS fingerprint and passes Cloudflare.
 *
 * Protocol:
 *  - Metadata (status, headers) returns via executeJavaScript's resolved value
 *  - Body chunks stream via ipcRenderer.send → ipcMain.on (CHANNEL_CHUNK)
 *  - Cancellation goes via ipcRenderer.invoke → ipcMain.handle (CHANNEL_CANCEL)
 */

let hiddenWindow: BrowserWindow | null = null

const DATA_URL =
  'data:text/html,<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *; script-src * \'unsafe-inline\'; style-src * \'unsafe-inline\'"></head><body></html>'

const CHANNEL_CHUNK = 'ai-proxy:fetch-chunk'
const CHANNEL_CANCEL = 'ai-proxy:fetch-cancel'

async function ensureHiddenWindow(): Promise<BrowserWindow> {
  if (hiddenWindow && !hiddenWindow.isDestroyed()) return hiddenWindow

  hiddenWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      offscreen: true,
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  await hiddenWindow.loadURL(DATA_URL)

  ipcMain.handle(CHANNEL_CANCEL, (_event, reqId: string) => {
    hiddenWindow?.webContents.executeJavaScript(`
      if (globalThis.__aiProxyAbort && globalThis.__aiProxyAbort[${JSON.stringify(reqId)}]) {
        globalThis.__aiProxyAbort[${JSON.stringify(reqId)}].abort();
        delete globalThis.__aiProxyAbort[${JSON.stringify(reqId)}];
      }
    `).catch(() => {})
  })

  return hiddenWindow
}

function buildExecuteCode(
  reqId: string,
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
): string {
  return `
    (async () => {
      if (!globalThis.__aiProxyAbort) globalThis.__aiProxyAbort = {};
      const ac = new AbortController();
      globalThis.__aiProxyAbort[${JSON.stringify(reqId)}] = ac;
      const { ipcRenderer } = require('electron');
      try {
        const resp = await fetch(${JSON.stringify(url)}, {
          method: ${JSON.stringify(method)},
          headers: ${JSON.stringify(headers)},
          body: ${body != null ? JSON.stringify(body) : 'undefined'},
          signal: ac.signal,
        });
        const h = {};
        resp.headers.forEach((v, k) => { h[k] = v; });
        if (resp.body) {
          const reader = resp.body.getReader();
          (async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  ipcRenderer.send(${JSON.stringify(CHANNEL_CHUNK)}, ${JSON.stringify(reqId)}, { type: 'done' });
                  break;
                }
                ipcRenderer.send(${JSON.stringify(CHANNEL_CHUNK)}, ${JSON.stringify(reqId)}, {
                  type: 'data', b64: Buffer.from(value).toString('base64'),
                });
              }
            } catch (err) {
              ipcRenderer.send(${JSON.stringify(CHANNEL_CHUNK)}, ${JSON.stringify(reqId)}, {
                type: 'error', message: err instanceof Error ? err.message : String(err),
              });
            } finally {
              delete globalThis.__aiProxyAbort[${JSON.stringify(reqId)}];
            }
          })();
        } else {
          const buf = await resp.arrayBuffer();
          if (buf.byteLength > 0) {
            ipcRenderer.send(${JSON.stringify(CHANNEL_CHUNK)}, ${JSON.stringify(reqId)}, {
              type: 'data', b64: Buffer.from(buf).toString('base64'),
            });
          }
          ipcRenderer.send(${JSON.stringify(CHANNEL_CHUNK)}, ${JSON.stringify(reqId)}, { type: 'done' });
          delete globalThis.__aiProxyAbort[${JSON.stringify(reqId)}];
        }
        return { status: resp.status, headers: h };
      } catch (err) {
        delete globalThis.__aiProxyAbort[${JSON.stringify(reqId)}];
        throw err;
      }
    })()
  `
}

export function initAiFetchProxy(): (url: string, init?: RequestInit) => Promise<Response> {
  let reqSeq = 0

  return async (url: string, init?: RequestInit): Promise<Response> => {
    const win = await ensureHiddenWindow()
    const reqId = `r${++reqSeq}_${Date.now()}`

    const headers: Record<string, string> = {}
    const rawHeaders = init?.headers
    if (rawHeaders instanceof Headers) rawHeaders.forEach((v, k) => (headers[k] = v))
    else if (Array.isArray(rawHeaders)) for (const [k, v] of rawHeaders) headers[k] = v
    else if (rawHeaders) Object.assign(headers, rawHeaders)

    const body = init?.body != null ? String(init.body) : null
    const method = init?.method ?? 'GET'
    const signal = init?.signal as AbortSignal | null | undefined

    type Chunk = { type: string; b64?: string; message?: string }
    let pendingPull: ((chunk: Chunk) => void) | null = null
    const chunkQueue: Chunk[] = []

    const chunkListener = (
      _event: Electron.IpcMainEvent,
      id: string,
      chunk: Chunk,
    ) => {
      if (id !== reqId) return
      if (pendingPull) {
        const resolve = pendingPull
        pendingPull = null
        resolve(chunk)
      } else {
        chunkQueue.push(chunk)
      }
    }
    ipcMain.on(CHANNEL_CHUNK, chunkListener)

    const nextChunk = (): Promise<Chunk> => {
      if (chunkQueue.length > 0) return Promise.resolve(chunkQueue.shift()!)
      return new Promise((resolve) => {
        pendingPull = resolve
      })
    }

    let meta: { status: number; headers: Record<string, string> }
    try {
      meta = (await win.webContents.executeJavaScript(
        buildExecuteCode(reqId, url, method, headers, body),
      )) as { status: number; headers: Record<string, string> }
    } catch (err) {
      ipcMain.removeListener(CHANNEL_CHUNK, chunkListener)
      throw err
    }

    const readable = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const chunk = await nextChunk()
        if (chunk.type === 'done') {
          ipcMain.removeListener(CHANNEL_CHUNK, chunkListener)
          controller.close()
        } else if (chunk.type === 'error') {
          ipcMain.removeListener(CHANNEL_CHUNK, chunkListener)
          controller.error(new Error(chunk.message ?? 'AI proxy fetch failed'))
        } else if (chunk.b64) {
          controller.enqueue(Uint8Array.from(Buffer.from(chunk.b64, 'base64')))
        }
      },
    })

    if (signal) {
      if (signal.aborted) {
        ipcMain.removeListener(CHANNEL_CHUNK, chunkListener)
        win.webContents
          .executeJavaScript(
            `void ipcRenderer.invoke(${JSON.stringify(CHANNEL_CANCEL)}, ${JSON.stringify(reqId)})`,
          )
          .catch(() => {})
        readable.cancel().catch(() => {})
      } else {
        signal.addEventListener(
          'abort',
          () => {
            ipcMain.removeListener(CHANNEL_CHUNK, chunkListener)
            win.webContents
              .executeJavaScript(
                `void ipcRenderer.invoke(${JSON.stringify(CHANNEL_CANCEL)}, ${JSON.stringify(reqId)})`,
              )
              .catch(() => {})
          },
          { once: true },
        )
      }
    }

    return new Response(readable, { status: meta.status, headers: meta.headers })
  }
}

export function cleanupAiFetchProxy(): void {
  ipcMain.removeHandler(CHANNEL_CANCEL)
  ipcMain.removeAllListeners(CHANNEL_CHUNK)
  if (hiddenWindow && !hiddenWindow.isDestroyed()) {
    hiddenWindow.destroy()
    hiddenWindow = null
  }
}
