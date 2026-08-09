/**
 * Typed application error model (Milestone I - Production Hardening)
 *
 * Replaces the legacy "arbitrary strings are the primary error contract" pattern
 * with a strict hierarchy that downstream HTTP layers can map to safe status
 * codes without leaking sensitive details.
 */

export type AppErrorCode =
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND_ERROR'
  | 'CONFLICT_ERROR'
  | 'PROVIDER_AUTHENTICATION_ERROR'
  | 'PROVIDER_RATE_LIMIT_ERROR'
  | 'PROVIDER_TRANSIENT_ERROR'
  | 'PROVIDER_TERMINAL_ERROR'
  | 'EXECUTION_ERROR'
  | 'VERIFICATION_ERROR'
  | 'SECURITY_ERROR'

export class AppError extends Error {
  public readonly code: AppErrorCode
  public readonly statusCode: number
  public readonly safeMessage: string
  public readonly cause?: unknown

  constructor(args: {
    code: AppErrorCode
    message: string
    safeMessage?: string
    statusCode?: number
    cause?: unknown
  }) {
    super(args.message)
    this.name = new.target.name
    this.code = args.code
    this.safeMessage = args.safeMessage ?? args.message
    this.cause = args.cause
    this.statusCode =
      args.statusCode ??
      ((): number => {
        switch (args.code) {
          case 'AUTHENTICATION_ERROR':
          case 'PROVIDER_AUTHENTICATION_ERROR':
            return 401
          case 'AUTHORIZATION_ERROR':
            return 403
          case 'NOT_FOUND_ERROR':
            return 404
          case 'CONFLICT_ERROR':
            return 409
          case 'VALIDATION_ERROR':
          case 'VERIFICATION_ERROR':
            return 400
          case 'PROVIDER_RATE_LIMIT_ERROR':
            return 429
          case 'PROVIDER_TRANSIENT_ERROR':
          case 'EXECUTION_ERROR':
            return 502
          case 'PROVIDER_TERMINAL_ERROR':
            return 502
          case 'SECURITY_ERROR':
            return 403
          default:
            return 500
        }
      })()
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required', cause?: unknown) {
    super({ code: 'AUTHENTICATION_ERROR', message, safeMessage: 'Authentication required', cause })
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Access denied', cause?: unknown) {
    super({ code: 'AUTHORIZATION_ERROR', message, safeMessage: 'Access denied', cause })
  }
}

export class ValidationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ code: 'VALIDATION_ERROR', message, cause })
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ code: 'NOT_FOUND_ERROR', message, safeMessage: 'Resource not found', cause })
  }
}

export class ConflictError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ code: 'CONFLICT_ERROR', message, cause })
  }
}

export class SecurityError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ code: 'SECURITY_ERROR', message, safeMessage: 'Operation rejected', cause })
  }
}

export class ProviderAuthenticationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({
      code: 'PROVIDER_AUTHENTICATION_ERROR',
      message,
      safeMessage: 'External provider rejected credentials',
      cause,
    })
  }
}

export class ProviderRateLimitError extends AppError {
  constructor(message: string, retryAfterMs?: number, cause?: unknown) {
    super({
      code: 'PROVIDER_RATE_LIMIT_ERROR',
      message,
      safeMessage: 'External provider rate limited',
      cause,
      statusCode: 429,
    })
    this.retryAfterMs = retryAfterMs
  }
  readonly retryAfterMs?: number
}

export class ProviderTransientError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({
      code: 'PROVIDER_TRANSIENT_ERROR',
      message,
      safeMessage: 'External provider temporarily unavailable',
      cause,
    })
  }
}

export class ProviderTerminalError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({
      code: 'PROVIDER_TERMINAL_ERROR',
      message,
      safeMessage: 'External provider rejected request',
      cause,
    })
  }
}

export class ExecutionError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ code: 'EXECUTION_ERROR', message, cause })
  }
}

export class VerificationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ code: 'VERIFICATION_ERROR', message, cause })
  }
}

/**
 * Safe HTTP envelope generator. Hides stack traces, internal messages, and
 * unexpected implementation details from clients.
 */
export interface SafeErrorEnvelope {
  error: {
    code: AppErrorCode | 'INTERNAL_ERROR'
    message: string
  }
}

export function toSafeEnvelope(err: unknown): { envelope: SafeErrorEnvelope; status: number } {
  if (err instanceof AppError) {
    return {
      envelope: { error: { code: err.code, message: err.safeMessage } },
      status: err.statusCode,
    }
  }
  return {
    envelope: { error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' } },
    status: 500,
  }
}
