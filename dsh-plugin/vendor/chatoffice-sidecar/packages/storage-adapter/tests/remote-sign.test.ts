import { describe, expect, it } from 'vitest'
import {
  aws4Sign,
  buildCanonicalRequest,
  buildCanonicalQueryString,
  encodeAwsUriComponent,
  encodeAwsUriPath,
  sha256Hex,
} from '../src/remote/sign.js'

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('AWS SigV4 against official documentation examples', () => {
  it('matches the S3 "GET Object" signing example', () => {
    const headers = {
      host: 'examplebucket.s3.amazonaws.com',
      range: 'bytes=0-9',
      'x-amz-content-sha256': EMPTY_SHA256,
      'x-amz-date': '20130524T000000Z',
    }
    const canonicalRequest = buildCanonicalRequest('GET', '/test.txt', '', headers, EMPTY_SHA256)
    expect(canonicalRequest).toBe(
      [
        'GET',
        '/test.txt',
        '',
        'host:examplebucket.s3.amazonaws.com',
        'range:bytes=0-9',
        `x-amz-content-sha256:${EMPTY_SHA256}`,
        'x-amz-date:20130524T000000Z',
        '',
        'host;range;x-amz-content-sha256;x-amz-date',
        EMPTY_SHA256,
      ].join('\n'),
    )
    const authorization = aws4Sign({
      method: 'GET',
      canonicalUri: '/test.txt',
      headers,
      payloadHash: EMPTY_SHA256,
      amzDate: '20130524T000000Z',
      scope: { date: '20130524', region: 'us-east-1', service: 's3' },
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
    })
    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    )
  })

  it('matches the SigV4 test suite "get-vanilla" case', () => {
    const authorization = aws4Sign({
      method: 'GET',
      canonicalUri: '/',
      headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
      payloadHash: EMPTY_SHA256,
      amzDate: '20150830T123600Z',
      scope: { date: '20150830', region: 'us-east-1', service: 'service' },
      credentials: {
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      },
    })
    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    )
  })

  it('changes the signature when the payload changes', () => {
    const base = {
      method: 'PUT',
      canonicalUri: '/bucket/key',
      headers: { host: 'h', 'x-amz-date': '20130524T000000Z' },
      amzDate: '20130524T000000Z',
      scope: { date: '20130524', region: 'us-east-1', service: 's3' },
      credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
    }
    const one = aws4Sign({ ...base, payloadHash: sha256Hex('one') })
    const two = aws4Sign({ ...base, payloadHash: sha256Hex('two') })
    expect(one).not.toBe(two)
  })
})

describe('AWS URI encoding', () => {
  it('keeps unreserved characters and encodes everything else', () => {
    expect(encodeAwsUriComponent('aZ09-._~')).toBe('aZ09-._~')
    expect(encodeAwsUriComponent('a b+c!d')).toBe('a%20b%2Bc%21d')
    expect(encodeAwsUriComponent('会/议')).toBe('%E4%BC%9A%2F%E8%AE%AE')
  })

  it('preserves slashes in object-key paths', () => {
    expect(encodeAwsUriPath('chatoffice/会 议/v2.docx')).toBe(
      'chatoffice/%E4%BC%9A%20%E8%AE%AE/v2.docx',
    )
  })

  it('sorts and encodes canonical query strings', () => {
    expect(buildCanonicalQueryString({ 'list-type': '2', prefix: '会 议/' })).toBe(
      'list-type=2&prefix=%E4%BC%9A%20%E8%AE%AE%2F',
    )
    expect(buildCanonicalQueryString({ b: '2', a: '1' })).toBe('a=1&b=2')
  })
})
