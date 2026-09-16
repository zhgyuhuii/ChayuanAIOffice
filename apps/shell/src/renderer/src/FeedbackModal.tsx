import { useEffect, useRef, useState } from 'react'
import qrCodeIcon from './assets/qrcode.png'
import type { FeedbackAttachmentMeta } from '../../shared/home-api'
import { useI18n } from './locale'
import {
  collectFeedbackDiagnostics,
  retryFeedbackDrafts,
  submitFeedbackForm,
  uploadFeedbackFile,
} from './feedbackClient'
import './feedback.css'

/**
 * 反馈对话框（侧栏底部反馈按钮）：类型（错误/需求/其他）+ 正文 + 附件
 * （图片/任意文件/运行日志），经主进程代理提交到 aidooo.com（与
 * chayuan-wps 反馈通道同端点）。离线提交自动存草稿，打开时自动重发。
 */
const TYPES: Array<{ id: 'bug' | 'suggestion' | 'other'; key: 'feedbackTypeBug' | 'feedbackTypeSuggestion' | 'feedbackTypeOther' }> = [
  { id: 'bug', key: 'feedbackTypeBug' },
  { id: 'suggestion', key: 'feedbackTypeSuggestion' },
  { id: 'other', key: 'feedbackTypeOther' },
]

type Notice =
  | { kind: 'success' }
  | { kind: 'draft' }
  | { kind: 'hint'; msg: string }
  | { kind: 'error'; msg: string }

interface PendingAttachment {
  meta: FeedbackAttachmentMeta
  /** local object URL for image previews (CSP blocks the aidooo URL) */
  preview?: string
}

