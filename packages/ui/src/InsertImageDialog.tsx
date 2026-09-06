import { useEffect, useRef, useState } from 'react'

import { insertImageStrings } from './insert-image-strings'
import './insert-image.css'

export interface WebImageItem {
  thumbnail: string
  full: string
  width: number
  height: number
  attribution?: string
  source?: string
}

/** one tier of the main-side search fallback chain, for the diagnostics line */
export interface SearchAttempt {
  backend: string
  status: 'skipped' | 'ok' | 'error'
  detail?: string
  count?: number
}

/** a dynamic parameter input declared main-side (packages/ai-provider media-params) */
export interface MediaParamField {
  id: string
  label: string
  labelZh?: string
  type: 'select' | 'text' | 'number'
  options?: Array<string | number>
  min?: number
  max?: number
  step?: number
  default: string | number
  required?: boolean
}

export interface MediaModelOption {
  kind: 'image' | 'video'
  profileId: string
  modelId: string
  label: string
  vendorId: string
  spec: { fields: MediaParamField[] }
}

/** renderer view of one main-process video task (ai-host video-tasks) */
export interface VideoTaskView {
  id: string
  profileId: string
  modelId: string
  label: string
  prompt: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  submittedAt: number
  completedAt?: number
  note?: string
  error?: string
  retriable?: boolean
  result?: {
    filePath?: string
    url?: string
    posterDataUrl?: string
  }
}

/** where the produced video lives — hosts branch on it when inserting */
export interface VideoInsertRef {
  filePath?: string
  url?: string
  posterDataUrl?: string
}

export interface InsertMeta {
  attribution?: string
  /** image when absent; hosts use kind to route the video pipeline */
  kind?: 'image' | 'video'
  video?: VideoInsertRef
}

/** App-injected transport: each editor wires these to its own IPC channels. */
export interface InsertImageBridge {
  /** page: 1-based result page for the "next batch" append (omitted/1 = fresh search) */
  searchWeb(
    query: string,
    page?: number,
  ): Promise<{ images: WebImageItem[]; error?: string; attempts?: SearchAttempt[] }>
  searchStock(
    source: 'pexels' | 'pixabay',
    query: string,
    page?: number,
  ): Promise<{ images: WebImageItem[]; error?: string; code?: string }>
  fetchImage(url: string): Promise<{ mediaType: string; base64: string } | null>
  getStockKeys(): Promise<{ pexels: string; pixabay: string }>
  setStockKeys(keys: { pexels?: string; pixabay?: string }): Promise<void>
  /** enabled image/video-generation models with their param specs (model picker) */
  listMediaModels?(): Promise<{ models: MediaModelOption[]; error?: string }>
  /** app's image-generation channel; results come back as data URLs */
  generate(req: {
    profileId?: string
    modelId?: string
    prompt: string
    params?: Record<string, unknown>
  }): Promise<{
    images?: { dataUrl: string }[]
    error?: string
  }>
  /** video task channels (ai-host video-tasks); absent = video generation off */
  videoSubmit?(req: {
    profileId: string
    modelId: string
    label?: string
    prompt: string
    params?: Record<string, unknown>
  }): Promise<{ id?: string; error?: string; code?: string }>
  videoTasks?(): Promise<{ tasks: VideoTaskView[]; error?: string }>
  videoCancel?(id: string): Promise<void>
  videoRetry?(id: string): Promise<{ error?: string }>
  videoPreview?(id: string): Promise<{ dataUrl?: string; url?: string; error?: string }>
  /** push notification for task state changes (main-process broadcast) */
  onVideoTasksChanged?(cb: (payload: { id: string; status: string }) => void): () => void
  /** model settings deep-link (opens ModelSettingsPage / AI settings) */
  openModelSettings?: () => void
}

const MAX_BYTES = 20 * 1024 * 1024
const KEY_APPLY_URLS: Record<'pexels' | 'pixabay', string> = {
  pexels: 'https://www.pexels.com/api/',
  pixabay: 'https://pixabay.com/api/docs/',
}

/** session-level model memory: survives closing the dialog, dies with the app */
let lastMediaSelection: { profileId: string; modelId: string } | null = null

