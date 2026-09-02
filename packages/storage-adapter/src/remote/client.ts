/**
 * Minimal S3-compatible object storage client (MinIO, Alibaba Cloud OSS S3
 * endpoint, …) built on fetch + the local SigV4 signer. Deliberately
 * dependency-free so it bundles cleanly into Electron main processes and the
 * BFF; only the operations this product needs are implemented.
 *
 * Conflict detection (plan consensus Q6) relies on ETags: `getObject` returns
 * the stored object's ETag, `headObject` re-reads it cheaply, and callers
 * compare before overwriting. There is no retry logic here — the pending-save
 * queue above this layer owns retry policy.
 */

import { aws4Sign, encodeAwsUriComponent, encodeAwsUriPath, sha256Hex } from './sign.js'
import {
  RemoteNotFoundError,
  RemoteStorageError,
  type RemoteFileInfo,
  type RemoteObject,
  type RemoteStorageConfig,
  type TestConnectionResult,
} from './types.js'

const EMPTY_PAYLOAD_SHA256 = sha256Hex('')
const DEFAULT_TIMEOUT_MS = 30_000

export interface RemoteStorageClient {
  /** Uploads bytes; resolves with the stored object's ETag. */
  putObject(key: string, bytes: Uint8Array, contentType?: string): Promise<{ etag: string }>
  /** Fetches exact bytes plus the ETag; throws RemoteNotFoundError on missing keys. */
  getObject(key: string): Promise<RemoteObject>
  /** Cheap metadata read; null when the key does not exist. */
  headObject(key: string): Promise<RemoteFileInfo | null>
  /** Deletes an object. Missing keys resolve (S3 delete is idempotent). */
  deleteObject(key: string): Promise<void>
  /** Server-side copy within the bucket (rename/upload primitives build on this). */
  copyObject(fromKey: string, toKey: string): Promise<{ etag: string }>
  /** Lists objects under a prefix, paging transparently. */
  listObjects(prefix: string): AsyncGenerator<RemoteFileInfo>
  /** HEADs the bucket, then best-effort reads versioning status. */
  testConnection(): Promise<TestConnectionResult>
}

export interface RemoteClientDeps {
  fetchImpl?: typeof fetch
  now?: () => Date
  timeoutMs?: number
}

