// @vitest-environment jsdom
/**
 * Markdown images: ![alt](src) renders as <img> for safe sources (data:image
 * base64, https:) — the shape generated images ride in as — while unsafe
 * sources (data:text, javascript:) and partial markdown stay literal text.
 * Every editor AI panel (docs/sheets/slides/markdown/pdf/html) shares this
 * component, so generated images never flood the message box as raw base64.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Markdown } from '../src/Markdown'

let host: HTMLDivElement
let root: Root

const render = async (ui: React.ReactNode): Promise<void> => {
  await act(async () => {
    root.render(ui)
  })
}

beforeEach(async () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  return async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
  }
})

describe('Markdown images', () => {
  it('renders a data:image markdown image as an <img> element', async () => {
    await render(createElement(Markdown, { text: '![女娲补天](data:image/png;base64,aW1n)' }))
    const img = host.querySelector('img.ai-md-img')
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,aW1n')
    expect(img?.getAttribute('alt')).toBe('女娲补天')
    expect(host.textContent).not.toContain('aW1n')
  })

  it('renders an https image and keeps the rest of the paragraph', async () => {
    await render(
      createElement(Markdown, { text: '生成完成：\n![pic](https://cdn.example.cn/out.png)' }),
    )
    const img = host.querySelector('img.ai-md-img')
    expect(img?.getAttribute('src')).toBe('https://cdn.example.cn/out.png')
    expect(host.textContent).toContain('生成完成：')
  })

  it('keeps unsafe sources literal — data:text and javascript: never become img', async () => {
    await render(
      createElement(Markdown, {
        text: '![x](data:text/html;base64,PGI+) ![y](javascript:alert(1))',
      }),
    )
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toContain('data:text/html')
    expect(host.textContent).toContain('javascript:alert(1)')
  })

  it('a partial (streaming) image markdown stays plain text, no crash', async () => {
    await render(createElement(Markdown, { text: '![alt](data:image/png;base64,AAAA' }))
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toContain('![alt](data:image/png;base64,AAAA')
  })

  it('a long base64 payload renders as one img without flooding text', async () => {
    const big = 'A'.repeat(200_000)
    await render(createElement(Markdown, { text: `![g](data:image/jpeg;base64,${big})` }))
    expect(host.querySelector('img.ai-md-img')).not.toBeNull()
    expect((host.textContent ?? '').length).toBeLessThan(100)
  })

  it('clicking the thumbnail opens the lightbox; backdrop click and Esc close it', async () => {
    await render(createElement(Markdown, { text: '![g](data:image/png;base64,aW1n)' }))
    expect(host.querySelector('.ai-md-zoom')).toBeNull()
    await act(async () => {
      ;(host.querySelector('img.ai-md-img') as HTMLElement).click()
    })
    const box = host.querySelector('.ai-md-zoom') as HTMLElement
    expect(box).not.toBeNull()
    expect((box.querySelector('img') as HTMLImageElement).src).toBe('data:image/png;base64,aW1n')
    // backdrop click closes
    await act(async () => {
      box.click()
    })
    expect(host.querySelector('.ai-md-zoom')).toBeNull()
    // reopen, then Escape closes
    await act(async () => {
      ;(host.querySelector('img.ai-md-img') as HTMLElement).click()
    })
    expect(host.querySelector('.ai-md-zoom')).not.toBeNull()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(host.querySelector('.ai-md-zoom')).toBeNull()
  })

  it('renders the insert chip only when the host wires onInsertImage, and calls it with the src', async () => {
    const onInsertImage = vi.fn()
    // no host hook → no chip
    await render(createElement(Markdown, { text: '![g](data:image/png;base64,aW1n)' }))
    expect(host.querySelector('.ai-md-img-insert')).toBeNull()
    // host wired → chip fires with the image src
    await render(
      createElement(Markdown, {
        text: '![g](data:image/png;base64,aW1n)',
        onInsertImage,
        insertImageLabel: '插入文档',
      }),
    )
    const chip = host.querySelector('.ai-md-img-insert') as HTMLElement
    expect(chip?.textContent).toBe('插入文档')
    await act(async () => {
      chip.click()
    })
    expect(onInsertImage).toHaveBeenCalledWith('data:image/png;base64,aW1n')
  })

  it('renders a ```video fence as an inline player for safe sources only', async () => {
    await render(
      createElement(Markdown, {
        text: '生成完成：\n\n```video\ndata:video/mp4;base64,AAAAaGw=\n```',
      }),
    )
    const video = host.querySelector('video.ai-md-video')
    expect(video?.getAttribute('src')).toBe('data:video/mp4;base64,AAAAaGw=')
    expect(video?.getAttribute('controls')).not.toBeNull()

    // unsafe / unknown fence content stays a code block
    await render(
      createElement(Markdown, {
        text: '```video\njavascript:alert(1)\n```',
      }),
    )
    expect(host.querySelector('video')).toBeNull()
    expect(host.querySelector('pre')).not.toBeNull()
  })
})
