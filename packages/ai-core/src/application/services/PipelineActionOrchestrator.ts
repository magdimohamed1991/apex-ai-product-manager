import type { Action } from '../../domain/entities'
import type { WorkspaceId } from '../../domain/value-objects'
import { ActionApplicationService } from './ActionApplicationService'
import { RepositoryDiscoveryPipeline } from '../../intelligence/pipeline/RepositoryDiscoveryPipeline'
import type { RepositoryFiles, Evidence } from '@apex/analysis'

export interface PipelineRunResult {
  pipelineRunId: string
  workspaceId: WorkspaceId
  promotedActions: Action[]
  failedPromotions: Array<{ proposedActionId: string; reason: string }>
}

/**
 * Pipeline Action Orchestrator (Milestone E)
 *
 * Connects the discovery analysis pipeline to the Action application,
 * promotion, and background execution workers. Acts as the clean boundary
 * without bloating RepositoryDiscoveryPipeline or violating upstream freezes.
 */
export class PipelineActionOrchestrator {
  constructor(
    private readonly pipeline: RepositoryDiscoveryPipeline,
    private readonly service: ActionApplicationService
  ) {}

  /**
   * Runs the discovery pipeline, extracts proposed actions, and automatically
   * promotes them into Actions idempotently with failure isolation.
   */
  async runPipelineAndPromote(
    workspaceId: WorkspaceId,
    files: RepositoryFiles,
    externalEvidence?: Evidence[]
  ): Promise<PipelineRunResult> {
    const pipelineRunId = `run-${crypto.randomUUID()}`
    
    // 1. Execute the frozen analysis pipeline
    const pipelineResult = this.pipeline.run({
      workspaceId,
      files,
      externalEvidence,
    })

    const promotedActions: Action[] = []
    const failedPromotions: Array<{ proposedActionId: string; reason: string }> = []

    // 2. Iterate through all produced recommendations and proposed actions (Item 3)
    for (const rec of pipelineResult.recommendations) {
      for (const pa of rec.proposedActions) {
        try {
          // 3. Promote ProposedAction atomically and idempotently
          const action = await this.service.promoteProposedAction(rec, pa)
          promotedActions.push(action)
        } catch (err) {
          // 4. Failure Isolation Policy: Accumulate failures without crashing pipeline (Item 4)
          failedPromotions.push({
            proposedActionId: pa.id,
            reason: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    return {
      pipelineRunId,
      workspaceId,
      promotedActions,
      failedPromotions,
    }
  }
}
