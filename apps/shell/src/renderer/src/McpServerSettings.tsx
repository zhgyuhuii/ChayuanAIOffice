import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from './locale'
import type { StringKey } from './locale'

// ── Settings → 集成 → 本地 MCP 服务 ─────────────────────────
// The app's OWN MCP server (this app exposing its editor tools to external
// agents over loopback HTTP). Moved here from a standalone settings section;
// the external-client direction (this app dialing OUT to user-registered
// servers) lives in McpManagePane under「MCP 管理」.

/** mcp.json snippet a client needs to reach the local server */
function mcpConfigExample(port: string): string {
  return JSON.stringify(
    { mcpServers: { chatoffice: { url: `http://127.0.0.1:${port}/mcp` } } },
    null,
    2,
  )
}

/** copies the given text; the label flips to "Copied" for a moment as feedback */
function CopyTextButton({ text, label }: { text: string; label?: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )
  return (
    <button
      className="set-btn"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true)
            if (timerRef.current !== null) window.clearTimeout(timerRef.current)
            timerRef.current = window.setTimeout(() => setCopied(false), 1600)
          },
          () => {},
        )
      }}
    >
      {copied ? t('setMcpCopied') : (label ?? t('setMcpCopy'))}
    </button>
  )
}

function FieldRow({
  label,
  value,
  valueTitle,
  action,
}: {
  label: string
  value: string
  valueTitle?: string
  action?: React.ReactNode
}) {
  return (
    <div className="set-field">
      <div className="set-field-text">
        <div className="set-field-label">{label}</div>
        <div className="set-field-value" data-tip={valueTitle}>
          {value}
        </div>
      </div>
      {action}
    </div>
  )
}

