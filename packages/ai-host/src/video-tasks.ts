import { type AiRuntime } from '@chatoffice/ai-provider'

/**
 * Video task registry — the main-process home of every in-flight video
 * generation (consensus: background survival). The insert-media dialog only
 * starts tasks and reads state; the submit→poll loop lives in
 * ai-provider's runMediaJob and keeps running after the dialog closes. On
 * every state change the registry broadcasts `ai:video-tasks-changed`, so a
 * reopened dialog (or a toast host) picks results up without polling.
 *
 * Tasks live in memory per app process and do not survive restarts. Result
 * videos stream to disk under the app's userData media dir; only file paths,
 * the (temporary) source URL and a small poster data URL are ever handed to
 * the renderer — video bytes and keys never ride the IPC channel. Aborting a
 * task drops the local poll loop; vendors with a documented cancel endpoint
 * get a best-effort remote cancel inside runMediaJob.
 */

export type VideoTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** renderer-facing task record — no keys, no params, no auth headers */
export interface VideoTaskView {
  id: string
  profileId: string
  modelId: string
  /** model display label for the task list */
  label: string
  prompt: string
  status: VideoTaskStatus
  submittedAt: number
  completedAt?: number
  /** vendor-side progress note ("42%") while running */
  note?: string
  error?: string
  /** failed tasks whose stored parameters can be resubmitted as-is (429) */
  retriable?: boolean
  result?: {
    /** written copy under the app's media dir (preview/insert target) */
    filePath?: string
    /** vendor result URL (often a temporary presigned link) */
    url?: string
    /** cover frame as a data URL, when the vendor provided one */
    posterDataUrl?: string
  }
}

export interface VideoSubmitRequest {
  profileId: string
  modelId: string
  label?: string
  prompt: string
  params?: Record<string, unknown>
  imageUrl?: string
}

/** the slice of Node fs the registry needs, injected per app main */
export interface VideoFileSink {
  mkdir(path: string, opts: { recursive: true }): Promise<unknown>
  createWriteStream(path: string): {
    write(chunk: Uint8Array): unknown
    end(cb?: () => void): unknown
    on(event: 'error', cb: (err: Error) => void): unknown
  }
  readFile(path: string): Promise<Uint8Array>
  statSize(path: string): Promise<number>
}

export interface VideoTaskRegistryDeps {
  /** lazy because registerSharedAiIpc builds the runtime itself — apps hand
   * back a getter that is only consulted when a task actually runs */
  runtime: () => AiRuntime
  sink: VideoFileSink
  /** absolute app-data directory that receives finished videos */
  mediaDir: string
  /** push `ai:video-tasks-changed` to the renderer windows */
  notify: (channel: string, payload: unknown) => void
  /** poster image url → {base64, mime}; null when unreachable.
   * defaults to ai-host's SSRF-guarded image downloader when omitted */
  downloadPoster?: (url: string) => Promise<{ base64: string; mime: string } | null>
}

/** concurrent active (queued+running) tasks; further submits are rejected */
const MAX_ACTIVE = 3
/** preview reads ride IPC as base64 — refuse anything absurd */
const PREVIEW_MAX_BYTES = 48 * 1024 * 1024

interface InternalTask {
  view: VideoTaskView
  /** preserved across retries so a 429-failed task can resubmit as-is */
  params: Record<string, unknown>
  imageUrl?: string
}

const videoFileName = (mediaDir: string, id: string): string =>
  `${mediaDir.replace(/[\\/]+$/, '')}/${id}.mp4`

