/**
 * Remote object storage (S3-compatible: MinIO, Alibaba Cloud OSS, …) types.
 *
 * Remote access is inherently async and byte-oriented, so it gets its own
 * surface instead of being squeezed into the synchronous SyncFs local area.
 * Domain decisions this file encodes (plan consensus 2026-09-03):
 *
 *   - a provider config list with exactly one "default save location" pointer
 *   - remote files are identified as `remote://<configId>/<key>` URIs
 *   - document bytes live only in the bucket; local caches are not kept
 */

export type RemoteStorageProtocol = 's3' | 'aliyun-oss'

/** One configured remote storage backend (a bucket + how to reach it). */
export interface RemoteStorageConfig {
  /** Stable id used by `remote://` URIs; survives renames of `name`. */
  id: string
  name: string
  protocol: RemoteStorageProtocol
  /** e.g. `http://minio.internal:9000` or `https://oss-cn-hangzhou.aliyuncs.com`. */
  endpoint: string
  /** SigV4 region, e.g. `us-east-1` or `cn-hangzhou`. */
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** Key prefix every document is stored under, e.g. `chatoffice/`. */
  prefix: string
  /** MinIO requires path-style; OSS defaults to virtual-hosted style. */
  pathStyle: boolean
  enabled: boolean
}

/** The global "default save location" pointer into the config list. */
export interface RemoteStorageDefaultLocation {
  configId: string
  /** Optional sub-prefix below the config's own prefix. */
  prefix?: string
}

/** Shape of the persisted storage-settings file (plaintext, mode 0600). */
export interface RemoteStorageSettings {
  version: number
  configs: RemoteStorageConfig[]
  defaultLocation: RemoteStorageDefaultLocation | null
}

/** Metadata of one remote object, as returned by list/head. */
export interface RemoteFileInfo {
  key: string
  size: number
  lastModifiedMs: number
  /** ETag without surrounding quotes. */
  etag: string
}

/** One fetched remote object: exact bytes plus the ETag to conflict-check against. */
export interface RemoteObject {
  bytes: Uint8Array
  etag: string
}

export interface TestConnectionResult {
  ok: boolean
  /** Human-readable failure reason when `ok` is false. */
  error?: string
  /** `true`/`false` when detected, `null` when the endpoint does not expose bucket versioning. */
  versioningEnabled?: boolean | null
}

/** Base error carrying the HTTP status and the provider error code (if any). */
export class RemoteStorageError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.name = 'RemoteStorageError'
    this.status = status
    this.code = code
  }
}

/** Thrown when the object (or, on HEAD, the bucket/key combination) does not exist. */
export class RemoteNotFoundError extends RemoteStorageError {
  constructor(message = 'remote object not found') {
    super(message, 404, 'NotFound')
    this.name = 'RemoteNotFoundError'
  }
}

/** Thrown when a guarded save hits an ETag mismatch (plan consensus Q6: the caller adjudicates). */
export class RemoteConflictError extends RemoteStorageError {
  readonly key: string
  readonly expectedEtag: string
  readonly currentEtag: string

  constructor(key: string, expectedEtag: string, currentEtag: string) {
    super(`remote object changed since it was loaded: ${key}`, 409, 'EtagMismatch')
    this.name = 'RemoteConflictError'
    this.key = key
    this.expectedEtag = expectedEtag
    this.currentEtag = currentEtag
  }
}
