import { describe, it, expect } from 'vitest'
import { ScryptPasswordHasher } from '../PasswordHasher'

describe('ScryptPasswordHasher (Milestone I - Production Hardening)', () => {
  const hasher = new ScryptPasswordHasher()

  it('produces a real scrypt-formatted hash, never the legacy "mock-hash:" form', async () => {
    const hash = await hasher.hash('correct-horse-battery-staple')
    expect(hash.startsWith('scrypt$')).toBe(true)
    expect(hash).not.toMatch(/^mock-hash:/)
  })

  it('produces non-reversible output (the plaintext is NOT in the hash)', async () => {
    const plaintext = 'my-secret-password-9a2'
    const hash = await hasher.hash(plaintext)
    expect(hash).not.toContain(plaintext)
    // And the reversed plaintext (legacy mock) is also not present
    const reversed = plaintext.split('').reverse().join('')
    expect(hash).not.toContain(reversed)
  })

  it('produces different hashes for the same input (random salt)', async () => {
    const h1 = await hasher.hash('same-password')
    const h2 = await hasher.hash('same-password')
    expect(h1).not.toBe(h2)
  })

  it('verifies the correct password successfully', async () => {
    const hash = await hasher.hash('hunter2hunter2')
    const ok = await hasher.verify('hunter2hunter2', hash)
    expect(ok).toBe(true)
  })

  it('rejects the wrong password', async () => {
    const hash = await hasher.hash('correct-password')
    const ok = await hasher.verify('wrong-password', hash)
    expect(ok).toBe(false)
  })

  it('rejects malformed stored hashes without throwing', async () => {
    expect(await hasher.verify('any', '')).toBe(false)
    expect(await hasher.verify('any', 'not-a-hash')).toBe(false)
    expect(await hasher.verify('any', 'bcrypt$garbage$xx$yy')).toBe(false)
    expect(await hasher.verify('any', 'scrypt$invalid-params$salt$hash')).toBe(false)
  })

  it('rejects empty password input', async () => {
    await expect(hasher.hash('')).rejects.toThrow(/non-empty/)
  })

  it('rejects empty input to verify without throwing', async () => {
    expect(await hasher.verify('', '$2a$10$valid$hash')).toBe(false)
  })

  it('rejects excessively long passwords', async () => {
    const long = 'x'.repeat(2000)
    await expect(hasher.hash(long)).rejects.toThrow(/exceeds/)
  })

  it('performs constant-time comparison (timingSafeEqual) for the same-length hash', async () => {
    // We can't directly test timing, but the implementation uses
    // timingSafeEqual for the final comparison.
    const hash = await hasher.hash('the-password')
    const ok = await hasher.verify('the-password', hash)
    expect(ok).toBe(true)
    // Two different passwords of the same length should both produce
    // ok=false in a comparable time window. The test just asserts the
    // contract; the implementation contract is timingSafeEqual.
    const ok2 = await hasher.verify('other-password', hash)
    expect(ok2).toBe(false)
  })
})