export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const [version, setVersion] = useState('')
  const [type, setType] = useState<'bug' | 'suggestion' | 'other'>('bug')
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [uploading, setUploading] = useState(0)
  const [logUploading, setLogUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewsRef = useRef<string[]>([])

  useEffect(() => {
    void collectFeedbackDiagnostics().then((d) => setVersion(d.appVersion))
    retryFeedbackDrafts().catch(() => {})
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      for (const url of previewsRef.current) URL.revokeObjectURL(url)
    }
  }, [onClose])

  const trackPreview = (url: string) => {
    previewsRef.current.push(url)
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const handleFiles = async (files: FileList | null, imagesOnly = false) => {
    const list = Array.from(files || [])
    if (!list.length) return
    for (const file of list) {
      if (imagesOnly && !file.type.startsWith('image/')) continue
      setUploading((n) => n + 1)
      try {
        const meta = await uploadFeedbackFile(file)
        const preview = meta.kind === 'image' ? URL.createObjectURL(file) : undefined
        if (preview) trackPreview(preview)
        setAttachments((prev) => [...prev, { meta, preview }])
      } catch (err) {
        setNotice({ kind: 'error', msg: err instanceof Error ? err.message : String(err) })
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  // 运行日志：MCP 日志（唯一落盘日志）最近 200 行打包 txt 上传；重复点击替换
  const attachLog = async () => {
    if (logUploading) return
    let lines: string[] = []
    try {
      lines = await window.chatOffice.getMcpLogs()
    } catch {
      lines = []
    }
    lines = lines.slice(-200)
    if (!lines.length) {
      setNotice({ kind: 'hint', msg: t('feedbackLogEmpty') })
      return
    }
    setLogUploading(true)
    try {
      const stamp = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const name = `aioffice-log-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.txt`
      const head = [
        `# ${t('feedbackLogHeader')} (${lines.length})`,
        `# version: ${version}`,
        `# time: ${stamp.toISOString()}`,
        `# ua: ${navigator.userAgent}`,
        '',
      ].join('\n')
      const file = new File([head + lines.join('\n')], name, { type: 'text/plain' })
      const meta = await uploadFeedbackFile(file)
      setAttachments((prev) => [
        ...prev.filter((a) => !a.meta.name.startsWith('aioffice-log-')),
        { meta },
      ])
    } catch (err) {
      setNotice({ kind: 'error', msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setLogUploading(false)
    }
  }

  const doSend = async () => {
    const content = text.trim()
    if (!content) {
      setNotice({ kind: 'hint', msg: t('feedbackContentRequired') })
      return
    }
    if (sending || uploading > 0) return
    setSending(true)
    setNotice(null)
    try {
      const res = await submitFeedbackForm({ content, type, attachments: attachments.map((a) => a.meta) })
      if (res.ok) {
        setText('')
        setAttachments([])
        setType('bug')
        setNotice({ kind: 'success' })
      } else if (res.offline) {
        setText('')
        setAttachments([])
        setType('bug')
        setNotice({ kind: 'draft' })
      } else {
        setNotice({ kind: 'error', msg: res.error || '' })
      }
    } catch (err) {
      setNotice({ kind: 'error', msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="fb-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      data-feedback-overlay
    >
      <div className="fb-dialog" role="dialog" aria-modal="true" aria-label={t('feedbackTitle')} data-feedback-dialog>
        <div className="fb-header">
          <div>
            <h3 className="fb-title">{t('feedbackTitle')}</h3>
            <p className="fb-subtitle">{t('feedbackSubtitle', { v: version || '—' })}</p>
          </div>
          <button className="fb-close" onClick={onClose} aria-label={t('cancel')} data-feedback-close>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="fb-types" role="radiogroup" aria-label={t('feedbackTypeLabel')}>
          <span className="fb-types-label">{t('feedbackTypeLabel')}</span>
          {TYPES.map(({ id, key }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={type === id}
              className={`fb-type-btn${type === id ? ' on' : ''}`}
              data-feedback-type={id}
              onClick={() => setType(id)}
            >
              {t(key)}
            </button>
          ))}
        </div>

        <textarea
          className="fb-textarea"
          rows={4}
          value={text}
          placeholder={t('feedbackPlaceholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void doSend()
            }
          }}
          data-feedback-textarea
        />

        {attachments.length > 0 && (
          <div className="fb-attachments" data-feedback-attachments>
            {attachments.map((att, i) => (
              <span className="fb-att" key={`${att.meta.name}-${i}`} data-feedback-attachment={att.meta.name}>
                {att.meta.kind === 'image' && att.preview ? (
                  <img src={att.preview} alt="" />
                ) : (
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M9.5 2.5h-5A1.5 1.5 0 0 0 3 4v8A1.5 1.5 0 0 0 4.5 13.5h7A1.5 1.5 0 0 0 13 12V6L9.5 2.5zM9.5 2.5V6H13M5.5 9h5M5.5 11h3"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
                <span className="fb-att-name">{att.meta.name}</span>
                <button
                  type="button"
                  className="fb-att-remove"
                  onClick={() => removeAttachment(i)}
                  aria-label={t('feedbackRemoveAttachment')}
                  title={t('feedbackRemoveAttachment')}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="fb-actions">
          <button type="button" className="fb-action-btn" onClick={() => imageInputRef.current?.click()} disabled={uploading > 0} data-feedback-attach-image>
            {t('feedbackAttachImage')}
          </button>
          <button type="button" className="fb-action-btn" onClick={() => fileInputRef.current?.click()} disabled={uploading > 0} data-feedback-attach-file>
            {t('feedbackAttachFile')}
          </button>
          <button
            type="button"
            className="fb-action-btn"
            onClick={() => void attachLog()}
            disabled={logUploading || uploading > 0}
            data-feedback-attach-log
          >
            {logUploading ? t('feedbackUploading') : t('feedbackAttachLog')}
          </button>
          {uploading > 0 && <span className="fb-uploading-label">{t('feedbackUploading')}</span>}
          <button
            type="button"
            className="fb-send"
            onClick={() => void doSend()}
            disabled={sending || uploading > 0}
            data-feedback-send
          >
            {sending ? t('feedbackSending') : t('feedbackSend')}
          </button>
        </div>

        {notice && (
          <div className={`fb-notice fb-notice-${notice.kind}`} data-feedback-notice={notice.kind}>
            {notice.kind === 'success' && t('feedbackSubmitted')}
            {notice.kind === 'draft' && t('feedbackDraftNotice')}
            {notice.kind === 'hint' && notice.msg}
            {notice.kind === 'error' && (notice.msg ? t('feedbackSendFailed', { msg: notice.msg }) : t('feedbackSendFailed', { msg: '' }))}
          </div>
        )}

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void handleFiles(e.target.files, true)
            e.target.value = ''
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}

/** 离线兜底：扫码关注公众号（点击反馈时探测 aidooo.com 不通） */
export function FeedbackQrCard({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="fb-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      data-feedback-qr-overlay
    >
      <div className="fb-dialog fb-qr-dialog" role="dialog" aria-modal="true" aria-label={t('followUs')} data-feedback-qr>
        <div className="fb-header">
          <h3 className="fb-title">{t('followUs')}</h3>
          <button className="fb-close" onClick={onClose} aria-label={t('cancel')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <img className="fb-qr-img" src={qrCodeIcon} alt={t('scanQrFollow')} />
        <p className="fb-qr-text">{t('followUs')}</p>
        <p className="fb-qr-sub">{t('scanQrFollow')}</p>
      </div>
    </div>
  )
}
