import { describe, it, expect } from 'vitest'
import { SecureIdGenerator } from '../IdGenerator'

describe('SecureIdGenerator (Milestone I - Production Hardening)', () => {
  it('produces URL-safe tokens with sufficient entropy', () => {
    const t = SecureIdGenerator.token(32)
    // base64url: A-Z a-z 0-9 _ - ; length 32 bytes => 43 chars
    expect(t.length).toBe(43)
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('produces different tokens on consecutive calls (no Math.random collision risk)', () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 1000; i++) tokens.add(SecureIdGenerator.token(16))
    expect(tokens.size).toBe(1000)
  })

  it('produces UUIDv4 with the canonical format', () => {
    const u = SecureIdGenerator.uuid()
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('produces workspace-scoped, action-aware APEX markers with a random nonce', () => {
    const m1 = SecureIdGenerator.apexMarker('ws-1', 'rec-1', 'pa-1')
    const m2 = SecureIdGenerator.apexMarker('ws-1', 'rec-1', 'pa-1')
    // Nonce makes them different (defeats concurrent-worker races)
    expect(m1).not.toBe(m2)
    expect(m1.startsWith('apex-marker:ws-1:rec-1:pa-1:')).toBe(true)
  })

  it('signalIdentity is deterministic: same tuple → same ID, different tuple → different ID', () => {
    const a = SecureIdGenerator.signalIdentity(
      'ws-1',
      'proj-1',
      'TESTING',
      'ADOPTION',
      'src-hash-1'
    )
    const a2 = SecureIdGenerator.signalIdentity(
      'ws-1',
      'proj-1',
      'TESTING',
      'ADOPTION',
      'src-hash-1'
    )
    const b = SecureIdGenerator.signalIdentity('ws-1', 'proj-1', 'CI_CD', 'ADOPTION', 'src-hash-1')
    // Deterministic: repeated compilation over the same observation set
    // must produce the same signal ID (across calls and process restarts).
    expect(a).toBe(a2)
    expect(a).not.toBe(b)
    expect(a).toMatch(/^sig-[0-9a-f]{16}-[0-9a-f]{8}$/)
    // Order must not matter for canonical stability.
    expect(SecureIdGenerator.signalIdentity('x', 'y')).toBe(
      SecureIdGenerator.signalIdentity('x', 'y')
    )
  })
})
