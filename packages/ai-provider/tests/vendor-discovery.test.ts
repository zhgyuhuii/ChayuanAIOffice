import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverVendorContract } from '../src/vendor-discovery'

/**
 * The discovery pipeline against two shapes:
 *  - the real agnes contract (catalog hit → llms.txt docs → mode enums parsed
 *    from the param table → first candidate converges → metadata.url poll),
 *    mirroring the live behavior verified against api.agnes-ai.cn on
 *    2026-10-09;
 *  - a stranger gateway (no catalog entry, no docs anywhere, rejects `text`,
 *    accepts `quality`, rate-limits the first image probe) proving the
 *    error-driven walk still converges without any documentation.
 */

const AGNES_LLMS_TXT = `# Agnes-Ai Docs

- [概述](https://wiki.agnes-ai.cn/zh-Hans/docs/overview.md): Agnes AI API 在线文档
- [Agnes Image 2.5 Flash](https://wiki.agnes-ai.cn/zh-Hans/docs/agnes-image-25-flash.md): Agnes 最新一代图像模型
- [Agnes Video 2.5 Flash](https://wiki.agnes-ai.cn/zh-Hans/docs/agnes-video-25-flash.md): 使用 OpenAI Videos 兼容 API 接入
`

const AGNES_VIDEO_DOC = `## 请求参数

| 参数 | 类型 | 必填 | 说明 |
| - | - | - | - |
| \`model\` | string | 是 | 使用 agnes-video-2.5-flash。 |
| \`mode\` | string | 是 | \`text\`、\`keyframe\` 或 \`reference\`。 |
| \`seconds\` | string | 否 | 视频时长，支持字符串 "4"–"12"。 |
| \`size\` | string | 否 | Flash 固定为 "720P"；其他值返回 HTTP 400。 |
`

const fast = { minIntervalMs: 0, pollDelayMs: 0, backoffMs: 0 }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('vendor contract discovery', () => {
  it('converges on the real agnes contract via docs-driven candidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === 'https://api.agnes-ai.cn/v1/models') {
          return jsonResponse({
            data: [
              { id: 'agnes-2.5-flash' },
              { id: 'agnes-video-2.5-flash' },
              { id: 'agnes-image-2.5-flash' },
            ],
          })
        }
        if (url === 'https://wiki.agnes-ai.cn/llms.txt') {
          return new Response(AGNES_LLMS_TXT)
        }
        if (url === 'https://wiki.agnes-ai.cn/zh-Hans/docs/agnes-video-25-flash.md') {
          return new Response(AGNES_VIDEO_DOC)
        }
        if (url === 'https://api.agnes-ai.cn/v1/videos' && init?.method === 'POST') {
          const body = String(init.body)
          if (!body.includes('"mode":"text"')) {
            return jsonResponse({ code: 'invalid_request', message: 'mode 无效' }, 400)
          }
          return jsonResponse({ id: 'job1', status: 'queued' })
        }
        if (url === 'https://api.agnes-ai.cn/v1/videos/job1') {
          return jsonResponse({
            status: 'completed',
            metadata: { url: 'https://cos/x.mp4' },
          })
        }
        if (url === 'https://api.agnes-ai.cn/v1/images/generations') {
          return jsonResponse({ data: [{ url: 'https://cos/x.png' }] })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )

    const profile = await discoverVendorContract(
      'https://api.agnes-ai.cn/v1',
      'sk-x',
      fast,
    )

    expect(profile.vendorHint).toBe('agnes-ai')
    expect(profile.models.map((m) => m.kind)).toContain('video-generation')
    // docs chain: catalog docsUrl origin → llms.txt → video page → enums
    expect(profile.docs.source).toBe('https://wiki.agnes-ai.cn/llms.txt')
    expect(profile.docs.videoModes).toEqual(['text', 'keyframe', 'reference'])
    expect(profile.docs.sizeHints).toContain('720P')
    // docs modes lead the walk, so text converges on the first try
    expect(profile.video.supported).toBe(true)
    expect((profile.video.requestShape as { mode: string }).mode).toBe('text')
    expect(profile.video.idField).toBe('id')
    expect(profile.video.modesRejected).toEqual([])
    // agnes nests the finished url in metadata.url
    expect(profile.video.poll.statusesSeen).toEqual(['completed'])
    expect(profile.video.poll.resultFieldPaths).toEqual(['metadata.url'])
    expect(profile.image.supported).toBe(true)
    expect(profile.image.responseKind).toBe('url')
    expect(profile.probes.length).toBeGreaterThan(5)
  })

  it('converges on a stranger gateway with no docs, walking errors and backing off', async () => {
    const createdModes: string[] = []
    let imageCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === 'https://api.strange-gw.example/v1/models') {
          return jsonResponse({ data: [{ id: 'strange-video-x' }, { id: 'flux-lite' }] })
        }
        if (url.endsWith('/llms.txt')) {
          return jsonResponse({ message: 'no docs here' }, 404)
        }
        if (url === 'https://api.strange-gw.example/v1/videos' && init?.method === 'POST') {
          const mode = /"mode":"([^"]+)"/.exec(String(init.body))?.[1] ?? ''
          createdModes.push(mode)
          if (mode !== 'quality') {
            return jsonResponse({ code: 'invalid_request', message: 'mode 无效' }, 400)
          }
          return jsonResponse({ id: 'job9', status: 'queued' })
        }
        if (url === 'https://api.strange-gw.example/v1/videos/job9') {
          return jsonResponse({ status: 'completed', url: 'https://cdn/x.mp4' })
        }
        if (url === 'https://api.strange-gw.example/v1/images/generations') {
          // free-tier throttle on the first try, success after backoff
          if (imageCalls++ === 0) {
            return jsonResponse(
              { error: { message: '请求过于频繁，请稍后再试。', code: 'rate_limit_exceeded' } },
              429,
            )
          }
          return jsonResponse({ data: [{ b64_json: 'aW1n' }] })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )

    const profile = await discoverVendorContract(
      'https://api.strange-gw.example/v1',
      'sk-x',
      fast,
    )

    expect(profile.vendorHint).toBe('unknown')
    expect(profile.docs.source).toBeNull()
    expect(profile.docs.notes.join(' ')).toContain('no catalog entry')
    // docs-less walk falls back to built-ins: text rejected, quality converges
    expect(createdModes).toEqual(['text', 'quality'])
    expect((profile.video.requestShape as { mode: string }).mode).toBe('quality')
    expect(profile.video.modesRejected).toEqual(['text'])
    expect(profile.video.poll.resultFieldPaths).toEqual(['url'])
    // the 429 was absorbed by backoff, then b64 shape recorded
    expect(profile.image.supported).toBe(true)
    expect(profile.image.responseKind).toBe('b64_json')
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