/**
 * 统一插入媒体对话框（三 tab：本地 / 网络图片 / AI 生成）。字节以 data: URL
 * 交给 onInsert，由各编辑器走自己的插入管线（docx Protected 块 / xlsx
 * journal 图片 / pptx addImageBytes）。图库密钥各家独立模态设置；AI 生成
 * 按模型清单选模型并按 spec 动态渲染参数。视频模型提交为后台任务（主进程
 * 存活），完成后在任务列表预览并按宿主能力插入。
 */
export function InsertImageDialog({
  bridge,
  lang,
  hostKind,
  onInsert,
  onClose,
}: {
  readonly bridge: InsertImageBridge
  readonly lang?: string
  /** which editor hosts the dialog — drives the video insertion capability hints */
  readonly hostKind?: 'docs' | 'sheets' | 'slides'
  readonly onInsert: (dataUrl: string, meta?: InsertMeta) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const t = insertImageStrings(lang)
  const isZh = t.title === '插入媒体'
  const [tab, setTab] = useState<'local' | 'web' | 'ai'>('local')

  // ── local ──
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [localError, setLocalError] = useState('')
  const pickLocal = (): void => fileRef.current?.click()
  const onFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_BYTES) {
      setLocalError(t.localHint)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '')
      if (dataUrl.startsWith('data:image/')) onInsert(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  // ── web ──
  const [source, setSource] = useState<'web' | 'pexels' | 'pixabay'>('web')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WebImageItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [webError, setWebError] = useState('')
  const [attempts, setAttempts] = useState<SearchAttempt[] | null>(null)
  // "下一批" accumulation: batches fetched so far, next-batch in flight, source drained
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  // the query that produced the displayed results — next batches must use it,
  // not the (possibly re-edited) input value
  const [searched, setSearched] = useState('')
  // one vendor per modal — Pexels and Pixabay never share a panel
  const [keyModal, setKeyModal] = useState<'pexels' | 'pixabay' | null>(null)
  const [KeyValue, setKeyValue] = useState('')
  const [keysSaved, setKeysSaved] = useState(false)
  const [keyTesting, setKeyTesting] = useState(false)
  const [keyTestResult, setKeyTestResult] = useState<'ok' | 'fail' | null>(null)
  const [selected, setSelected] = useState<WebImageItem | null>(null)
  const [inserting, setInserting] = useState(false)
  // shared request token: any newer search/next-batch/source-switch invalidates in-flight ones
  const seqRef = useRef(0)

  const runSearch = async (): Promise<void> => {
    const q = query.trim()
    if (!q || searching) return
    const seq = ++seqRef.current
    setSearching(true)
    setWebError('')
    setAttempts(null)
    setSelected(null)
    setPage(1)
    setExhausted(false)
    setLoadingMore(false)
    setSearched(q)
    try {
      const r =
        source === 'web' ? await bridge.searchWeb(q) : await bridge.searchStock(source, q)
      if (seq !== seqRef.current) return
      setResults(r.images ?? [])
      setAttempts('attempts' in r ? (r.attempts ?? null) : null)
      if (r.error) setWebError(r.error)
    } catch (err) {
      if (seq !== seqRef.current) return
      setResults([])
      setWebError(String(err))
    } finally {
      if (seq === seqRef.current) setSearching(false)
    }
  }
  /** append the next batch below the current gallery (button + scroll-to-bottom) */
  const loadMore = async (): Promise<void> => {
    const q = searched
    if (!q || searching || loadingMore || exhausted || !results || results.length === 0) return
    const seq = ++seqRef.current
    const nextPage = page + 1
    setLoadingMore(true)
    setWebError('')
    try {
      const r =
        source === 'web'
          ? await bridge.searchWeb(q, nextPage)
          : await bridge.searchStock(source, q, nextPage)
      if (seq !== seqRef.current) return
      const seen = new Set(results.map((it) => it.full || it.thumbnail))
      const added = (r.images ?? []).filter((it) => !seen.has(it.full || it.thumbnail))
      if (r.error) setWebError(r.error) // transient failure: gallery stays, retry allowed
      else if (added.length === 0) setExhausted(true) // drained (dupes count as drained)
      else {
        setResults([...results, ...added])
        setPage(nextPage)
      }
    } catch (err) {
      if (seq !== seqRef.current) return
      setWebError(String(err))
    } finally {
      if (seq === seqRef.current) setLoadingMore(false)
    }
  }
  /** scroll-to-bottom auto-load: one batch per arrival, no auto-continue (护栏) */
  const onGridScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 240) return
    void loadMore()
  }
  const openKeyModal = async (which: 'pexels' | 'pixabay'): Promise<void> => {
    setKeyModal(which)
    setKeysSaved(false)
    setKeyTesting(false)
    setKeyTestResult(null)
    try {
      const keys = await bridge.getStockKeys()
      setKeyValue(which === 'pexels' ? (keys.pexels ?? '') : (keys.pixabay ?? ''))
    } catch {
      setKeyValue('') // degraded: leave blank
    }
  }
  /** switching to a stock source only nags when its key is unconfigured */
  const guideKeyModal = (which: 'pexels' | 'pixabay'): void => {
    void bridge
      .getStockKeys()
      .then((keys) => {
        const v = which === 'pexels' ? keys.pexels : keys.pixabay
        if (!v) void openKeyModal(which)
      })
      .catch(() => {})
  }
  const saveKeys = async (): Promise<void> => {
    await bridge.setStockKeys(keyModal === 'pexels' ? { pexels: KeyValue } : { pixabay: KeyValue })
    setKeysSaved(true)
  }
  const testKey = async (): Promise<void> => {
    if (keyTesting || !keyModal) return
    setKeyTesting(true)
    setKeyTestResult(null)
    try {
      await bridge.setStockKeys(
        keyModal === 'pexels' ? { pexels: KeyValue } : { pixabay: KeyValue },
      )
      const r = await bridge.searchStock(keyModal, 'nature')
      setKeyTestResult(!r.error && (r.images?.length ?? 0) > 0 ? 'ok' : 'fail')
    } catch {
      setKeyTestResult('fail')
    } finally {
      setKeyTesting(false)
    }
  }
  const insertWebImage = async (): Promise<void> => {
    if (!selected || inserting) return
    setInserting(true)
    try {
      // full-size origins often refuse programmatic downloads; the hotlinkable
      // thumbnail is the fallback so a blocked origin degrades to lower
      // resolution instead of an error
      const media =
        (await bridge.fetchImage(selected.full)) ??
        (selected.thumbnail && selected.thumbnail !== selected.full
          ? await bridge.fetchImage(selected.thumbnail)
          : null)
      if (!media) {
        setWebError(t.loadFail)
        return
      }
      onInsert(`data:${media.mediaType};base64,${media.base64}`, {
        ...(selected.attribution ? { attribution: selected.attribution } : {}),
      })
    } finally {
      setInserting(false)
    }
  }

  // ── ai ──
  const [prompt, setPrompt] = useState('')
  const [mediaModels, setMediaModels] = useState<MediaModelOption[] | null>(null)
  const [modelsError, setModelsError] = useState('')
  const [modelSel, setModelSel] = useState<{ profileId: string; modelId: string } | null>(null)
  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<{ dataUrl: string }[]>([])
  const [aiError, setAiError] = useState('')
  // video tasks (video models only): submitted main-side, survive dialog close
  const [videoTasks, setVideoTasks] = useState<VideoTaskView[]>([])
  const [videoBusy, setVideoBusy] = useState(false)
  const [videoPreviews, setVideoPreviews] = useState<Record<string, string>>({})
  const [elapsedTick, setElapsedTick] = useState(0)

  const selectedModel = mediaModels?.find(
    (m) => modelSel && m.profileId === modelSel.profileId && m.modelId === modelSel.modelId,
  )
  const selectedIsVideo = selectedModel?.kind === 'video'
  const pickModel = (value: string): void => {
    if (!mediaModels) return
    if (value === '__manage__') {
      bridge.openModelSettings?.()
      return
    }
    const [profileId = '', modelId = ''] = value.split('::')
    const next = mediaModels.find((m) => m.profileId === profileId && m.modelId === modelId)
    if (!next) return
    setModelSel({ profileId, modelId })
    lastMediaSelection = { profileId, modelId }
    // seed the dynamic inputs with each field's default
    const seeded: Record<string, string> = {}
    for (const f of next.spec.fields) seeded[f.id] = String(f.default)
    setParamValues(seeded)
  }
  const ensureModels = async (): Promise<void> => {
    if (mediaModels || !bridge.listMediaModels) return
    try {
      const r = await bridge.listMediaModels()
      setMediaModels(r.models ?? [])
      setModelsError(r.error ?? '')
      const remembered =
        r.models?.find(
          (m) =>
            lastMediaSelection &&
            m.profileId === lastMediaSelection.profileId &&
            m.modelId === lastMediaSelection.modelId,
        ) ?? r.models?.[0]
      if (remembered) {
        setModelSel({ profileId: remembered.profileId, modelId: remembered.modelId })
        const seeded: Record<string, string> = {}
        for (const f of remembered.spec.fields) seeded[f.id] = String(f.default)
        setParamValues(seeded)
      }
    } catch (err) {
      setModelsError(String(err))
    }
  }
  const openAiTab = (): void => {
    setTab('ai')
    void ensureModels()
  }
  const refreshVideoTasks = async (): Promise<void> => {
    if (!bridge.videoTasks) return
    try {
      const r = await bridge.videoTasks()
      setVideoTasks(r.tasks ?? [])
    } catch {
      /* the task list is auxiliary — never block the dialog on it */
    }
  }
  // task list refreshes on main-process broadcasts and when the tab opens
  useEffect(() => {
    if (tab !== 'ai' || !bridge.videoTasks) return
    void refreshVideoTasks()
    const off = bridge.onVideoTasksChanged?.(() => void refreshVideoTasks())
    return () => off?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])
  // live "elapsed" for active tasks
  const hasActiveTask = videoTasks.some((t) => t.status === 'queued' || t.status === 'running')
  useEffect(() => {
    if (!hasActiveTask) return
    const timer = setInterval(() => setElapsedTick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [hasActiveTask])
  // lazy-load the <video> preview once a task succeeds
  useEffect(() => {
    if (!bridge.videoPreview) return
    for (const t of videoTasks) {
      if (t.status === 'succeeded' && t.result && !videoPreviews[t.id]) {
        void bridge
          .videoPreview(t.id)
          .then((r) => {
            if (r.dataUrl) setVideoPreviews((prev) => ({ ...prev, [t.id]: r.dataUrl! }))
          })
          .catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoTasks])
  const submitVideo = async (): Promise<void> => {
    const p = prompt.trim()
    if (!p || videoBusy || !bridge.videoSubmit || !modelSel) return
    setVideoBusy(true)
    setAiError('')
    try {
      const r = await bridge.videoSubmit({
        profileId: modelSel.profileId,
        modelId: modelSel.modelId,
        ...(selectedModel ? { label: selectedModel.label } : {}),
        prompt: p,
        ...(Object.keys(paramValues).length ? { params: paramValues } : {}),
      })
      if (r.error) setAiError(r.code === 'busy' ? t.videoBusyLimit : r.error)
      else void refreshVideoTasks()
    } catch (err) {
      setAiError(String(err))
    } finally {
      setVideoBusy(false)
    }
  }
  const runGenerate = async (): Promise<void> => {
    const p = prompt.trim()
    if (!p || generating) return
    if (selectedIsVideo) {
      await submitVideo()
      return
    }
    setGenerating(true)
    setAiError('')
    try {
      const r = await bridge.generate({
        ...(modelSel ?? {}),
        prompt: p,
        ...(Object.keys(paramValues).length ? { params: paramValues } : {}),
      })
      if (r.images && r.images.length > 0) {
        setGenerated(r.images)
      } else {
        setAiError(r.error ?? t.aiErrorTitle)
      }
    } catch (err) {
      setAiError(String(err))
    } finally {
      setGenerating(false)
    }
  }
  const cancelVideoTask = async (id: string): Promise<void> => {
    await bridge.videoCancel?.(id).catch(() => {})
    void refreshVideoTasks()
  }
  const retryVideoTask = async (id: string): Promise<void> => {
    const r = await bridge.videoRetry?.(id).catch(() => ({ error: 'retry unavailable' }))
    if (r?.error) setAiError(r.error)
    void refreshVideoTasks()
  }
  const insertVideo = (task: VideoTaskView): void => {
    if (hostKind === 'sheets') {
      setAiError(t.videoSheetsInsertRefused)
      return
    }
    if (!task.result) return
    // first arg carries the video bytes (preview dataUrl) so slides can embed
    // them directly; docs ignores it and takes the poster from meta.video
    onInsert(videoPreviews[task.id] ?? task.result.posterDataUrl ?? '', {
      kind: 'video',
      video: task.result,
    })
  }
  const formatElapsed = (from: number, to?: number): string => {
    void elapsedTick
    const secs = Math.max(0, Math.floor(((to ?? Date.now()) - from) / 1000))
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }
  const videoStatusText = (status: VideoTaskView['status']): string =>
    status === 'queued'
      ? t.videoStatusQueued
      : status === 'running'
        ? t.videoStatusRunning
        : status === 'succeeded'
          ? t.videoStatusSucceeded
          : status === 'failed'
            ? t.videoStatusFailed
            : t.videoStatusCancelled

  const paramLabel = (f: MediaParamField): string =>
    isZh ? (f.labelZh ?? f.label) : f.label

  const diagText = (a: SearchAttempt): string => {
    const name = a.backend.charAt(0).toUpperCase() + a.backend.slice(1)
    if (a.status === 'ok') return `${name} ${t.diagOk} ${a.count ?? 0}`
    if (a.status === 'error') return `${name} ${t.diagError}`
    return `${name} ${t.diagSkipped}`
  }

  return (
    <div className="insimg-backdrop" onClick={onClose}>
      <div
        className="insimg-dialog"
        role="dialog"
        aria-label={t.title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="insimg-header">
          <span className="insimg-title">{t.title}</span>
          <nav className="insimg-tabs">
            {(
              [
                ['local', t.tabLocal],
                ['web', t.tabWeb],
                ['ai', t.tabAI],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className={`insimg-tab ${tab === id ? 'active' : ''}`}
                onClick={id === 'ai' ? openAiTab : () => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <button className="insimg-close" aria-label={t.close} onClick={onClose}>
            ✕
          </button>
        </header>

        {tab === 'local' && (
          <section className="insimg-body insimg-local">
            <button className="insimg-primary" onClick={pickLocal}>
              {t.pickLocal}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
              style={{ display: 'none' }}
              onChange={onFile}
            />
            <p className="insimg-hint">{localError || t.localHint}</p>
          </section>
        )}

        {tab === 'web' && (
          <section className="insimg-body">
            <div className="insimg-toolbar">
              <div className="insimg-chips">
                {(
                  [
                    ['web', t.sourceWeb],
                    ['pexels', t.sourcePexels],
                    ['pixabay', t.sourcePixabay],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    className={`insimg-chip ${source === id ? 'active' : ''}`}
                    onClick={() => {
                      setSource(id)
                      ++seqRef.current // invalidate in-flight search/next-batch, full reset
                      setResults(null)
                      setWebError('')
                      setAttempts(null)
                      setPage(1)
                      setExhausted(false)
                      setLoadingMore(false)
                      setSearching(false)
                      setSearched('')
                      // keyless stock source: guide into its own key modal when unconfigured
                      if (id !== 'web') guideKeyModal(id)
                    }}
                  >
                    {label}
                  </button>
                ))}
                {source !== 'web' && (
                  <button
                    className="insimg-gear"
                    title={
                      source === 'pexels' ? t.keysTitlePexels : t.keysTitlePixabay
                    }
                    onClick={() => void openKeyModal(source as 'pexels' | 'pixabay')}
                  >
                    ⚙
                  </button>
                )}
              </div>
              <div className="insimg-searchrow">
                <input
                  className="insimg-search"
                  placeholder={t.searchPlaceholder}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runSearch()
                  }}
                />
                <button
                  className="insimg-primary"
                  disabled={searching}
                  onClick={() => void runSearch()}
                >
                  {t.search}
                </button>
              </div>
            </div>
            <div className="insimg-grid-wrap" onScroll={onGridScroll}>
              {results === null ? (
                <p className="insimg-hint">{webError || t.emptyQuery}</p>
              ) : results.length === 0 ? (
                <div className="insimg-hint">
                  <p>{webError || t.noResults}</p>
                  {attempts && attempts.length > 0 && (
                    <p className="insimg-diag">
                      {t.diagTitle} {attempts.map(diagText).join(' · ')}
                    </p>
                  )}
                </div>
              ) : (
                <div className="insimg-grid-body">
                  <div className="insimg-grid">
                    {results.map((item, i) => (
                      <button
                        key={`${item.full}-${i}`}
                        className={`insimg-cell ${selected?.full === item.full ? 'selected' : ''}`}
                        onClick={() => {
                          setSelected(item)
                          setWebError('') // a stale insert failure must not shadow the new pick
                        }}
                        title={item.attribution ?? ''}
                      >
                        <img src={item.thumbnail || item.full} alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                  <div className="insimg-more">
                    {exhausted ? (
                      <span className="insimg-nomore">{t.noMoreImages}</span>
                    ) : (
                      <button
                        className="insimg-morebtn"
                        disabled={loadingMore}
                        onClick={() => void loadMore()}
                      >
                        {loadingMore ? t.loadingMore : t.loadMore}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <footer className="insimg-footer">
              <span className="insimg-hint">{selected?.attribution ?? webError ?? ''}</span>
              <button
                className="insimg-primary"
                disabled={!selected || inserting}
                onClick={() => void insertWebImage()}
              >
                {inserting ? '…' : t.insert}
              </button>
            </footer>
          </section>
        )}

        {tab === 'ai' && (
          <section className="insimg-body">
            {bridge.listMediaModels && (
              <label className="insimg-modelrow">
                <span>{t.aiModelLabel}</span>
                <select
                  className="insimg-select"
                  value={modelSel ? `${modelSel.profileId}::${modelSel.modelId}` : ''}
                  onChange={(e) => pickModel(e.target.value)}
                >
                  <option value="">{modelsError || t.aiNoModels}</option>
                  {mediaModels && mediaModels.some((m) => m.kind !== 'video') && (
                    <optgroup label={t.aiModelGroup}>
                      {mediaModels
                        .filter((m) => m.kind !== 'video')
                        .map((m) => (
                          <option key={`${m.profileId}::${m.modelId}`} value={`${m.profileId}::${m.modelId}`}>
                            {m.label}
                          </option>
                        ))}
                    </optgroup>
                  )}
                  {mediaModels && mediaModels.some((m) => m.kind === 'video') && (
                    <optgroup label={t.aiModelGroupVideo}>
                      {mediaModels
                        .filter((m) => m.kind === 'video')
                        .map((m) => (
                          <option key={`${m.profileId}::${m.modelId}`} value={`${m.profileId}::${m.modelId}`}>
                            {m.label}
                          </option>
                        ))}
                    </optgroup>
                  )}
                  {bridge.openModelSettings && (
                    <option value="__manage__">{t.aiModelManage}</option>
                  )}
                </select>
              </label>
            )}
            {selectedIsVideo && (
              <div className="insimg-videohint">
                {hostKind === 'slides'
                  ? t.videoHostHintSlides
                  : hostKind === 'docs'
                    ? t.videoHostHintDocs
                    : hostKind === 'sheets'
                      ? t.videoHostHintSheets
                      : t.videoHostHintSlides}
              </div>
            )}
            {selectedModel && selectedModel.spec.fields.length > 0 && (
              <div className="insimg-params">
                {selectedModel.spec.fields.map((f) => (
                  <label key={f.id} className="insimg-paramrow">
                    <span>{paramLabel(f)}</span>
                    {f.type === 'select' ? (
                      <select
                        className="insimg-select"
                        value={paramValues[f.id] ?? String(f.default)}
                        onChange={(e) =>
                          setParamValues({ ...paramValues, [f.id]: e.target.value })
                        }
                      >
                        {(f.options ?? []).map((o) => (
                          <option key={String(o)} value={String(o)}>
                            {String(o)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="insimg-paraminput"
                        type={f.type === 'number' ? 'number' : 'text'}
                        value={paramValues[f.id] ?? String(f.default)}
                        {...(f.type === 'number'
                          ? {
                              min: f.min,
                              max: f.max,
                              step: f.step,
                            }
                          : {})}
                        onChange={(e) =>
                          setParamValues({ ...paramValues, [f.id]: e.target.value })
                        }
                      />
                    )}
                  </label>
                ))}
              </div>
            )}
            <textarea
              className="insimg-prompt"
              placeholder={t.aiPrompt}
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="insimg-toolbar">
              <div className="insimg-chips">
                <button
                  className="insimg-primary"
                  disabled={generating || videoBusy || !prompt.trim()}
                  onClick={() => void runGenerate()}
                >
                  {generating
                    ? t.aiGenerating
                    : videoBusy
                      ? t.videoSubmitting
                      : selectedIsVideo
                        ? t.videoSubmit
                        : t.aiGenerate}
                </button>
              </div>
            </div>
            {aiError && (
              <div className="insimg-aierror">
                <span>{aiError}</span>
                {bridge.openModelSettings && (
                  <button onClick={bridge.openModelSettings}>{t.aiOpenModelSettings}</button>
                )}
              </div>
            )}
            <div className="insimg-grid-wrap">
              {generated.length > 0 ? (
                <div className="insimg-grid">
                  {generated.map((img, i) => (
                    <button
                      key={i}
                      className="insimg-cell"
                      onClick={() => onInsert(img.dataUrl)}
                    >
                      <img src={img.dataUrl} alt="" />
                    </button>
                  ))}
                </div>
              ) : (
                !generating &&
                !aiError && <p className="insimg-hint">{t.aiPrompt}</p>
              )}
            </div>
            {bridge.videoTasks && videoTasks.length > 0 && (
              <div className="insimg-vtasks">
                <p className="insimg-vtasks-title">{t.videoTasksTitle}</p>
                {videoTasks.map((task) => {
                  const preview = videoPreviews[task.id]
                  const active = task.status === 'queued' || task.status === 'running'
                  return (
                    <div key={task.id} className={`insimg-vtask vtask-${task.status}`}>
                      <div className="insimg-vtask-head">
                        <span className="insimg-vtask-prompt" title={task.prompt}>
                          {task.prompt}
                        </span>
                        <span className={`insimg-vtask-status st-${task.status}`}>
                          {videoStatusText(task.status)}
                          {task.status === 'running' && task.note ? ` ${task.note}` : ''}
                          {active ? ` · ${formatElapsed(task.submittedAt)}` : ''}
                        </span>
                      </div>
                      {task.status === 'failed' && task.error && (
                        <p className="insimg-vtask-error" title={task.error}>
                          {task.error}
                        </p>
                      )}
                      {task.status === 'succeeded' && task.result && (
                        <div className="insimg-vtask-result">
                          {preview ? (
                            <video controls preload="metadata" src={preview} />
                          ) : task.result.posterDataUrl ? (
                            <img src={task.result.posterDataUrl} alt="" />
                          ) : (
                            <p className="insimg-hint">{t.videoPreviewLoading}</p>
                          )}
                          <div className="insimg-vtask-actions">
                            <button
                              className="insimg-primary"
                              onClick={() => insertVideo(task)}
                            >
                              {t.insert}
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="insimg-vtask-actions">
                        {active && (
                          <button onClick={() => void cancelVideoTask(task.id)}>{t.videoCancel}</button>
                        )}
                        {(task.status === 'failed' || task.status === 'cancelled') &&
                          bridge.videoRetry && (
                            <button onClick={() => void retryVideoTask(task.id)}>
                              {t.videoRetry}
                            </button>
                          )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {keyModal && (
          <div className="insimg-modal-backdrop" onClick={() => setKeyModal(null)}>
            <div
              className="insimg-modal"
              role="dialog"
              aria-label={keyModal === 'pexels' ? t.keysTitlePexels : t.keysTitlePixabay}
              onClick={(e) => e.stopPropagation()}
            >
              <header className="insimg-modal-header">
                <span>{keyModal === 'pexels' ? t.keysTitlePexels : t.keysTitlePixabay}</span>
                <button
                  className="insimg-close"
                  aria-label={t.close}
                  onClick={() => setKeyModal(null)}
                >
                  ✕
                </button>
              </header>
              <p className="insimg-keys-hint">
                {keyModal === 'pexels' ? t.keysHintPexels : t.keysHintPixabay}
                <a href={KEY_APPLY_URLS[keyModal]} target="_blank" rel="noreferrer">
                  {t.keyApplyUrl}
                </a>
                {t.keysApply}
              </p>
              <label className="insimg-keyrow">
                <span>{keyModal === 'pexels' ? t.pexelsKey : t.pixabayKey}</span>
                <input
                  type="password"
                  placeholder={t.keyPlaceholder}
                  value={KeyValue}
                  onChange={(e) => setKeyValue(e.target.value)}
                />
              </label>
              <div className="insimg-modal-actions">
                <button className="insimg-primary" onClick={() => void testKey()}>
                  {keyTesting ? t.keyTesting : t.keyTest}
                </button>
                <button
                  className="insimg-primary"
                  onClick={() => {
                    void saveKeys()
                  }}
                >
                  {keysSaved ? t.keysSaved : t.keysSave}
                </button>
              </div>
              {keyTestResult && (
                <p className={`insimg-keytest ${keyTestResult}`}>
                  {keyTestResult === 'ok' ? t.keyTestOk : t.keyTestFail}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
