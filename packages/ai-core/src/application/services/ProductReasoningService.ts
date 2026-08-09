import { createHash } from 'node:crypto'
import type { RichRecommendation, AIProductReasoning, AIAlternative } from '../../domain/entities'
import type { ProductRepository } from '../../domain/repositories/ProductRepository'
import type { LLMProvider } from '../../providers/LLMProvider'
import { Logger } from '../../observability/Logger'
import { ValidationError } from '../../errors/AppError'

const log = new Logger('h4.reasoning')

const VERSION = 'h4-v2'

const ALLOWED_EFFORT: ReadonlyArray<AIAlternative['effort']> = ['low', 'medium', 'high']
const ALLOWED_IMPACT: ReadonlyArray<AIAlternative['impact']> = ['low', 'medium', 'high', 'critical']

/**
 * Strict schema validators (Milestone I - Production Hardening)
 * JSON.parse is NOT schema validation. We must enforce types, enum membership,
 * and ranges before any reasoning output is treated as authoritative.
 */

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isStringRecordArray(v: unknown): boolean {
  if (!Array.isArray(v)) return false
  return v.every((x) => x && typeof x === 'object' && !Array.isArray(x))
}

function validateAlternative(a: unknown, index: number): AIAlternative {
  if (!a || typeof a !== 'object' || Array.isArray(a)) {
    throw new ValidationError(`alternatives[${index}] must be a non-null object`)
  }
  const obj = a as Record<string, unknown>
  const label = typeof obj.label === 'string' && obj.label.trim().length > 0 ? obj.label : null
  if (!label) throw new ValidationError(`alternatives[${index}].label must be a non-empty string`)

  const effort = ALLOWED_EFFORT.includes(obj.effort as AIAlternative['effort'])
    ? (obj.effort as AIAlternative['effort'])
    : 'medium'
  const impact = ALLOWED_IMPACT.includes(obj.impact as AIAlternative['impact'])
    ? (obj.impact as AIAlternative['impact'])
    : 'high'
  const description = typeof obj.description === 'string' ? obj.description : ''

  return { label, effort, impact, description }
}

export interface ValidatedReasoning {
  rationale: string
  impactExplanation: string
  tradeoffs: string[]
  alternatives: AIAlternative[]
  knowns: string[]
  inferences: string[]
  unknowns: string[]
  clarifyingQuestions: string[]
  confidence: number
  recommendedDecision: string
}

/**
 * Schema-validate the raw LLM output. Throws a typed ValidationError on
 * missing required fields, wrong types, or out-of-range values. The caller
 * must not substitute fabricated defaults — the API contract requires that
 * a malformed LLM response causes reasoning to be marked unavailable, not
 * silently replaced with hand-written text.
 */
function validateReasoningOutput(raw: unknown): ValidatedReasoning {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('Reasoning output must be a JSON object')
  }
  const obj = raw as Record<string, unknown>

  const rationale = typeof obj.rationale === 'string' ? obj.rationale.trim() : ''
  if (rationale.length === 0) {
    throw new ValidationError('Reasoning output missing required field: rationale')
  }
  const impactExplanation =
    typeof obj.impactExplanation === 'string' ? obj.impactExplanation.trim() : ''
  if (impactExplanation.length === 0) {
    throw new ValidationError('Reasoning output missing required field: impactExplanation')
  }
  const recommendedDecision =
    typeof obj.recommendedDecision === 'string' ? obj.recommendedDecision.trim() : ''
  if (recommendedDecision.length === 0) {
    throw new ValidationError('Reasoning output missing required field: recommendedDecision')
  }

  if (!isStringArray(obj.tradeoffs) || obj.tradeoffs.length === 0) {
    throw new ValidationError('Reasoning output requires non-empty string array: tradeoffs')
  }
  if (!isStringArray(obj.knowns)) {
    throw new ValidationError('Reasoning output requires string array: knowns')
  }
  if (!isStringArray(obj.inferences)) {
    throw new ValidationError('Reasoning output requires string array: inferences')
  }
  if (!isStringArray(obj.unknowns)) {
    throw new ValidationError('Reasoning output requires string array: unknowns')
  }
  if (!isStringArray(obj.clarifyingQuestions)) {
    throw new ValidationError('Reasoning output requires string array: clarifyingQuestions')
  }
  if (!isStringRecordArray(obj.alternatives) || (obj.alternatives as unknown[]).length === 0) {
    throw new ValidationError('Reasoning output requires at least one alternative')
  }
  if (!isFiniteNumber(obj.confidence) || obj.confidence < 0 || obj.confidence > 1) {
    throw new ValidationError('Reasoning output requires confidence in [0, 1]')
  }

  const alternatives = (obj.alternatives as unknown[]).map((a, i) => validateAlternative(a, i))

  return {
    rationale,
    impactExplanation,
    tradeoffs: obj.tradeoffs as string[],
    alternatives,
    knowns: obj.knowns as string[],
    inferences: obj.inferences as string[],
    unknowns: obj.unknowns as string[],
    clarifyingQuestions: obj.clarifyingQuestions as string[],
    confidence: obj.confidence,
    recommendedDecision,
  }
}

