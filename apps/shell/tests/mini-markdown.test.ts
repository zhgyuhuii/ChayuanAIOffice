import { describe, expect, it } from 'vitest'
import { markdownToHtml } from '../src/renderer/src/home-chat/mini-markdown'

describe('mini-markdown images', () => {
  it('renders markdown images from data: and https: URLs', () => {
    const html = markdownToHtml('![一只柴犬](data:image/png;base64,aW1n)')
    expect(html).toContain('<img src="data:image/png;base64,aW1n" alt="一只柴犬">')

    const https = markdownToHtml('![pic](https://cdn.example.com/x.png)')
    expect(https).toContain('<img src="https://cdn.example.com/x.png" alt="pic">')
  })

  it('keeps raw HTML img out — source HTML stays escaped', () => {
    const html = markdownToHtml('<img src="https://evil/x.png">')
    expect(html).not.toContain('<img src="https://evil')
    expect(html).toContain('&lt;img')
  })

  it('rejects non-image data URLs and javascript: sources', () => {
    expect(markdownToHtml('![x](data:text/html;base64,PGI%3D)')).not.toContain('<img')
    expect(markdownToHtml('![x](javascript:alert(1))')).not.toContain('<img')
  })

  it('still renders links and emphasis', () => {
    const html = markdownToHtml('[site](https://a.b) and *em*')
    expect(html).toContain('<a href="https://a.b">site</a>')
    expect(html).toContain('<em>em</em>')
  })

  it('renders a ```video fence as an inline player for safe sources only', () => {
    const html = markdownToHtml('生成完成：\n\n```video\ndata:video/mp4;base64,AAAAaGw=\n```')
    expect(html).toContain('<video class="chat-md-video" controls')
    expect(html).toContain('src="data:video/mp4;base64,AAAAaGw="')

    const unsafe = markdownToHtml('```video\njavascript:alert(1)\n```')
    expect(unsafe).not.toContain('<video')
    expect(unsafe).toContain('<pre><code>')
  })
})
