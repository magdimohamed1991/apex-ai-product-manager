import { describe, it, expect } from 'vitest'
import {
  createAction,
  createActionFromProposedAction,
  transitionAction,
  validateAction,
  validateActionTransition,
} from '../Action'
import { createWorkspaceId } from '../../value-objects'
import type { WorkspaceId, ActionStatus } from '../../value-objects'
import type { Recommendation, ProposedAction } from '../Recommendation'

const WORKSPACE_ID = createWorkspaceId('ws-action-test')

describe('Action Domain Contract (2C.1) Hardened', () => {
  const baseInput = {
    workspaceId: WORKSPACE_ID,
    title: 'Configure Vitest framework',
    description: 'Set up automated unit testing framework',
    target: 'github' as const,
    status: 'proposed' as const,
    relatedRecommendationId: 'rec-12345',
    relatedProposedActionId: 'pa-67890',
    externalId: 'ext-999',
  }

  describe('createAction factory', () => {
    it('successfully creates an Action with all valid inputs', () => {
      const action = createAction(baseInput)
      expect(action.id).toBeDefined()
      expect(action.createdAt).toBeInstanceOf(Date)
      expect(action.updatedAt).toBeInstanceOf(Date)
      expect(action.title).toBe('Configure Vitest framework')
      expect(action.relatedRecommendationId).toBe('rec-12345')
      expect(action.relatedProposedActionId).toBe('pa-67890')
      expect(action.status).toBe('proposed')
    })

    it('allows overriding id and dates', () => {
      const fixedDate = new Date('2026-08-08')
      const action = createAction({
        ...baseInput,
        id: 'action-custom-id',
        createdAt: fixedDate,
        updatedAt: fixedDate,
      })
      expect(action.id).toBe('action-custom-id')
      expect(action.createdAt).toEqual(fixedDate)
      expect(action.updatedAt).toEqual(fixedDate)
    })
  })

  describe('validateAction structural invariants', () => {
    it('throws if action has no id', () => {
      const invalidAction = createAction(baseInput)
      const damaged = { ...invalidAction, id: '' }
      expect(() => validateAction(damaged)).toThrow('Action must have a valid non-empty id')
    })

    it('throws if action has no workspaceId', () => {
      const invalidAction = createAction(baseInput)
      const damaged = { ...invalidAction, workspaceId: '' as unknown as WorkspaceId }
      expect(() => validateAction(damaged)).toThrow('Action must have a valid non-empty workspaceId')
    })

    it('throws if action has empty or whitespace title', () => {
      expect(() =>
        createAction({
          ...baseInput,
          title: '   ',
        })
      ).toThrow('Action must have a non-empty title')
    })

    it('throws if action has empty relatedRecommendationId (strict provenance)', () => {
      expect(() =>
        createAction({
          ...baseInput,
          relatedRecommendationId: '',
        })
      ).toThrow('Action must be linked to a non-empty relatedRecommendationId')
    })

    it('throws if action has empty relatedProposedActionId (Item 12)', () => {
      expect(() =>
        createAction({
          ...baseInput,
          relatedProposedActionId: '',
        })
      ).toThrow('Action must be linked to a non-empty relatedProposedActionId')
    })
  })

  describe('externalId ↔ target semantics (Item 8)', () => {
    it('throws if target is internal but externalId is non-null', () => {
      expect(() =>
        createAction({
          ...baseInput,
          target: 'internal',
          externalId: 'ext-some-id',
        })
      ).toThrow('Action with target "internal" must have externalId set to null')
    })

    it('passes if target is internal and externalId is null', () => {
      expect(() =>
        createAction({
          ...baseInput,
          target: 'internal',
          externalId: null,
        })
      ).not.toThrow()
    })

    it('passes if target is external and externalId is null initially', () => {
      expect(() =>
        createAction({
          ...baseInput,
          target: 'github',
          externalId: null,
        })
      ).not.toThrow()
    })

    it('passes if target is external and externalId is populated', () => {
      expect(() =>
        createAction({
          ...baseInput,
          target: 'github',
          externalId: 'pr-42',
        })
      ).not.toThrow()
    })
  })

  describe('validateActionTransition state machine rules (Item 7)', () => {
    it('allows legal transitions with correct actor authorities', () => {
      expect(() => validateActionTransition('proposed', 'approved', 'user')).not.toThrow()
      expect(() => validateActionTransition('approved', 'queued', 'system')).not.toThrow()
      expect(() => validateActionTransition('queued', 'in-progress', 'executor')).not.toThrow()
      expect(() => validateActionTransition('in-progress', 'completed', 'executor')).not.toThrow()
      expect(() => validateActionTransition('in-progress', 'failed', 'executor')).not.toThrow()
    })

    it('throws on transition triggered by unauthorized actor (Item 5)', () => {
      expect(() => validateActionTransition('proposed', 'approved', 'executor')).toThrow(
        /rejected: actor "executor" is not authorized/
      )
      expect(() => validateActionTransition('in-progress', 'completed', 'user')).toThrow(
        /rejected: actor "user" is not authorized/
      )
    })

    it('throws on illegal transitions (completed -> proposed)', () => {
      expect(() => validateActionTransition('completed', 'proposed')).toThrow(
        /Invalid action status transition: cannot transition from "completed" to "proposed"/
      )
    })

    it('throws on illegal transitions (failed -> approved)', () => {
      expect(() => validateActionTransition('failed', 'approved')).toThrow(
        /Invalid action status transition: cannot transition from "failed" to "approved"/
      )
    })

    it('throws on illegal transitions (queued -> proposed)', () => {
      expect(() => validateActionTransition('queued', 'proposed')).toThrow(
        /Invalid action status transition: cannot transition from "queued" to "proposed"/
      )
    })

    it('throws on every terminal transition for "completed"', () => {
      const allStatuses = ['proposed', 'approved', 'queued', 'in-progress', 'completed', 'failed'] as const
      for (const status of allStatuses) {
        expect(() => validateActionTransition('completed', status)).toThrow(
          /Invalid action status transition: cannot transition from "completed"/
        )
      }
    })

    it('throws on every terminal transition for "failed"', () => {
      const allStatuses = ['proposed', 'approved', 'queued', 'in-progress', 'completed', 'failed'] as const
      for (const status of allStatuses) {
        expect(() => validateActionTransition('failed', status)).toThrow(
          /Invalid action status transition: cannot transition from "failed"/
        )
      }
    })
  })

  describe('ProposedAction → Action conversion boundary (Item 10 & Item 11)', () => {
    const pa1: ProposedAction = {
      id: 'pa-001',
      title: 'Configure CI',
      description: 'Add CI testing pipeline',
    }

    const pa2: ProposedAction = {
      id: 'pa-002',
      title: 'Setup Docker',
      description: 'Add Dockerfile configuration',
    }

    const recommendationA: Recommendation = {
      id: 'rec-A',
      workspaceId: WORKSPACE_ID,
      origin: 'insight',
      deduplicationKey: 'key-a',
      title: 'Rec Title',
      rationale: 'Rat',
      impact: 'Imp',
      effort: 'low',
      priority: 'high',
      confidence: 1,
      insightIds: ['ins-1'],
      findingIds: [],
      proposedActions: [pa1, pa2],
      createdAt: new Date(),
    }

    const recommendationB: Recommendation = {
      id: 'rec-B',
      workspaceId: WORKSPACE_ID,
      origin: 'insight',
      deduplicationKey: 'key-b',
      title: 'Rec B Title',
      rationale: 'Rat B',
      impact: 'Imp B',
      effort: 'low',
      priority: 'high',
      confidence: 1,
      insightIds: ['ins-2'],
      findingIds: [],
      proposedActions: [pa2],
      createdAt: new Date(),
    }

    it('successfully converts a belonging ProposedAction to Action', () => {
      const action = createActionFromProposedAction(recommendationA, pa1)
      expect(action.relatedRecommendationId).toBe('rec-A')
      expect(action.relatedProposedActionId).toBe('pa-001')
      expect(action.title).toBe('Configure CI')
      expect(action.description).toBe('Add CI testing pipeline')
      expect(action.status).toBe('proposed')
      expect(action.target).toBe('internal')
      expect(action.externalId).toBeNull()
    })

    it('proves workspaceId is strictly derived from the recommendation workspaceId', () => {
      const customWorkspaceId = createWorkspaceId('ws-custom-derived')
      const customRec = { ...recommendationA, workspaceId: customWorkspaceId }
      const action = createActionFromProposedAction(customRec, pa1)
      expect(action.workspaceId).toBe(customWorkspaceId)
    })

    it('proves that conversion defaults are strictly internal, proposed, and null externalId', () => {
      const action = createActionFromProposedAction(recommendationA, pa1)
      expect(action.target).toBe('internal')
      expect(action.status).toBe('proposed')
      expect(action.externalId).toBeNull()
    })

    it('throws if ProposedAction is malformed (missing id or title)', () => {
      const malformedPA = { ...pa1, id: '' }
      expect(() => createActionFromProposedAction(recommendationA, malformedPA)).toThrow(
        'ProposedAction must have a valid non-empty id'
      )

      const malformedPA2 = { ...pa1, title: '   ' }
      expect(() => createActionFromProposedAction(recommendationA, malformedPA2)).toThrow(
        'ProposedAction must have a non-empty title'
      )
    })

    it('throws if Recommendation is malformed (missing id or workspaceId)', () => {
      const malformedRec = { ...recommendationA, id: '' }
      expect(() => createActionFromProposedAction(malformedRec, pa1)).toThrow(
        'Recommendation must have a valid non-empty id'
      )

      const malformedRec2 = { ...recommendationA, workspaceId: '' as unknown as WorkspaceId }
      expect(() => createActionFromProposedAction(malformedRec2, pa1)).toThrow(
        'Recommendation must have a valid non-empty workspaceId'
      )
    })

    it('throws if trying to convert a ProposedAction that does not belong to the Recommendation (Item 10)', () => {
      expect(() => createActionFromProposedAction(recommendationB, pa1)).toThrow(
        /ProposedAction "pa-001" does not belong to Recommendation "rec-B"/
      )
    })

    it('generates actions with different relatedProposedActionId values for different ProposedActions from same Recommendation (Item 11)', () => {
      const action1 = createActionFromProposedAction(recommendationA, pa1)
      const action2 = createActionFromProposedAction(recommendationA, pa2)
      expect(action1.relatedProposedActionId).toBe('pa-001')
      expect(action2.relatedProposedActionId).toBe('pa-002')
      expect(action1.id).not.toEqual(action2.id)
    })
  })

  describe('Action Lifecycle Runner (2C.3)', () => {
    it('successfully transitions Action status and updates updatedAt', async () => {
      const action = createAction(baseInput)
      const oldUpdatedAt = action.updatedAt.getTime()

      // Artificial wait to guarantee updatedAt difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      const transitioned = transitionAction(action, 'approved')
      expect(transitioned.status).toBe('approved')
      expect(transitioned.updatedAt.getTime()).toBeGreaterThan(oldUpdatedAt)

      // Immutable check: original Action status must remain unchanged
      expect(action.status).toBe('proposed')
    })

    it('retains all other fields perfectly unchanged on transition', () => {
      const action = createAction(baseInput)
      const transitioned = transitionAction(action, 'approved')

      expect(transitioned.id).toBe(action.id)
      expect(transitioned.workspaceId).toBe(action.workspaceId)
      expect(transitioned.title).toBe(action.title)
      expect(transitioned.description).toBe(action.description)
      expect(transitioned.target).toBe(action.target)
      expect(transitioned.relatedRecommendationId).toBe(action.relatedRecommendationId)
      expect(transitioned.relatedProposedActionId).toBe(action.relatedProposedActionId)
      expect(transitioned.externalId).toBe(action.externalId)
      expect(transitioned.createdAt).toEqual(action.createdAt)
    })

    it('throws on illegal transitions (e.g. proposed -> queued)', () => {
      const action = createAction(baseInput)
      expect(() => transitionAction(action, 'queued')).toThrow(
        /Invalid action status transition: cannot transition from "proposed" to "queued"/
      )
    })

    it('throws on transition to unknown/invalid status', () => {
      const action = createAction(baseInput)
      expect(() => transitionAction(action, 'invalid-status' as unknown as ActionStatus)).toThrow(
        /Unknown action status: "invalid-status"/
      )
    })

    it('rejects transitioning from terminal states', () => {
      const actionCompleted = createAction({ ...baseInput, status: 'completed' })
      expect(() => transitionAction(actionCompleted, 'approved')).toThrow(
        /Invalid action status transition: cannot transition from "completed"/
      )

      const actionFailed = createAction({ ...baseInput, status: 'failed' })
      expect(() => transitionAction(actionFailed, 'approved')).toThrow(
        /Invalid action status transition: cannot transition from "failed"/
      )
    })
  })
})
