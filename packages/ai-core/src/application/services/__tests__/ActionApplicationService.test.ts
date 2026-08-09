import { describe, it, expect, beforeEach } from 'vitest'
import { ActionApplicationService, adapterRegistry } from '../ActionApplicationService'
import { InMemoryActionRepository } from '../../../domain/repositories/__tests__/ActionRepository.test'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { Recommendation, ProposedAction } from '../../../domain/entities/Recommendation'
import { transitionAction } from '../../../domain/entities/Action'

const WORKSPACE_A = createWorkspaceId('ws-milestoneA-a')
const WORKSPACE_B = createWorkspaceId('ws-milestoneA-b')

describe('ActionApplicationService — Milestone A: Action Reliability & Idempotency', () => {
  let repository: InMemoryActionRepository
  let service: ActionApplicationService

  beforeEach(() => {
    repository = new InMemoryActionRepository()
    service = new ActionApplicationService(repository)
  })

  const pa1: ProposedAction = {
    id: 'pa-1',
    title: 'Setup Vitest',
    description: 'Add baseline Vitest testing framework',
  }

  const pa2: ProposedAction = {
    id: 'pa-2',
    title: 'Add Dockerfile',
    description: 'Add Docker setup for deployment',
  }

  const recommendationA: Recommendation = {
    id: 'rec-A',
    workspaceId: WORKSPACE_A,
    origin: 'insight',
    deduplicationKey: 'dup-a',
    title: 'Recommendation A',
    rationale: 'Rationale A',
    impact: 'Impact A',
    effort: 'low',
    priority: 'high',
    confidence: 0.95,
    insightIds: ['ins-1'],
    findingIds: [],
    proposedActions: [pa1, pa2],
    createdAt: new Date(),
  }

  const recommendationB: Recommendation = {
    id: 'rec-B',
    workspaceId: WORKSPACE_A, // same workspace, different recommendation
    origin: 'insight',
    deduplicationKey: 'dup-b',
    title: 'Recommendation B',
    rationale: 'Rationale B',
    impact: 'Impact B',
    effort: 'low',
    priority: 'high',
    confidence: 0.9,
    insightIds: ['ins-2'],
    findingIds: [],
    proposedActions: [pa1], // has matching pa-1 ID but under rec-B
    createdAt: new Date(),
  }

  const recommendationC: Recommendation = {
    id: 'rec-C',
    workspaceId: WORKSPACE_B, // different workspace
    origin: 'insight',
    deduplicationKey: 'dup-c',
    title: 'Recommendation C',
    rationale: 'Rationale C',
    impact: 'Impact C',
    effort: 'low',
    priority: 'high',
    confidence: 0.8,
    insightIds: ['ins-3'],
    findingIds: [],
    proposedActions: [pa1],
    createdAt: new Date(),
  }

  it('1. Same ProposedAction promotes to the same Action (Repeated execution/Idempotency check)', async () => {
    // First promotion
    const action1 = await service.promoteProposedAction(recommendationA, pa1)
    expect(action1).toBeDefined()
    expect(action1.status).toBe('proposed')

    // Second promotion (identical params)
    const action2 = await service.promoteProposedAction(recommendationA, pa1)

    // They must represent the same Action (idempotent retrieval)
    expect(action1.id).toBe(action2.id)
    expect(action1.idempotencyKey).toBe(action2.idempotencyKey)

    // Check that there is only 1 Action inside repository for this workspace
    const list = await repository.getByWorkspace({ workspaceId: WORKSPACE_A })
    expect(list.filter((a) => a.idempotencyKey === action1.idempotencyKey).length).toBe(1)
  })

  it('2. Same Recommendation + different ProposedAction promotes to different Actions', async () => {
    const action1 = await service.promoteProposedAction(recommendationA, pa1)
    const action2 = await service.promoteProposedAction(recommendationA, pa2)

    expect(action1.id).not.toEqual(action2.id)
    expect(action1.idempotencyKey).not.toEqual(action2.idempotencyKey)
  })

  it('3. Different Recommendations promote to different Actions (provenance isolation)', async () => {
    const actionA = await service.promoteProposedAction(recommendationA, pa1)
    const actionB = await service.promoteProposedAction(recommendationB, pa1)

    expect(actionA.id).not.toEqual(actionB.id)
    expect(actionA.idempotencyKey).not.toEqual(actionB.idempotencyKey)
  })

  it('4. Different Workspaces promote to completely isolated Actions (Workspace boundary)', async () => {
    const actionA = await service.promoteProposedAction(recommendationA, pa1)
    const actionC = await service.promoteProposedAction(recommendationC, pa1)

    expect(actionA.workspaceId).toBe(WORKSPACE_A)
    expect(actionC.workspaceId).toBe(WORKSPACE_B)
    expect(actionA.id).not.toEqual(actionC.id)
    expect(actionA.idempotencyKey).not.toEqual(actionC.idempotencyKey)

    const listA = await repository.getByWorkspace({ workspaceId: WORKSPACE_A })
    const listB = await repository.getByWorkspace({ workspaceId: WORKSPACE_B })

    expect(listA.some((a) => a.id === actionC.id)).toBe(false)
    expect(listB.some((a) => a.id === actionA.id)).toBe(false)
  })

  it('5. Repository round-trip preserves idempotency key format perfectly', async () => {
    const action = await service.promoteProposedAction(recommendationA, pa1)
    const retrieved = await repository.getByIdAndWorkspace(action.id, WORKSPACE_A)

    expect(retrieved?.idempotencyKey).toBe(action.idempotencyKey)
    expect(retrieved?.idempotencyKey).toBe(`promo:${WORKSPACE_A}:rec-A:pa-1`)
  })

  it('6. Changing Action status does not change its logical idempotency identity', async () => {
    const action = await service.promoteProposedAction(recommendationA, pa1)
    const originalKey = action.idempotencyKey

    // Transition Action to approved
    const transitioned = transitionAction(action, 'approved')
    await repository.save(transitioned)

    const retrieved = await repository.getByIdAndWorkspace(action.id, WORKSPACE_A)
    expect(retrieved?.status).toBe('approved')
    expect(retrieved?.idempotencyKey).toBe(originalKey) // key remains unchanged
  })

  it('7. Changing externalId does not change its logical idempotency identity', async () => {
    const action = await service.promoteProposedAction(recommendationA, pa1)
    const originalKey = action.idempotencyKey

    // Update external ID
    const updated = {
      ...action,
      target: 'github' as const, // Change target so externalId can be set
      externalId: 'issue-123',
    }
    await repository.save(updated)

    const retrieved = await repository.getByIdAndWorkspace(action.id, WORKSPACE_A)
    expect(retrieved?.externalId).toBe('issue-123')
    expect(retrieved?.idempotencyKey).toBe(originalKey) // key remains unchanged
  })

  it('8. executeActionPath handles internal targets directly without adapters', async () => {
    const action = await service.promoteProposedAction(recommendationA, pa1)
    const context = { workspaceId: WORKSPACE_A, credentials: {} }

    const result = await service.executeActionPath(action, context, 'exec:test:1')
    expect(result.externalId).toBeNull()
    expect(result.resolution).toBe('created')
    expect(result.metadata?.info).toBe('Internal task executed successfully')
  })

  it('9. executeActionPath routes to AdapterRegistry and throws on unsupported targets', async () => {
    const action = await service.promoteProposedAction(recommendationA, pa1)
    const externalAction = { ...action, target: 'github' as const }
    const context = { workspaceId: WORKSPACE_A, credentials: {} }

    // Resolving 'github' target should throw because no adapter is registered yet (routing contract)
    await expect(service.executeActionPath(externalAction, context, 'exec:test:1')).rejects.toThrow(
      /Unsupported action execution target: "github"/
    )
  })

  it('10. Resolving registered adapter from AdapterRegistry successfully', async () => {
    const mockAdapter = {
      target: 'github' as const,
      validateTarget: async () => {},
      executeAction: async () => ({ externalId: 'pr-42', resolution: 'created' as const }),
    }

    adapterRegistry.register(mockAdapter)
    const resolved = adapterRegistry.resolve('github')
    expect(resolved).toBe(mockAdapter)
  })
})
