import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../../database/DurableFileDatabase'
import { SqlProductRepository } from '../SqlProductRepository'
import { createWorkspaceId } from '../../../domain/value-objects'

const TEST_DB_DIR = path.join(process.cwd(), 'database-sql-product-repo-test')

/**
 * Regression tests for the (id, workspaceId)-scoped upsert contract.
 *
 * The legacy implementation filtered upserts by `id` alone, so a workspace B
 * row sharing an id with a workspace A row (e.g. the onboarding project id
 * "proj-core" is identical across every workspace) silently DELETED the
 * workspace A row. This is a cross-tenant data-loss bug.
 */
describe('SqlProductRepository — cross-workspace id collision isolation', () => {
  let database: DurableFileDatabase
  let repo: SqlProductRepository

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    }
    database = new DurableFileDatabase(TEST_DB_DIR)
    await database.initialize()
    repo = new SqlProductRepository(database)
  })

  it('keeps workspace A project rows intact when workspace B saves the same project id', async () => {
    const wsA = createWorkspaceId('ws-a')
    const wsB = createWorkspaceId('ws-b')

    await repo.saveProject({
      id: 'proj-core',
      workspaceId: wsA,
      name: 'A Core',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })
    await repo.saveProject({
      id: 'proj-core',
      workspaceId: wsB,
      name: 'B Core',
      createdAt: new Date('2026-02-01T00:00:00Z'),
    })

    const a = await repo.getProjectByIdAndWorkspace('proj-core', wsA)
    expect(a).not.toBeNull()
    expect(a!.name).toBe('A Core')

    const b = await repo.getProjectByIdAndWorkspace('proj-core', wsB)
    expect(b).not.toBeNull()
    expect(b!.name).toBe('B Core')

    // Both rows must be independently listable.
    expect((await repo.getProjectsByWorkspace(wsA)).length).toBe(1)
    expect((await repo.getProjectsByWorkspace(wsB)).length).toBe(1)
  })

  it('keeps workspace A recommendation rows when workspace B saves the same recommendation id', async () => {
    const wsA = createWorkspaceId('ws-a')
    const wsB = createWorkspaceId('ws-b')
    const sharedId = 'rec-add-testing-insight-ins-ws-a-no-tests'
    const base = {
      id: sharedId,
      origin: 'insight' as const,
      deduplicationKey: 'add-testing:insight:ins-ws-a-no-tests',
      title: 'Introduce automated testing',
      rationale: 'No test suite detected',
      impact: 'Reduces regression risk',
      effort: 'medium' as const,
      priority: 'high' as const,
      confidence: 0.95,
      insightIds: ['ins-ws-a-no-tests'],
      findingIds: [],
      proposedActions: [],
    }

    await repo.saveRecommendation(
      { ...base, workspaceId: wsA, title: 'A title', createdAt: new Date('2026-01-01T00:00:00Z') },
      'proj-a'
    )
    await repo.saveRecommendation(
      { ...base, workspaceId: wsB, title: 'B title', createdAt: new Date('2026-02-01T00:00:00Z') },
      'proj-b'
    )

    const a = await repo.getRecommendationByIdAndWorkspace(sharedId, wsA)
    expect(a).not.toBeNull()
    expect(a!.title).toBe('A title')

    const b = await repo.getRecommendationByIdAndWorkspace(sharedId, wsB)
    expect(b).not.toBeNull()
    expect(b!.title).toBe('B title')
  })

  it('getRecommendationProjectId returns null for cross-workspace lookup', async () => {
    const wsA = createWorkspaceId('ws-a')
    const wsB = createWorkspaceId('ws-b')
    const sharedId = 'rec-isolation-proj-id'
    const base = {
      id: sharedId,
      origin: 'insight' as const,
      deduplicationKey: 'test:insight:proj-id',
      title: 'Test',
      rationale: 'Test',
      impact: 'Test',
      effort: 'medium' as const,
      priority: 'high' as const,
      confidence: 0.9,
      insightIds: ['ins-test'],
      findingIds: [],
      proposedActions: [],
    }

    await repo.saveRecommendation(
      { ...base, workspaceId: wsA, title: 'A', createdAt: new Date('2026-01-01T00:00:00Z') },
      'proj-a'
    )
    await repo.saveRecommendation(
      { ...base, workspaceId: wsB, title: 'B', createdAt: new Date('2026-02-01T00:00:00Z') },
      'proj-b'
    )

    const projA = await repo.getRecommendationProjectId(sharedId, wsA)
    const projB = await repo.getRecommendationProjectId(sharedId, wsB)

    expect(projA).toBe('proj-a')
    expect(projB).toBe('proj-b')

    const crossA = await repo.getRecommendationProjectId(sharedId, createWorkspaceId('ws-c'))
    expect(crossA).toBeNull()
  })

  it('keeps workspace A finding rows when workspace B saves the same finding id', async () => {
    const wsA = createWorkspaceId('ws-a')
    const wsB = createWorkspaceId('ws-b')
    const finding = {
      id: 'finding-shared-id',
      workspaceId: wsA,
      type: 'risk' as const,
      title: 'Correlated signals detected',
      description: 'Signals overlap',
      priority: 'medium' as const,
      severity: 'medium' as const,
      evidenceIds: ['e1'],
      correlationId: 'corr-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    }

    await repo.saveFinding(finding, 'proj-a')
    await repo.saveFinding({ ...finding, id: 'finding-shared-id', workspaceId: wsB }, 'proj-b')

    const listA = await repo.getFindingsByProject('proj-a', wsA)
    const listB = await repo.getFindingsByProject('proj-b', wsB)
    expect(listA.length).toBe(1)
    expect(listB.length).toBe(1)
  })
})
