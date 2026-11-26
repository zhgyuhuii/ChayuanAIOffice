// Embedded audio/video used to travel as one base64 data URL across the
// slides:media-data IPC boundary (a 200 MB movie became a ~270 MB string in
// both processes). These tests pin the replacement: the IPC resolves to a
// chaoffice-slide-media://av/ URL, and the protocol handler serves the bytes
// with HTTP Range semantics (206/416) so <video>/<audio> can stream and seek.
import { tmpdir } from 'node:os'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: never[]) => unknown>()
type ProtocolRequest = { url: string; headers: Headers }
let protocolHandler: ((request: ProtocolRequest) => Response) | null = null

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getName: () => 'slides-test',
    getVersion: () => '0',
    whenReady: () => Promise.resolve(),
  },
  dialog: {},
  clipboard: { writeBuffer: () => {} },
  ipcMain: {
    handle: (channel: string, fn: (...args: never[]) => unknown) => handlers.set(channel, fn),
    on: () => {},
    removeHandler: () => {},
  },
  BrowserWindow: class {},
  webContents: {
    getAllWebContents: () => [],
    fromId: () => ({ send: () => {} }),
  },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  session: {
    defaultSession: {
      protocol: { handle: (_s: string, h: (request: ProtocolRequest) => Response) => void (protocolHandler = h) },
      setDisplayMediaRequestHandler: () => {},
    },
  },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true, toDataURL: () => '' }) },
  shell: {},
  desktopCapturer: { getSources: async () => [] },
  WebContentsView: class {},
}))
// The shaping chain loads a harfbuzz wasm that cannot resolve in the unit-test env.
vi.mock('../src/main/shaped-metrics', () => ({
  shapedMetricsReady: async () => {},
  refineComplexWidths: async () => {},
  complexScriptOf: () => null,
  initShapedMetrics: () => {},
  gtMeasure: (t: string) => ({ width: t.length * 8 }),
  shapedFamily: () => null,
  shapedMeasure: () => ({ width: 0 }),
}))

import { createBlankPptx, openPptx } from '@chaoffice/pptx-engine'
import { registerSlidesIpc } from '../src/main/slides-main'
import {
  makeAvMediaUrl,
  makeMediaResolver,
  readSlideMedia,
  sessions,
  type Session,
} from '../src/main/session-state'

const WC = 1
let session: Session
function call(channel: string, ...args: unknown[]): any {
  return (handlers.get(channel) as (...args: unknown[]) => unknown)(
    { sender: { id: WC } },
    ...args,
  )
}

/** Minimal ISO-BMFF header ('....ftypisom') plus padding: sniffs as video/mp4. */
function mp4Bytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  bytes.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0)
  return bytes
}

async function addVideo(bytes: Uint8Array): Promise<{ sourceId: string }> {
  const r = await call('slides:add-media-bytes', {
    slideIndex: 0,
    kind: 'video',
    ext: 'mp4',
    fitWidthPx: 1280,
    base64: Buffer.from(bytes).toString('base64'),
    natural: { width: 640, height: 360 },
  })
  expect(r).toBeTruthy()
  return { sourceId: r.sourceId as string }
}

const request = (url: string, range?: string) => ({
  url,
  headers: new Headers(range ? { range } : {}),
})

beforeAll(async () => {
  registerSlidesIpc()
  // The handler registers from app.whenReady().then(...)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(protocolHandler).toBeTruthy()
})
beforeEach(async () => {
  await new Promise<void>((resolve) => setImmediate(resolve))
  sessions.clear()
  session = {
    path: '',
    fitWidthPx: 1280,
    undoStack: [],
    redoStack: [],
    opened: await openPptx(await createBlankPptx()),
  }
  sessions.set(WC, session)
})

