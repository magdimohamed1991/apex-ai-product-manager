import type { VerificationStrategy, VerificationContext } from './VerificationTypes'
import { TestVerificationStrategy } from './strategies/TestVerificationStrategy'
import { CIVerificationStrategy } from './strategies/CIVerificationStrategy'
import { TypeScriptVerificationStrategy } from './strategies/TypeScriptVerificationStrategy'
import { DefaultVerificationStrategy } from './strategies/DefaultVerificationStrategy'

export class VerificationStrategyRegistry {
  private readonly strategies: VerificationStrategy[] = []

  constructor() {
    // Pre-register canonical strategies out of the box (Item 6)
    this.strategies.push(new TestVerificationStrategy())
    this.strategies.push(new CIVerificationStrategy())
    this.strategies.push(new TypeScriptVerificationStrategy())
    this.strategies.push(new DefaultVerificationStrategy())
  }

  register(strategy: VerificationStrategy): void {
    // Insert at front so custom strategies take precedence over defaults
    this.strategies.unshift(strategy)
  }

  findStrategy(context: VerificationContext): VerificationStrategy {
    const found = this.strategies.find((s) => s.canHandle(context))
    if (!found) {
      return new DefaultVerificationStrategy()
    }
    return found
  }
}

export const verificationRegistry = new VerificationStrategyRegistry()
