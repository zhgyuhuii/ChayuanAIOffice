import { useCallback, useEffect, useState } from 'react'
import type { TFunc } from './locale'
import type {
  ExternalMcpServerConfig,
  ExternalMcpToolInfo,
  ExternalMcpTransport,
  ExternalMcpVerifyResult,
} from '../../shared/mcp-client-api'

// ── Settings → MCP 管理 ─────────────────────────────────────
// External MCP servers: the user registers third-party servers (HTTP / SSE /
// stdio), verifies them online, browses their tools grouped per server, and
// flips them on/off. Enabled servers' tools are injected into the home chat
// agent (prefixed `mcp__<server>__<tool>`), so the dialog can call them.

const TRANSPORTS: Array<{
  value: ExternalMcpTransport
  labelKey: 'mcpMgTpHttp' | 'mcpMgTpSse' | 'mcpMgTpStdio'
}> = [
  { value: 'http', labelKey: 'mcpMgTpHttp' },
  { value: 'sse', labelKey: 'mcpMgTpSse' },
  { value: 'stdio', labelKey: 'mcpMgTpStdio' },
]

interface DraftForm {
  /** null while adding; the id being edited otherwise */
  id: string | null
  name: string
  transport: ExternalMcpTransport
  url: string
  headersText: string
  command: string
  argsText: string
  envText: string
  /** enabled flag preserved across an edit */
  enabled: boolean
}

const EMPTY_DRAFT: DraftForm = {
  id: null,
  name: '',
  transport: 'http',
  url: '',
  headersText: '',
  command: '',
  argsText: '',
  envText: '',
  enabled: true,
}

/** parse a JSON object text field ('' = {}) */
function parseJsonMap(text: string): Record<string, string> {
  if (!text.trim()) return {}
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('not an object')
  }
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    out[key] = String(value)
  }
  return out
}

function draftToConfig(
  draft: DraftForm,
): Pick<
  ExternalMcpServerConfig,
  'name' | 'transport' | 'url' | 'headers' | 'command' | 'args' | 'env'
> {
  const base = { name: draft.name.trim(), transport: draft.transport }
  if (draft.transport === 'http' || draft.transport === 'sse') {
    return { ...base, url: draft.url.trim(), headers: parseJsonMap(draft.headersText) }
  }
  return {
    ...base,
    command: draft.command.trim(),
    args: draft.argsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    env: parseJsonMap(draft.envText),
  }
}

function draftFromServer(server: ExternalMcpServerConfig): DraftForm {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    url: server.url ?? '',
    headersText:
      server.headers && Object.keys(server.headers).length > 0
        ? JSON.stringify(server.headers, null, 2)
        : '',
    command: server.command ?? '',
    argsText: (server.args ?? []).join('\n'),
    envText:
      server.env && Object.keys(server.env).length > 0 ? JSON.stringify(server.env, null, 2) : '',
    enabled: server.enabled,
  }
}