describe('slides:media-data protocol URLs', () => {
  it('resolves embedded media to a slide-media URL instead of a base64 data URL', async () => {
    const bytes = mp4Bytes(300)
    const { sourceId } = await addVideo(bytes)
    const data = call('slides:media-data', 0, sourceId)
    expect(data).toEqual({ kind: 'video', url: expect.stringMatching(/^chaoffice-slide-media:\/\/av\//) })
    expect(data.url).toContain('mime=video%2Fmp4')
    expect('dataUrl' in data).toBe(false)
    // Same bytes resolve to the same URL across calls (byteVersion keying)
    expect(call('slides:media-data', 0, sourceId).url).toBe(data.url)
    // The registration serves the raw bytes under the container mime
    const media = readSlideMedia(data.url)
    expect(media?.mime).toBe('video/mp4')
    expect(media?.body.byteLength).toBe(bytes.length)
  })

  it('hands external link media through unchanged', async () => {
    // A linked movie is stored with external: true and no archive part
    const slide = session.opened.deck.slides[0]!
    slide.elements.push({
      id: 'linked-video',
      type: 'picture',
      offset: { x: 0, y: 0, cx: 914400, cy: 914400 },
      media: { kind: 'video', target: 'https://example.test/clip.mp4', external: true },
    } as never)
    expect(call('slides:media-data', 0, 'linked-video')).toEqual({
      kind: 'video',
      url: 'https://example.test/clip.mp4',
    })
  })

  it('gives replacement bytes a new URL (undo reuses the original)', async () => {
    const { sourceId } = await addVideo(mp4Bytes(300))
    const first = call('slides:media-data', 0, sourceId).url
    // Replacing the archive part with different bytes must invalidate the URL
    const el = session.opened.deck.slides[0]!.elements.find((e) => e.id === sourceId) as {
      media: { target: string }
    }
    session.opened.archive.entries.set(el.media.target, mp4Bytes(301))
    const second = makeAvMediaUrl(session.opened, el.media.target, 'video')
    expect(second).not.toBe(first)
    expect(readSlideMedia(first)?.body.byteLength).toBe(300)
    expect(readSlideMedia(second!)?.body.byteLength).toBe(301)
  })

  it('sniffs the audio container regardless of the part extension', async () => {
    // ID3-tagged bytes stored under an .mov-named part: the sniffers decide
    const bytes = new Uint8Array(64)
    bytes.set([0x49, 0x44, 0x33, 0x04, 0x00], 0)
    session.opened.archive.entries.set('ppt/media/media1.mov', bytes)
    const url = makeAvMediaUrl(session.opened, 'ppt/media/media1.mov', 'audio')
    expect(url).toContain('mime=audio%2Fmpeg')
    expect(readSlideMedia(url!)?.mime).toBe('audio/mpeg')
  })
})

describe('slide-media protocol Range semantics', () => {
  it('serves the full body with Accept-Ranges when no Range header is present', async () => {
    const bytes = mp4Bytes(300)
    const { sourceId } = await addVideo(bytes)
    const url = call('slides:media-data', 0, sourceId).url
    const res = protocolHandler!(request(url))
    expect(res.status).toBe(200)
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-length')).toBe('300')
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
  })

  it('answers a bounded range with 206 and the requested slice', async () => {
    const bytes = mp4Bytes(300)
    const { sourceId } = await addVideo(bytes)
    const url = call('slides:media-data', 0, sourceId).url
    const res = protocolHandler!(request(url, 'bytes=10-99'))
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 10-99/300')
    expect(res.headers.get('content-length')).toBe('90')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes.subarray(10, 100))
  })

  it('answers the open-ended range media elements send on load', async () => {
    const bytes = mp4Bytes(300)
    const { sourceId } = await addVideo(bytes)
    const url = call('slides:media-data', 0, sourceId).url
    const res = protocolHandler!(request(url, 'bytes=0-'))
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 0-299/300')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
  })

  it('supports suffix ranges used for seek-to-end probes', async () => {
    const bytes = mp4Bytes(300)
    const { sourceId } = await addVideo(bytes)
    const url = call('slides:media-data', 0, sourceId).url
    const res = protocolHandler!(request(url, 'bytes=-16'))
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 284-299/300')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes.subarray(284))
  })

  it('rejects a start beyond the end of the body with 416', async () => {
    const { sourceId } = await addVideo(mp4Bytes(300))
    const url = call('slides:media-data', 0, sourceId).url
    const res = protocolHandler!(request(url, 'bytes=999999-'))
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */300')
  })

  it('falls back to a full 200 for malformed or multi-range headers', async () => {
    const bytes = mp4Bytes(300)
    const { sourceId } = await addVideo(bytes)
    const url = call('slides:media-data', 0, sourceId).url
    for (const header of ['bytes=abc', 'bytes=5-1', 'bytes=0-1,5-9', 'chunks=0-99']) {
      const res = protocolHandler!(request(url, header))
      expect(res.status, header).toBe(200)
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
    }
  })

  it('serves archive image URLs with the same Range semantics', async () => {
    // The image path (readSlideMedia conversions) shares the handler: a picture
    // URL must also range-slice, since canvases and media share the scheme
    const bytes = new Uint8Array(200)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    session.opened.archive.entries.set('ppt/media/range.png', bytes)
    const url = makeMediaResolver(session.opened, session.opened.deck.slides[0]!.path)(
      'ppt/media/range.png',
    )!
    expect(url.startsWith('chaoffice-slide-media://archive/')).toBe(true)
    const res = protocolHandler!(request(url, 'bytes=8-15'))
    expect(res.status).toBe(206)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes.subarray(8, 16))
  })

  it('keeps 404 for unknown URLs', () => {
    expect(protocolHandler!(request('chaoffice-slide-media://av/unknown')).status).toBe(404)
  })
})
