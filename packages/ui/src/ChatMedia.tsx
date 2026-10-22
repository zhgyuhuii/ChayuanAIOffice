import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Inline media result card for AI chat surfaces (Doubao/DeepSeek-style): the
 * generated image / video / audio renders directly in the conversation and a
 * hover download button saves it (另存为). Double-click zooms images and
 * videos into a full-screen lightbox (click-away / Esc closes; the enlarged
 * video keeps its controls). Works with data:, blob:, http(s) and desktop
 * file: sources — anything fetchable goes through a Blob anchor; file://
 * falls back to a direct download anchor (Electron save dialog).
 */
export interface ChatMediaPayload {
  kind: 'image' | 'video' | 'audio'
  url: string
  name?: string
}

async function saveMedia(src: string, name: string): Promise<void> {
  const a = document.createElement('a')
  if (src.startsWith('file:')) {
    a.href = src
    a.download = name
  } else {
    const resp = await fetch(src)
    const blob = await resp.blob()
    a.href = URL.createObjectURL(blob)
    a.download = name
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function ChatMedia({ media, lang }: { media: ChatMediaPayload; lang?: string }): React.JSX.Element {
  const [saved, setSaved] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const zh = !(lang ?? 'zh').startsWith('en')
  useEffect(() => {
    if (!zoomed) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setZoomed(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomed])
  const ext =
    media.kind === 'image'
      ? /data:image\/(png|jpeg|jpg|webp|gif)/.exec(media.url)?.[1]?.replace('jpeg', 'jpg') ?? 'png'
      : media.kind === 'video'
        ? 'mp4'
        : /data:audio\/(wav|mpeg|mp3|ogg)/.exec(media.url)?.[1] ?? 'audio'
  const name = media.name ?? `${media.kind}-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '')}.${ext}`
  const download = async () => {
    try {
      await saveMedia(media.url, name)
      setSaved(true)
      setTimeout(() => setSaved(false), 1600)
    } catch {
      /* transient fetch failure: the anchor path already ran */
    }
  }
  const zoomable = media.kind === 'image' || media.kind === 'video'
  const btn: React.CSSProperties = {
    position: 'absolute',
    top: 8,
    right: 8,
    border: 'none',
    borderRadius: 6,
    background: 'rgba(20,20,20,0.62)',
    color: '#fff',
    font: '11px/1 system-ui, sans-serif',
    padding: '5px 9px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    opacity: 0,
    transition: 'opacity .12s',
    backdropFilter: 'blur(3px)',
  }
  return (
    <span
      className="chat-media"
      style={{ position: 'relative', display: 'inline-block', maxWidth: 380, marginTop: 6 }}
      onMouseEnter={(e) => {
        const b = e.currentTarget.querySelector<HTMLButtonElement>('button')
        if (b) b.style.opacity = '1'
      }}
      onMouseLeave={(e) => {
        const b = e.currentTarget.querySelector<HTMLButtonElement>('button')
        if (b) b.style.opacity = '0'
      }}
    >
      {media.kind === 'image' && (
        <img
          src={media.url}
          alt={name}
          style={{ maxWidth: 380, maxHeight: 380, borderRadius: 8, display: 'block', cursor: zoomable ? 'zoom-in' : 'default' }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (zoomable) setZoomed(true)
          }}
        />
      )}
      {media.kind === 'video' && (
        <video
          src={media.url}
          controls
          preload="metadata"
          style={{ maxWidth: 380, maxHeight: 380, borderRadius: 8, display: 'block', background: '#000', cursor: 'zoom-in' }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            setZoomed(true)
          }}
        />
      )}
      {media.kind === 'audio' && <audio src={media.url} controls style={{ maxWidth: 330, display: 'block' }} />}
      <button type="button" style={btn} onClick={download} title={zh ? '另存为' : 'Save as'}>
        {saved ? (zh ? '✓ 已保存' : '✓ Saved') : `⤓ ${zh ? '另存为' : 'Save'}`}
      </button>
      {zoomed &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(10,10,12,0.88)',
              display: 'grid',
              placeItems: 'center',
              zIndex: 2147483000,
              cursor: 'zoom-out',
            }}
            onClick={() => setZoomed(false)}
          >
            {media.kind === 'image' ? (
              <img
                src={media.url}
                alt={name}
                style={{ maxWidth: '94vw', maxHeight: '94vh', borderRadius: 10, boxShadow: '0 18px 60px rgba(0,0,0,0.55)' }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <video
                src={media.url}
                controls
                autoPlay
                style={{ maxWidth: '94vw', maxHeight: '94vh', borderRadius: 10, boxShadow: '0 18px 60px rgba(0,0,0,0.55)', background: '#000' }}
                onClick={(e) => e.stopPropagation()}
              />
            )}
            <span
              style={{
                position: 'fixed',
                top: 18,
                right: 22,
                color: 'rgba(255,255,255,0.85)',
                font: '13px/1 system-ui, sans-serif',
                pointerEvents: 'none',
              }}
            >
              {zh ? '双击打开 · 点击空白或 Esc 关闭' : 'Double-click opened · click-away or Esc closes'}
            </span>
          </div>,
          document.body,
        )}
    </span>
  )
}
