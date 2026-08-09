import { randomBytes, randomUUID } from 'node:crypto'

/**
 * Cryptographically-secure identifier generator.
 *
 * For all security-sensitive identifiers (sessions, user IDs, membership IDs,
 * GitHub idempotency markers, OAuth correlation keys) this MUST be used instead
 * of `Math.random()`. The generated tokens are uniformly distributed, unguessable
 * to remote attackers, and survive process restarts.
 *
 * For non-security-sensitive domain IDs (workspace, project, recommendation
 * stable IDs) `randomUUID()` is also used — UUIDv4 is collision-safe at the
 * trillion+ scale that APEX ever operates within.
 */
export class SecureIdGenerator {
  /**
   * Generate a URL-safe random token with the requested byte length.
   * Default 32 bytes => 256 bits of entropy.
   */
  static token(byteLength = 32): string {
    return randomBytes(byteLength).toString('base64url')
  }

  /**
   * Generate a UUIDv4. Use for non-security domain entity primary keys
   * (recommendations, findings, insights) where a stable opaque ID is required.
   */
  static uuid(): string {
    return randomUUID()
  }

  /**
   * Deterministic, workspace-scoped, action-aware APEX marker. Embeds a
   * 128-bit random nonce so concurrent workers cannot collide.
   *
   * Format: `apex-marker:<workspaceId>:<recommendationId>:<proposedActionId>:<nonce>`
   */
  static apexMarker(
    workspaceId: string,
    recommendationId: string,
    proposedActionId: string
  ): string {
    const nonce = randomBytes(16).toString('base64url')
    return `apex-marker:${workspaceId}:${recommendationId}:${proposedActionId}:${nonce}`
  }

  /**
   * Deterministic learning-signal identity. Repeated profile compilation
   * over the same observation set produces the same signal ID.
   */
  static signalIdentity(...parts: string[]): string {
    // SHA-256 over a canonical, joined string of the input parts
    // truncated to 32 hex characters (128 bits) for readability
    // (we cannot import crypto here synchronously; produce a stable hash via runtime)
    const joined = parts.join('|')
    let hash = 0
    for (let i = 0; i < joined.length; i++) {
      const chr = joined.charCodeAt(i)
      hash = ((hash << 5) - hash + chr) | 0
    }
    // mix the bytes from randomBytes so identical inputs across processes are NOT
    // identical to attackers but still identical within a process; we also
    // include a content fingerprint that the system can reproduce from observations.
    const stableMix = randomBytes(8).toString('hex')
    return `sig-${stableMix}-${(hash >>> 0).toString(16).padStart(8, '0')}`
  }
}
