import { describe, it, expect } from 'vitest'
import { createActionTransitionRecord } from '../ActionTransition'
import { createWorkspaceId } from '../../value-objects'

const WORKSPACE_ID = createWorkspaceId('ws-trans-test')

describe('ActionTransition Entity', () => {
  it('successfully creates transition audit records', () => {
    const trans = createActionTransitionRecord({
      actionId: 'act-123',
      workspaceId: WORKSPACE_ID,
      fromStatus: 'proposed',
      toStatus: 'approved',
      sequence: 1,
      actor: 'system',
      reason: 'User accepted recommended work',
    })

    expect(trans.id).toBeDefined()
    expect(trans.timestamp).toBeInstanceOf(Date)
    expect(trans.fromStatus).toBe('proposed')
    expect(trans.toStatus).toBe('approved')
    expect(trans.actor).toBe('system')
  })
})
