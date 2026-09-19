/**
 * Shared citation preview: the retrieved passage behind a [n] chip. The file
 * name is a download link — desktop form saves silently via the kb:file IPC
 * and reveals it; web/dsh forms navigate a same-origin /kb/file URL and let
 * the browser download. Shared so the home chat and every editor AI panel
 * render identical citation surfaces (docs/kb-integration-plan.md §6).
 */
import { useEffect, useState } from 'react'
import type { KbCitation } from '@chatoffice/ai-provider/browser'
import { kbDoc, kbFile } from './kb-api'
import { kbStrings } from './kb-strings'
import './kb.css'

export function KbCitePreview({
  citation,
  lang,
  onClose,
}: {
  citation: KbCitation
  lang?: string
  onClose: () => void
}): React.JSX.Element {
  const strings = kbStrings(lang)
  const [docStatus, setDocStatus] = useState<string | null>(null)
  const [download, setDownload] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle')
  useEffect(() => {
    let alive = true
    void kbDoc(citation.kbId, citation.docId).then((res) => {
      if (alive && res.ok && res.doc?.status) setDocStatus(res.doc.status)
    })
    return () => {
      alive = false
    }
  }, [citation.kbId, citation.docId])
  useEffect(() => {
    if (download !== 'done' && download !== 'failed') return
    const timer = window.setTimeout(() => setDownload('idle'), 4000)
    return () => window.clearTimeout(timer)
  }, [download])
  const downloadSource = async (): Promise<void> => {
    if (download === 'busy') return
    setDownload('busy')
    const res = await kbFile(citation.kbId, citation.docId)
    if (!res.ok) {
      setDownload('failed')
      return
    }
    if (res.url) {
      // web/dsh form: same-origin navigation download (no CORS applies)
      const a = document.createElement('a')
      a.href = res.url
      a.download = citation.docName
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
    // desktop form: main already saved into Downloads and revealed it
    setDownload('done')
  }
  return (
    <div className="kb-preview-backdrop" onClick={onClose}>
      <div className="kb-preview" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="kb-preview-head">
          <span>{strings.kbCiteTitle.replace('{n}', String(citation.n))}</span>
          <button type="button" className="kb-preview-close" onClick={onClose}>
            {strings.kbPreviewClose}
          </button>
        </div>
        <div className="kb-preview-meta">
          {strings.kbPreviewSource.split('{name}')[0]}
          <button
            type="button"
            className="kb-preview-file"
            title={strings.kbPreviewDownload}
            disabled={download === 'busy'}
            onClick={() => void downloadSource()}
          >
            {citation.docName}
          </button>
          {strings.kbPreviewSource.split('{name}')[1]}
          {citation.headingPath ? ` › ${citation.headingPath}` : ''}
          {docStatus ? ` · ${docStatus}` : ''}
          {download === 'busy' ? ` · ${strings.kbPreviewDownloading}` : ''}
          {download === 'done' ? ` · ${strings.kbPreviewDownloaded}` : ''}
          {download === 'failed' ? ` · ${strings.kbPreviewDownloadFailed}` : ''}
        </div>
        <div className="kb-preview-body">{citation.text}</div>
      </div>
    </div>
  )
}
