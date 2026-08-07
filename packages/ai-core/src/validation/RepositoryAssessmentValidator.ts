import type { RepositoryAssessment } from '@apex/prompts'

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Validates LLM output before it enters the domain.
 * Never trust the LLM — always validate structured output.
 *
 * On failure: retry once, then return a structured error.
 */
export class RepositoryAssessmentValidator {
  validate(raw: unknown): ValidationResult {
    const errors: string[] = []

    if (!raw || typeof raw !== 'object') {
      return { valid: false, errors: ['Response is not an object'] }
    }

    const obj = raw as Partial<RepositoryAssessment>

    if (
      !obj.executiveSummary ||
      typeof obj.executiveSummary !== 'string' ||
      obj.executiveSummary.trim().length === 0
    ) {
      errors.push('executiveSummary is missing or empty')
    }

    if (!Array.isArray(obj.strengths)) {
      errors.push('strengths must be an array')
    }

    if (!Array.isArray(obj.risks) || obj.risks.length === 0) {
      errors.push('risks must be a non-empty array')
    } else {
      obj.risks.forEach((risk, i) => {
        if (!risk.title) errors.push(`risks[${i}].title is missing`)
        if (!['critical', 'high', 'medium', 'low'].includes(risk.severity)) {
          errors.push(`risks[${i}].severity is invalid: ${risk.severity}`)
        }
      })
    }

    if (!obj.technicalDebt || typeof obj.technicalDebt !== 'object') {
      errors.push('technicalDebt is missing')
    } else {
      if (!['low', 'medium', 'high', 'critical'].includes(obj.technicalDebt.level)) {
        errors.push(`technicalDebt.level is invalid: ${obj.technicalDebt.level}`)
      }
      if (!obj.technicalDebt.reasoning) {
        errors.push('technicalDebt.reasoning is missing')
      }
    }

    if (!Array.isArray(obj.engineeringPriorities) || obj.engineeringPriorities.length === 0) {
      errors.push('engineeringPriorities must be a non-empty array')
    } else {
      obj.engineeringPriorities.forEach((p, i) => {
        if (!p.title) errors.push(`engineeringPriorities[${i}].title is missing`)
        if (typeof p.rank !== 'number')
          errors.push(`engineeringPriorities[${i}].rank must be a number`)
      })
    }

    if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 1) {
      errors.push('confidence must be a number between 0 and 1')
    }

    return { valid: errors.length === 0, errors }
  }

  parseJSON(content: string): unknown {
    // Strip markdown code blocks if LLM wrapped the JSON
    const cleaned = content
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    try {
      return JSON.parse(cleaned)
    } catch {
      throw new Error(`Failed to parse LLM response as JSON: ${cleaned.slice(0, 200)}`)
    }
  }
}
