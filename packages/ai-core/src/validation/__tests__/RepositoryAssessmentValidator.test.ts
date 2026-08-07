import { describe, it, expect } from 'vitest'
import { RepositoryAssessmentValidator } from '../RepositoryAssessmentValidator'

const validAssessment = {
  executiveSummary: 'The repository is well-structured with TypeScript and CI.',
  strengths: ['TypeScript', 'CI configured', 'Monorepo'],
  risks: [
    {
      title: 'No automated tests',
      severity: 'high',
      description: 'No test framework detected.',
      recommendedAction: 'Add Vitest',
    },
  ],
  technicalDebt: {
    level: 'medium',
    reasoning: 'Missing tests increase risk.',
    estimatedEffortDays: 5,
  },
  engineeringPriorities: [
    {
      rank: 1,
      title: 'Add automated tests',
      rationale: 'Reduces deployment risk',
      effort: 'medium',
      impact: 'high',
    },
  ],
  confidence: 0.85,
}

describe('RepositoryAssessmentValidator', () => {
  const validator = new RepositoryAssessmentValidator()

  describe('valid input', () => {
    it('passes valid assessment', () => {
      const result = validator.validate(validAssessment)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('missing fields', () => {
    it('fails when executiveSummary is missing', () => {
      const result = validator.validate({ ...validAssessment, executiveSummary: '' })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('executiveSummary'))).toBe(true)
    })

    it('fails when risks is empty', () => {
      const result = validator.validate({ ...validAssessment, risks: [] })
      expect(result.valid).toBe(false)
    })

    it('fails when engineeringPriorities is empty', () => {
      const result = validator.validate({ ...validAssessment, engineeringPriorities: [] })
      expect(result.valid).toBe(false)
    })

    it('fails when technicalDebt is missing', () => {
      const { technicalDebt: _, ...rest } = validAssessment
      const result = validator.validate(rest)
      expect(result.valid).toBe(false)
    })

    it('fails when confidence is out of range', () => {
      const result = validator.validate({ ...validAssessment, confidence: 1.5 })
      expect(result.valid).toBe(false)
    })

    it('fails when confidence is negative', () => {
      const result = validator.validate({ ...validAssessment, confidence: -0.1 })
      expect(result.valid).toBe(false)
    })
  })

  describe('invalid severity', () => {
    it('fails when risk severity is invalid', () => {
      const bad = {
        ...validAssessment,
        risks: [{ ...validAssessment.risks[0], severity: 'extreme' }],
      }
      const result = validator.validate(bad)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('severity'))).toBe(true)
    })
  })

  describe('non-object input', () => {
    it('fails for null', () => {
      expect(validator.validate(null).valid).toBe(false)
    })

    it('fails for string', () => {
      expect(validator.validate('some string').valid).toBe(false)
    })

    it('fails for number', () => {
      expect(validator.validate(42).valid).toBe(false)
    })
  })

  describe('parseJSON', () => {
    it('parses valid JSON', () => {
      const result = validator.parseJSON('{"key": "value"}')
      expect(result).toEqual({ key: 'value' })
    })

    it('strips markdown code blocks', () => {
      const result = validator.parseJSON('```json\n{"key": "value"}\n```')
      expect(result).toEqual({ key: 'value' })
    })

    it('throws on invalid JSON', () => {
      expect(() => validator.parseJSON('not json')).toThrow()
    })
  })
})
