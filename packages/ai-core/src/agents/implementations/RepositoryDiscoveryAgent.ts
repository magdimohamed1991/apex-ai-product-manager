import { BaseAgent } from '../base'
import type { AgentContext } from '../contracts'
import { RepositoryDiscoveryPipeline } from '../../intelligence/pipeline'
import type { PipelineInput, PipelineResult } from '../../intelligence/pipeline'

export type RepositoryDiscoveryInput = PipelineInput
export type RepositoryDiscoveryOutput = PipelineResult

/**
 * Repository Discovery Agent
 *
 * Thin orchestrator over RepositoryDiscoveryPipeline.
 * No LLM — pure static analysis with full domain output:
 * summary, evidence, insights, findings, explanations, recommendations.
 */
export class RepositoryDiscoveryAgent extends BaseAgent<
  RepositoryDiscoveryInput,
  RepositoryDiscoveryOutput
> {
  readonly id = 'repository-discovery'
  readonly name = 'Repository Discovery Agent'
  readonly version = '2.0.0'

  private readonly pipeline = new RepositoryDiscoveryPipeline()

  protected async run(
    input: RepositoryDiscoveryInput,
    _context: AgentContext
  ): Promise<RepositoryDiscoveryOutput> {
    return this.pipeline.run(input)
  }
}
