// @apex/ai-core — Product Intelligence Platform

export * from './domain'
export * from './application'
export * from './agents'
export * from './providers'
export * from './types'
export * from './correlation'
export * from './intelligence'
export * from './validation'

export { DurableFileDatabase } from './infrastructure/database/DurableFileDatabase'
export type {
  UserRecord,
  SessionRecord,
  WorkspaceMembership,
  DatabaseState,
} from './infrastructure/database/DurableFileDatabase'
export { SqlActionRepository } from './infrastructure/repositories/SqlActionRepository'
export { SqlProductRepository } from './infrastructure/repositories/SqlProductRepository'
export { SqlRecommendationOutcomeRepository } from './infrastructure/repositories/SqlRecommendationOutcomeRepository'
export { SqlAdaptiveLearningProfileRepository } from './infrastructure/repositories/SqlAdaptiveLearningProfileRepository'

// H9–H12 intelligence persistence adapters
export { SqlCompetitorRepository } from './infrastructure/repositories/SqlCompetitorRepository'
export { SqlUXRepository } from './infrastructure/repositories/SqlUXRepository'
export { SqlBrowserIntelligenceRepository } from './infrastructure/repositories/SqlBrowserIntelligenceRepository'
export { SqlExecutiveRepository } from './infrastructure/repositories/SqlExecutiveRepository'

// Security primitives
export { ScryptPasswordHasher } from './security/PasswordHasher'
export type { PasswordHasher } from './security/PasswordHasher'
export { SecureIdGenerator } from './security/IdGenerator'
export { AuthRateLimiter } from './security/AuthRateLimiter'
export type { RateLimitResult } from './security/AuthRateLimiter'
export { ApiRateLimiter } from './security/ApiRateLimiter'
export type { ApiRateLimitResult } from './security/ApiRateLimiter'

// Auth
export { AuthService } from './application/services/AuthService'
export type { AuthenticatedSession, SignupInput } from './application/services/AuthService'

// Observability
export { Logger } from './observability/Logger'
export type { LogEntry, LogFields, LogLevel } from './observability/Logger'

// Typed errors
export {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  NotFoundError,
  ConflictError,
  SecurityError,
  ProviderAuthenticationError,
  ProviderRateLimitError,
  ProviderTransientError,
  ProviderTerminalError,
  ExecutionError,
  VerificationError,
  toSafeEnvelope,
} from './errors/AppError'
export type { AppErrorCode, SafeErrorEnvelope } from './errors/AppError'
