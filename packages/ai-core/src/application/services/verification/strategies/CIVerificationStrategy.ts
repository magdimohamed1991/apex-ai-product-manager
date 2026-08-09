import type { VerificationStrategy, VerificationContext, VerificationResult } from '../VerificationTypes'

export class CIVerificationStrategy implements VerificationStrategy {
  canHandle(context: VerificationContext): boolean {
    const title = context.recommendation.title.toLowerCase()
    return title.includes('ci') || title.includes('workflow')
  }

  async verify(context: VerificationContext): Promise<VerificationResult> {
    const hasCI = context.evidence.hasGitHubActions || context.evidence.hasCI
    if (hasCI) {
      return {
        status: 'VERIFIED_SUCCESS',
        verificationStatus: 'Verified successfully.',
        verificationEvidence: ['Detected .github/workflows directory presence.'],
        outcomeSummary: 'GitHub Actions CI workflow has been successfully introduced.',
      }
    }
    return {
      status: 'FAILED',
      verificationStatus: 'Verification check failed.',
      verificationEvidence: [],
      outcomeSummary: 'Codebase remains unconfigured: CI workflows are missing.',
    }
  }
}
