/**
 * Read-only virtual-window view for giant documents.
 *
 * A giant session's document.xml can never become a JS string, so the main
 * process parses window-local slices through the ordinary production parser
 * (docs:giant-window). This view mounts ONE read-only editor and swaps its
 * content per window; scroll geometry comes from a per-block height table
 * (estimated up front, measured once a window has rendered) so a half-million
 * block document scrolls over a virtual, not a materialized, DOM.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { GiantOpenResult, GiantWindowResult } from '../../shared/ipc'
import { editorExtensions } from '../editor/extensions'
import { blocksToPmDoc, pmDocOptions } from '../editor/convert'
import type { Block } from '@chaoffice/docx-engine'

const WINDOW_BLOCKS = 150
/** reload when the visible block drifts within this many blocks of an edge */
const EDGE_BLOCKS = 40
/** rough height of an unmeasured block: a plain paragraph line plus spacing */
const ESTIMATED_BLOCK_PX = 30

export interface GiantDocViewProps {
  open: GiantOpenResult
  onClose: () => void
  labels: GiantDocLabels
}

export interface GiantDocLabels {
  readonlyBadge: string
  closeLabel: string
  blocksLabel: (count: number) => string
}

export function GiantDocView({ open, onClose, labels }: GiantDocViewProps): ReactElement {
  const { blockCount } = open.meta
  const [win, setWin] = useState<GiantWindowResult | null>(null)
  const [loading, setLoading] = useState(true)
  /** cumulative heights: heights[i] = px of blocks [0, i); length blockCount+1 */
  const cumRef = useRef<Float64Array | null>(null)
  const firstRef = useRef(0)
  const fetchSeqRef = useRef(0)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const suppressScrollRef = useRef(false)

  const editor = useEditor(
    {
      extensions: editorExtensions,
      editable: false,
      content: { type: 'doc', content: [] },
      editorProps: {
        attributes: { 'data-giant-doc': 'true', class: 'giant-doc-editor' },
      },
    },
    [],
  )

  const ensureCum = useCallback((): Float64Array => {
    let cum = cumRef.current
    if (!cum || cum.length !== blockCount + 1) {
      // rebuild: measured windows keep their heights (none the first time)
      cum = new Float64Array(blockCount + 1)
      for (let i = 0; i < blockCount; i++) cum[i + 1] = cum[i] + ESTIMATED_BLOCK_PX
      cumRef.current = cum
    }
    return cum
  }, [blockCount])

  const fetchWindow = useCallback(
    async (first: number): Promise<void> => {
      const seq = ++fetchSeqRef.current
      const clamped = Math.max(0, Math.min(first, Math.max(0, blockCount - 1)))
      setLoading(true)
      try {
        const result = await window.desktop.giantWindow(
          open.giantId,
          clamped,
          WINDOW_BLOCKS,
        )
        if (seq !== fetchSeqRef.current || !result) return
        firstRef.current = result.first
        setWin(result)
      } finally {
        if (seq === fetchSeqRef.current) setLoading(false)
      }
    },
    [blockCount, open.giantId],
  )

  // initial window
  useEffect(() => {
    void fetchWindow(0)
  }, [fetchWindow])

  // swap the editor content when a window lands, then measure real heights
  useEffect(() => {
    if (!editor || !win) return
    const options = pmDocOptions({
      docDefaults: win.docDefaults ?? undefined,
      compatibilityMode: win.compatibilityMode,
    })
    const doc = blocksToPmDoc(win.blocks as Block[], undefined, options)
    // window swaps are not edits: keep them out of any history machinery
    editor
      .chain()
      .setMeta('addToHistory', false)
      .setContent(doc as never, { emitUpdate: false })
      .run()
    const first = win.first
    const request = requestAnimationFrame(() => {
      if (editor.isDestroyed) return
      const dom = editor.view.dom as HTMLElement
      const cum = ensureCum()
      let changed = false
      const children = dom.children
      for (let i = 0; i < win.count && i < children.length; i++) {
        const h = (children[i] as HTMLElement).offsetHeight
        if (h > 0 && cum[first + i + 1] - cum[first + i] !== h) {
          cum[first + i + 1] = cum[first + i] + h
          changed = true
        }
      }
      if (changed) {
        // re-close the gaps to the right of the measured window
        for (let i = first + win.count; i < blockCount; i++) cum[i + 1] = cum[i] + ESTIMATED_BLOCK_PX
        setHeightTick((n) => n + 1)
      }
    })
    return () => cancelAnimationFrame(request)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, win, blockCount, ensureCum])

  const [heightTick, setHeightTick] = useState(0)
  void heightTick // referenced by the scroll-geometry memos below

  const onScroll = useCallback(() => {
    if (suppressScrollRef.current) return
    const scroller = scrollerRef.current
    if (!scroller) return
    const cum = cumRef.current
    if (!cum) return
    const top = scroller.scrollTop
    // binary search: greatest i with cum[i] <= top
    let lo = 0
    let hi = cum.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (cum[mid]! <= top) lo = mid
      else hi = mid - 1
    }
    const visible = lo
    const first = firstRef.current
    if (visible < first + EDGE_BLOCKS && visible > first - EDGE_BLOCKS) return
    if (visible >= first && visible < first + WINDOW_BLOCKS - EDGE_BLOCKS) return
    const next = Math.max(0, visible - Math.floor(WINDOW_BLOCKS / 3))
    void fetchWindow(next)
  }, [fetchWindow])

  const totalPx = cumRef.current ? cumRef.current[blockCount]! : blockCount * ESTIMATED_BLOCK_PX
  const { topPx, bottomPx } = useMemo(() => {
    const cum = cumRef.current
    if (!cum || !win) return { topPx: 0, bottomPx: Math.max(0, totalPx) }
    const top = cum[win.first]!
    const windowPx = Math.max(0, cum[Math.min(win.first + win.count, cum.length - 1)]! - top)
    return { topPx: top, bottomPx: Math.max(0, totalPx - top - windowPx) }
    // heightTick re-runs this memo when the measured table changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win, totalPx, heightTick])

  const close = useCallback(() => {
    window.desktop.giantClose(open.giantId)
    onClose()
  }, [onClose, open.giantId])

  // Esc leaves the giant view, mirroring the editor's Focus escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div className="giant-doc-view" data-file-name={open.name}>
      <div className="giant-doc-bar">
        <span className="giant-doc-name" title={open.path}>
          {open.name}
        </span>
        <span className="giant-doc-badges">
          <span className="giant-doc-badge">{labels.readonlyBadge}</span>
          <span className="giant-doc-badge">{labels.blocksLabel(blockCount)}</span>
          {loading ? <span className="giant-doc-badge giant-doc-loading">⋯</span> : null}
        </span>
        <button type="button" className="giant-doc-close" onClick={close}>
          {labels.closeLabel}
        </button>
      </div>
      <div className="giant-doc-scroller" ref={scrollerRef} onScroll={onScroll}>
        <div style={{ height: topPx }} aria-hidden />
        <div className="giant-doc-page">
          <EditorContent editor={editor} />
        </div>
        <div style={{ height: bottomPx }} aria-hidden />
      </div>
    </div>
  )
}
