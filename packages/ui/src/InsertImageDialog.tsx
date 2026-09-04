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

/** App-injected transport: each editor wires these to its own IPC channels. */
export interface InsertImageBridge {
  searchWeb(query: string): Promise<{ images: WebImageItem[]; error?: string }>
  searchStock(
    source: 'pexels' | 'pixabay',
    query: string,
  ): Promise<{ images: WebImageItem[]; error?: string; code?: string }>
  fetchImage(url: string): Promise<{ mediaType: string; base64: string } | null>
  getStockKeys(): Promise<{ pexels: string; pixabay: string }>
  setStockKeys(keys: { pexels?: string; pixabay?: string }): Promise<void>
  /** app's image-generation channel; URL or data URL comes back as dataUrl */
  generate(req: { prompt: string; size?: string; n?: number }): Promise<{
    images?: { dataUrl: string }[]
    error?: string
  }>
  /** model settings deep-link (opens ModelSettingsPage / AI settings) */
  openModelSettings?: () => void
}

const SIZES = ['1024*1024', '1664*928', '928*1664'] as const
const COUNTS = [1, 2, 4] as const
const MAX_BYTES = 20 * 1024 * 1024

/**
 * 统一插入图片对话框（三 tab：本地 / 网络图片 / AI 生成）。字节以 data: URL
 * 交给 onInsert，由各编辑器走自己的插入管线（docx Protected 块 / xlsx
 * journal 图片 / pptx addImageBytes）。
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
  const [keysOpen, setKeysOpen] = useState(false)
  const [keys, setKeys] = useState<{ pexels: string; pixabay: string }>({
    pexels: '',
    pixabay: '',
  })
  const [keysSaved, setKeysSaved] = useState(false)
  const [selected, setSelected] = useState<WebImageItem | null>(null)
  const [inserting, setInserting] = useState(false)

  const runSearch = async (): Promise<void> => {
    const q = query.trim()
    if (!q || searching) return
    setSearching(true)
    setWebError('')
    setSelected(null)
    try {
      const r = source === 'web' ? await bridge.searchWeb(q) : await bridge.searchStock(source, q)
      setResults(r.images ?? [])
      if (r.error) setWebError(r.error)
    } catch (err) {
      setResults([])
      setWebError(String(err))
    } finally {
      setSearching(false)
    }
  }
  const openKeys = async (): Promise<void> => {
    setKeysOpen(true)
    setKeysSaved(false)
    try {
      setKeys(await bridge.getStockKeys())
    } catch {
      /* degraded: leave blank */
    }
  }
  const saveKeys = async (): Promise<void> => {
    await bridge.setStockKeys(keys)
    setKeysSaved(true)
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
  const [size, setSize] = useState<string>('1024*1024')
  const [count, setCount] = useState<number>(1)
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<{ dataUrl: string }[]>([])
  const [aiError, setAiError] = useState('')
  const runGenerate = async (): Promise<void> => {
    const p = prompt.trim()
    if (!p || generating) return
    setGenerating(true)
    setAiError('')
    try {
      const r = await bridge.generate({ prompt: p, size, n: count })
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
                onClick={() => setTab(id)}
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
                    }}
                  >
                    {label}
                  </button>
                ))}
                {source !== 'web' && (
                  <button
                    className="insimg-gear"
                    title={t.keysTitle}
                    onClick={() => void openKeys()}
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
            {keysOpen && (
              <div className="insimg-keys">
                <div className="insimg-keys-hint">
                  {t.keysHint}
                  {source === 'pexels' && (
                    <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer">
                      {t.keyApplyUrl}
                    </a>
                  )}
                  {source === 'pixabay' && (
                    <a href="https://pixabay.com/api/docs/" target="_blank" rel="noreferrer">
                      {t.keyApplyUrl}
                    </a>
                  )}
                  {t.keysApply}
                </div>
                <label className="insimg-keyrow">
                  <span>{t.pexelsKey}</span>
                  <input
                    type="password"
                    placeholder={t.keyPlaceholder}
                    value={keys.pexels}
                    onChange={(e) => setKeys({ ...keys, pexels: e.target.value })}
                  />
                </label>
                <label className="insimg-keyrow">
                  <span>{t.pixabayKey}</span>
                  <input
                    type="password"
                    placeholder={t.keyPlaceholder}
                    value={keys.pixabay}
                    onChange={(e) => setKeys({ ...keys, pixabay: e.target.value })}
                  />
                </label>
                <button
                  className="insimg-primary"
                  onClick={() => {
                    void saveKeys()
                  }}
                >
                  {keysSaved ? t.keysSaved : t.keysSave}
                </button>
              </div>
            )}
            <div className="insimg-grid-wrap">
              {results === null ? (
                <p className="insimg-hint">{webError || t.emptyQuery}</p>
              ) : results.length === 0 ? (
                <p className="insimg-hint">{webError || t.noResults}</p>
              ) : (
                <div className="insimg-grid">
                  {results.map((item, i) => (
                    <button
                      key={`${item.full}-${i}`}
                      className={`insimg-cell ${selected?.full === item.full ? 'selected' : ''}`}
                      onClick={() => setSelected(item)}
                      title={item.attribution ?? ''}
                    >
                      <img src={item.thumbnail} alt="" loading="lazy" />
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
            <textarea
              className="insimg-prompt"
              placeholder={t.aiPrompt}
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="insimg-toolbar">
              <div className="insimg-chips">
                {SIZES.map((s) => (
                  <button
                    key={s}
                    className={`insimg-chip ${size === s ? 'active' : ''}`}
                    onClick={() => setSize(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="insimg-chips">
                {COUNTS.map((n) => (
                  <button
                    key={n}
                    className={`insimg-chip ${count === n ? 'active' : ''}`}
                    onClick={() => setCount(n)}
                  >
                    ×{n}
                  </button>
                ))}
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
                      className={`insimg-cell ${false ? 'selected' : ''}`}
                      onClick={() => onInsert(img.dataUrl)}
                    >
                      <img src={img.dataUrl} alt="" />
                    </button>
                  ))}
                </div>
              ) : (
                !generating && !aiError && <p className="insimg-hint">{t.aiPrompt}</p>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
