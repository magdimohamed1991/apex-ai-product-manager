import type { WorkspaceId, Severity, IntegrationType } from '../value-objects'

/**
 * An Insight is a piece of intelligence discovered by any agent.
 * It does not know which agent produced it — only the source integration.
 */
export interface Insight {
  id: string
  workspaceId: WorkspaceId
  title: string
  description: string
  confidence: number // 0–1
  severity: Severity
  source: IntegrationType
  evidence: string[]
  tags: string[]
  explanationId?: string // link to Explanation entity
  createdAt: Date
}
