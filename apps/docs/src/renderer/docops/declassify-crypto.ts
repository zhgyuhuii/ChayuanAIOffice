// declassify-crypto — the chayuan-wps documentDeclassifyCrypto.js scheme ported:
// PBKDF2-SHA-256 (210000 iterations, 16-byte random salt) derives an AES-256-GCM
// key (12-byte random IV). GCM's built-in authentication turns a wrong password
// into a clean decrypt failure. Runs in the Electron renderer via WebCrypto.

const KDF_ITERATIONS = 210_000
const SALT_BYTES = 16
const IV_BYTES = 12

export interface DeclassifyEnvelope {
  algorithm: 'AES-GCM-256'
  keyDerivation: { algorithm: 'PBKDF2-SHA-256'; iterations: number; salt: string }
  iv: string
  ciphertext: string
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

async function deriveKeyWith(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: KDF_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** seal a JSON payload with the user's password */
export async function encryptPayloadWithPassword(
  payload: unknown,
  password: string,
): Promise<DeclassifyEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKeyWith(password, salt)
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    plaintext,
  )
  return {
    algorithm: 'AES-GCM-256',
    keyDerivation: {
      algorithm: 'PBKDF2-SHA-256',
      iterations: KDF_ITERATIONS,
      salt: toBase64(salt),
    },
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  }
}

/** open an envelope; throws on wrong password / tampered data (GCM auth) */
export async function decryptPayload<T>(
  envelope: DeclassifyEnvelope,
  password: string,
): Promise<T> {
  const salt = fromBase64(envelope.keyDerivation.salt)
  const iv = fromBase64(envelope.iv)
  const key = await deriveKeyWith(password, salt)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    fromBase64(envelope.ciphertext) as unknown as BufferSource,
  )
  return JSON.parse(new TextDecoder().decode(plaintext)) as T
}

/** SHA-256 fingerprint, base64 — the wps textHashes channel */
export async function fingerprintText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return toBase64(new Uint8Array(digest))
}
