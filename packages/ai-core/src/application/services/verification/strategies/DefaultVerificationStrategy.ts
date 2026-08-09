import type { VerificationStrategy, VerificationContext, VerificationResult } from '../VerificationTypes'

export class DefaultVerificationStrategy implements VerificationStrategy {
  canHandle(): boolean {
    return true
  }

  async verify(): Promise<VerificationResult> {
    return {
      status: 'NOT_VERIFIABLE',
      verificationStatus: 'Verification check failed.',
      verificationEvidence: [],
      outcomeSummary: 'This recommendation cannot be automatically verified from filesystem scans.',
    }
  }
}
