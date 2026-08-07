import { describe, it, expect } from 'vitest'
import { MockLLMProvider } from '../implementations/MockLLMProvider'

describe('MockLLMProvider', () => {
  const provider = new MockLLMProvider()

  it('has correct name and model', () => {
    expect(provider.name).toBe('mock')
    expect(provider.model).toBe('mock-v1')
  })

  it('returns a response without API call', async () => {
    const response = await provider.complete('test prompt')
    expect(response.content.length).toBeGreaterThan(0)
  })

  it('returns correct model in response', async () => {
    const response = await provider.complete('test prompt')
    expect(response.model).toBe('mock-v1')
  })

  it('calculates token usage from prompt length', async () => {
    const prompt = 'a'.repeat(400) // ~100 tokens
    const response = await provider.complete(prompt)
    expect(response.usage.promptTokens).toBeGreaterThan(0)
    expect(response.usage.totalTokens).toBeGreaterThan(0)
  })

  it('measures durationMs', async () => {
    const response = await provider.complete('test')
    expect(response.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('accepts custom response', async () => {
    const custom = new MockLLMProvider('{"key": "custom"}')
    const response = await custom.complete('test')
    expect(response.content).toBe('{"key": "custom"}')
  })

  it('handles empty prompt', async () => {
    const response = await provider.complete('')
    expect(response).toBeDefined()
  })
})
