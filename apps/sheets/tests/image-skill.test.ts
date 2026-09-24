import { afterEach, describe, expect, it, vi } from 'vitest'

import { createImageSkill } from '../src/renderer/ai/image-skill'

function stubDesktopApi(api: Record<string, unknown>): void {
  vi.stubGlobal('window', { desktopApi: api })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function call(name: string, input: Record<string, unknown>) {
  return { id: 'call-1', name, input }
}

describe('image skill: image_search', () => {
  it('rejects an empty query', async () => {
    stubDesktopApi({})
    const result = await createImageSkill().executeTool(call('image_search', {}))
    expect(result.isError).toBe(true)
  })

  it('surfaces backend failures as errors, not empty galleries', async () => {
    stubDesktopApi({
      imageSearch: vi.fn().mockResolvedValue({ images: [], method: 'error', error: 'quota' }),
    })
    const result = await createImageSkill().executeTool(call('image_search', { query: 'cat' }))
    expect(result.isError).toBe(true)
    expect(result.output).toContain('quota')
    expect(result.output).toContain('not an empty result')
  })

  it('lists numbered direct URLs with pixel sizes', async () => {
    const imageSearch = vi.fn().mockResolvedValue({
      method: 'serper',
      images: [
        {
          title: 'Golden retriever',
          imageUrl: 'https://img.example.com/dog.jpg',
          sourceUrl: 'https://example.com',
          source: 'example',
          width: 800,
          height: 600,
        },
      ],
    })
    stubDesktopApi({ imageSearch })
    const result = await createImageSkill().executeTool(
      call('image_search', { query: 'dog', maxResults: 3 }),
    )
    expect(imageSearch).toHaveBeenCalledWith('dog', 3)
    expect(result.isError).toBeUndefined()
    expect(result.output).toContain('1. Golden retriever [800x600]')
    expect(result.output).toContain('https://img.example.com/dog.jpg')
  })
})

describe('image skill: generate_image', () => {
  it('rejects an empty prompt', async () => {
    stubDesktopApi({})
    const result = await createImageSkill().executeTool(call('generate_image', {}))
    expect(result.isError).toBe(true)
  })

  it('propagates generation errors (e.g. not logged in)', async () => {
    stubDesktopApi({
      generateImage: vi.fn().mockResolvedValue({ error: 'ChatOffice account is not logged in' }),
    })
    const result = await createImageSkill().executeTool(
      call('generate_image', { prompt: 'a chart mascot' }),
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain('not logged in')
  })

  it('returns the generated URL with insertion guidance', async () => {
    const generateImage = vi.fn().mockResolvedValue({ url: 'https://cdn.example.com/gen/1.png' })
    stubDesktopApi({ generateImage })
    const result = await createImageSkill().executeTool(
      call('generate_image', { prompt: 'minimal logo', aspectRatio: '1:1' }),
    )
    expect(generateImage).toHaveBeenCalledWith({ prompt: 'minimal logo', aspectRatio: '1:1' })
    expect(result.isError).toBeUndefined()
    expect(result.output).toContain('https://cdn.example.com/gen/1.png')
    expect(result.output).toContain('add_image')
  })

  it('generation fails → falls back to a matching web image (image-source-plan #9)', async () => {
    const imageSearch = vi.fn().mockResolvedValue({
      method: 'serper',
      images: [{ title: 'logo', imageUrl: 'https://img.example.com/logo.png', width: 64, height: 64 }],
    })
    stubDesktopApi({
      generateImage: vi.fn().mockResolvedValue({ error: 'ChatOffice account is not logged in' }),
      imageSearch,
    })
    const result = await createImageSkill().executeTool(
      call('generate_image', { prompt: 'minimal logo' }),
    )
    expect(imageSearch).toHaveBeenCalledWith('minimal logo', 5)
    expect(result.isError).toBeUndefined()
    expect(result.output).toContain('web image was used instead')
    expect(result.output).toContain('https://img.example.com/logo.png')
    expect(result.output).toContain('add_image')
  })

  it('generation fails and no web image matches → the error points at generate_svg', async () => {
    stubDesktopApi({
      generateImage: vi.fn().mockResolvedValue({ error: 'quota exceeded' }),
      imageSearch: vi.fn().mockResolvedValue({ method: 'serper', images: [] }),
    })
    const result = await createImageSkill().executeTool(
      call('generate_image', { prompt: 'minimal logo' }),
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain('no web image matched')
    expect(result.output).toContain('generate_svg')
  })

  it("default source 'svg' skips the web tier entirely (never a silent source switch)", async () => {
    const imageSearch = vi.fn()
    stubDesktopApi({
      generateImage: vi.fn().mockResolvedValue({ error: 'quota exceeded' }),
      imageSearch,
    })
    const result = await createImageSkill(() => true, () => 'svg').executeTool(
      call('generate_image', { prompt: 'minimal logo' }),
    )
    expect(imageSearch).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.output).not.toContain('no web image matched')
    expect(result.output).toContain('generate_svg')
  })
})

describe('image skill: global default source directive', () => {
  it('an explicit default steers the system prompt; auto/local stay neutral', () => {
    const auto = createImageSkill(() => true, () => 'auto').systemPrompt
    const local = createImageSkill(() => true, () => 'local').systemPrompt
    expect(auto).not.toContain('Image source preference')
    expect(local).not.toContain('Image source preference')

    const svg = createImageSkill(() => true, () => 'svg').systemPrompt
    expect(svg).toContain('generate_svg first')
    const web = createImageSkill(() => true, () => 'web').systemPrompt
    expect(web).toContain('image_search first')
    const model = createImageSkill(() => true, () => 'model').systemPrompt
    expect(model).toContain('generate_image first')
  })

  it('the directive applies without the cloud tools too (no-login tier keeps the steering)', () => {
    const svg = createImageSkill(() => false, () => 'svg').systemPrompt
    expect(svg).toContain('generate_svg first')
    expect(svg).not.toContain('generate_image creates')
  })
})

describe('image skill: unknown tool', () => {
  it('fails closed', async () => {
    stubDesktopApi({})
    const result = await createImageSkill().executeTool(call('delete_everything', {}))
    expect(result.isError).toBe(true)
  })
})
