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
  capabilities(): Promise<{ chaofficeAvailable: boolean }>
  setAiSettings(view: unknown): Promise<void>
  setAiCurrentModel(selection: unknown): Promise<void>
  aiDiscoverModels(target: unknown): Promise<unknown>
  aiChaOfficeStatus(withEmail?: boolean): Promise<{ loggedIn: boolean }>
  aiChaOfficeLogin(): Promise<void>
  aiStream(request: unknown): Promise<void>
  aiStreamCancel(requestId: string): Promise<void>
  onAiStream(handler: ChunkListener): () => void
  webSearch(query: string, maxResults?: number): Promise<unknown>
  imageSearch(query: string, maxResults?: number): Promise<unknown>
  fetchImage(url: string): Promise<{ base64: string; mime: string } | null>
  aiGenerateImage(op: {
    prompt: string
    aspectRatio?: string
  }): Promise<{ url?: string; error?: string }>
  /** home-chat media channel (desktop ai:media-generate parity): images come
   *  back materialized as data URLs; keys stay server-side */
  mediaGenerate(req: {
    profileId?: string
    modelId?: string
    prompt: string
    params?: Record<string, unknown>
  }): Promise<{ images?: { dataUrl: string }[]; error?: string }>
  mediaCapabilities(): Promise<{ flags?: Record<string, boolean>; models?: Record<string, string> }>
  mediaVideo(req: {
    prompt: string
    aspectRatio?: string
    durationSeconds?: number
  }): Promise<{ url?: string; bytesB64?: string; mime?: string; model?: string; error?: string }>
  mediaUnderstand(req: {
    kind: 'image' | 'video' | 'auto'
    sources: string[]
    requirements: string
  }): Promise<{ text?: string; model?: string; error?: string }>
  mediaAsr(req: { source: string; language?: string }): Promise<{ text?: string; error?: string }>
  mediaTts(req: {
    text: string
    voice?: string
  }): Promise<{ url?: string; bytesB64?: string; mime?: string; error?: string }>
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

/** settings 读重试：sidecar 冷启动期间（dsh 插件 host 健康轮询窗最长 60s，
 * 未就绪路由 503）编辑器首屏的一次性拉取会失败，而 App 层拿到拒绝后不再
 * 重试 → 模型选择器永久空白（真机实录）。这里对读操作做有限退避；写路径
 * 不重试（避免重复提交）。 */
async function retryGet<T>(url: string, attempts = 12, delayMs = 1000): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await jsonPost<T>(url, undefined, 'GET')
    } catch (err) {
      if (i >= attempts - 1) throw err
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

/** '' in the plain web form; '/chaoffice-app' behind the dsh plugin proxy
 *  (same derivation as kbApiBase). Callers used to pass nothing, which sent
 *  every editor AI request to the origin root → 404 → an empty model picker
 *  while the Home page (own baseURI-based URL) worked. */
function defaultAiBase(pathname = window.location.pathname): string {
  const marker = '/chaoffice-app'
  const idx = pathname.indexOf(marker)
  return idx >= 0 ? pathname.slice(0, idx + marker.length) : ''
}

export function createAiHttpBridge(baseUrl = defaultAiBase()): AiHttpBridge {
  const listeners = new Set<ChunkListener>()
  const controllers = new Map<string, AbortController>()

  const dispatch = (chunk: unknown) => {
    for (const listener of listeners) listener(chunk)
  }

  return {
    async getAiSettings() {
      return retryGet<unknown>(`${baseUrl}/ai/settings`)
    },
    async capabilities() {
      return jsonPost<{ chaofficeAvailable: boolean }>(
        `${baseUrl}/ai/capabilities`,
        undefined,
        'GET',
      )
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
    async aiChaOfficeStatus() {
      return { loggedIn: false }
    },
    async aiChaOfficeLogin() {
      /* chaoffice login is desktop-only; the web form is pure BYOK */
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
          dispatch({
            requestId,
            type: 'error',
            error: err instanceof Error ? err.message : String(err),
          })
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
    async mediaGenerate(req) {
      return jsonPost<{ images?: { dataUrl: string }[]; error?: string }>(
        `${baseUrl}/ai/media/generate`,
        req,
      )
    },
    async mediaCapabilities() {
      return retryGet<{ flags?: Record<string, boolean>; models?: Record<string, string> }>(
        `${baseUrl}/ai/media/capabilities`,
        3,
        800,
      )
    },
    async mediaVideo(req) {
      return jsonPost<
        { url?: string; bytesB64?: string; mime?: string; model?: string; error?: string }
      >(`${baseUrl}/ai/media/video`, req)
    },
    async mediaUnderstand(req) {
      return jsonPost<{ text?: string; model?: string; error?: string }>(
        `${baseUrl}/ai/media/understand`,
        req,
      )
    },
    async mediaAsr(req) {
      return jsonPost<{ text?: string; error?: string }>(`${baseUrl}/ai/media/asr`, req)
    },
    async mediaTts(req) {
      return jsonPost<{ url?: string; bytesB64?: string; mime?: string; error?: string }>(
        `${baseUrl}/ai/media/tts`,
        req,
      )
    },
  }
}