export function createVideoTaskRegistry(deps: VideoTaskRegistryDeps) {
  const tasks = new Map<string, InternalTask>()
  const controllers = new Map<string, AbortController>()
  const downloadPoster = deps.downloadPoster ?? (async () => null)
  const CHANGED = 'ai:video-tasks-changed'

  const notify = (id: string, status: VideoTaskStatus): void => {
    deps.notify(CHANGED, { id, status })
  }

  const activeCount = (): number =>
    [...tasks.values()].filter((t) => t.view.status === 'queued' || t.view.status === 'running').length

  /** stream the result video to disk; the file path is the stable handle for
   * preview/insert. Video bytes are far too big for the IPC channel — that is
   * why this registry exists at all. */
  const downloadToDisk = async (id: string, url: string, downloadHeaders?: Record<string, string>): Promise<string> => {
    const filePath = videoFileName(deps.mediaDir, id)
    await deps.sink.mkdir(deps.mediaDir, { recursive: true })
    const res = await fetch(url, { ...(downloadHeaders ? { headers: downloadHeaders } : {}) })
    if (!res.ok || !res.body) throw new Error(`video download failed: HTTP ${res.status}`)
    const ws = deps.sink.createWriteStream(filePath)
    let wsError: Error | undefined
    ws.on('error', (err) => {
      wsError = err
    })
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (wsError) throw wsError
      ws.write(value)
    }
    await new Promise<void>((resolve, reject) => {
      ws.end(() => resolve())
      ws.on('error', (err) => reject(err))
    })
    if (wsError) throw wsError
    return filePath
  }

  const drive = (task: InternalTask): void => {
    const id = task.view.id
    const controller = new AbortController()
    controllers.set(id, controller)
    const view = task.view
    view.status = 'queued'
    // optional fields can't take undefined under exactOptionalPropertyTypes
    delete view.error
    delete view.note
    delete view.completedAt
    delete view.retriable
    delete view.result
    notify(id, view.status)
    void (async () => {
      try {
        const result = await deps.runtime().runVideoJob({
          profileId: view.profileId,
          modelId: view.modelId,
          prompt: view.prompt,
          params: task.params,
          ...(task.imageUrl ? { imageUrl: task.imageUrl } : {}),
          signal: controller.signal,
          onProgress: (stage, note) => {
            if (stage === 'running') {
              view.status = 'running'
              if (note === undefined) delete view.note
              else view.note = note
              notify(id, 'running')
            }
          },
        })
        const posterMeta = result.meta?.poster
        const poster =
          typeof posterMeta === 'string' && posterMeta
            ? await downloadPoster(posterMeta).catch(() => null)
            : null
        const filePath = await downloadToDisk(id, result.url, result.downloadHeaders)
        view.status = 'succeeded'
        view.completedAt = Date.now()
        view.result = {
          filePath,
          ...(result.url ? { url: result.url } : {}),
          ...(poster ? { posterDataUrl: `data:${poster.mime};base64,${poster.base64}` } : {}),
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (controller.signal.aborted) {
          view.status = 'cancelled'
        } else {
          view.status = 'failed'
          view.error = message
          // 429/rate-limits are transient: keep params and offer one-click retry
          view.retriable = /\b429\b|rate.?limit|too many requests/i.test(message)
        }
        view.completedAt = Date.now()
      } finally {
        controllers.delete(id)
        notify(id, view.status)
      }
    })()
  }

  return {
    /** start a task; rejected with code 'busy' at the concurrency ceiling */
    submit(req: VideoSubmitRequest): { id?: string; error?: string; code?: 'busy' | 'error' } {
      if (!req.profileId || !req.modelId || !req.prompt?.trim()) {
        return { error: 'video submit requires profileId, modelId and prompt', code: 'error' }
      }
      if (activeCount() >= MAX_ACTIVE) {
        return {
          error: `Concurrency limit: at most ${MAX_ACTIVE} video tasks can run at once`,
          code: 'busy',
        }
      }
      const id = `vt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const task: InternalTask = {
        view: {
          id,
          profileId: req.profileId,
          modelId: req.modelId,
          label: req.label || req.modelId,
          prompt: req.prompt.trim(),
          status: 'queued',
          submittedAt: Date.now(),
        },
        params: req.params ?? {},
        ...(req.imageUrl ? { imageUrl: req.imageUrl } : {}),
      }
      tasks.set(id, task)
      drive(task)
      return { id }
    },

    /** abort the local poll loop (remote cancel happens inside runMediaJob) */
    cancel(id: string): void {
      const task = tasks.get(id)
      if (!task || (task.view.status !== 'queued' && task.view.status !== 'running')) return
      controllers.get(id)?.abort()
    },

    /** resubmit a failed/cancelled task from its stored parameters */
    retry(id: string): { error?: string } {
      const task = tasks.get(id)
      if (!task) return { error: `unknown task ${id}` }
      if (task.view.status !== 'failed' && task.view.status !== 'cancelled') {
        return { error: 'only failed or cancelled tasks can be retried' }
      }
      if (activeCount() >= MAX_ACTIVE) {
        return { error: `Concurrency limit: at most ${MAX_ACTIVE} video tasks can run at once` }
      }
      drive(task)
      return {}
    },

    list(): { tasks: VideoTaskView[] } {
      return {
        tasks: [...tasks.values()]
          .map((t) => t.view)
          .sort((a, b) => b.submittedAt - a.submittedAt),
      }
    },

    /** one video's bytes as a data URL for the <video> preview (capped) */
    async preview(id: string): Promise<{ dataUrl?: string; url?: string; error?: string }> {
      const task = tasks.get(id)
      if (!task) return { error: `unknown task ${id}` }
      if (task.view.status !== 'succeeded' || !task.view.result) {
        return { error: 'task has no result yet' }
      }
      const { filePath, url } = task.view.result
      if (filePath) {
        try {
          const size = await deps.sink.statSize(filePath)
          if (size > PREVIEW_MAX_BYTES) {
            return { ...(url ? { url } : {}), error: 'video too large for inline preview' }
          }
          const bytes = await deps.sink.readFile(filePath)
          // Buffer exists in every Electron main; ai-host already relies on it
          const b64 = Buffer.from(bytes).toString('base64')
          return { dataUrl: `data:video/mp4;base64,${b64}`, ...(url ? { url } : {}) }
        } catch (err) {
          return { ...(url ? { url } : {}), error: err instanceof Error ? err.message : String(err) }
        }
      }
      return { ...(url ? { url } : {}), error: 'no local copy of the video' }
    },
  }
}

export type VideoTaskRegistry = ReturnType<typeof createVideoTaskRegistry>
