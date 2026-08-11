/**
 * Per-identifier rate limiter for API endpoints (H8 Security Hardening).
 *
 * Purpose: prevent abuse of data-heavy API endpoints.
 *
 * Strategy: sliding-window counter per (workspaceId + endpoint) with a
 * fixed time window. Defaults: 60 requests per minute per workspace.
 *
 * Scope: single-process, in-memory limiter appropriate for the supported
 * single-process architecture.
 */

interface Bucket {
  count: number
  resetAt: number
}

export interface ApiRateLimitResult {
  allowed: boolean
  remaining: number
  resetInMs: number
  retryAfterMs?: number
}

export class ApiRateLimiter {
  private readonly buckets = new Map<string, Bucket>()
  private readonly maxRequests: number
  private readonly windowMs: number

  constructor(maxRequests = 60, windowMs = 60 * 1000) {
    this.maxRequests = maxRequests
    this.windowMs = windowMs
  }

  check(key: string): ApiRateLimitResult {
    const now = Date.now()
    const b = this.buckets.get(key)
    if (!b || b.resetAt < now) {
      return { allowed: true, remaining: this.maxRequests, resetInMs: this.windowMs }
    }
    return {
      allowed: b.count < this.maxRequests,
      remaining: Math.max(0, this.maxRequests - b.count),
      resetInMs: b.resetAt - now,
    }
  }

  record(key: string): ApiRateLimitResult {
    const now = Date.now()
    const existing = this.buckets.get(key)
    if (!existing || existing.resetAt < now) {
      const b: Bucket = { count: 1, resetAt: now + this.windowMs }
      this.buckets.set(key, b)
      return { allowed: true, remaining: this.maxRequests - 1, resetInMs: this.windowMs }
    }
    existing.count += 1
    const allowed = existing.count <= this.maxRequests
    return {
      allowed,
      remaining: Math.max(0, this.maxRequests - existing.count),
      resetInMs: existing.resetAt - now,
      retryAfterMs: allowed ? undefined : existing.resetAt - now,
    }
  }

  reset(): void {
    this.buckets.clear()
  }
}
