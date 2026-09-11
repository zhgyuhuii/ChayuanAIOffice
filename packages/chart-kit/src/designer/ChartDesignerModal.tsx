import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getLibraryGroups, type LibraryExample, type LibraryGroup } from '../examples/library'
import { runOptionCode } from '../sandbox/runner'
import { stringifyOption } from '../sandbox/serialize'
import { extractTableFromOption, optionFromChartSpec, type OptionTable } from './optionFromSpec'
import { toFlatTable, type FlatTable } from '../spec/data-table'
import { renderOptionSnapshot } from './snapshot'
import { thumbUrl } from './thumbs'
import { EchartsPreview, type EchartsPreviewHandle } from './EchartsPreview'
import { ChartErrorBoundary } from './ChartErrorBoundary'
import type { ChartSpec } from '../spec/chartspec'
import './designer.css'

/**
 * 公共图表设计器(居中大模态,Q11):
 * 左 39 组分组树 + 示例画廊;右侧实时预览 + 数据/代码双编辑(Q10)。
 * 三编辑器(docs/sheets/slides)同一入口;产物经 onInsert 交宿主落库。
 */

export interface ChartDesignerInitial {
  groupId?: string
  exampleId?: string
  /** 双击已有图表重开时带回的代码 */
  code?: string
  title?: string
  /** 标准块回显:数据表直载(无代码,数据页预填) */
  specData?: {
    type: string
    title?: string
    categories: string[]
    series: Array<{ name: string; values: (number | null)[] }>
  }
  /** 扩展块回显:函数安全串(有 code 走代码回显;无 code 时转 option 预览) */
  optionJson?: string
}

export interface ChartDesignerInsert {
  /** 'ooxml' = 标准 8 组走 ChartSpec→宿主 OOXML 链;'echarts' = option+快照(Q3) */
  engine: 'ooxml' | 'echarts'
  groupId: string
  title: string
  /** 沙箱可重放的示例/用户代码(再编辑的事实源) */
  code: string | null
  /** 函数安全序列化的 option(__chartkit_fn__ 标记) */
  optionJson: string
  /** 扩展档 PNG 快照(dataUrl);引擎 ooxml 时无 */
  snapshotPng?: string
  /** engine==='ooxml' 时的标准契约 */
  spec?: ChartSpec
  /** 扁平数据表(数据兼容:sidecar 随存,跨端可加工不锁死) */
  data?: FlatTable | null
}

export interface ChartDesignerModalProps {
  lang?: 'zh-CN' | 'en'
  initial?: ChartDesignerInitial | null
  onClose(): void
  onInsert(payload: ChartDesignerInsert): void
}

/** docs 现有 OOXML 写链(NewChart.kind)支持的类型;其余标准类型 P3 收割后切换 */
const OOXML_READY_GROUPS = new Set(['bar', 'line', 'pie'])

type Lang = 'zh-CN' | 'en'
const tr = (lang: Lang, zh: string, en: string) => (lang === 'en' ? en : zh)

