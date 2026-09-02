import { describe, expect, it } from 'vitest'
import { createRemoteStorageClient, RemoteNotFoundError, RemoteStorageError } from '../src/index.js'
import type { RemoteStorageConfig } from '../src/index.js'
import { sha256Hex } from '../src/remote/sign.js'

interface CapturedCall {
  url: string
  init: RequestInit
}

function mockFetch(responder: (url: string, init: RequestInit) => Response): {
  calls: CapturedCall[]
  fetchImpl: typeof fetch
} {
  const calls: CapturedCall[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return responder(String(url), init ?? {})
  }) as typeof fetch
  return { calls, fetchImpl }
}

const FIXED_NOW = () => new Date('2013-05-24T00:00:00Z')

function minioConfig(overrides: Partial<RemoteStorageConfig> = {}): RemoteStorageConfig {
  return {
    id: 'cfg-1',
    name: 'MinIO',
    protocol: 's3',
    endpoint: 'http://127.0.0.1:9000',
    region: 'us-east-1',
    bucket: 'docs',
    accessKeyId: 'AK',
    secretAccessKey: 'SK',
    prefix: 'chatoffice/',
    pathStyle: true,
    enabled: true,
    ...overrides,
  }
}

describe('createRemoteStorageClient', () => {
  it('PUTs path-style with signed headers, strict encoding and no forbidden Host header', async () => {
    const { calls, fetchImpl } = mockFetch(
      () => new Response(null, { status: 200, headers: { etag: '"abc123"' } }),
    )
    const client = createRemoteStorageClient(minioConfig(), { fetchImpl, now: FIXED_NOW })
    const bytes = Buffer.from('hello')
    const result = await client.putObject('chatoffice/a b.txt', bytes, 'text/plain')

    expect(result.etag).toBe('abc123')
    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]
    expect(url).toBe('http://127.0.0.1:9000/docs/chatoffice/a%20b.txt')
    expect(init.method).toBe('PUT')
    const headers = init.headers as Record<string, string>
    expect(headers['content-type']).toBe('text/plain')
    expect(headers['x-amz-content-sha256']).toBe(sha256Hex(bytes))
    expect(
      headers.authorization.startsWith(
        'AWS4-HMAC-SHA256 Credential=AK/20130524/us-east-1/s3/aws4_request, ',
      ),
    ).toBe(true)
    expect(headers.authorization).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, ',
    )
    expect('host' in headers).toBe(false)
    expect(Buffer.from(init.body as Uint8Array).toString('utf8')).toBe('hello')
  })

  it('GETs virtual-hosted style and returns bytes with the stripped ETag', async () => {
    const { calls, fetchImpl } = mockFetch(
      () => new Response(Buffer.from('doc-bytes'), { status: 200, headers: { etag: '"etag-9"' } }),
    )
    const client = createRemoteStorageClient(
      minioConfig({
        endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
        bucket: 'mydocs',
        pathStyle: false,
      }),
      { fetchImpl, now: FIXED_NOW },
    )
    const object = await client.getObject('chatoffice/x.docx')

    expect(Buffer.from(object.bytes).toString('utf8')).toBe('doc-bytes')
    expect(object.etag).toBe('etag-9')
    expect(calls[0].url).toBe('https://mydocs.oss-cn-hangzhou.aliyuncs.com/chatoffice/x.docx')
  })

  it('supports endpoint base paths in path-style mode', async () => {
    const { calls, fetchImpl } = mockFetch(() => new Response(null, { status: 204 }))
    const client = createRemoteStorageClient(
      minioConfig({ endpoint: 'http://127.0.0.1:9000/office' }),
      {
        fetchImpl,
        now: FIXED_NOW,
      },
    )
    await client.deleteObject('chatoffice/old.docx')
    expect(calls[0].url).toBe('http://127.0.0.1:9000/office/docs/chatoffice/old.docx')
    expect(calls[0].init.method).toBe('DELETE')
  })

  it('maps 404 and NoSuchKey to RemoteNotFoundError', async () => {
    const { fetchImpl } = mockFetch(
      () => new Response('<?xml><Error><Code>NoSuchKey</Code></Error>', { status: 404 }),
    )
    const client = createRemoteStorageClient(minioConfig(), { fetchImpl, now: FIXED_NOW })
    await expect(client.getObject('missing.docx')).rejects.toBeInstanceOf(RemoteNotFoundError)
  })

  it('surfaces provider error codes and messages on other failures', async () => {
    const { fetchImpl } = mockFetch(
      () =>
        new Response('<Error><Code>AccessDenied</Code><Message>bad key</Message></Error>', {
          status: 403,
        }),
    )
    const client = createRemoteStorageClient(minioConfig(), { fetchImpl, now: FIXED_NOW })
    const error = await client.getObject('x').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(RemoteStorageError)
    expect((error as RemoteStorageError).status).toBe(403)
    expect((error as RemoteStorageError).code).toBe('AccessDenied')
    expect((error as Error).message).toContain('bad key')
  })

  it('headObject resolves null on 404 and parses metadata otherwise', async () => {
    const notFound = mockFetch(() => new Response(null, { status: 404 }))
    const missing = createRemoteStorageClient(minioConfig(), {
      fetchImpl: notFound.fetchImpl,
      now: FIXED_NOW,
    })
    expect(await missing.headObject('nope.docx')).toBeNull()

    const found = mockFetch(
      () =>
        new Response(null, {
          status: 200,
          headers: {
            etag: '"m1"',
            'content-length': '42',
            'last-modified': 'Fri, 24 May 2013 00:00:00 GMT',
          },
        }),
    )
    const client = createRemoteStorageClient(minioConfig(), {
      fetchImpl: found.fetchImpl,
      now: FIXED_NOW,
    })
    expect(await client.headObject('chatoffice/a.docx')).toEqual({
      key: 'chatoffice/a.docx',
      size: 42,
      lastModifiedMs: Date.parse('Fri, 24 May 2013 00:00:00 GMT'),
      etag: 'm1',
    })
  })

  it('server-side copies via x-amz-copy-source and reads the result ETag', async () => {
    const { calls, fetchImpl } = mockFetch(
      () =>
        new Response('<CopyObjectResult><ETag>&quot;copy-1&quot;</ETag></CopyObjectResult>', {
          status: 200,
        }),
    )
    const client = createRemoteStorageClient(minioConfig(), { fetchImpl, now: FIXED_NOW })
    const result = await client.copyObject('chatoffice/src a.txt', 'chatoffice/dst.txt')

    expect(result.etag).toBe('copy-1')
    expect((calls[0].init.headers as Record<string, string>)['x-amz-copy-source']).toBe(
      '/docs/chatoffice/src%20a.txt',
    )
    expect(calls[0].url).toBe('http://127.0.0.1:9000/docs/chatoffice/dst.txt')
  })

  it('lists with sorted canonical query params and pages through results', async () => {
    const pageOne =
      '<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>tok/en+1==</NextContinuationToken>' +
      '<Contents><Key>chatoffice/a.docx</Key><Size>3</Size><LastModified>2013-05-24T00:00:00.000Z</LastModified><ETag>&quot;e1&quot;</ETag></Contents>' +
      '<Contents><Key>chatoffice/会&amp;议.txt</Key><Size>4</Size><LastModified>2013-05-24T00:00:00.000Z</LastModified><ETag>&quot;e2&quot;</ETag></Contents>' +
      '</ListBucketResult>'
    const pageTwo =
      '<ListBucketResult><IsTruncated>false</IsTruncated>' +
      '<Contents><Key>chatoffice/z.docx</Key><Size>5</Size><LastModified>2013-05-24T00:00:00.000Z</LastModified><ETag>&quot;e3&quot;</ETag></Contents>' +
      '</ListBucketResult>'
    const { calls, fetchImpl } = mockFetch(
      (url) =>
        new Response(url.includes('continuation-token') ? pageTwo : pageOne, { status: 200 }),
    )
    const client = createRemoteStorageClient(minioConfig(), { fetchImpl, now: FIXED_NOW })
    const files = []
    for await (const file of client.listObjects('chatoffice/')) files.push(file)

    expect(files.map((file) => file.key)).toEqual([
      'chatoffice/a.docx',
      'chatoffice/会&议.txt',
      'chatoffice/z.docx',
    ])
    expect(files[0].etag).toBe('e1')
    expect(calls[0].url).toBe(
      'http://127.0.0.1:9000/docs?list-type=2&max-keys=1000&prefix=chatoffice%2F',
    )
    expect(calls[1].url).toBe(
      'http://127.0.0.1:9000/docs?continuation-token=tok%2Fen%2B1%3D%3D&list-type=2&max-keys=1000&prefix=chatoffice%2F',
    )
  })

  it('testConnection HEADs the bucket and best-effort reads versioning', async () => {
    const ok = mockFetch((url) =>
      url.includes('versioning')
        ? new Response(
            '<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>',
            { status: 200 },
          )
        : new Response(null, { status: 200 }),
    )
    const okClient = createRemoteStorageClient(minioConfig(), {
      fetchImpl: ok.fetchImpl,
      now: FIXED_NOW,
    })
    expect(await okClient.testConnection()).toEqual({ ok: true, versioningEnabled: true })
    expect(ok.calls[0].url).toBe('http://127.0.0.1:9000/docs')
    expect(ok.calls[0].init.method).toBe('HEAD')
    expect(ok.calls[1].url).toBe('http://127.0.0.1:9000/docs?versioning=')

    const uncheckable = mockFetch((url) =>
      url.includes('versioning')
        ? new Response(null, { status: 403 })
        : new Response(null, { status: 200 }),
    )
    const uncheckableClient = createRemoteStorageClient(minioConfig(), {
      fetchImpl: uncheckable.fetchImpl,
      now: FIXED_NOW,
    })
    expect(await uncheckableClient.testConnection()).toEqual({ ok: true, versioningEnabled: null })

    const unreachable = mockFetch(
      () => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }),
    )
    const unreachableClient = createRemoteStorageClient(minioConfig(), {
      fetchImpl: unreachable.fetchImpl,
      now: FIXED_NOW,
    })
    const result = await unreachableClient.testConnection()
    expect(result.ok).toBe(false)
    expect(result.error).toContain('403')
  })

  it('rejects traversal and absolute keys', async () => {
    const { fetchImpl } = mockFetch(() => new Response(null, { status: 200 }))
    const client = createRemoteStorageClient(minioConfig(), { fetchImpl, now: FIXED_NOW })
    await expect(client.putObject('../escape.txt', Buffer.from('x'))).rejects.toThrow()
    await expect(client.putObject('/abs.txt', Buffer.from('x'))).rejects.toThrow()
    await expect(client.getObject('a/../b.txt')).rejects.toThrow()
  })
})