export function createRemoteStorageClient(
  config: RemoteStorageConfig,
  deps: RemoteClientDeps = {},
): RemoteStorageClient {
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? (() => new Date())
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const endpoint = new URL(config.endpoint.replace(/\/+$/, ''))
  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
    throw new Error('remote storage endpoint must be an http(s) URL')
  }
  const basePath = endpoint.pathname === '/' ? '' : endpoint.pathname.replace(/\/+$/, '')

  function assertKey(key: string): void {
    if (typeof key !== 'string' || key.length === 0)
      throw new Error('remote object key must be a non-empty string')
    if (key.startsWith('/') || key.split('/').includes('..')) {
      throw new Error(`remote object key must be relative and traversal-free: "${key}"`)
    }
  }

  /** Builds the canonical URI + request host for a key (possibly '' for bucket-level ops). */
  function targetFor(key: string): { canonicalUri: string; host: string } {
    const encodedKey = key ? encodeAwsUriPath(key) : ''
    if (config.pathStyle) {
      const bucket = encodeAwsUriComponent(config.bucket)
      const suffix = encodedKey ? `/${encodedKey}` : ''
      return { canonicalUri: `${basePath}/${bucket}${suffix}`, host: endpoint.host }
    }
    return {
      canonicalUri: `${basePath}${encodedKey ? `/${encodedKey}` : ''}`,
      host: `${config.bucket}.${endpoint.host}`,
    }
  }

  function authorize(
    method: string,
    target: { canonicalUri: string; host: string },
    query: Record<string, string>,
    extraHeaders: Record<string, string>,
    payloadHash: string,
    amzDate: string,
  ): string {
    return aws4Sign({
      method,
      canonicalUri: target.canonicalUri,
      query,
      headers: {
        host: target.host,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        ...extraHeaders,
      },
      payloadHash,
      amzDate,
      scope: {
        date: amzDate.slice(0, 8),
        region: config.region,
        service: 's3',
      },
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    })
  }

  async function request(
    method: string,
    key: string,
    options: {
      query?: Record<string, string>
      headers?: Record<string, string>
      body?: Uint8Array
    } = {},
  ): Promise<Response> {
    const target = targetFor(key)
    const query = options.query ?? {}
    const payloadHash = options.body ? sha256Hex(options.body) : EMPTY_PAYLOAD_SHA256
    const amzDate = `${now().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`
    const authorization = authorize(
      method,
      target,
      query,
      options.headers ?? {},
      payloadHash,
      amzDate,
    )
    // The signed amz headers must also travel with the request (S3 requires
    // x-amz-content-sha256 verbatim); `host` stays out — fetch derives it.
    const headers = {
      authorization,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      ...options.headers,
    }
    const url = `${endpoint.protocol}//${target.host}${target.canonicalUri}${
      Object.keys(query).length ? `?${queryString(query)}` : ''
    }`
    const response = await fetchImpl(url, {
      method,
      headers,
      body: options.body ? Buffer.from(options.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw await toError(response, method)
    return response
  }

  async function toError(response: Response, method: string): Promise<Error> {
    const text = await response.text().catch(() => '')
    const code = extractXmlText(text, 'Code')
    if (response.status === 404 || code === 'NoSuchKey' || code === 'NotFound')
      return new RemoteNotFoundError()
    const message = extractXmlText(text, 'Message')
    return new RemoteStorageError(
      `${method} failed with HTTP ${response.status}${code ? ` (${code})` : ''}${message ? `: ${message}` : ''}`,
      response.status,
      code,
    )
  }

  async function putObject(
    key: string,
    bytes: Uint8Array,
    contentType = 'application/octet-stream',
  ): Promise<{ etag: string }> {
    assertKey(key)
    const response = await request('PUT', key, {
      body: bytes,
      headers: { 'content-type': contentType },
    })
    return { etag: stripQuotes(response.headers.get('etag') ?? '') }
  }

  async function getObject(key: string): Promise<RemoteObject> {
    assertKey(key)
    const response = await request('GET', key)
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      etag: stripQuotes(response.headers.get('etag') ?? ''),
    }
  }

  async function headObject(key: string): Promise<RemoteFileInfo | null> {
    assertKey(key)
    try {
      const response = await request('HEAD', key)
      return {
        key,
        size: Number(response.headers.get('content-length') ?? '0'),
        lastModifiedMs: response.headers.get('last-modified')
          ? Date.parse(response.headers.get('last-modified')!)
          : 0,
        etag: stripQuotes(response.headers.get('etag') ?? ''),
      }
    } catch (error) {
      if (error instanceof RemoteNotFoundError) return null
      throw error
    }
  }

  async function deleteObject(key: string): Promise<void> {
    assertKey(key)
    await request('DELETE', key)
  }

  async function copyObject(fromKey: string, toKey: string): Promise<{ etag: string }> {
    assertKey(fromKey)
    assertKey(toKey)
    const source = `/${config.bucket}/${encodeAwsUriPath(fromKey)}`
    const response = await request('PUT', toKey, { headers: { 'x-amz-copy-source': source } })
    const text = await response.text()
    return { etag: stripQuotes(extractXmlText(text, 'ETag') ?? '') }
  }

  async function* listObjects(prefix: string): AsyncGenerator<RemoteFileInfo> {
    let continuationToken: string | null = null
    do {
      const query: Record<string, string> = { 'list-type': '2', 'max-keys': '1000' }
      if (prefix) query.prefix = prefix
      if (continuationToken) query['continuation-token'] = continuationToken
      const response = await request('GET', '', { query })
      const xml = await response.text()
      for (const block of matchXmlBlocks(xml, 'Contents')) {
        const key = extractXmlText(block, 'Key')
        if (!key) continue
        yield {
          key,
          size: Number(extractXmlText(block, 'Size') ?? '0'),
          lastModifiedMs: Date.parse(extractXmlText(block, 'LastModified') ?? '') || 0,
          etag: stripQuotes(extractXmlText(block, 'ETag') ?? ''),
        }
      }
      continuationToken = extractXmlText(xml, 'NextContinuationToken')
    } while (continuationToken)
  }

  async function testConnection(): Promise<TestConnectionResult> {
    try {
      await request('HEAD', '')
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    let versioningEnabled: boolean | null
    try {
      const response = await request('GET', '', { query: { versioning: '' } })
      const xml = await response.text()
      versioningEnabled = extractXmlText(xml, 'Status') === 'Enabled'
    } catch {
      versioningEnabled = null
    }
    return { ok: true, versioningEnabled }
  }

  return { putObject, getObject, headObject, deleteObject, copyObject, listObjects, testConnection }
}

function queryString(query: Record<string, string>): string {
  // Canonical (sorted, strictly encoded) query, so the URL and the signed
  // canonical request stay byte-identical — required by strict providers.
  return Object.keys(query)
    .sort()
    .map((key) => `${encodeAwsUriComponent(key)}=${encodeAwsUriComponent(query[key])}`)
    .join('&')
}

function stripQuotes(etag: string): string {
  return etag.replace(/^"+|"+$/g, '')
}

function matchXmlBlocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map(
    (match) => match[1],
  )
}

function extractXmlText(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
  return match ? unescapeXml(match[1]) : null
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}