export function ChartDesignerModal({
  lang = 'zh-CN',
  initial,
  onClose,
  onInsert,
}: ChartDesignerModalProps) {
  const groups = useMemo(() => getLibraryGroups(), [])
  const [groupId, setGroupId] = useState(() => initial?.groupId ?? 'line')
  const [exampleId, setExampleId] = useState<string | null>(initial?.exampleId ?? null)
  const [code, setCode] = useState(() => initial?.code ?? '')
  const [option, setOption] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'data' | 'code'>(initial?.code ? 'code' : 'data')
  const [table, setTable] = useState<OptionTable | null>(
    initial?.specData
      ? {
          categories: initial.specData.categories,
          series: initial.specData.series,
        }
      : null,
  )
  const [query, setQuery] = useState('')
  const [inserting, setInserting] = useState(false)
  const previewRef = useRef<EchartsPreviewHandle>(null)
  const codeRef = useRef(code)
  codeRef.current = code

  const group: LibraryGroup | undefined = groups.find((g) => g.id === groupId) ?? groups[0]

  const runCode = useCallback(async (nextCode: string) => {
    setBusy(true)
    setError(null)
    const r = await runOptionCode(nextCode)
    setBusy(false)
    if (r.ok) {
      setOption(r.option)
      setTable(extractTableFromOption(r.option))
      return true
    }
    setError(r.error ?? 'unknown error')
    return false
  }, [])

  // 组/示例切换:装入示例代码并自动试跑(应用户"选完即所见"预期)
  useEffect(() => {
    if (initial?.code || initial?.specData || initial?.optionJson) return // 重开已有图表:数据/代码已带,不覆盖
    const first = group?.examples.find((e) => e.id === exampleId) ?? group?.examples[0]
    if (!first) return
    setExampleId(first.id)
    setCode(first.code)
    void runCode(first.code)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 组切换即换示例
  }, [groupId])

  // 双击回显(initial 带代码):自动试跑让预览立即可见,不用手点运行
  useEffect(() => {
    const code = initial?.code
    if (code) {
      void runCode(code)
      return
    }
    // 无代码但有 optionJson(如 AI/表格来源的图):反序列化直接预览+提表
    const optJson = initial?.optionJson
    if (optJson) {
      void (async () => {
        try {
          const { parseOption } = await import('../sandbox/serialize')
          const opt = parseOption(optJson)
          setOption(opt)
          setTable(extractTableFromOption(opt))
          setError(null)
        } catch (e) {
          setError(String((e as Error).message ?? e).slice(0, 120))
        }
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时执行
  }, [])

  // 数据表格 → 预览 option(标准形状经 ChartSpec 组装,Q5 受限样式)
  const applyTable = (next: OptionTable) => {
    setTable(next)
    const spec: ChartSpec = {
      version: 1,
      type: (OOXML_READY_GROUPS.has(groupId) ? groupId : groupId) as ChartSpec['type'],
      data: { categories: next.categories, series: next.series },
    }
    setOption(optionFromChartSpec(spec))
    setError(null)
  }

  const setCell = (si: number, ci: number, raw: string) => {
    if (!table) return
    const n = Number(raw.replace(/,/g, ''))
    const next: OptionTable = {
      categories: [...table.categories],
      series: table.series.map((s, i) =>
        i === si
          ? {
              ...s,
              values: s.values.map((v, j) =>
                j === ci
                  ? raw.trim() === '' || Number.isFinite(n)
                    ? raw.trim() === ''
                      ? null
                      : n
                    : v
                  : v,
              ),
            }
          : s,
      ),
    }
    applyTable(next)
  }

  const pickExample = (ex: LibraryExample) => {
    setExampleId(ex.id)
    setCode(ex.code)
    setTab('code')
    void runCode(ex.code)
  }

  const insert = async () => {
    if (!group) return
    setInserting(true)
    try {
      const title = group.zh
      if (tab === 'data' && table && OOXML_READY_GROUPS.has(group.id)) {
        const spec: ChartSpec = {
          version: 1,
          type: group.id as ChartSpec['type'],
          data: { categories: table.categories, series: table.series },
          meta: { source: exampleId ? 'example' : 'user', exampleId: exampleId ?? undefined },
        }
        onInsert({
          engine: 'ooxml',
          groupId: group.id,
          title,
          code: codeRef.current || null,
          optionJson: stringifyOption(option),
          spec,
        })
        return
      }
      if (!option) return
      // 优先从右侧活预览直接出图:预览是已渲染完成的真实场景(GL 3D 图
      // 的 claygl 首帧远晚于 zrender finished,离屏重渲的时序不可靠,曾
      // 截到只剩 visualMap 的空海报);活预览不在(理论不可达)才离屏重渲。
      const snapshotPng =
        (await previewRef.current?.snapshot({ pixelRatio: 2, backgroundColor: '#ffffff' })) ??
        (await renderOptionSnapshot(option))
      onInsert({
        engine: 'echarts',
        groupId: group.id,
        title,
        code: codeRef.current || null,
        optionJson: stringifyOption(option),
        snapshotPng,
        data: toFlatTable(option),
      })
    } finally {
      setInserting(false)
    }
  }

  const filtered = useMemo(() => {
    if (!group) return []
    const q = query.trim().toLowerCase()
    if (!q) return group.examples
    return group.examples.filter(
      (e) =>
        e.id.toLowerCase().includes(q) ||
        e.title.toLowerCase().includes(q) ||
        e.titleCN.includes(q),
    )
  }, [group, query])

  const canInsert = Boolean(
    group && ((tab === 'data' && table && OOXML_READY_GROUPS.has(group.id)) || option),
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="ck-designer-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="ck-designer" role="dialog" aria-label={tr(lang, '图表库', 'Chart Gallery')}>
        <header className="ck-designer-header">
          <h2>{tr(lang, '插入图表', 'Insert Chart')}</h2>
          <input
            className="ck-designer-search"
            placeholder={tr(lang, '搜索示例…', 'Search examples…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="ck-designer-close" aria-label="close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="ck-designer-body">
          <nav className="ck-designer-groups">
            {groups.map((g) => (
              <button
                key={g.id}
                className={`ck-designer-group${g.id === groupId ? ' is-active' : ''}`}
                onClick={() => {
                  setGroupId(g.id)
                  setExampleId(null)
                  setTab('data')
                }}
              >
                <span className="ck-designer-group-name">{lang === 'en' ? g.en : g.zh}</span>
                {g.gl && <span className="ck-designer-badge">3D</span>}
                <span className="ck-designer-count">{g.examples.length}</span>
              </button>
            ))}
          </nav>

          <div className="ck-designer-gallery">
            {filtered.map((ex) => (
              <button key={ex.id} className="ck-designer-card" onClick={() => pickExample(ex)}>
                {thumbUrl(ex.id) ? (
                  <img src={thumbUrl(ex.id) ?? ''} alt={ex.title} draggable={false} />
                ) : (
                  <span className="ck-designer-card-glyph" aria-hidden>
                    ▦
                  </span>
                )}
                <span className="ck-designer-card-title" title={`${ex.titleCN} · ${ex.title}`}>
                  {lang === 'en' ? ex.title : ex.titleCN}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="ck-designer-empty">
                {tr(lang, '该组暂无匹配示例', 'No matching examples')}
              </p>
            )}
          </div>

          <section className="ck-designer-main">
            <div className="ck-designer-preview">
              {option ? (
                <ChartErrorBoundary label="图表">
                  <EchartsPreview
                    ref={previewRef}
                    option={option}
                    heightPx={360}
                    className="ck-designer-canvas"
                  />
                </ChartErrorBoundary>
              ) : (
                <div className="ck-designer-canvas ck-designer-canvas-empty">
                  {busy
                    ? tr(lang, '渲染中…', 'Rendering…')
                    : tr(
                        lang,
                        '选择左侧示例,或粘贴 option 代码',
                        'Pick an example, or paste option code',
                      )}
                </div>
              )}
              {error && <p className="ck-designer-error">{error}</p>}
            </div>

            <div className="ck-designer-tabs">
              <button className={tab === 'data' ? 'is-active' : ''} onClick={() => setTab('data')}>
                {tr(lang, '数据', 'Data')}
              </button>
              <button className={tab === 'code' ? 'is-active' : ''} onClick={() => setTab('code')}>
                {tr(lang, '代码', 'Code')}
              </button>
              <div className="ck-designer-tab-actions">
                {tab === 'code' && (
                  <button disabled={busy || inserting} onClick={() => void runCode(code)}>
                    {busy ? tr(lang, '运行中…', 'Running…') : tr(lang, '运行', 'Run')}
                  </button>
                )}
                {tab === 'data' && table && (
                  <button
                    onClick={() =>
                      applyTable({
                        categories: [...table.categories, tr(lang, '新增', 'New')],
                        series: table.series.map((s) => ({ ...s, values: [...s.values, null] })),
                      })
                    }
                  >
                    {tr(lang, '+ 行', '+ Row')}
                  </button>
                )}
              </div>
            </div>

            {tab === 'data' ? (
              table ? (
                <div className="ck-designer-table-wrap">
                  <table className="ck-designer-table">
                    <thead>
                      <tr>
                        <th>{tr(lang, '类别', 'Category')}</th>
                        {table.series.map((s, i) => (
                          <th key={i}>
                            <input
                              value={s.name}
                              onChange={(e) =>
                                applyTable({
                                  categories: table.categories,
                                  series: table.series.map((x, j) =>
                                    j === i ? { ...x, name: e.target.value } : x,
                                  ),
                                })
                              }
                            />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.categories.map((c, ci) => (
                        <tr key={ci}>
                          <th>
                            <input
                              value={c}
                              onChange={(e) =>
                                applyTable({
                                  categories: table.categories.map((x, j) =>
                                    j === ci ? e.target.value : x,
                                  ),
                                  series: table.series,
                                })
                              }
                            />
                          </th>
                          {table.series.map((s, si) => (
                            <td key={si}>
                              <input
                                value={s.values[ci] ?? ''}
                                onChange={(e) => setCell(si, ci, e.target.value)}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="ck-designer-hint">
                  {tr(
                    lang,
                    '该示例使用了复杂数据形状(层级/关系/多轴等),请切换到「代码」页编辑。',
                    'This example uses a complex data shape (hierarchy/graph/multi-axis); edit it in the Code tab.',
                  )}
                </p>
              )
            ) : (
              <textarea
                className="ck-designer-code"
                spellCheck={false}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={`option = { ... }  // ${tr(lang, '支持辅助函数', 'helper functions allowed')}`}
              />
            )}
          </section>
        </div>

        <footer className="ck-designer-footer">
          <span className="ck-designer-note">
            {OOXML_READY_GROUPS.has(group?.id ?? '')
              ? tr(lang, '标准类型:Word/WPS 打开可编辑数据', 'Standard type: editable in Word/WPS')
              : tr(
                  lang,
                  '扩展类型:以图片+源码形式嵌入,Word/WPS 中显示为静态图',
                  'Extended type: embedded as image + source; static in Word/WPS',
                )}
          </span>
          <button onClick={onClose}>{tr(lang, '取消', 'Cancel')}</button>
          <button
            className="is-primary"
            disabled={!canInsert || busy || inserting}
            onClick={() => void insert()}
          >
            {inserting ? tr(lang, '生成快照…', 'Snapshotting…') : tr(lang, '插入', 'Insert')}
          </button>
        </footer>
      </div>
    </div>
  )
}
