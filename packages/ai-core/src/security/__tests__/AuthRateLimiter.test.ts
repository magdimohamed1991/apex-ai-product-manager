import { describe, it, expect, beforeEach } from 'vitest'
import { AuthRateLimiter } from '../AuthRateLimiter'

describe('AuthRateLimiter (Milestone I - Production Hardening)', () => {
  let limiter: AuthRateLimiter
  beforeEach(() => {
    limiter = new AuthRateLimiter(3, 1000) // 3 attempts per 1s for fast tests
  })

  it('allows the first attempt', () => {
    const r = limiter.check('ip-1')
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(3)
  })

  it('blocks after maxAttempts failures', () => {
    expect(limiter.recordFailure('ip-1').allowed).toBe(true)
    expect(limiter.recordFailure('ip-1').allowed).toBe(true)
    expect(limiter.recordFailure('ip-1').allowed).toBe(true)
    const r4 = limiter.recordFailure('ip-1')
    expect(r4.allowed).toBe(false)
    expect(r4.retryAfterMs).toBeDefined()
  })

  it('isolates buckets by key', () => {
    limiter.recordFailure('ip-1')
    limiter.recordFailure('ip-1')
    limiter.recordFailure('ip-1')
    // ip-1 is now blocked, but ip-2 is independent
    expect(limiter.check('ip-2').allowed).toBe(true)
  })

  it('recordSuccess clears the bucket', () => {
    limiter.recordFailure('ip-1')
    limiter.recordFailure('ip-1')
    limiter.recordSuccess('ip-1')
    expect(limiter.check('ip-1').allowed).toBe(true)
  })

  it('rejects brute-force within window', () => {
    for (let i = 0; i < 10; i++) {
      const res = limiter.recordFailure('attacker')
      if (!res.allowed) {
        expect(res.retryAfterMs).toBeGreaterThan(0)
        return
      }
    }
    throw new Error('expected to block before 10 attempts with max=3')
  })
})