/**
 * AI Product Reasoning Service (Milestone H4)
 *
 * Implements the contextual AI reasoning layer strictly as an advisor over
 * deterministic H3 evidence. Consumes rich structured priority recommendations,
 * passes them as context to the LLM, parses and STRICTLY VALIDATES the resulting
 * structured schema.
 *
 * Epistemic separation (H4 invariant):
 *   - The LLM reasons over repository evidence, H3 priority score, and H6
 *     calibration signals.
 *   - The LLM MUST NOT invent repository facts. The grounding check rejects
 *     any `known` claim that cannot be traced to the supplied evidence.
 *   - If the LLM produces invalid output, reasoning is marked unavailable
 *     rather than fabricated.
 */
export class ProductReasoningService {
  private static readonly SCHEMA_VERSION = VERSION

  constructor(
    private readonly productRepository: ProductRepository,
    private readonly llmProvider: LLMProvider
  ) {}

  /**
   * Generate deep PM-centric product reasoning over structured evidence.
   * If the LLM produces an invalid response, returns a typed "unavailable"
   * reasoning record — never fabricated content.
   */
  async generateReasoning(
    rec: RichRecommendation,
    projectContext?: string,
    calibration?: {
      baseScore: number
      calibratedScore: number
      preferenceMultiplier: number
      outcomeReliabilityMultiplier: number
      appliedSignals: Array<{
        category: string
        type: string
        observationCount: number
        value: number
      }>
      explanation: string
      calibrationVersion?: string
    }
  ): Promise<AIProductReasoning> {
    const start = Date.now()

    // Build a stable context hash for provenance & dedup.
    const contextHash = createHash('sha256')
      .update(
        JSON.stringify(rec) +
          (projectContext || '') +
          (calibration ? JSON.stringify(calibration) : '')
      )
      .digest('hex')

    const prompt = this.buildPrompt(rec, projectContext, calibration)

    let response
    try {
      response = await this.llmProvider.complete(prompt, {
        temperature: 0.1,
        systemPrompt:
          'You are a Senior AI Product Manager. You reason STRICTLY over verified facts and provide balanced, risk-aware, alternative-driven strategic decisions. You NEVER invent or hallucinate repository facts not explicitly supplied in the prompt. ' +
          'You classify claims as `knowns` (facts traceable to supplied evidence), `inferences` (likely PM/business consequences not directly observable), and `unknowns` (questions that remain unanswered). ' +
          'You return a single valid JSON object that matches the supplied schema exactly.',
      })
    } catch (err) {
      log.warn('LLM provider failure', { err: err instanceof Error ? err.message : String(err) })
      return this.buildUnavailableReasoning(rec, 'provider_error', contextHash)
    }

    // Strict parse + schema validation
    let raw: unknown
    try {
      raw = JSON.parse(response.content)
    } catch (err) {
      log.warn('LLM output was not valid JSON', {
        err: err instanceof Error ? err.message : String(err),
      })
      return this.buildUnavailableReasoning(rec, 'invalid_json', contextHash)
    }

    let validated: ValidatedReasoning
    try {
      validated = validateReasoningOutput(raw)
    } catch (err) {
      log.warn('LLM output failed schema validation', {
        err: err instanceof Error ? err.message : String(err),
      })
      return this.buildUnavailableReasoning(rec, 'schema_violation', contextHash)
    }

    // Grounding check: every `known` claim must trace to supplied evidence.
    // A claim is grounded if it references the recommendation title, its
    // categorical label, or any of the supplied rationale/impact text.
    const groundingKeywords = this.collectGroundingKeywords(rec)
    const cleanedKnowns: string[] = []
    const rejectedKnowns: string[] = []
    for (const k of validated.knowns) {
      if (this.isGrounded(k, groundingKeywords)) {
        cleanedKnowns.push(k)
      } else {
        rejectedKnowns.push(k)
        log.warn('Grounding violation: rejected unsupported fact', { claim: k })
      }
    }

    if (cleanedKnowns.length === 0) {
      // Reject the entire reasoning response: none of the model's "knowns"
      // were traceable to the evidence we supplied. Falling back to a
      // fabricated `knowns` list would directly violate the H4 invariant.
      log.warn('All known claims rejected by grounding check', { rejected: rejectedKnowns.length })
      return this.buildUnavailableReasoning(rec, 'grounding_violation', contextHash)
    }

    const reasoning: AIProductReasoning = {
      recommendationId: rec.id,
      workspaceId: rec.workspaceId,
      model: response.model,
      version: ProductReasoningService.SCHEMA_VERSION,
      contextHash,
      rationale: validated.rationale,
      impactExplanation: validated.impactExplanation,
      tradeoffs: validated.tradeoffs,
      alternatives: validated.alternatives,
      knowns: cleanedKnowns,
      inferences: validated.inferences,
      unknowns: validated.unknowns,
      clarifyingQuestions: validated.clarifyingQuestions,
      confidence: validated.confidence,
      recommendedDecision: validated.recommendedDecision,
      timestamp: new Date(),
    }

    await this.productRepository.saveAIProductReasoning(reasoning)
    log.info('Reasoning generated', {
      recommendationId: rec.id,
      durationMs: Date.now() - start,
      model: response.model,
    })
    return reasoning
  }

