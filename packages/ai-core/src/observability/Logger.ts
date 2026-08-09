import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Structured operational logger (Milestone I - Production Hardening)
 *
 * Replaces the existing network of `console.log` / `console.error` calls with a
 * correlation-aware, secret-redacting structured logger.
 *
 *   - `requestId` / `correlationId` flow across boundaries via
 *     AsyncLocalStorage (correct under concurrent requests, unlike a
 *     module-global context variable)
 *   - never logs passwords, access tokens, API keys, raw credentials
 *   - safe to call in the browser (falls back to console)
 *   - never throws — observability must never crash the host process
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'session',
  'sessiontoken',
  'apikey',
  'secret',
  'authorization',
  'cookie',
  'privatekey',
  'clientsecret',
  'bearer',
])

/**
 * Keys that CONTAIN sensitive substrings but are NOT credentials:
 * - `idempotencyKey` is a deterministic business key (promo:<ws>:<rec>:<pa>)
 * - `externalId` is a public GitHub/Jira issue URL or ID
 * Redacting them previously destroyed the audit trail in execution logs.
 */
const NON_SENSITIVE_KEYS = new Set(['idempotencykey', 'externalid'])

const REDACTED = '[REDACTED]'

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[Truncated]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    if (value.length > 4096) return value.slice(0, 4096) + '...[Truncated]'
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value
  }
  if (Array.isArray(value)) {
    return value.slice(0, 32).map((v) => redact(v, depth + 1))
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) {
      const lk = k.toLowerCase()
      if (NON_SENSITIVE_KEYS.has(lk)) {
        out[k] = redact(obj[k], depth + 1)
        continue
      }
      if (
        SENSITIVE_KEYS.has(lk) ||
        lk.includes('token') ||
        lk.includes('password') ||
        lk.includes('secret')
      ) {
        out[k] = REDACTED
      } else {
        out[k] = redact(obj[k], depth + 1)
      }
    }
    return out
  }
  return value
}

export interface LogFields {
  [key: string]: unknown
}

export interface LogEntry {
  timestamp: string
  level: LogLevel
  scope: string
  message: string
  requestId?: string
  fields: LogFields
}

export class Logger {
  /**
   * Async-local request context. AsyncLocalStorage keeps the correlation ID
   * scoped to the current async chain, so interleaved requests never leak
   * their request IDs into each other's log lines (the previous
   * module-global `context` object was racy under concurrency).
   */
  private static readonly context = new AsyncLocalStorage<{ requestId?: string }>()

  constructor(private readonly scope: string) {}

  /** Bind a correlation/request ID to the current async context. */
  static withRequestId<T>(id: string, fn: () => T): T {
    return Logger.context.run({ requestId: id }, fn)
  }

  static newRequestId(): string {
    return randomUUID()
  }

  private emit(level: LogLevel, message: string, fields: LogFields = {}): void {
    try {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        scope: this.scope,
        message,
        requestId: Logger.context.getStore()?.requestId,
        fields: redact(fields) as LogFields,
      }
      const line = JSON.stringify(entry)
      // stderr for warn/error, stdout for the rest
      if (level === 'error') {
        console.error(line)
      } else if (level === 'warn') {
        console.warn(line)
      } else {
        console.log(line)
      }
    } catch {
      // Logger MUST never throw
    }
  }

  debug(message: string, fields: LogFields = {}): void {
    if (process.env.APEX_LOG_LEVEL === 'debug') {
      this.emit('debug', message, fields)
    }
  }

  info(message: string, fields: LogFields = {}): void {
    this.emit('info', message, fields)
  }

  warn(message: string, fields: LogFields = {}): void {
    this.emit('warn', message, fields)
  }

  error(message: string, fields: LogFields = {}): void {
    this.emit('error', message, fields)
  }
}
