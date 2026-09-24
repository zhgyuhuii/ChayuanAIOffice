/**
 * `remote://<configId>/<key>` URI helpers (plan consensus Q9).
 *
 * Remote files flow through the same string-typed channels as local absolute
 * paths (recents, project-store fileMap), so the URI must round-trip any
 * object key, including CJK names, spaces and empty path segments. Keys are
 * stored unencoded at the API boundary; encoding happens per segment here.
 */

const REMOTE_URI_SCHEME = 'remote://'

export function isRemoteUri(value: string): boolean {
  return typeof value === 'string' && value.startsWith(REMOTE_URI_SCHEME)
}

/** Builds a remote URI. Throws on ids/keys that cannot round-trip. */
export function formatRemoteUri(configId: string, key: string): string {
  if (!configId || configId.includes('/')) {
    throw new Error(`invalid remote storage config id: "${configId}"`)
  }
  if (!key || key.startsWith('/')) {
    throw new Error(`invalid remote object key: "${key}"`)
  }
  const encodedKey = key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${REMOTE_URI_SCHEME}${configId}/${encodedKey}`
}

/** Parses a remote URI; returns null for anything that is not a valid remote URI. */
export function parseRemoteUri(uri: string): { configId: string; key: string } | null {
  if (!isRemoteUri(uri)) return null
  const rest = uri.slice(REMOTE_URI_SCHEME.length)
  const separator = rest.indexOf('/')
  if (separator <= 0) return null
  const configId = rest.slice(0, separator)
  if (configId.includes('/')) return null
  try {
    const key = rest
      .slice(separator + 1)
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/')
    if (!key) return null
    return { configId, key }
  } catch {
    return null
  }
}
