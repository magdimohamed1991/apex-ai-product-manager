/**
 * Re-export canonical SourceReference from @apex/contracts.
 *
 * The single source of truth for SourceReference now lives in @apex/contracts,
 * making it available to both @apex/analysis and @apex/ai-core without
 * violating the dependency direction (analysis cannot import from ai-core).
 *
 * Both packages depend on contracts, so both can use the same type.
 */
export type { SourceReference } from '@apex/contracts'
