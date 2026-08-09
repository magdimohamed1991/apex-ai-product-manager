import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider'

// Test the OpenAI provider contract. We mock fetch to avoid live API
// calls, and assert the request shape and the response extraction.

function makeProfile(
  overrides: Partial<{ model: string; maxTokens: number; temperature: number }> = {}
) {
  return {
    id: 'test-profile',
    model: 'gpt-4o',
    temperature: 0.1,
    maxTokens: 256,
    reasoning: false,
    description: 'test',
    ...overrides,
  }
}

describe('OpenAIResponsesProvider (Milestone I - Production Hardening)', () => {
  let originalFetch: typeof fetch
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    originalFetch = global.fetch
    fetchMock = vi.fn()
    // @ts-expect-error mock global
    global.fetch = fetchMock
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('rejects construction with an empty api key', () => {
    expect(() => new OpenAIResponsesProvider('', makeProfile())).toThrow(/API key is required/)
  })

  it('sends Authorization header with the api key and the right request body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"answer":42}' }] }],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      }),
    })
    const provider = new OpenAIResponsesProvider('sk-test-1234', makeProfile())
    const r = await provider.complete('hello', { systemPrompt: 'sys' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer sk-test-1234')
    expect(init.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('gpt-4o')
    expect(body.input).toBe('hello')
    expect(body.instructions).toBe('sys')
    expect(body.max_output_tokens).toBe(256)
    expect(body.temperature).toBe(0.1)
    expect(r.content).toBe('{"answer":42}')
    expect(r.usage.totalTokens).toBe(15)
  })

  it('sends structured output request when a JSON schema is configured', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        output: [],
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      }),
    })
    const provider = new OpenAIResponsesProvider({
      apiKey: 'sk-x',
      profile: makeProfile(),
      structuredOutputName: 'Reasoning',
      structuredOutputSchema: { type: 'object', properties: { rationale: { type: 'string' } } },
    })
    await provider.complete('p')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.text).toBeDefined()
    expect(body.text.format.type).toBe('json_schema')
    expect(body.text.format.name).toBe('Reasoning')
  })

  it('retries on 429 then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'rate limited' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        }),
      })
    const provider = new OpenAIResponsesProvider('sk-y', makeProfile())
    const r = await provider.complete('p')
    expect(r.content).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws typed ProviderAuthenticationError on 401 and never leaks the api key', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid api key sk-secret',
    })
    const provider = new OpenAIResponsesProvider('sk-secret', makeProfile())
    let err: unknown
    try {
      await provider.complete('p')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    const msg = (err as Error).message
    expect(msg).toMatch(/OpenAI authentication failed/)
    expect(msg).not.toContain('sk-secret')
    expect(msg).toMatch(/REDACTED/)
  })

  it('throws ProviderTransientError on 5xx after exhausting retries', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server error',
    })
    const provider = new OpenAIResponsesProvider({
      apiKey: 'sk-z',
      profile: makeProfile(),
      maxRetries: 1,
    })
    await expect(provider.complete('p')).rejects.toThrow(/server error|OpenAI retries/)
  })
})
