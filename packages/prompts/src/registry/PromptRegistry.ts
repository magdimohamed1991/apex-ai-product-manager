import { PromptRenderer } from '../renderer/PromptRenderer'
import type { RenderedPrompt } from '../renderer/PromptRenderer'
import type { RepositoryPromptVariables } from '../variables/repository'

type PromptId = 'repository-intelligence'

interface PromptEntry {
  id: PromptId
  versions: string[]
  latestVersion: string
}

/**
 * Central registry for all APEX prompt templates.
 * Enables versioning, A/B testing, and audit trails.
 */
export class PromptRegistry {
  private readonly renderer = new PromptRenderer()

  private readonly registry: Record<PromptId, PromptEntry> = {
    'repository-intelligence': {
      id: 'repository-intelligence',
      versions: ['v1'],
      latestVersion: 'v1',
    },
  }

  get(
    id: 'repository-intelligence',
    variables: RepositoryPromptVariables,
    version?: string
  ): RenderedPrompt
  get(id: PromptId, variables: unknown, version?: string): RenderedPrompt {
    const entry = this.registry[id]
    if (!entry) throw new Error(`Prompt "${id}" not found in registry`)

    const v = version ?? entry.latestVersion

    if (id === 'repository-intelligence') {
      return this.renderer.renderRepositoryIntelligence(variables as RepositoryPromptVariables, v)
    }

    throw new Error(`No renderer found for prompt "${id}"`)
  }

  list(): PromptEntry[] {
    return Object.values(this.registry)
  }

  versions(id: PromptId): string[] {
    return this.registry[id]?.versions ?? []
  }
}

export const promptRegistry = new PromptRegistry()
