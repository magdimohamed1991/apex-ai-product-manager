/**
 * BudgetPolicy controls LLM spending.
 * When limits are exceeded, falls back to MockLLMProvider.
 *
 * Goal: $0 cost during development, controlled cost in production.
 */
export interface BudgetPolicy {
  maxTokensPerRequest: number
  maxDailyCostUsd: number | null // null = no limit
  fallbackToMock: boolean
}

export const DevelopmentBudgetPolicy: BudgetPolicy = {
  maxTokensPerRequest: 4000,
  maxDailyCostUsd: 0, // $0 — always use mock in dev
  fallbackToMock: true,
}

export const StagingBudgetPolicy: BudgetPolicy = {
  maxTokensPerRequest: 4000,
  maxDailyCostUsd: 5.0, // $5/day
  fallbackToMock: true,
}

export const ProductionBudgetPolicy: BudgetPolicy = {
  maxTokensPerRequest: 8000,
  maxDailyCostUsd: null, // unlimited — monitored via telemetry
  fallbackToMock: false,
}

export function shouldFallbackToMock(
  policy: BudgetPolicy,
  estimatedTokens: number,
  dailySpendUsd: number
): boolean {
  if (estimatedTokens > policy.maxTokensPerRequest) return policy.fallbackToMock
  if (policy.maxDailyCostUsd !== null && dailySpendUsd >= policy.maxDailyCostUsd)
    return policy.fallbackToMock
  return false
}
