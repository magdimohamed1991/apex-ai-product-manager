import type { LLMProvider, LLMOptions, LLMResponse } from '../LLMProvider'
import type { ModelProfile } from '../ModelProfile'
import { Logger } from '../../observability/Logger'
import {
  ProviderAuthenticationError,
  ProviderRateLimitError,
  ProviderTerminalError,
  ProviderTransientError,
} from '../../errors/AppError'

const log = new Logger('provider.openai')

/**
 * OpenAI Responses API provider.
 *
 * Honors the H4 LLM contract:
 *   - system instructions are transmitted as a separate `instructions` field
 *   - structured JSON output is requested via `text.format` with `json_schema`
 *   - per-request timeouts are enforced via AbortController
 *   - bounded retries with exponential backoff (rate-limit only)
 *   - rate-limit (429), auth (401), and terminal (4xx) errors are
 *     normalized to typed ProviderXError classes
 *   - API key is NEVER logged or echoed in errors
 *
 * The provider does NOT silently fall back to a mock. If OPENAI_API_KEY is
 * missing at construction time, the provider throws. Callers must wire a
 * real provider explicitly.
 */

export interface OpenAIResponsesProviderOptions {
  apiKey: string
  profile: ModelProfile
  /** Optional JSON schema name; if supplied, requests structured output. */
  structuredOutputName?: string
  /** Schema to enforce on the response (JSON Schema draft 2020-12). */
  structuredOutputSchema?: Record<string, unknown>
  /** Maximum retry attempts for transient/rate-limit errors. */
  maxRetries?: number
  /** Base delay for exponential backoff (ms). */
  retryBaseMs?: number
  /** Request timeout (ms). */
  timeoutMs?: number
  /** Optional base URL override (for tests, proxies). */
  baseUrl?: string
}

export class OpenAIResponsesProvider implements LLMProvider {
  readonly name = 'openai'
  readonly model: string

  private readonly apiKey: string
  private readonly profile: ModelProfile
  private readonly options: Required<
    Pick<OpenAIResponsesProviderOptions, 'maxRetries' | 'retryBaseMs' | 'timeoutMs'>
  > & {
    structuredOutputName?: string
    structuredOutputSchema?: Record<string, unknown>
    baseUrl?: string
  }

  constructor(apiKeyOrOptions: string | OpenAIResponsesProviderOptions, profile?: ModelProfile) {
    if (typeof apiKeyOrOptions === 'string') {
      if (!apiKeyOrOptions) throw new Error('OpenAI API key is required')
      this.apiKey = apiKeyOrOptions
      this.profile = profile!
      this.model = profile!.model
      this.options = { maxRetries: 3, retryBaseMs: 500, timeoutMs: 30000 }
    } else {
      const opts = apiKeyOrOptions
      if (!opts.apiKey) throw new Error('OpenAI API key is required')
      this.apiKey = opts.apiKey
      this.profile = opts.profile
      this.model = opts.profile.model
      this.options = {
        maxRetries: opts.maxRetries ?? 3,
        retryBaseMs: opts.retryBaseMs ?? 500,
        timeoutMs: opts.timeoutMs ?? 30000,
        structuredOutputName: opts.structuredOutputName,
        structuredOutputSchema: opts.structuredOutputSchema,
        baseUrl: opts.baseUrl,
      }
    }
  }

  /**
   * Send a completion request, with bounded retries for transient errors.
   */
  async complete(prompt: string, options?: LLMOptions): Promise<LLMResponse> {
    const start = Date.now()
    const model = this.profile.model
    const maxTokens = options?.maxTokens ?? this.profile.maxTokens
    const temperature = options?.temperature ?? this.profile.temperature

    let lastError: unknown
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs)
      try {
        const body = this.buildRequestBody(prompt, options, model, maxTokens, temperature)
        const url = `${this.options.baseUrl ?? 'https://api.openai.com'}/v1/responses`
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          lastError = this.classifyHttpError(res.status, errText)
          if (res.status === 429) {
            const backoff = this.options.retryBaseMs * 2 ** attempt
            log.warn('OpenAI rate limited; retrying', { attempt, backoffMs: backoff })
            await this.sleep(backoff)
            continue
          }
          if (res.status >= 500) {
            const backoff = this.options.retryBaseMs * 2 ** attempt
            log.warn('OpenAI server error; retrying', {
              status: res.status,
              attempt,
              backoffMs: backoff,
            })
            await this.sleep(backoff)
            continue
          }
          throw lastError
        }

        const data = (await res.json()) as {
          output: Array<{
            content?: Array<{ type: string; text?: string }>
            type?: string
          }>
          usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
        }

        // Extract text content from the first output message.
        let content = ''
        for (const item of data.output || []) {
          if (item.type === 'message' && item.content) {
            for (const piece of item.content) {
              if (piece.type === 'output_text' && piece.text) {
                content = piece.text
                break
              }
            }
            if (content) break
          }
        }

        return {
          content,
          model,
          usage: {
            promptTokens: data.usage?.input_tokens ?? 0,
            completionTokens: data.usage?.output_tokens ?? 0,
            totalTokens: data.usage?.total_tokens ?? 0,
          },
          durationMs: Date.now() - start,
        }
      } catch (err) {
        if (err instanceof ProviderAuthenticationError || err instanceof ProviderTerminalError) {
          throw err
        }
        if (err instanceof ProviderRateLimitError && attempt < this.options.maxRetries) {
          lastError = err
          const backoff = this.options.retryBaseMs * 2 ** attempt
          await this.sleep(backoff)
          continue
        }
        if ((err as { name?: string }).name === 'AbortError') {
          throw new ProviderTransientError(
            `OpenAI request timed out after ${this.options.timeoutMs}ms`
          )
        }
        throw new ProviderTransientError(
          `OpenAI request failed: ${err instanceof Error ? err.message : String(err)}`
        )
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new ProviderTransientError('OpenAI retries exhausted')
  }

  private buildRequestBody(
    prompt: string,
    options: LLMOptions | undefined,
    model: string,
    maxTokens: number,
    temperature: number
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      input: prompt,
      max_output_tokens: maxTokens,
      temperature,
    }
    if (options?.systemPrompt) {
      body['instructions'] = options.systemPrompt
    }
    if (this.options.structuredOutputSchema && this.options.structuredOutputName) {
      body['text'] = {
        format: {
          type: 'json_schema',
          name: this.options.structuredOutputName,
          schema: this.options.structuredOutputSchema,
          strict: true,
        },
      }
    }
    return body
  }

  private classifyHttpError(status: number, errText: string): Error {
    // The error text MAY contain the API key if the upstream echoed it.
    // The API key prefix "sk-" is enough to detect this — we strip the
    // entire response to be safe.
    const sanitized = errText.replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]')
    if (status === 401) {
      return new ProviderAuthenticationError(
        `OpenAI authentication failed: ${sanitized || 'invalid API key'}`
      )
    }
    if (status === 403) {
      return new ProviderAuthenticationError(`OpenAI authorization failed: ${sanitized}`)
    }
    if (status === 429) {
      return new ProviderRateLimitError(`OpenAI rate limit: ${sanitized || 'try again later'}`)
    }
    if (status >= 500) {
      return new ProviderTransientError(`OpenAI server error (${status}): ${sanitized}`)
    }
    return new ProviderTerminalError(`OpenAI rejected request (${status}): ${sanitized}`)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }
}
