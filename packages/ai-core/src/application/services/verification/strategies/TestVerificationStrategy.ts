import type { VerificationStrategy, VerificationContext, VerificationResult } from '../VerificationTypes'

export class TestVerificationStrategy implements VerificationStrategy {
  canHandle(context: VerificationContext): boolean {
    const title = context.recommendation.title.toLowerCase()
    return title.includes('test') || title.includes('testing')
  }

  async verify(context: VerificationContext): Promise<VerificationResult> {
    const hasTests = context.evidence.hasVitestConfig || context.evidence.hasJestConfig || context.evidence.hasJest
    if (hasTests) {
      return {
        status: 'VERIFIED_SUCCESS',
        verificationStatus: 'Verified successfully.',
        verificationEvidence: ['Detected vitest.config.ts/jest.config.js on filesystem scan.'],
        outcomeSummary: 'Automated test suite has been successfully introduced to the codebase.',
      }
    }
    return {
      status: 'FAILED',
      verificationStatus: 'Verification check failed.',
      verificationEvidence: [],
      outcomeSummary: 'Codebase remains unconfigured: test files were not found.',
    }
  }
}
