/**
 * pptx service (batch 4): the SAME pure pipeline the Electron main runs —
 * pptx-engine open/save plus the shared render-build module extracted from
 * apps/slides (single-source, plan v2.2). Sessions keep the OpenedPptx model
 * server-side so `save` serializes the current deck; renderer edit channels
 * arrive with the session-sync batch.
 */

import { randomUUID } from 'node:crypto'
import { openPptx, savePptx, createBlankPptx, type OpenedPptx } from '@chatoffice/pptx-engine'
import { buildAllRenderSlides, deckDefaultFont } from '../../../slides/src/main/render-build'

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
