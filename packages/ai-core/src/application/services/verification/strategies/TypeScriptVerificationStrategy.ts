import type {
  VerificationStrategy,
  VerificationContext,
  VerificationResult,
} from '../VerificationTypes'

export class TypeScriptVerificationStrategy implements VerificationStrategy {
  canHandle(context: VerificationContext): boolean {
    const title = context.recommendation.title.toLowerCase()
    return title.includes('typescript') || title.includes('type check')
  }

  async verify(context: VerificationContext): Promise<VerificationResult> {
    const hasTS = context.evidence.hasTypeScriptConfig
    if (hasTS) {
      // Epistemic honesty: this check only verifies that a TypeScript
      // configuration file EXISTS in the scanned evidence. The legacy
      // wording claimed "strict checking" was enabled, which this signal
      // cannot prove — never report more than the evidence supports.
      return {
        status: 'VERIFIED_SUCCESS',
        verificationStatus: 'Verified successfully.',
        verificationEvidence: ['Detected tsconfig.json presence in the scanned evidence.'],
        outcomeSummary: 'TypeScript configuration was detected in the codebase.',
      }
    }
    return {
      status: 'FAILED',
      verificationStatus: 'Verification check failed.',
      verificationEvidence: [],
      outcomeSummary: 'TypeScript configuration was not detected.',
    }
  }
}