export function McpServerSettings() {
  const { t } = useI18n()
  const [mcpRunning, setMcpRunning] = useState(false)
  const [mcpEnabled, setMcpEnabled] = useState(false)
  const [mcpPort, setMcpPort] = useState('3093')
  // the last port the main process confirmed: an invalid edit reverts to this
  // rather than a hard-coded default, which could disagree with a server that is
  // already running on another port
  const mcpSavedPort = useRef('3093')
  const [mcpError, setMcpError] = useState('')
  const [mcpSaving, setMcpSaving] = useState(false)
  const [mcpBackground, setMcpBackground] = useState(false)
  const [mcpLogging, setMcpLogging] = useState(false)
  const [mcpCaps, setMcpCaps] = useState<string[]>(['docs'])
  const [mcpLogs, setMcpLogs] = useState<string[]>([])
  const logViewRef = useRef<HTMLPreElement | null>(null)

  /**
   * Apply an MCP settings patch: always sends the full current snapshot plus the
   * changed field (the main process persists and applies atomically, restarting
   * the server when the port or the exposed tool set changes).
   */
  const applyMcp = (patch: {
    enabled?: boolean
    port?: number
    background?: boolean
    logging?: boolean
  }) => {
    setMcpSaving(true)
    void window.chatOffice
      .setMcpSettings({
        enabled: patch.enabled ?? mcpEnabled,
        port: patch.port ?? (Number(mcpPort) || 3093),
        background: patch.background ?? mcpBackground,
        logging: patch.logging ?? mcpLogging,
      })
      .then((s) => {
        setMcpRunning(s.running)
        setMcpEnabled(s.enabled)
        setMcpPort(String(s.port))
        mcpSavedPort.current = String(s.port)
        setMcpBackground(s.background)
        setMcpLogging(s.logging)
        setMcpCaps(s.capabilities ?? ['docs'])
        setMcpError(s.error ?? '')
      })
      .catch(() => {})
      .finally(() => setMcpSaving(false))
  }

  /** tail of the MCP log for the in-pane viewer */
  const fetchMcpLogs = useCallback(() => {
    void window.chatOffice
      .getMcpLogs?.()
      .then((lines) => setMcpLogs(Array.isArray(lines) ? lines : []))
      .catch(() => {})
  }, [])

  // poll while logging is on: entries land as tools run
  useEffect(() => {
    if (!mcpLogging) return
    fetchMcpLogs()
    const timer = window.setInterval(fetchMcpLogs, 2000)
    return () => window.clearInterval(timer)
  }, [mcpLogging, fetchMcpLogs])

  // follow the tail (newest entries last), but never fight a reader who scrolled up
  useEffect(() => {
    const el = logViewRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) el.scrollTop = el.scrollHeight
  }, [mcpLogs])

  useEffect(() => {
    let alive = true
    void window.chatOffice.getMcpStatus?.().then((s) => {
      if (!alive) return
      setMcpRunning(s.running)
      setMcpEnabled(s.enabled)
      setMcpPort(String(s.port))
      mcpSavedPort.current = String(s.port)
      setMcpBackground(s.background)
      setMcpLogging(s.logging)
      setMcpCaps(s.capabilities ?? ['docs'])
      setMcpError(s.error ?? '')
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <section className="set-mcp-server">
      <h4 className="set-pane-subtitle">{t('setSecMcp')}</h4>
      <div className="set-field set-field-top">
        <div className="set-field-text">
          <div className="set-field-stack">
            <div className="set-field-label">{t('setMcp')}</div>
            <div className="set-field-desc">{t('setMcpDesc')}</div>
            <div className="set-field-desc set-mcp-status">
              <span
                className={`set-status-dot${mcpError ? ' error' : mcpRunning ? ' running' : ''}`}
                aria-hidden="true"
              />
              <span>{mcpError || (mcpRunning ? t('setMcpRunning') : t('setMcpStopped'))}</span>
            </div>
          </div>
        </div>
        <button
          className="set-switch"
          role="switch"
          aria-checked={mcpEnabled}
          aria-label={t('setMcp')}
          disabled={mcpSaving}
          onClick={() => applyMcp({ enabled: !mcpEnabled })}
        />
      </div>
      <div className="set-field">
        <div className="set-field-text">
          <div className="set-field-stack">
            <label className="set-field-label" htmlFor="set-mcp-port">
              {t('setMcpPort')}
            </label>
          </div>
        </div>
        <input
          id="set-mcp-port"
          className="set-input"
          type="number"
          min={1024}
          max={65535}
          value={mcpPort}
          onChange={(e) => setMcpPort(e.target.value)}
          onBlur={() => {
            const port = Number(mcpPort)
            if (!Number.isInteger(port) || port < 1024 || port > 65535) {
              // revert to the port the main process last confirmed, not
              // a literal default that may not match the running server
              setMcpPort(mcpSavedPort.current)
              return
            }
            if (String(port) === mcpSavedPort.current) return
            // persist even while the server is off, so the port is
            // configured before it is switched on
            applyMcp({ port })
          }}
        />
      </div>
      <div className="set-field set-field-top">
        <div className="set-field-text">
          <div className="set-field-stack">
            <div className="set-field-label">{t('setMcpBg')}</div>
            <div className="set-field-desc">{t('setMcpBgDesc')}</div>
          </div>
        </div>
        <button
          className="set-switch"
          role="switch"
          aria-checked={mcpBackground}
          aria-label={t('setMcpBg')}
          disabled={mcpSaving}
          onClick={() => applyMcp({ background: !mcpBackground })}
        />
      </div>
      <h4 className="set-group-title">{t('setMcpConn')}</h4>
      <FieldRow
        label={t('setMcpUrlHttp')}
        value={`http://127.0.0.1:${mcpPort}/mcp`}
        action={<CopyTextButton text={`http://127.0.0.1:${mcpPort}/mcp`} />}
      />
      <FieldRow
        label={t('setMcpUrlSse')}
        value={`http://127.0.0.1:${mcpPort}/sse`}
        action={<CopyTextButton text={`http://127.0.0.1:${mcpPort}/sse`} />}
      />
      <FieldRow
        label={t('setMcpHealth')}
        value={`http://127.0.0.1:${mcpPort}/health`}
        action={<CopyTextButton text={`http://127.0.0.1:${mcpPort}/health`} />}
      />
      <div className="set-config-block">
        <div className="set-config-head">
          <div className="set-field-stack">
            <div className="set-field-label">{t('setMcpConfig')}</div>
            <div className="set-field-desc">{t('setMcpConfigDesc')}</div>
          </div>
          <CopyTextButton text={mcpConfigExample(mcpPort)} />
        </div>
        <pre className="set-code">{mcpConfigExample(mcpPort)}</pre>
      </div>
      <h4 className="set-group-title">{t('setMcpLog')}</h4>
      <div className="set-field set-field-top">
        <div className="set-field-text">
          <div className="set-field-stack">
            <div className="set-field-label">{t('setMcpLog')}</div>
            <div className="set-field-desc">{t('setMcpLogDesc')}</div>
          </div>
        </div>
        <button
          className="set-switch"
          role="switch"
          aria-checked={mcpLogging}
          aria-label={t('setMcpLog')}
          disabled={mcpSaving}
          onClick={() => applyMcp({ logging: !mcpLogging })}
        />
      </div>
      {mcpLogging && (
        <div className="set-config-block">
          <div className="set-config-head">
            <div className="set-field-stack">
              <div className="set-field-label">{t('setMcpLogFile')}</div>
              <div className="set-field-desc">mcp-log.txt</div>
            </div>
            <div className="set-btn-row">
              <button className="set-btn" onClick={fetchMcpLogs}>
                {t('setMcpLogRefresh')}
              </button>
              <button className="set-btn" onClick={() => void window.chatOffice.openMcpLogFile?.()}>
                {t('setMcpLogOpen')}
              </button>
              <button
                className="set-btn"
                onClick={() => {
                  void window.chatOffice.clearMcpLogs?.().then(fetchMcpLogs)
                }}
              >
                {t('setMcpLogClear')}
              </button>
            </div>
          </div>
          <pre ref={logViewRef} className="set-code set-log">
            {mcpLogs.length > 0 ? (
              mcpLogs.join('\n')
            ) : (
              <span className="set-log-empty">{t('setMcpLogEmpty')}</span>
            )}
          </pre>
        </div>
      )}
      <h4 className="set-group-title">{t('setMcpCap')}</h4>
      {(
        [
          ['docs', 'setMcpCapDocs', 'setMcpCapDocsDesc'],
          ['slides', 'setMcpCapSlides', 'setMcpCapSlidesDesc'],
          ['sheets', 'setMcpCapSheets', 'setMcpCapSheetsDesc'],
          ['pdf', 'setMcpCapPdf', 'setMcpCapPdfDesc'],
        ] as Array<[string, StringKey, StringKey]>
      )
        .filter(([id]) => mcpCaps.includes(id))
        .map(([, labelKey, descKey]) => (
          <FieldRow key={labelKey} label={t(labelKey)} value={t(descKey)} />
        ))}
    </section>
  )
}
