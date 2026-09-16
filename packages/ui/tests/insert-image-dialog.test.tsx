// @vitest-environment jsdom
/**
 * InsertImageDialog web-gallery interactions: a click selects exactly one
 * cell, 下一批 appends the next page (URL-dedup) while keeping the selection,
 * a fully-duplicate batch flips the gallery to 已到底, and insert falls back
 * to the hotlinkable thumbnail when the full-size download is refused.
 * Guards the WebImageItem wire-shape contract (full/thumbnail must exist).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  InsertImageDialog,
  type InsertImageBridge,
  type WebImageItem,
} from '../src/InsertImageDialog'

const item = (tag: string): WebImageItem => ({
  thumbnail: `https://img/${tag}/thumb`,
  full: `https://img/${tag}/full`,
  width: 100,
  height: 80,
  attribution: `${tag} author`,
})

const cells = (): HTMLElement[] => [...host.querySelectorAll('.insimg-cell')]
const buttonByText = (text: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === text)

/** React ignores direct value writes; go through the native setter */
function typeQuery(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

let host: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

/** mount, open the 网络图片 tab, search "cat", return the onInsert spy */
async function setup(bridge: InsertImageBridge): Promise<ReturnType<typeof vi.fn>> {
  const onInsert = vi.fn()
  await act(async () => {
    root!.render(
      createElement(InsertImageDialog, { bridge, lang: 'zh', onInsert, onClose: vi.fn() }),
    )
  })
  await act(async () => {
    buttonByText('网络图片')!.click()
  })
  const input = host.querySelector<HTMLInputElement>('.insimg-search')!
  await act(async () => {
    typeQuery(input, 'cat')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  return onInsert
}

describe('InsertImageDialog web gallery', () => {
  it('selects exactly one cell and inserts the fetched full image', async () => {
    const fetchImage = vi.fn(async (url: string) =>
      url.endsWith('/full') ? { mediaType: 'image/jpeg', base64: 'QQ==' } : null,
    )
    const bridge: InsertImageBridge = {
      searchWeb: vi.fn(async () => ({ images: [item('a'), item('b')] })),
      searchStock: vi.fn(async () => ({ images: [] })),
      fetchImage,
      getStockKeys: async () => ({ pexels: '', pixabay: '' }),
      setStockKeys: async () => {},
    }
    const onInsert = await setup(bridge)

    expect(cells()).toHaveLength(2)
    await act(async () => {
      cells()[1]!.click()
    })
    const picked = host.querySelectorAll('.insimg-cell.selected')
    expect(picked).toHaveLength(1)
    expect(picked[0]).toBe(cells()[1])

    await act(async () => {
      buttonByText('插入')!.click()
    })
    expect(fetchImage).toHaveBeenCalledWith('https://img/b/full')
    expect(onInsert).toHaveBeenCalledWith('data:image/jpeg;base64,QQ==', {
      attribution: 'b author',
    })
  })

  it('falls back to the thumbnail when the full-size download is refused', async () => {
    const fetchImage = vi.fn(async (url: string) =>
      url.endsWith('/full') ? null : { mediaType: 'image/jpeg', base64: 'QQ==' },
    )
    const bridge: InsertImageBridge = {
      searchWeb: vi.fn(async () => ({ images: [item('a')] })),
      searchStock: vi.fn(async () => ({ images: [] })),
      fetchImage,
      getStockKeys: async () => ({ pexels: '', pixabay: '' }),
      setStockKeys: async () => {},
    }
    const onInsert = await setup(bridge)

    await act(async () => {
      cells()[0]!.click()
    })
    await act(async () => {
      buttonByText('插入')!.click()
    })
    expect(fetchImage).toHaveBeenNthCalledWith(1, 'https://img/a/full')
    expect(fetchImage).toHaveBeenNthCalledWith(2, 'https://img/a/thumb')
    expect(onInsert).toHaveBeenCalledWith('data:image/jpeg;base64,QQ==', {
      attribution: 'a author',
    })
  })

  it('下一批 appends with URL-dedup, keeps the selection, and flips to 已到底 when drained', async () => {
    const searchWeb = vi.fn(
      async (_q: string, page?: number) =>
        (page ?? 1) === 1
          ? { images: [item('a'), item('b')] }
          : (page ?? 0) === 2
            ? { images: [item('c'), item('a')] } // one fresh, one duplicate
            : { images: [item('a'), item('b'), item('c')] }, // all duplicates → drained
    )
    const bridge: InsertImageBridge = {
      searchWeb,
      searchStock: vi.fn(async () => ({ images: [] })),
      fetchImage: vi.fn(async () => null),
      getStockKeys: async () => ({ pexels: '', pixabay: '' }),
      setStockKeys: async () => {},
    }
    await setup(bridge)

    await act(async () => {
      cells()[0]!.click() // pick "a" before appending
    })
    await act(async () => {
      buttonByText('下一批')!.click()
    })
    expect(searchWeb).toHaveBeenCalledWith('cat', 2, undefined)
    expect(cells()).toHaveLength(3) // a, b, c — the duplicate "a" collapsed
    expect(host.querySelectorAll('.insimg-cell.selected')).toHaveLength(1)
    expect(host.querySelector('.insimg-cell.selected img')?.getAttribute('src')).toBe(
      'https://img/a/thumb',
    )

    await act(async () => {
      buttonByText('下一批')!.click()
    })
    expect(searchWeb).toHaveBeenCalledWith('cat', 3, undefined)
    expect(cells()).toHaveLength(3)
    expect(host.querySelector('.insimg-nomore')?.textContent).toBe('已经到底了')
    expect(buttonByText('下一批')).toBeUndefined()
  })

  it('AI tab model picker: vendor groups replace the optgroup select, picking a video model flips the hint', async () => {
    const openModelSettings = vi.fn()
    const bridge: InsertImageBridge = {
      searchWeb: vi.fn(async () => ({ images: [] })),
      searchStock: vi.fn(async () => ({ images: [] })),
      fetchImage: vi.fn(async () => null),
      getStockKeys: async () => ({ pexels: '', pixabay: '' }),
      setStockKeys: async () => {},
      listMediaModels: vi.fn(async () => ({
        models: [
          {
            kind: 'image',
            profileId: 'prof-openai',
            modelId: 'gpt-image-2',
            label: 'gpt-image-2',
            vendorId: 'openai',
            spec: { fields: [] },
          },
          {
            kind: 'video',
            profileId: 'prof-kling',
            modelId: 'kling-v3',
            label: 'kling-v3',
            vendorId: 'kling',
            spec: { fields: [] },
          },
        ],
      })),
      openModelSettings,
    }
    const onInsert = vi.fn()
    await act(async () => {
      root!.render(
        createElement(InsertImageDialog, { bridge, lang: 'zh', onInsert, onClose: vi.fn() }),
      )
    })
    await act(async () => {
      buttonByText('AI 生成')!.click()
    })
    // no legacy optgroup select; ensureModels auto-picks the first image model
    expect(host.querySelector('select.insimg-select')).toBeNull()
    // kind chips split the lines: AI 生图 shows only the image model
    expect(host.querySelector('[data-ai-kind="image"]')!.className).toContain('active')
    let pickerTrigger = host.querySelector('.ai-model-picker-trigger') as HTMLButtonElement
    expect(pickerTrigger.textContent).toContain('gpt-image-2')
    await act(async () => {
      pickerTrigger.click()
    })
    expect(host.querySelectorAll('.ai-picker-vgroup')).toHaveLength(1)
    await act(async () => {
      host.querySelector('[data-ai-kind="video"]')!.click()
    })
    pickerTrigger = host.querySelector('.ai-model-picker-trigger') as HTMLButtonElement
    expect(pickerTrigger.textContent).toContain('kling-v3')
    await act(async () => {
      host.querySelector('[data-ai-kind="video"]')!.click() // already active; no-op
    })
    await act(async () => {
      pickerTrigger.click()
      host.querySelector('[data-picker-model="prof-kling::kling-v3"]')!.click()
    })
    // selection flows through: trigger label + the video-capability hint row
    expect(
      (host.querySelector('.ai-model-picker-trigger') as HTMLButtonElement).textContent,
    ).toContain('kling-v3')
    expect(host.querySelector('.insimg-videohint')).toBeTruthy()
  })
})
