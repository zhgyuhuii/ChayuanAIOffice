import { useCallback, useEffect, useState } from 'react'
import type {
  RemoteFilesClient,
  RemoteStorageConfig,
  RemoteStorageSettings,
  TestConnectionResult,
} from '@chatoffice/storage-adapter'
import { useI18n } from './locale'

declare global {
  interface Window {
    chatOfficeRemoteFiles?: RemoteFilesClient
  }
}

interface Feedback {
  kind: 'ok' | 'err'
  text: string
}

const EMPTY_CONFIG_DRAFT = (): RemoteStorageConfig => ({
  id: '',
  name: '',
  protocol: 's3',
  endpoint: '',
  region: 'us-east-1',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  prefix: 'chatoffice/',
  pathStyle: true,
  enabled: true,
})

function isComplete(config: RemoteStorageConfig): boolean {
  return Boolean(
    config.name.trim() &&
    /^https?:\/\//.test(config.endpoint.trim()) &&
    config.region.trim() &&
    config.bucket.trim() &&
    config.accessKeyId.trim() &&
    config.secretAccessKey.trim(),
  )
}

/** "远程存储" pane (SettingsModal): provider configs + the default save pointer. */
export function StoragePane() {
  const { t } = useI18n()
  const client = window.chatOfficeRemoteFiles
  const [settings, setSettings] = useState<RemoteStorageSettings | null>(null)
  const [draft, setDraft] = useState<RemoteStorageConfig | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (!client) return
    client
      .getSettings()
      .then(setSettings)
      .catch(() => setFeedback({ kind: 'err', text: t('setAiTestFail') }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on remount, not on t()
  }, [client])

  const persist = useCallback(
    async (next: RemoteStorageSettings) => {
      if (!client) return
      try {
        const saved = await client.saveSettings(next)
        setSettings(saved)
        setFeedback({ kind: 'ok', text: t('setAiSaved') })
      } catch (error) {
        setFeedback({
          kind: 'err',
          text: error instanceof Error ? error.message : t('setAiTestFail'),
        })
      }
    },
    [client, t],
  )

  if (!client) return null

  const saveDraft = () => {
    if (!draft || !settings) return
    if (!isComplete(draft)) {
      setFeedback({ kind: 'err', text: t('rsInvalid') })
      return
    }
    const exists = settings.configs.some((config) => config.id === draft.id)
    const configs = exists
      ? settings.configs.map((config) => (config.id === draft.id ? draft : config))
      : [
          ...settings.configs,
          { ...draft, id: `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
        ]
    setDraft(null)
    void persist({ ...settings, configs })
  }

  const removeConfig = (configId: string) => {
    if (!settings || !window.confirm(t('rsDeleteConfirm'))) return
    void persist({
      ...settings,
      configs: settings.configs.filter((config) => config.id !== configId),
      defaultLocation:
        settings.defaultLocation?.configId === configId ? null : settings.defaultLocation,
    })
  }

  const testDraft = async () => {
    if (!draft || !client) return
    setTesting(true)
    setFeedback(null)
    try {
      const result: TestConnectionResult = await client.testConnection(draft)
      if (!result.ok) {
        setFeedback({ kind: 'err', text: `${t('setAiTestFail')} ${result.error ?? ''}`.trim() })
      } else if (result.versioningEnabled === true) {
        setFeedback({ kind: 'ok', text: `${t('setAiTestOk')} ${t('rsVersioningOn')}` })
      } else if (result.versioningEnabled === false) {
        setFeedback({ kind: 'err', text: `${t('setAiTestOk')} ${t('rsVersioningOff')}` })
      } else {
        setFeedback({ kind: 'ok', text: `${t('setAiTestOk')} ${t('rsVersioningUnknown')}` })
      }
    } catch (error) {
      setFeedback({
        kind: 'err',
        text: error instanceof Error ? error.message : t('setAiTestFail'),
      })
    } finally {
      setTesting(false)
    }
  }

  if (draft) {
    const set = (patch: Partial<RemoteStorageConfig>) => setDraft({ ...draft, ...patch })
    return (
      <>
        <h3 className="set-pane-title">{t('setSecRemoteStorage')}</h3>
        <div className="set-field">
          <div className="set-field-text">
            <label className="set-field-label">{t('rsName')}</label>
          </div>
          <input
            className="set-input"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>
        <div className="set-field">
          <div className="set-field-text">
            <label className="set-field-label">{t('rsProtocol')}</label>
          </div>
          <select
            className="set-input"
            value={draft.protocol}
            onChange={(e) => {
              const protocol = e.target.value as RemoteStorageConfig['protocol']
              // MinIO needs path-style; OSS defaults to virtual-hosted buckets
              set({ protocol, pathStyle: protocol === 's3' })
            }}
          >
            <option value="s3">{t('rsProtocolS3')}</option>
            <option value="aliyun-oss">{t('rsProtocolOss')}</option>
          </select>
        </div>
        <div className="set-field">
          <div className="set-field-text">
            <label className="set-field-label">{t('rsEndpoint')}</label>
          </div>
          <input
            className="set-input"
            placeholder="http://127.0.0.1:9000"
            value={draft.endpoint}
            onChange={(e) => set({ endpoint: e.target.value })}
          />
        </div>
        <div className="set-field">
          <div className="set-field-text">
            <label className="set-field-label">{t('rsRegion')}</label>
          </div>
          <input
            className="set-input"
            value={draft.region}
            onChange={(e) => set({ region: e.target.value })}
          />
        </div>
        <div className="set-field">
          <div className="set-field-text">
            <label className="set-field-label">{t('rsBucket')}</label>
          </div>
          <input
            className="set-input"
            value={draft.bucket}
            onChange={(e) => set({ bucket: e.target.value })}
          />
        </div>
        <div className="set-field">
          <div className="set-field-text">
            <label className="set-field-label">{t('rsAccessKeyId')}</label>
          </div>
          <input
            className="set-input"
            value={draft.accessKeyId}
            onChange={(e) => set({ accessKeyId: e.target.value })}
          />
        </div>
        <div className="set-field">
          <div className="set-field-text">
            <label className="set-field-label">{t('rsSecretKey')}</label>
          </div>
          <input
            className="set-input"
            type="password"
            value={draft.secretAccessKey}
            onChange={(e) => set({ secretAccessKey: e.target.value })}
          />
        </div>
        <div className="set-field">
          <div className="set-field-text">
            <label className="set-field-label">{t('rsPrefix')}</label>
          </div>
          <input
            className="set-input"
            value={draft.prefix}
            onChange={(e) => set({ prefix: e.target.value })}
          />
        </div>
        <div className="set-field">
          <div className="set-field-text">
            <div className="set-field-label">{t('rsPathStyle')}</div>
          </div>
          <button
            className="set-switch"
            role="switch"
            aria-checked={draft.pathStyle}
            onClick={() => set({ pathStyle: !draft.pathStyle })}
          />
        </div>
        <div className="set-field">
          <div className="set-field-text">
            <div className="set-field-label">{t('rsEnabled')}</div>
          </div>
          <button
            className="set-switch"
            role="switch"
            aria-checked={draft.enabled}
            onClick={() => set({ enabled: !draft.enabled })}
          />
        </div>
        <div className="set-pane-footer">
          <button className="set-btn" disabled={testing} onClick={() => void testDraft()}>
            {testing ? t('setAiTesting') : t('setAiTest')}
          </button>
          <button className="set-btn" onClick={saveDraft}>
            {t('setAiSave')}
          </button>
          <button
            className="set-btn"
            onClick={() => {
              setDraft(null)
              setFeedback(null)
            }}
          >
            {t('cancel')}
          </button>
          {feedback && <span className={`set-ai-status ${feedback.kind}`}>{feedback.text}</span>}
        </div>
      </>
    )
  }

  return (
    <>
      <h3 className="set-pane-title">{t('setSecRemoteStorage')}</h3>
      <div className="set-field">
        <div className="set-field-text">
          <div className="set-field-desc">{t('rsDesc')}</div>
        </div>
      </div>
      {(settings?.configs.length ?? 0) === 0 && (
        <div className="set-field-desc">{t('rsEmpty')}</div>
      )}
      {settings?.configs.map((config) => {
        const isDefault = settings.defaultLocation?.configId === config.id
        return (
          <div className="set-field" key={config.id}>
            <div className="set-field-text">
              <div className="set-field-stack">
                <div className="set-field-label">
                  <label className="set-radio">
                    <input
                      type="radio"
                      name="rs-default"
                      checked={isDefault}
                      onChange={() =>
                        void persist({ ...settings, defaultLocation: { configId: config.id } })
                      }
                    />
                    {config.name}
                    {isDefault ? ` · ${t('rsDefaultTitle')}` : ''}
                    {config.enabled ? '' : ` · ${t('rsEnabled')} ✕`}
                  </label>
                </div>
                <div className="set-field-desc">
                  {config.endpoint} / {config.bucket} / {config.prefix}
                </div>
              </div>
            </div>
            <div className="set-btn-row">
              <button
                className="set-btn"
                onClick={() => {
                  setFeedback(null)
                  setDraft(config)
                }}
              >
                {t('rsEdit')}
              </button>
              <button className="set-btn" onClick={() => removeConfig(config.id)}>
                {t('delete')}
              </button>
            </div>
          </div>
        )
      })}
      <div className="set-field">
        <div className="set-field-text">
          <label className="set-radio">
            <input
              type="radio"
              name="rs-default"
              checked={!settings?.defaultLocation}
              onChange={() => settings && void persist({ ...settings, defaultLocation: null })}
            />
            {t('rsDefaultLocal')}
          </label>
        </div>
      </div>
      <div className="set-pane-footer">
        <button
          className="set-btn"
          onClick={() => {
            setFeedback(null)
            setDraft(EMPTY_CONFIG_DRAFT())
          }}
        >
          {t('rsAdd')}
        </button>
      </div>
    </>
  )
}
