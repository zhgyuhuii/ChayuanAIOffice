import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { executeTool } from '../src/renderer/ai/tools'

// jsdom has no image pipeline: stub the rasterizer the generate_svg tier uses
vi.mock('@chatoffice/pptx-render/svg-raster', () => ({ rasterizeSvg: vi.fn() }))
import { rasterizeSvg } from '@chatoffice/pptx-render/svg-raster'

const mockedRaster = vi.mocked(rasterizeSvg)

const editors = new Set<Editor>()
afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors.clear()
  vi.clearAllMocks()
})

function createEditor(): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'docParagraph',
          attrs: { docxIndex: null },
          content: [{ type: 'text', text: 'x' }],
        },
      ],
    },
  })
  editors.add(editor)
  return editor
}

const NUM_IDS = { bullet: null, ordered: null }

type DesktopStub = { desktop?: unknown }

/** run one imagery tool call with a stubbed desktop bridge */
async function runWithDesktop(
  desktop: Record<string, unknown>,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  opts?: { tool?: string; getImageSource?: () => 'auto' | 'web' | 'model' | 'local' | 'svg' },
) {
  const editor = createEditor()
  const w = window as unknown as DesktopStub
  const saved = w.desktop
  w.desktop = desktop
  try {
    return {
      exec: await executeTool(
        editor,
        { id: 't', name: opts?.tool ?? 'generate_image', input },
        NUM_IDS,
        undefined,
        signal,
        undefined,
        undefined,
        undefined,
        opts?.getImageSource,
      ),
      editor,
    }
  } finally {
    w.desktop = saved
  }
}

describe('generate_image', () => {
  it('rejects an empty prompt without calling the channel', async () => {
    let called = false
    const { exec } = await runWithDesktop(
      {
        aiGenerateImage: () => {
          called = true
          return Promise.resolve({ url: 'https://example.com/a.png' })
        },
      },
      { prompt: '   ' },
    )
    expect(exec.isError).toBe(true)
    expect(called).toBe(false)
  })

  it('surfaces the channel error (not logged in / cloud tools off / generation failure)', async () => {
    const { exec, editor } = await runWithDesktop(
      {
        aiGenerateImage: () => Promise.resolve({ error: 'ChatOffice account is not logged in' }),
        // no-url generation falls back to web search; empty results keep the channel error path
        imageSearch: () => Promise.resolve({ method: 'web', images: [] }),
      },
      { prompt: 'a watercolor fox' },
    )
    expect(exec.isError).toBe(true)
    expect(exec.output).toContain('not logged in')
    expect(editor.state.doc.childCount).toBe(1) // nothing inserted
  })

  it('an abort after generation never writes into the document', async () => {
    const ctrl = new AbortController()
    const { exec, editor } = await runWithDesktop(
      {
        aiGenerateImage: () => {
          ctrl.abort()
          return Promise.resolve({ url: 'https://example.com/a.png' })
        },
        fetchImage: () => Promise.resolve({ base64: 'AAAA', mime: 'image/png' }),
      },
      { prompt: 'a watercolor fox' },
      ctrl.signal,
    )
    expect(exec.isError).toBe(true)
    expect(exec.output).toContain('stopped by the user')
    expect(editor.state.doc.childCount).toBe(1)
  })

  it('passes the prompt and aspect ratio through to the channel', async () => {
    let received: unknown = null
    await runWithDesktop(
      {
        aiGenerateImage: (op: unknown) => {
          received = op
          return Promise.resolve({ error: 'stop here' }) // fail before the jsdom-unfriendly decode
        },
        imageSearch: () => Promise.resolve({ method: 'web', images: [] }),
      },
      { prompt: 'a watercolor fox', aspectRatio: '16:9' },
    )
    expect(received).toEqual({ prompt: 'a watercolor fox', aspectRatio: '16:9' })
  })
})

describe('generate_image no-login web fallback (image-source-plan #9)', () => {
  const CHANNEL_DOWN = {
    aiGenerateImage: () => Promise.resolve({ error: 'ChatOffice account is not logged in' }),
  }

  it('generation fails → a matching web image is picked and downloaded instead', async () => {
    const fetchImage = vi.fn().mockResolvedValue(null) // download fails at fetch: proves the pick without the jsdom-hostile decode
    const { exec } = await runWithDesktop(
      {
        ...CHANNEL_DOWN,
        imageSearch: () =>
          Promise.resolve({
            method: 'serper',
            images: [
              { title: 'fox', imageUrl: 'https://img.example.com/fox.jpg', width: 800, height: 600 },
            ],
          }),
        fetchImage,
      },
      { prompt: 'a watercolor fox' },
    )
    expect(fetchImage).toHaveBeenCalledWith('https://img.example.com/fox.jpg')
    expect(exec.isError).toBe(true)
    expect(exec.output).toContain('download failed')
  })

  it('generation fails and no web image matches → the error hands the slot to generate_svg', async () => {
    const imageSearch = vi.fn().mockResolvedValue({ method: 'serper', images: [] })
    const { exec } = await runWithDesktop(
      { ...CHANNEL_DOWN, imageSearch },
      { prompt: 'a watercolor fox' },
    )
    expect(imageSearch).toHaveBeenCalledWith('a watercolor fox', 5)
    expect(exec.isError).toBe(true)
    expect(exec.output).toContain('no web image matched')
    expect(exec.output).toContain('generate_svg')
  })

  it("default source 'svg' skips the web tier entirely (never a silent source switch)", async () => {
    const imageSearch = vi.fn()
    const { exec } = await runWithDesktop(
      { ...CHANNEL_DOWN, imageSearch },
      { prompt: 'a watercolor fox' },
      undefined,
      { getImageSource: () => 'svg' },
    )
    expect(imageSearch).not.toHaveBeenCalled()
    expect(exec.isError).toBe(true)
    expect(exec.output).not.toContain('no web image matched')
    expect(exec.output).toContain('generate_svg')
  })
})

describe('generate_svg (offline vector tier)', () => {
  const GOOD_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#f00"/></svg>'

  it('rejects non-SVG markup before rasterizing', async () => {
    const { exec } = await runWithDesktop({}, { svg: '<div>x</div>' }, undefined, {
      tool: 'generate_svg',
    })
    expect(exec.isError).toBe(true)
    expect(mockedRaster).not.toHaveBeenCalled()
  })

  it('reports a blank render as an error (the model retries with better markup)', async () => {
    mockedRaster.mockResolvedValue({ ok: true, base64: 'QUJD', width: 10, height: 10, paintRatio: 0 })
    const { exec } = await runWithDesktop({}, { svg: GOOD_SVG }, undefined, {
      tool: 'generate_svg',
    })
    expect(exec.isError).toBe(true)
    expect(exec.output).toContain('blank')
  })

  it('surfaces render-check failures as errors', async () => {
    mockedRaster.mockRejectedValue(new Error('SVG failed to decode'))
    const { exec } = await runWithDesktop({}, { svg: GOOD_SVG }, undefined, {
      tool: 'generate_svg',
    })
    expect(exec.isError).toBe(true)
    expect(exec.output).toContain('SVG failed to decode')
  })
})
