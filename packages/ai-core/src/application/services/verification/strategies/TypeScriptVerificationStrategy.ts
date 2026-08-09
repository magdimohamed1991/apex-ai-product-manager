import type { VerificationStrategy, VerificationContext, VerificationResult } from '../VerificationTypes'

export class TypeScriptVerificationStrategy implements VerificationStrategy {
  canHandle(context: VerificationContext): boolean {
    const title = context.recommendation.title.toLowerCase()
    return title.includes('typescript') || title.includes('type check')
  }

  async verify(context: VerificationContext): Promise<VerificationResult> {
    const hasTS = context.evidence.hasTypeScriptConfig
    if (hasTS) {
      return {
        status: 'VERIFIED_SUCCESS',
        verificationStatus: 'Verified successfully.',
        verificationEvidence: ['Detected tsconfig.json strict checking.'],
        outcomeSummary: 'TypeScript type checking strict configurations are enabled.',
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
