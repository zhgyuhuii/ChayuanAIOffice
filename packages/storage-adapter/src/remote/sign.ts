/**
 * Minimal AWS Signature Version 4 (header-based), byte-exact per the AWS
 * "Signature Version 4" docs so MinIO and Alibaba Cloud OSS S3-compatible
 * endpoints both accept requests. Only the subset this package needs is
 * implemented: signed header requests with an explicit payload hash —
 * no presigned URLs, no chunked streaming.
 */

import { createHash, createHmac } from 'node:crypto'

const ALGORITHM = 'AWS4-HMAC-SHA256'

/** RFC 3986 unreserved characters, kept verbatim by AWS URI encoding. */
const AWS_URI_UNRESERVED = /^[A-Za-z0-9\-._~]$/

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * AWS URI-encoding for a single path segment or query key/value: every UTF-8
 * byte outside the unreserved set becomes `%XX` (upper case).
 */
export function encodeAwsUriComponent(value: string): string {
  let out = ''
  for (const byte of Buffer.from(value, 'utf8')) {
    const char = String.fromCharCode(byte)
    out += AWS_URI_UNRESERVED.test(char)
      ? char
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

/** Encodes an object-key path, preserving `/` as the folder separator. */
export function encodeAwsUriPath(path: string): string {
  return path.split('/').map(encodeAwsUriComponent).join('/')
}

export interface Aws4SignInput {
  method: string
  /** Single-encoded absolute path starting with `/`; S3 rules (never re-normalized). */
  canonicalUri: string
  /** Query parameters; encoded and sorted here. */
  query?: Record<string, string>
  /** Headers to sign; names are lower-cased and sorted here. Must include `host`. */
  headers: Record<string, string>
  /** Hex SHA-256 of the payload (empty-body hash for GET/HEAD/DELETE). */
  payloadHash: string
  /** e.g. `20130524T000000Z`. */
  amzDate: string
  scope: { date: string; region: string; service: string }
  credentials: { accessKeyId: string; secretAccessKey: string }
}

export function buildCanonicalQueryString(query: Record<string, string> | undefined): string {
  if (!query) return ''
  return Object.keys(query)
    .map((key) => ({ key: encodeAwsUriComponent(key), value: encodeAwsUriComponent(query[key]) }))
    .sort((a, b) => (a.key === b.key ? (a.value < b.value ? -1 : 1) : a.key < b.key ? -1 : 1))
    .map((entry) => `${entry.key}=${entry.value}`)
    .join('&')
}

export function buildCanonicalRequest(
  method: string,
  canonicalUri: string,
  canonicalQuery: string,
  headers: Record<string, string>,
  payloadHash: string,
): string {
  const lowerCased = Object.keys(headers).map((name) => ({
    name: name.toLowerCase(),
    value: headers[name].trim(),
  }))
  lowerCased.sort((a, b) => (a.name < b.name ? -1 : 1))
  const canonicalHeaders = lowerCased.map((entry) => `${entry.name}:${entry.value}\n`).join('')
  const signedHeaders = lowerCased.map((entry) => entry.name).join(';')
  return [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join(
    '\n',
  )
}

export function buildStringToSign(
  amzDate: string,
  scope: Aws4SignInput['scope'],
  canonicalRequest: string,
): string {
  const credentialScope = `${scope.date}/${scope.region}/${scope.service}/aws4_request`
  return [ALGORITHM, amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n')
}

function deriveSigningKey(secret: string, date: string, region: string, service: string): Buffer {
  const kDate = createHmac('sha256', `AWS4${secret}`).update(date).digest()
  const kRegion = createHmac('sha256', kDate).update(region).digest()
  const kService = createHmac('sha256', kRegion).update(service).digest()
  return createHmac('sha256', kService).update('aws4_request').digest()
}

/** Computes the `Authorization` header value for the request described by `input`. */
export function aws4Sign(input: Aws4SignInput): string {
  const canonicalQuery = buildCanonicalQueryString(input.query)
  const canonicalRequest = buildCanonicalRequest(
    input.method,
    input.canonicalUri,
    canonicalQuery,
    input.headers,
    input.payloadHash,
  )
  const stringToSign = buildStringToSign(input.amzDate, input.scope, canonicalRequest)
  const signingKey = deriveSigningKey(
    input.credentials.secretAccessKey,
    input.scope.date,
    input.scope.region,
    input.scope.service,
  )
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const credentialScope = `${input.scope.date}/${input.scope.region}/${input.scope.service}/aws4_request`
  return `${ALGORITHM} Credential=${input.credentials.accessKeyId}/${credentialScope}, SignedHeaders=${Object.keys(
    input.headers,
  )
    .map((name) => name.toLowerCase())
    .sort()
    .join(';')}, Signature=${signature}`
}
