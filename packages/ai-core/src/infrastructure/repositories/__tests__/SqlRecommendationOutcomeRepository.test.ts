import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../../database/DurableFileDatabase'
import { SqlRecommendationOutcomeRepository } from '../SqlRecommendationOutcomeRepository'
import { createRecommendationOutcome } from '../../../domain/entities/RecommendationOutcome'
import type { RecommendationOutcome } from '../../../domain/entities/RecommendationOutcome'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { WorkspaceId } from '../../../domain/value-objects'

const TEST_DB_DIR = path.join(process.cwd(), 'database-outcome-repo-test')
const WORKSPACE_A = createWorkspaceId('ws-outcome-repo-a')
const WORKSPACE_B = createWorkspaceId('ws-outcome-repo-b')

describe('SqlRecommendationOutcomeRepository — tenant isolation', () => {
  let database: DurableFileDatabase
  let repository: SqlRecommendationOutcomeRepository

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    }
    database = new DurableFileDatabase(TEST_DB_DIR)
    await database.initialize()
    repository = new SqlRecommendationOutcomeRepository(database)
  })

  function makeOutcome(
    id: string,
    workspaceId: WorkspaceId,
    projectId: string,
    recId: string,
    status: RecommendationOutcome['status']
  ): RecommendationOutcome {
    return createRecommendationOutcome({
      id,
      recommendationId: recId,
      workspaceId,
      projectId,
      status,
      verificationStatus: 'Pending.',
      verificationEvidence: [] as string[],
      outcomeSummary: 'test',
      actionId: null,
      executionId: null,
    })
  }

  it('keeps both tenants’ outcomes when ids collide across workspaces (no clobber)', async () => {
    // Regression: `save` previously filtered by `id` alone, so workspace B
    // saving an outcome with workspace A's id would DELETE workspace A's row.
    const outcomeA = makeOutcome(
      'out-shared-id',
      WORKSPACE_A,
      'proj-a',
      'rec-a',
      'VERIFIED_SUCCESS'
    )
    await repository.save(outcomeA)

    const outcomeB = makeOutcome('out-shared-id', WORKSPACE_B, 'proj-b', 'rec-b', 'FAILED')
    await repository.save(outcomeB)

    const fetchedA = await repository.getByIdAndWorkspace('out-shared-id', WORKSPACE_A)
    const fetchedB = await repository.getByIdAndWorkspace('out-shared-id', WORKSPACE_B)
    expect(fetchedA?.status).toBe('VERIFIED_SUCCESS')
    expect(fetchedB?.status).toBe('FAILED')
    expect(fetchedA?.recommendationId).toBe('rec-a')
    expect(fetchedB?.recommendationId).toBe('rec-b')
  })

  it('scopes reads by (projectId, workspaceId) and keeps same-id outcomes of other projects', async () => {
    const p1 = makeOutcome('out-1', WORKSPACE_A, 'proj-1', 'rec-1', 'PENDING')
    const p2 = makeOutcome('out-2', WORKSPACE_A, 'proj-2', 'rec-2', 'FAILED')
    await repository.save(p1)
    await repository.save(p2)

    const project1 = await repository.getByProject('proj-1', WORKSPACE_A)
    const project2 = await repository.getByProject('proj-2', WORKSPACE_A)
    expect(project1.map((o) => o.id)).toEqual(['out-1'])
    expect(project2.map((o) => o.id)).toEqual(['out-2'])
    expect(await repository.getByProject('proj-1', WORKSPACE_B)).toEqual([])
  })
})