export function McpManagePane({ t }: { t: TFunc }) {
  const api = () => window.chatOfficeMcp
  const [servers, setServers] = useState<ExternalMcpServerConfig[] | null>(null)
  const [draft, setDraft] = useState<DraftForm | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<ExternalMcpVerifyResult | null>(null)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  /** expanded server id → live tools (fetched via verify on expand) */
  const [expanded, setExpanded] = useState<string | null>(null)
  const [toolsCache, setToolsCache] = useState<Record<string, ExternalMcpToolInfo[]>>({})
  const [toolsLoading, setToolsLoading] = useState<string | null>(null)
  const [toolsError, setToolsError] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const list = await api()?.listServers()
    if (list) setServers(list)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const startAdd = () => {
    setDraft({ ...EMPTY_DRAFT })
    setVerifyResult(null)
    setFormError('')
  }

  const startEdit = (server: ExternalMcpServerConfig) => {
    setDraft(draftFromServer(server))
    setVerifyResult(null)
    setFormError('')
  }

  const runVerify = async () => {
    if (!draft || verifying) return
    let config: ReturnType<typeof draftToConfig>
    try {
      config = draftToConfig(draft)
    } catch {
      setFormError(t('mcpMgErrJson'))
      return
    }
    setVerifying(true)
    setFormError('')
    setVerifyResult(null)
    try {
      setVerifyResult((await api()?.verifyDraft(config)) ?? null)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e))
    } finally {
      setVerifying(false)
    }
  }

  const save = async () => {
    if (!draft || saving) return
    let config: ReturnType<typeof draftToConfig>
    try {
      config = draftToConfig(draft)
    } catch {
      setFormError(t('mcpMgErrJson'))
      return
    }
    if (!config.name) {
      setFormError(t('mcpMgErrName'))
      return
    }
    if (config.transport !== 'stdio' && !/^https?:\/\//.test(config.url ?? '')) {
      setFormError(t('mcpMgErrUrl'))
      return
    }
    if (config.transport === 'stdio' && !config.command) {
      setFormError(t('mcpMgErrCommand'))
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const list = await api()?.saveServer({
        id: draft.id ?? crypto.randomUUID(),
        ...config,
        enabled: draft.enabled,
        createdAt: 0,
        updatedAt: 0,
        lastVerify:
          verifyResult && verifyResult.ok
            ? { at: Date.now(), ok: true, toolCount: verifyResult.tools.length }
            : null,
      })
      if (list) setServers(list)
      setDraft(null)
      setVerifyResult(null)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (server: ExternalMcpServerConfig) => {
    const list = await api()?.setServerEnabled(server.id, !server.enabled)
    if (list) setServers(list)
  }

  const confirmDelete = async (id: string) => {
    const list = await api()?.deleteServer(id)
    if (list) setServers(list)
    setDeleting(null)
    if (expanded === id) setExpanded(null)
  }

  /** expand/collapse a server group; expanding fetches its live tool list */
  const toggleExpand = async (server: ExternalMcpServerConfig) => {
    if (expanded === server.id) {
      setExpanded(null)
      return
    }
    setExpanded(server.id)
    setToolsError((prev) => ({ ...prev, [server.id]: '' }))
    setToolsLoading(server.id)
    try {
      const result = await api()?.verifyServer(server.id)
      if (!result) return
      if (result.ok) {
        setToolsCache((prev) => ({ ...prev, [server.id]: result.tools }))
      } else {
        setToolsError((prev) => ({ ...prev, [server.id]: result.error ?? t('mcpMgVerifyFail') }))
      }
    } catch (e) {
      setToolsError((prev) => ({
        ...prev,
        [server.id]: e instanceof Error ? e.message : String(e),
      }))
    } finally {
      setToolsLoading(null)
      void refresh()
    }
  }

  const transportLabel = (transport: ExternalMcpTransport): string =>
    t(TRANSPORTS.find((tp) => tp.value === transport)?.labelKey ?? 'mcpMgTpHttp')

  return (
    <>
      <h3 className="set-pane-title">{t('setSecMcpManage')}</h3>
      <div className="set-field-desc set-mcpm-lead">{t('mcpMgDesc')}</div>

      {draft ? (
        <div className="set-mcpm-form" role="group" aria-label={t('mcpMgAdd')}>
          <h4 className="set-pane-subtitle">
            {draft.id ? t('mcpMgFormTitleEdit') : t('mcpMgFormTitleAdd')}
          </h4>
          <div className="set-field">
            <div className="set-field-text">
              <div className="set-field-stack">
                <label className="set-field-label" htmlFor="mcpm-name">
                  {t('mcpMgName')}
                </label>
              </div>
            </div>
            <input
              id="mcpm-name"
              className="set-input"
              value={draft.name}
              placeholder={t('mcpMgNamePh')}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="set-field">
            <div className="set-field-text">
              <label className="set-field-label">{t('mcpMgTransport')}</label>
            </div>
            <div className="set-mcpm-tp" role="radiogroup" aria-label={t('mcpMgTransport')}>
              {TRANSPORTS.map((tp) => (
                <button
                  key={tp.value}
                  type="button"
                  className={`set-mcpm-tp-btn${draft.transport === tp.value ? ' active' : ''}`}
                  role="radio"
                  aria-checked={draft.transport === tp.value}
                  onClick={() => setDraft({ ...draft, transport: tp.value })}
                >
                  {t(tp.labelKey)}
                </button>
              ))}
            </div>
          </div>
          {(draft.transport === 'http' || draft.transport === 'sse') && (
            <>
              <div className="set-field">
                <div className="set-field-text">
                  <div className="set-field-stack">
                    <label className="set-field-label" htmlFor="mcpm-url">
                      {t('mcpMgUrl')}
                    </label>
                  </div>
                </div>
                <input
                  id="mcpm-url"
                  className="set-input"
                  value={draft.url}
                  placeholder="https://example.com/mcp"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
              </div>
              <div className="set-field">
                <div className="set-field-text">
                  <div className="set-field-stack">
                    <label className="set-field-label" htmlFor="mcpm-headers">
                      {t('mcpMgHeaders')}
                    </label>
                    <div className="set-field-desc">{t('mcpMgHeadersHint')}</div>
                  </div>
                </div>
                <textarea
                  id="mcpm-headers"
                  className="set-input set-mcpm-textarea"
                  rows={2}
                  spellCheck={false}
                  value={draft.headersText}
                  placeholder={'{"Authorization": "Bearer …"}'}
                  onChange={(e) => setDraft({ ...draft, headersText: e.target.value })}
                />
              </div>
            </>
          )}
          {draft.transport === 'stdio' && (
            <>
              <div className="set-field">
                <div className="set-field-text">
                  <div className="set-field-stack">
                    <label className="set-field-label" htmlFor="mcpm-command">
                      {t('mcpMgCommand')}
                    </label>
                    <div className="set-field-desc">{t('mcpMgStdioHint')}</div>
                  </div>
                </div>
                <input
                  id="mcpm-command"
                  className="set-input"
                  value={draft.command}
                  placeholder="npx"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                />
              </div>
              <div className="set-field">
                <div className="set-field-text">
                  <div className="set-field-stack">
                    <label className="set-field-label" htmlFor="mcpm-args">
                      {t('mcpMgArgs')}
                    </label>
                  </div>
                </div>
                <textarea
                  id="mcpm-args"
                  className="set-input set-mcpm-textarea"
                  rows={2}
                  spellCheck={false}
                  value={draft.argsText}
                  placeholder={'-y\n@some/mcp-server'}
                  onChange={(e) => setDraft({ ...draft, argsText: e.target.value })}
                />
              </div>
              <div className="set-field">
                <div className="set-field-text">
                  <div className="set-field-stack">
                    <label className="set-field-label" htmlFor="mcpm-env">
                      {t('mcpMgEnv')}
                    </label>
                  </div>
                </div>
                <textarea
                  id="mcpm-env"
                  className="set-input set-mcpm-textarea"
                  rows={2}
                  spellCheck={false}
                  value={draft.envText}
                  placeholder={'{"API_KEY": "…"}'}
                  onChange={(e) => setDraft({ ...draft, envText: e.target.value })}
                />
              </div>
            </>
          )}
          {verifyResult && (
            <div
              className={`set-mcpm-verify${verifyResult.ok ? ' ok' : ' err'}`}
              role="status"
              data-testid="mcpm-verify"
            >
              {verifyResult.ok
                ? t('mcpMgVerifyOk', { n: String(verifyResult.tools.length) })
                : `${t('mcpMgVerifyFail')}: ${verifyResult.error ?? ''}`}
              {verifyResult.ok && verifyResult.tools.length > 0 && (
                <div className="set-mcpm-tool-preview">
                  {verifyResult.tools.map((tool) => (
                    <div key={tool.name} className="set-mcpm-tool">
                      <code>{tool.name}</code>
                      {tool.description ? <span>{tool.description}</span> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {formError && (
            <div className="set-field-desc set-mcpm-error" role="alert">
              {formError}
            </div>
          )}
          <div className="set-intg-actions set-mcpm-actions">
            <button className="set-btn" onClick={() => setDraft(null)} disabled={saving}>
              {t('cancel')}
            </button>
            <button
              className="set-btn"
              onClick={() => void runVerify()}
              disabled={verifying || saving}
            >
              {verifying ? t('mcpMgVerifying') : t('mcpMgVerify')}
            </button>
            <button
              className="set-btn primary"
              onClick={() => void save()}
              disabled={verifying || saving}
            >
              {t('mcpMgSave')}
            </button>
          </div>
        </div>
      ) : (
        <div className="set-mcpm-addrow">
          <button className="set-btn primary" onClick={startAdd}>
            {t('mcpMgAdd')}
          </button>
        </div>
      )}

      {servers !== null && servers.length === 0 && !draft && (
        <div className="set-field-desc set-mcpm-empty">{t('mcpMgEmpty')}</div>
      )}

      {servers?.map((server) => {
        const isOpen = expanded === server.id
        const tools = toolsCache[server.id]
        const verify = server.lastVerify
        return (
          <div key={server.id} className="set-mcpm-server" data-open={isOpen}>
            <div className="set-field">
              <button
                type="button"
                className="set-mcpm-head"
                aria-expanded={isOpen}
                onClick={() => void toggleExpand(server)}
              >
                <svg
                  className="set-mcpm-chevron"
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                >
                  <path
                    d="M4 2.5 8 6l-4 3.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="set-mcpm-name">{server.name}</span>
                <span className="set-mcpm-meta">
                  {transportLabel(server.transport)}
                  {' · '}
                  {verify?.ok
                    ? t('mcpMgToolsCount', { n: String(verify.toolCount) })
                    : t('mcpMgUnverified')}
                </span>
              </button>
              <div className="set-intg-actions">
                <button
                  className="set-switch"
                  role="switch"
                  aria-checked={server.enabled}
                  aria-label={t('mcpMgEnabled')}
                  title={server.enabled ? t('mcpMgEnabled') : t('mcpMgDisabled')}
                  onClick={() => void toggleEnabled(server)}
                />
                <button className="set-btn" onClick={() => startEdit(server)}>
                  {t('mcpMgEdit')}
                </button>
                {deleting === server.id ? (
                  <button className="set-btn danger" onClick={() => void confirmDelete(server.id)}>
                    {t('mcpMgConfirmDelete')}
                  </button>
                ) : (
                  <button className="set-btn danger" onClick={() => setDeleting(server.id)}>
                    {t('mcpMgDelete')}
                  </button>
                )}
              </div>
            </div>
            {isOpen && (
              <div className="set-mcpm-body">
                {toolsLoading === server.id && (
                  <div className="set-field-desc">{t('mcpMgVerifying')}</div>
                )}
                {toolsError[server.id] && (
                  <div className="set-field-desc set-mcpm-error">{toolsError[server.id]}</div>
                )}
                {tools && tools.length === 0 && !toolsError[server.id] && (
                  <div className="set-field-desc">{t('mcpMgNoTools')}</div>
                )}
                {tools && tools.length > 0 && (
                  <div className="set-mcpm-tools">
                    {tools.map((tool) => (
                      <div key={tool.name} className="set-mcpm-tool">
                        <code>{tool.name}</code>
                        {tool.description ? <span>{tool.description}</span> : null}
                      </div>
                    ))}
                  </div>
                )}
                <div className="set-mcpm-actions">
                  <button
                    className="set-btn"
                    disabled={toolsLoading === server.id}
                    onClick={() => {
                      setExpanded(null)
                      window.setTimeout(() => void toggleExpand(server), 0)
                    }}
                  >
                    {t('mcpMgReverify')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
