/**
 * AI HTTP bridge for the web form: preload-shaped AI methods backed by the
 * BFF's /ai/* endpoints. The editors' transports stay createIpcTransport —
 * aiStream here runs the SSE fetch and forwards chunks into the onAiStream
 * listeners, so not one line of editor code changes between desktop and web.
 *
 * Keys never reach the browser: settings views carry KEEP_KEY sentinels and
 * stream requests carry only the model selection.
 */

type ChunkListener = (chunk: unknown) => void

export interface AiHttpBridge {
  getAiSettings(): Promise<unknown>
  capabilities(): Promise<{ gskAvailable: boolean }>
  setAiSettings(view: unknown): Promise<void>
  setAiCurrentModel(selection: unknown): Promise<void>
  aiDiscoverModels(target: unknown): Promise<unknown>
  aiGskStatus(withEmail?: boolean): Promise<{ loggedIn: boolean }>
  aiGskLogin(): Promise<void>
  aiStream(request: unknown): Promise<void>
  aiStreamCancel(requestId: string): Promise<void>
  onAiStream(handler: ChunkListener): () => void
  webSearch(query: string, maxResults?: number): Promise<unknown>
  imageSearch(query: string, maxResults?: number): Promise<unknown>
  fetchImage(url: string): Promise<{ base64: string; mime: string } | null>
  aiGenerateImage(op: { prompt: string; aspectRatio?: string }): Promise<{ url?: string; error?: string }>
}

async function jsonPost<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as T
}

export function createAiHttpBridge(baseUrl = ''): AiHttpBridge {
  const listeners = new Set<ChunkListener>()
  const controllers = new Map<string, AbortController>()

  const dispatch = (chunk: unknown) => {
    for (const listener of listeners) listener(chunk)
  }

  return {
    async getAiSettings() {
      return jsonPost<unknown>(`${baseUrl}/ai/settings`, undefined, 'GET')
    },
    async capabilities() {
      return jsonPost<{ gskAvailable: boolean }>(`${baseUrl}/ai/capabilities`, undefined, 'GET')
    },
    async setAiSettings(view) {
      await jsonPost(`${baseUrl}/ai/settings`, view, 'PUT')
    },
    async setAiCurrentModel(selection) {
      await jsonPost(`${baseUrl}/ai/set-current-model`, selection)
    },
    async aiDiscoverModels(target) {
      return jsonPost<unknown>(`${baseUrl}/ai/discover-models`, target)
    },
    async aiGskStatus() {
      return { loggedIn: false }
    },
    async aiGskLogin() {
      /* gsk login is desktop-only; the web form is pure BYOK */
    },
    async aiStream(request) {
      const { requestId } = request as { requestId: string }
      const controller = new AbortController()
      controllers.set(requestId, controller)
      try {
        const response = await fetch(`${baseUrl}/ai/stream`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        })
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            const line = frame.split('\n').find((l) => l.startsWith('data: '))
            if (!line) continue
            try {
              dispatch(JSON.parse(line.slice(6)))
            } catch {
              /* skip malformed frames */
            }
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          dispatch({ requestId, type: 'error', error: err instanceof Error ? err.message : String(err) })
        }
      } finally {
        controllers.delete(requestId)
      }
    },
    async aiStreamCancel(requestId) {
      controllers.get(requestId)?.abort()
      await jsonPost(`${baseUrl}/ai/stream-cancel`, { requestId }).catch(() => undefined)
    },
    onAiStream(handler) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
    async webSearch(query, maxResults) {
      return jsonPost<unknown>(`${baseUrl}/ai/web-search`, { query, maxResults })
    },
    async imageSearch(query, maxResults) {
      return jsonPost<unknown>(`${baseUrl}/ai/image-search`, { query, maxResults })
    },
    async fetchImage(url) {
      return jsonPost<{ base64: string; mime: string } | null>(`${baseUrl}/ai/fetch-image`, { url })
    },
    async aiGenerateImage(op) {
      return jsonPost<{ url?: string; error?: string }>(`${baseUrl}/ai/generate-image`, op)
    },
  }
}
