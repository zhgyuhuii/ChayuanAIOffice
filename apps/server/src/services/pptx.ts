/**
 * pptx service (batch 4): the SAME pure pipeline the Electron main runs —
 * pptx-engine open/save plus the shared render-build module extracted from
 * apps/slides (single-source, plan v2.2). Sessions keep the OpenedPptx model
 * server-side so `save` serializes the current deck; renderer edit channels
 * arrive with the session-sync batch.
 */

import { randomUUID } from 'node:crypto'
import { openPptx, savePptx, createBlankPptx, type OpenedPptx } from '@chaoffice/pptx-engine'
import { runTxn, type TxnRequest, type TxnResult } from '@chaoffice/pptx-ops'
import {
  buildAllRenderSlides,
  buildOneRenderSlide,
  deckDefaultFont,
} from '../../../slides/src/main/render-build'

export interface PptxApi {
  openBytes(input: { base64: string; name: string; fitWidthPx?: number }): Promise<{
    sessionId: string
    path: string
    slides: unknown[]
    size: { cx: number; cy: number }
    defaultFont?: string
  }>
  /** New blank deck (same pipeline as the Electron 'slides:new-blank'). */
  newBlank(input: { fitWidthPx?: number }): Promise<{
    sessionId: string
    slides: unknown[]
    size: { cx: number; cy: number }
    defaultFont?: string
  }>
  /** Serialize the session's current model to pptx bytes. */
  saveBytes(sessionId: string): Promise<{ base64: string }>
  /** Run one editor verb (a pptx-ops transaction) against the session model,
   *  returning the rebuilt slide for the renderer's applySlide. The web twin
   *  of the Electron slides-main edit handlers (addTable/addPicture/…). */
  command(input: {
    sessionId: string
    ops: TxnRequest['ops']
    fitWidthPx?: number
  }): Promise<{
    ok: boolean
    failures?: TxnResult['failures']
    slide: unknown
    slideIndex: number
    sourceIds: (string | number)[]
    size: { cx: number; cy: number }
  }>
  close(sessionId: string): Promise<void>
  status(): { openSessions: number }
}

interface Session {
  name: string
  opened: OpenedPptx
  fitWidthPx: number
}

export function createPptxService(): PptxApi {
  const sessions = new Map<string, Session>()
  return {
    async openBytes(input) {
      const bytes = Buffer.from(input.base64, 'base64')
      if (bytes.byteLength === 0) throw new Error('empty pptx bytes')
      const fitWidthPx = input.fitWidthPx ?? 960
      const opened = await openPptx(new Uint8Array(bytes))
      const sessionId = randomUUID()
      sessions.set(sessionId, { name: input.name, opened, fitWidthPx })
      return {
        sessionId,
        path: `webfs-session:${sessionId}:${input.name}`,
        slides: buildAllRenderSlides(opened, fitWidthPx),
        size: { cx: opened.deck.size.cx, cy: opened.deck.size.cy },
        defaultFont: deckDefaultFont(opened),
      }
    },
    async newBlank(input) {
      const fitWidthPx = input?.fitWidthPx ?? 960
      const opened = await openPptx(await createBlankPptx())
      const sessionId = randomUUID()
      sessions.set(sessionId, { name: '', opened, fitWidthPx })
      return {
        sessionId,
        slides: buildAllRenderSlides(opened, fitWidthPx),
        size: { cx: opened.deck.size.cx, cy: opened.deck.size.cy },
        defaultFont: deckDefaultFont(opened),
      }
    },
    async command(input) {
      const session = sessions.get(input.sessionId)
      if (!session) throw new Error(`unknown pptx session: ${input.sessionId}`)
      if (input.fitWidthPx && input.fitWidthPx > 0) session.fitWidthPx = input.fitWidthPx
      const r = runTxn(session.opened, { ops: input.ops })
      if (!r.applied || !r.records?.length) {
        return {
          ok: false,
          failures: r.failures,
          slide: null,
          slideIndex: -1,
          sourceIds: [],
          size: { cx: session.opened.deck.size.cx, cy: session.opened.deck.size.cy },
        }
      }
      const slideIndex = (input.ops[0]?.target as { slide?: number } | undefined)?.slide ?? 0
      const slide = buildOneRenderSlide(session.opened, slideIndex, session.fitWidthPx)
      const sourceIds = r.records.flatMap((rec) => rec.created ?? [])
      return {
        ok: true,
        slide,
        slideIndex,
        sourceIds,
        size: { cx: session.opened.deck.size.cx, cy: session.opened.deck.size.cy },
      }
    },
    async saveBytes(sessionId) {
      const session = sessions.get(sessionId)
      if (!session) throw new Error(`unknown pptx session: ${sessionId}`)
      const out = await savePptx(session.opened)
      return { base64: Buffer.from(out).toString('base64') }
    },
    async close(sessionId) {
      sessions.delete(sessionId)
    },
    status() {
      return { openSessions: sessions.size }
    },
  }
}
