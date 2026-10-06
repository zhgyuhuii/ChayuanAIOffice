/** 跨端助手库浏览器（整体要求: 每种文档类型 ≥100 个助手）。
 *  在各端 AI 面板的「助手」tab 内渲染：搜索 + 领域折叠分组 + 助手条目,
 *  点击条目把 prompt 送入当前面板的对话(由宿主传入 onRun)。 */
import { useMemo, useState } from 'react'
import {
  ASSISTANT_LIBRARY,
  libraryTotal,
  type AssistantApp,
} from './types'
import {
  SHEETS_ASSISTANT_DOMAINS,
  SHEETS_ASSISTANT_TOTAL,
  SLIDES_ASSISTANT_DOMAINS,
  SLIDES_ASSISTANT_TOTAL,
  PDF_ASSISTANT_DOMAINS,
  PDF_ASSISTANT_TOTAL,
  MARKDOWN_ASSISTANT_DOMAINS,
  MARKDOWN_ASSISTANT_TOTAL,
  HTML_ASSISTANT_DOMAINS,
  HTML_ASSISTANT_TOTAL,
} from './data/index'

export const ASSISTANT_DOMAINS_BY_APP: Record<AssistantApp, { total: number; domains: typeof SHEETS_ASSISTANT_DOMAINS }> = {
  sheets: { total: SHEETS_ASSISTANT_TOTAL, domains: SHEETS_ASSISTANT_DOMAINS },
  slides: { total: SLIDES_ASSISTANT_TOTAL, domains: SLIDES_ASSISTANT_DOMAINS },
  pdf: { total: PDF_ASSISTANT_TOTAL, domains: PDF_ASSISTANT_DOMAINS },
  markdown: { total: MARKDOWN_ASSISTANT_TOTAL, domains: MARKDOWN_ASSISTANT_DOMAINS },
  html: { total: HTML_ASSISTANT_TOTAL, domains: HTML_ASSISTANT_DOMAINS },
}

/** 注册表回填: types.ts 里的 ASSISTANT_LIBRARY 默认为空,这里用各端数据填充 */
ASSISTANT_LIBRARY.sheets = SHEETS_ASSISTANT_DOMAINS
ASSISTANT_LIBRARY.slides = SLIDES_ASSISTANT_DOMAINS
ASSISTANT_LIBRARY.pdf = PDF_ASSISTANT_DOMAINS
ASSISTANT_LIBRARY.markdown = MARKDOWN_ASSISTANT_DOMAINS
ASSISTANT_LIBRARY.html = HTML_ASSISTANT_DOMAINS

export function assistantLibraryTotal(app: AssistantApp): number {
  return ASSISTANT_DOMAINS_BY_APP[app]?.total ?? libraryTotal(app)
}

export function AssistantLibraryBrowser({
  app,
  onRun,
}: {
  app: AssistantApp
  onRun: (prompt: string) => void
}) {
  const [query, setQuery] = useState('')
  const [openDomains, setOpenDomains] = useState<Record<string, boolean>>({})
  const domains = ASSISTANT_LIBRARY[app]
  const q = query.trim().toLowerCase()

  const filtered = useMemo(
    () =>
      domains
        .map((d) => ({
          ...d,
          items: q
            ? d.items.filter(
                (it) =>
                  it.label.toLowerCase().includes(q) ||
                  it.description.toLowerCase().includes(q) ||
                  d.label.toLowerCase().includes(q),
              )
          : d.items,
        }))
        .filter((d) => d.items.length > 0),
    [domains, q],
  )

  return (
    <div className="assistant-library" data-app={app}>
      <div className="assistant-library-head">
        <input
          className="assistant-library-search"
          type="search"
          placeholder="搜索助手…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="assistant-library-count">
          {filtered.reduce((n, d) => n + d.items.length, 0)}/{libraryTotal(app)}
        </span>
      </div>
      <div className="assistant-library-list">
        {filtered.map((d) => {
          const open = q !== '' || openDomains[d.key] !== false
          return (
            <div key={d.key} className="assistant-library-domain">
              <button
                type="button"
                className="assistant-library-domain-head"
                onClick={() => setOpenDomains((prev) => ({ ...prev, [d.key]: openDomains[d.key] === false }))}
              >
                <span className="assistant-library-domain-icon">{d.icon}</span>
                <span className="assistant-library-domain-label">{d.label}</span>
                <span className="assistant-library-domain-count">{d.items.length}</span>
              </button>
              {open && (
                <div className="assistant-library-items">
                  {d.items.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      className="assistant-library-item"
                      title={it.description}
                      onClick={() => onRun(it.prompt)}
                    >
                      <span className="assistant-library-item-icon">{it.icon}</span>
                      <span className="assistant-library-item-body">
                        <span className="assistant-library-item-label">{it.label}</span>
                        <span className="assistant-library-item-desc">{it.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div className="assistant-library-empty">没有匹配的助手</div>
        )}
      </div>
    </div>
  )
}
