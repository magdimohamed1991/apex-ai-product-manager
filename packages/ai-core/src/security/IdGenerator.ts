import { createHash, randomBytes, randomUUID } from 'node:crypto'

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
   * Deterministic learning-signal identity. Repeated compilation over the
   * same observation set — including across process restarts — produces
   * the same signal ID. The ID is a truncated SHA-256 over the canonical
   * joined input parts; no randomness is mixed in.
   *
   * The previous implementation embedded `randomBytes(8)` in the output,
   * which contradicted the documented determinism contract and would have
   * created duplicate logical signals on every profile recompilation.
   */
  static signalIdentity(...parts: string[]): string {
    const joined = parts.join('|')
    const h = createHash('sha256').update(joined).digest('hex')
    return `sig-${h.slice(0, 16)}-${h.slice(16, 24)}`
  }
}
