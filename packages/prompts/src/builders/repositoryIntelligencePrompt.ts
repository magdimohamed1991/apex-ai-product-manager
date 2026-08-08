import { promptRegistry } from '../registry/PromptRegistry'
import type { RepositoryPromptVariables } from '../variables/repository'

/**
 * @deprecated Use promptRegistry.get('repository-intelligence', variables) directly.
 * This wrapper exists for backward compatibility only and delegates to the canonical path.
 */
export function buildRepositoryIntelligencePrompt(input: RepositoryPromptVariables): string {
  const rendered = promptRegistry.get('repository-intelligence', input)
  return rendered.content
}
