import { describe, it, expect } from 'vitest'
import {
  DevelopmentBudgetPolicy,
  StagingBudgetPolicy,
  ProductionBudgetPolicy,
  shouldFallbackToMock,
} from '../BudgetPolicy'

describe('BudgetPolicy', () => {
  describe('DevelopmentBudgetPolicy', () => {
    it('has $0 daily limit', () => {
      expect(DevelopmentBudgetPolicy.maxDailyCostUsd).toBe(0)
    })

    it('falls back to mock', () => {
      expect(DevelopmentBudgetPolicy.fallbackToMock).toBe(true)
    })
  })

  describe('StagingBudgetPolicy', () => {
    it('has $5 daily limit', () => {
      expect(StagingBudgetPolicy.maxDailyCostUsd).toBe(5)
    })

    it('falls back to mock', () => {
      expect(StagingBudgetPolicy.fallbackToMock).toBe(true)
    })
  })

  describe('ProductionBudgetPolicy', () => {
    it('has no daily limit', () => {
      expect(ProductionBudgetPolicy.maxDailyCostUsd).toBeNull()
    })

    it('does not fall back to mock', () => {
      expect(ProductionBudgetPolicy.fallbackToMock).toBe(false)
    })
  })

  describe('shouldFallbackToMock', () => {
    it('returns true when daily cost reaches limit', () => {
      const result = shouldFallbackToMock(StagingBudgetPolicy, 100, 5.0)
      expect(result).toBe(true)
    })

    it('returns false when under daily limit', () => {
      const result = shouldFallbackToMock(StagingBudgetPolicy, 100, 2.0)
      expect(result).toBe(false)
    })

    it('returns true when tokens exceed per-request limit', () => {
      const result = shouldFallbackToMock(DevelopmentBudgetPolicy, 9999, 0)
      expect(result).toBe(true)
    })

    it('returns false for production with no limit', () => {
      const result = shouldFallbackToMock(ProductionBudgetPolicy, 100, 100)
      expect(result).toBe(false)
    })

    it('always falls back in development (daily $0)', () => {
      const result = shouldFallbackToMock(DevelopmentBudgetPolicy, 10, 0.01)
      expect(result).toBe(true)
    })
  })
})
