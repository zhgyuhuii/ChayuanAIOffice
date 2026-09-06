import { useRef, useState } from 'react'

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
  kind: 'image'
  profileId: string
  modelId: string
  label: string
  vendorId: string
  spec: { fields: MediaParamField[] }
}

/** App-injected transport: each editor wires these to its own IPC channels. */
export interface InsertImageBridge {
  searchWeb(
    query: string,
  ): Promise<{ images: WebImageItem[]; error?: string; attempts?: SearchAttempt[] }>
  searchStock(
    source: 'pexels' | 'pixabay',
    query: string,
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
 * 按模型清单选模型并按 spec 动态渲染参数。
 */
export function InsertImageDialog({
  bridge,
  lang,
  onInsert,
  onClose,
}: {
  readonly bridge: InsertImageBridge
  readonly lang?: string
  readonly onInsert: (dataUrl: string, meta?: { attribution?: string }) => void
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
  // one vendor per modal — Pexels and Pixabay never share a panel
  const [keyModal, setKeyModal] = useState<'pexels' | 'pixabay' | null>(null)
  const [KeyValue, setKeyValue] = useState('')
  const [keysSaved, setKeysSaved] = useState(false)
  const [keyTesting, setKeyTesting] = useState(false)
  const [keyTestResult, setKeyTestResult] = useState<'ok' | 'fail' | null>(null)
  const [selected, setSelected] = useState<WebImageItem | null>(null)
  const [inserting, setInserting] = useState(false)

  const runSearch = async (): Promise<void> => {
    const q = query.trim()
    if (!q || searching) return
    setSearching(true)
    setWebError('')
    setAttempts(null)
    setSelected(null)
    try {
      const r =
        source === 'web' ? await bridge.searchWeb(q) : await bridge.searchStock(source, q)
      setResults(r.images ?? [])
      setAttempts('attempts' in r ? (r.attempts ?? null) : null)
      if (r.error) setWebError(r.error)
    } catch (err) {
      setResults([])
      setWebError(String(err))
    } finally {
      setSearching(false)
    }
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
      const media = await bridge.fetchImage(selected.full)
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

  const selectedModel = mediaModels?.find(
    (m) => modelSel && m.profileId === modelSel.profileId && m.modelId === modelSel.modelId,
  )
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
  const runGenerate = async (): Promise<void> => {
    const p = prompt.trim()
    if (!p || generating) return
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
                      setResults(null)
                      setWebError('')
                      setAttempts(null)
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
            <div className="insimg-grid-wrap">
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
                <div className="insimg-grid">
                  {results.map((item, i) => (
                    <button
                      key={`${item.full}-${i}`}
                      className={`insimg-cell ${selected?.full === item.full ? 'selected' : ''}`}
                      onClick={() => setSelected(item)}
                      title={item.attribution ?? ''}
                    >
                      <img src={item.thumbnail || item.full} alt="" loading="lazy" />
                    </button>
                  ))}
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
                  {mediaModels && mediaModels.length > 0 && (
                    <optgroup label={t.aiModelGroup}>
                      {mediaModels.map((m) => (
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
                  disabled={generating || !prompt.trim()}
                  onClick={() => void runGenerate()}
                >
                  {generating ? t.aiGenerating : t.aiGenerate}
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
