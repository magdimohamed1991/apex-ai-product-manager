import { scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

/**
 * Secure password hashing (Milestone I - Production Hardening)
 *
 * Uses Node's built-in `scrypt` algorithm — a memory-hard, tunable cost KDF that
 * does not require native compilation. This is preferred over a third-party Argon2
 * dependency to keep the single-process build free of node-gyp / prebuilt binaries.
 *
 * Format: `scrypt$N=2^15,r=8,p=1$<salt-b64>$<hash-b64>`
 *  - N: CPU/memory cost (2^15 = 32768)
 *  - r: block size (8)
 *  - p: parallelization (1)
 *  - salt: 16 random bytes, base64 encoded
 *  - hash: 64 random bytes, base64 encoded
 *
 * The format is forward-compatible: cost parameters are stored in the hash
 * so they can be increased over time without breaking existing credentials.
 */

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number }
) => Promise<Buffer>

// Fixed parameters — keep stable for cross-version compatibility.
const SCRYPT_N = 2 ** 15
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64
const SCRYPT_SALT_BYTES = 16
// scrypt requires maxmem > 128 * N * r * p
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * SCRYPT_P * 2

export interface PasswordHasher {
  hash(plaintext: string): Promise<string>
  verify(plaintext: string, stored: string): Promise<boolean>
}

export class ScryptPasswordHasher implements PasswordHasher {
  async hash(plaintext: string): Promise<string> {
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
      throw new Error('Password must be a non-empty string')
    }
    if (plaintext.length > 1024) {
      // Practical limit; legitimate passwords do not approach this size
      throw new Error('Password exceeds maximum supported length (1024 characters)')
    }
    const saltBuf = randomBytes(SCRYPT_SALT_BYTES)
    const hashBuf = await scrypt(plaintext.normalize('NFKC'), saltBuf, SCRYPT_KEYLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAXMEM,
    })
    return `scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${saltBuf.toString('base64')}$${hashBuf.toString('base64')}`
  }

  async verify(plaintext: string, stored: string): Promise<boolean> {
    if (typeof plaintext !== 'string' || typeof stored !== 'string') {
      return false
    }
    const parts = stored.split('$')
    if (parts.length !== 4 || parts[0] !== 'scrypt') {
      return false
    }
    const [, paramsRaw, saltB64, hashB64] = parts
    const params = Object.fromEntries(
      paramsRaw.split(',').map((kv) => {
        const [k, v] = kv.split('=')
        return [k, Number(v)]
      })
    ) as { N: number; r: number; p: number }

    if (!params.N || !params.r || !params.p) {
      return false
    }

    const expected = Buffer.from(hashB64, 'base64')
    const salt = Buffer.from(saltB64, 'base64')
    if (expected.length === 0 || salt.length === 0) {
      return false
    }
    let actual: Buffer
    try {
      actual = await scrypt(plaintext.normalize('NFKC'), salt, expected.length, {
        N: params.N,
        r: params.r,
        p: params.p,
        maxmem: 128 * params.N * params.r * params.p * 2,
      })
    } catch {
      return false
    }
    if (actual.length !== expected.length) {
      return false
    }
    // timingSafeEqual guards against timing-side-channel password matching
    return timingSafeEqual(actual, expected)
  }
}
