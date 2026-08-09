/**
 * Per-identifier rate limiter for authentication attempts (Milestone I -
 * Production Hardening)
 *
 * Purpose: defeat credential stuffing and password guessing.
 *
 * Strategy: token-bucket per (IP + endpoint) with a fixed time window.
 * Beyond 5 failed attempts within 15 minutes, the endpoint returns 429.
 *
 * Scope: this is a single-process, in-memory limiter appropriate for the
 * supported single-process architecture. For multi-process deployments,
 * replace with a shared store (Redis, etc.) behind the same interface.
 */

interface Bucket {
  count: number
  resetAt: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetInMs: number
  retryAfterMs?: number
}

export class AuthRateLimiter {
  private readonly buckets = new Map<string, Bucket>()
  private readonly maxAttempts: number
  private readonly windowMs: number

  constructor(maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    this.maxAttempts = maxAttempts
    this.windowMs = windowMs
  }

  /**
   * Record a failed attempt and return whether the next call should be
   * allowed. If allowed, the attempt is NOT counted; the caller only
   * counts it via `recordFailure`.
   */
  check(key: string): RateLimitResult {
    const now = Date.now()
    const b = this.buckets.get(key)
    if (!b || b.resetAt < now) {
      return { allowed: true, remaining: this.maxAttempts, resetInMs: this.windowMs }
    }
    return {
      allowed: b.count < this.maxAttempts,
      remaining: Math.max(0, this.maxAttempts - b.count),
      resetInMs: b.resetAt - now,
    }
  }

  recordFailure(key: string): RateLimitResult {
    const now = Date.now()
    const existing = this.buckets.get(key)
    if (!existing || existing.resetAt < now) {
      const b: Bucket = { count: 1, resetAt: now + this.windowMs }
      this.buckets.set(key, b)
      return { allowed: true, remaining: this.maxAttempts - 1, resetInMs: this.windowMs }
    }
    existing.count += 1
    const allowed = existing.count <= this.maxAttempts
    return {
      allowed,
      remaining: Math.max(0, this.maxAttempts - existing.count),
      resetInMs: existing.resetAt - now,
      retryAfterMs: allowed ? undefined : existing.resetAt - now,
    }
  }

  recordSuccess(key: string): void {
    this.buckets.delete(key)
  }

  /** Test hook — clear all rate-limit state. */
  reset(): void {
    this.buckets.clear()
  }
}
