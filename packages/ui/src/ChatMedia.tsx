import React, { useState } from 'react'

/**
 * Inline media result card for AI chat surfaces (Doubao/DeepSeek-style): the
 * generated image / video / audio renders directly in the conversation and a
 * hover download button saves it (另存为). Works with data:, blob:, http(s)
 * and desktop file: sources — anything fetchable goes through a Blob anchor;
 * file:// falls back to a direct download anchor (Electron save dialog).
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
  const zh = !(lang ?? 'zh').startsWith('en')
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
        // eslint-disable-next-line @next/next/no-img-element -- data-url chat media
        <img
          src={media.url}
          alt={name}
          style={{ maxWidth: 380, maxHeight: 380, borderRadius: 8, display: 'block' }}
        />
      )}
      {media.kind === 'video' && (
        <video
          src={media.url}
          controls
          preload="metadata"
          style={{ maxWidth: 380, maxHeight: 380, borderRadius: 8, display: 'block', background: '#000' }}
        />
      )}
      {media.kind === 'audio' && <audio src={media.url} controls style={{ maxWidth: 330, display: 'block' }} />}
      <button type="button" style={btn} onClick={download} title={zh ? '另存为' : 'Save as'}>
        {saved ? (zh ? '✓ 已保存' : '✓ Saved') : `⤓ ${zh ? '另存为' : 'Save'}`}
      </button>
    </span>
  )
}