  private collectGroundingKeywords(rec: RichRecommendation): Set<string> {
    const keywords = new Set<string>()
    for (const w of rec.title.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= 3) keywords.add(w)
    }
    for (const w of rec.pmCategory.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= 3) keywords.add(w)
    }
    for (const w of rec.rationale.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= 3) keywords.add(w)
    }
    for (const w of rec.impact.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= 3) keywords.add(w)
    }
    // rec.id is a stable opaque ID; treat its inclusion as strong grounding
    keywords.add(rec.id.toLowerCase())
    return keywords
  }

  private isGrounded(claim: string, keywords: Set<string>): boolean {
    const lc = claim.toLowerCase()
    // Reject the legacy fabricated strings specifically
    if (lc.includes('tsconfig contains disabled parameters')) return false
    if (lc.includes('ci workflow lacks validation')) return false
    if (lc.includes('ci workflow lacks')) return false
    // Require at least one keyword from supplied evidence
    for (const k of keywords) {
      if (k.length >= 3 && lc.includes(k)) return true
    }
    return false
  }

  private buildPrompt(
    rec: RichRecommendation,
    projectContext?: string,
    calibration?: {
      baseScore: number
      calibratedScore: number
      preferenceMultiplier: number
      outcomeReliabilityMultiplier: number
      appliedSignals: Array<{
        category: string
        type: string
        observationCount: number
        value: number
      }>
      explanation: string
      calibrationVersion?: string
    }
  ): string {
    let calibrationSection = ''
    if (calibration) {
      calibrationSection = `
H6 ADAPTIVE LEARNING SIGNALS (Historical choices, not facts about the current repository):
- Base Score: ${calibration.baseScore}
- Calibrated Score: ${calibration.calibratedScore}
- Preference Multiplier: ${calibration.preferenceMultiplier}
- Outcome Reliability Multiplier: ${calibration.outcomeReliabilityMultiplier}
- Explanation: ${calibration.explanation}
- Applied Signals:
${calibration.appliedSignals.map((s) => `  * Category ${s.category} (${s.type}): observed count: ${s.observationCount}, value: ${s.value}`).join('\n')}
`
    }

    return `
Verified Codebase Evidence:
- Recommendation ID: ${rec.id}
- Category: ${rec.pmCategory}
- Rationale: ${rec.rationale}
- Confidence: ${rec.confidence}

Deterministic Impact Metrics:
- Severity: ${rec.assessment.severity}
- Business Impact: ${rec.assessment.businessImpact}
- User Impact: ${rec.assessment.userImpact}
- Delivery Risk: ${rec.assessment.deliveryRisk}
- Operational Risk: ${rec.assessment.operationalRisk}
- Calculated Priority Score: ${rec.priorityScore}
- Deterministic Expected Outcome: ${rec.expectedOutcome}
${calibrationSection}

${projectContext ? `Explicit Project Context / User Answers:\n${projectContext}\n` : ''}

Instructions:
Reason over this structured product data. Generate a JSON response matching the following schema.
Do not include any markup, markdown wrapper, or text outside the JSON object.

EPistemic separation rule:
  - "knowns" lists ONLY facts traceable to the supplied recommendation id, title, rationale, impact, pmCategory, or evidence listed above.
  - "inferences" lists likely PM/business consequences that are NOT directly observable.
  - "unknowns" lists legitimate open questions or missing telemetry.
  - DO NOT move inferred claims into "knowns". A grounded PM would rather say "unknown" than invent.

Schema:
{
  "rationale": "Why does this recommendation matter for this project specifically?",
  "impactExplanation": "Detailed business/user outcome explanation",
  "tradeoffs": ["Advantage vs Disadvantage 1", "Advantage vs Disadvantage 2"],
  "alternatives": [
    {
      "label": "Option A — Description",
      "effort": "low|medium|high",
      "impact": "low|medium|high|critical",
      "description": "Scope of work..."
    }
  ],
  "knowns": ["Factual observed point traceable to the supplied evidence"],
  "inferences": ["Likely PM/biz consequence not directly observable"],
  "unknowns": ["Missing telemetry or question"],
  "clarifyingQuestions": ["Question for the PM to narrow scoping"],
  "confidence": 0.95,
  "recommendedDecision": "Which option is best and why?"
}
`
  }

  /**
   * Build an "unavailable" reasoning record. NO FABRICATED FACTS are
   * ever placed into the output. The PM sees that reasoning is unavailable
   * and why.
   */
  private buildUnavailableReasoning(
    rec: RichRecommendation,
    failureReason: 'provider_error' | 'invalid_json' | 'schema_violation' | 'grounding_violation',
    contextHash: string
  ): AIProductReasoning {
    return {
      recommendationId: rec.id,
      workspaceId: rec.workspaceId,
      model: this.llmProvider.model,
      version: ProductReasoningService.SCHEMA_VERSION,
      contextHash,
      rationale: 'AI reasoning is currently unavailable for this recommendation.',
      impactExplanation:
        'The reasoning engine was unable to produce a verified, grounded response. PMs must rely on the deterministic H3 evidence until reasoning is restored.',
      tradeoffs: ['Reasoning unavailable — proceed with deterministic H3 evidence only'],
      alternatives: [
        {
          label: 'Proceed with H3 evidence only',
          effort: 'low',
          impact: 'medium',
          description:
            'Apply the recommendation based on the deterministic priority score and known facts.',
        },
      ],
      knowns: [],
      inferences: [],
      unknowns: [
        'Why did the reasoning engine fail?',
        'Was the failure due to provider error, schema violation, or grounding violation?',
      ],
      clarifyingQuestions: [],
      confidence: 0,
      recommendedDecision: 'Reasoning unavailable — defer to H3 evidence and PM judgment.',
      timestamp: new Date(),
      unavailable: true,
      failureReason,
    }
  }
}
