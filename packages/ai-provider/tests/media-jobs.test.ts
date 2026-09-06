import { afterEach, describe, expect, it, vi } from 'vitest'
import { getMediaJobAdapter, registerMediaJobAdapter, runMediaJob } from '../src/media-jobs'
import type { MediaJobAdapter, MediaJobRequest } from '../src/media-jobs'

afterEach(() => {
  vi.unstubAllGlobals()
})

const baseReq: MediaJobRequest = {
  kind: 'video',
  vendorId: 'test',
  model: 'test-model',
  apiKey: 'k',
  prompt: 'a slow pan over a city',
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('runMediaJob', () => {
  it('submits, polls through running, and returns the result URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ id: 'job-1' })) // submit
      .mockResolvedValueOnce(jsonRes({ status: 'queued' })) // poll 1
      .mockResolvedValueOnce(jsonRes({ status: 'running' })) // poll 2
      .mockResolvedValueOnce(jsonRes({ status: 'succeeded', video_url: 'https://cdn/v.mp4' })) // poll 3
    vi.stubGlobal('fetch', fetchMock)
    registerMediaJobAdapter({
      vendorId: 'test',
      pollIntervalMs: 1,
      async submit(req) {
        const res = await fetch('https://x/submit', { method: 'POST', body: JSON.stringify({ model: req.model }) })
        return ((await res.json()) as { id: string }).id
      },
      async poll(jobId) {
        const res = await fetch(`https://x/poll/${jobId}`)
        const body = (await res.json()) as { status: string; video_url?: string }
        if (body.status === 'succeeded')
          return { state: 'succeeded' as const, result: { url: body.video_url!, mime: 'video/mp4' } }
        if (body.status === 'failed') return { state: 'failed' as const, error: 'nope' }
        return body.status === 'queued' ? { state: 'queued' as const } : { state: 'running' as const }
      },
    })
    const stages: string[] = []
    const result = await runMediaJob({ ...baseReq, onProgress: (s) => stages.push(s) })
    expect(result.url).toBe('https://cdn/v.mp4')
    expect(result.mime).toBe('video/mp4')
    expect(stages[0]).toBe('submitted')
    expect(stages).toContain('running')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('propagates vendor failures and missing adapters', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ id: 'j' })))
    registerMediaJobAdapter({
      vendorId: 'failtest',
      pollIntervalMs: 1,
      async submit() {
        return 'j'
      },
      async poll() {
        return { state: 'failed' as const, error: 'content policy' }
      },
    })
    await expect(runMediaJob({ ...baseReq, vendorId: 'failtest' })).rejects.toThrow('content policy')
    await expect(runMediaJob({ ...baseReq, vendorId: 'unwired' })).rejects.toThrow('No media-generation adapter')
  })

  it('surfaces an HTTP submit failure with the status code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('bad key', { status: 401 })),
    )
    const adapter: MediaJobAdapter = {
      vendorId: 'httptest',
      async submit(req) {
        const res = await fetch('https://x', { headers: { Authorization: `Bearer ${req.apiKey}` } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return 'j'
      },
      async poll() {
        return { state: 'queued' as const }
      },
    }
    registerMediaJobAdapter(adapter)
    await expect(runMediaJob({ ...baseReq, vendorId: 'httptest' })).rejects.toThrow('HTTP 401')
  })
})

describe('built-in adapters', () => {
  it('registers the four first-party vendor adapters', () => {
    for (const vendorId of ['aliyun-bailian', 'zhipu', 'minimax', 'volcengine']) {
      expect(getMediaJobAdapter(vendorId)?.vendorId).toBe(vendorId)
    }
  })

  it('zhipu poll maps SUCCESS + video_result url', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonRes({ task_status: 'SUCCESS', video_result: [{ url: 'https://z/v.mp4' }] })),
    )
    const poll = await getMediaJobAdapter('zhipu')!.poll('j1', baseReq)
    expect(poll).toEqual({ state: 'succeeded', result: { url: 'https://z/v.mp4', mime: 'video/mp4', meta: { jobId: 'j1' } } })
  })

  it('dashscope submit reads output.task_id and poll maps FAILED', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ output: { task_id: 'ds-1' } }))
      .mockResolvedValueOnce(jsonRes({ output: { task_status: 'FAILED', message: 'bad prompt' } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = getMediaJobAdapter('aliyun-bailian')!
    const id = await adapter.submit(baseReq)
    expect(id).toBe('ds-1')
    const poll = await adapter.poll(id, baseReq)
    expect(poll.state).toBe('failed')
  })

  it('kling: JWT bearer auth, body fields, and the profile baseUrl selects the site', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ data: { task_id: 'kl-1' } }))
      .mockResolvedValueOnce(
        jsonRes({
          data: {
            task_status: 'succeed',
            task_result: { videos: [{ url: 'https://k/v.mp4', cover_image_url: 'https://k/p.jpg' }] },
          },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = getMediaJobAdapter('kling')!
    const req: MediaJobRequest = {
      ...baseReq,
      vendorId: 'kling',
      model: 'kling-v1-6',
      apiKey: 'ak-test:sk-test',
      // China-site keys (api-beijing) vs the global default: the profile's
      // baseUrl must win — an AK/SK pair only auths on its issuing site
      baseUrl: 'https://api-beijing.klingai.com',
      aspectRatio: '16:9',
      durationSeconds: 5,
    }
    const id = await adapter.submit(req)
    expect(id).toBe('kl-1')
    const submitCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(submitCall[0]).toBe('https://api-beijing.klingai.com/v1/videos/text2video')
    expect(submitCall[1]!.headers).toMatchObject({ Authorization: expect.stringMatching(/^Bearer ey/) })
    expect(JSON.parse(String(submitCall[1]!.body))).toMatchObject({
      model_name: 'kling-v1-6',
      duration: '5',
      aspect_ratio: '16:9',
    })
    const poll = await adapter.poll(id, req)
    const pollCall = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(pollCall[0]).toBe('https://api-beijing.klingai.com/v1/videos/text2video/kl-1')
    // toMatchObject: the poster-in-meta enrichment lands separately
    expect(poll).toMatchObject({
      state: 'succeeded',
      result: { url: 'https://k/v.mp4', mime: 'video/mp4' },
    })
  })
})
