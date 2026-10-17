import React, { useEffect, useRef, useState } from 'react'

/**
 * Per-message actions for every AI chat surface (home conversation + the six
 * editors' AI panels): copy the raw text, download it as a .md file. Pure and
 * self-contained — inline styles only, so each host renders it without CSS
 * wiring; clipboard falls back to a hidden textarea for non-secure contexts.
 */
export function MessageActions({
  text,
  fileNameStem,
  labels,
}: {
  /** raw message text (markdown as authored) */
  text: string
  /** download file name without extension; default 'message' */
  fileNameStem?: string
  labels?: { copy?: string; copied?: string; download?: string }
}): React.JSX.Element | null {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  if (!text.trim()) return null
  const t = {
    copy: labels?.copy ?? '复制',
    copied: labels?.copied ?? '已复制',
    download: labels?.download ?? '下载',
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }
  const download = () => {
    const safe = (fileNameStem ?? 'message')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 60) || 'message'
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safe}-${new Date().toISOString().slice(0, 10)}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }
  const btn: React.CSSProperties = {
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    opacity: 0.55,
    cursor: 'pointer',
    font: '11px/1.6 inherit',
    padding: '2px 6px',
    borderRadius: 4,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  }
  return (
    <span
      className="msg-actions"
      style={{ display: 'inline-flex', gap: 2, marginLeft: 6, verticalAlign: 'middle' }}
      onMouseEnter={(e) => {
        ;(e.currentTarget.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).forEach(
          (b) => (b.style.opacity = '0.9'),
        )
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).forEach(
          (b) => (b.style.opacity = '0.55'),
        )
      }}
    >
      <button type="button" style={btn} onClick={copy} title={t.copy} aria-label={t.copy}>
        {copied ? `✓ ${t.copied}` : `⧉ ${t.copy}`}
      </button>
      <button type="button" style={btn} onClick={download} title={t.download} aria-label={t.download}>
        ↓ {t.download}
      </button>
    </span>
  )
}
