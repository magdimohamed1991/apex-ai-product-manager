import { describe, it, expect } from 'vitest'
import { createExecution, validateExecution } from '../Execution'
import { createWorkspaceId } from '../../value-objects'

const WORKSPACE_ID = createWorkspaceId('ws-exec-test')

describe('Execution Entity', () => {
  const baseInput = {
    actionId: 'act-123',
    workspaceId: WORKSPACE_ID,
    attempt: 1,
    status: 'pending' as const,
    externalId: null,
    error: null,
  }

  it('successfully creates an Execution and auto-generates key', () => {
    const exec = createExecution(baseInput)
    expect(exec.id).toBeDefined()
    expect(exec.idempotencyKey).toBe('exec:act-123:1')
    expect(exec.startedAt).toBeInstanceOf(Date)
    expect(exec.status).toBe('pending')
  })

  it('throws on invalid key mismatches', () => {
    const exec = createExecution(baseInput)
    const damaged = { ...exec, idempotencyKey: 'exec:act-123:2' }
    expect(() => validateExecution(damaged)).toThrow(/Execution idempotencyKey mismatch/)
  })

  it('throws on negative attempts', () => {
    expect(() => createExecution({ ...baseInput, attempt: 0 })).toThrow(
      /attempt number must be greater than or equal to 1/
    )
  })
})
