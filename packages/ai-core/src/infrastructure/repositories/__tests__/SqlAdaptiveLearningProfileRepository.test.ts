import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../../database/DurableFileDatabase'
import { SqlAdaptiveLearningProfileRepository } from '../SqlAdaptiveLearningProfileRepository'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { LearningSignal } from '../../../domain/entities/ProductAdaptive'

const TEST_DB_DIR = path.join(process.cwd(), 'database-adaptive-profile-repo-test')

function signal(id: string, category: string, type: LearningSignal['type']): LearningSignal {
  return {
    id,
    workspaceId: createWorkspaceId('ws-1'),
    projectId: 'proj-1',
    category,
    type,
    observationCount: 6,
    value: 0.8,
    confidence: 0.4,
    sourceRecommendationIds: ['rec-1'],
    generatedAt: new Date(),
    evidenceState: 'observed',
    calibrationVersion: 'h6-v2',
  }
}

describe('SqlAdaptiveLearningProfileRepository — stale signal replacement', () => {
  let database: DurableFileDatabase
  let repo: SqlAdaptiveLearningProfileRepository

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    }
    database = new DurableFileDatabase(TEST_DB_DIR)
    await database.initialize()
    repo = new SqlAdaptiveLearningProfileRepository(database)
  })

  it('replaces the previous signal for the same (workspace, project, category, type) when the observation set changes', async () => {
    const ws = createWorkspaceId('ws-1')

    // First compilation: observation set "src-hash-1" → signal id A.
    await repo.saveSignals([signal('sig-AAA-aaaaaaaaaaaaaaaa', 'TESTING', 'ADOPTION')])
    expect(await repo.getSignals(ws, 'proj-1')).toHaveLength(1)

    // Second compilation with a NEW observation set produces a NEW
    // deterministic id for the SAME logical signal. The old row must be
    // replaced, not appended.
    await repo.saveSignals([signal('sig-BBB-bbbbbbbbbbbbbbbb', 'TESTING', 'ADOPTION')])

    const signals = await repo.getSignals(ws, 'proj-1')
    expect(signals).toHaveLength(1)
    expect(signals[0].id).toBe('sig-BBB-bbbbbbbbbbbbbbbb')
  })

  it('keeps signals of other categories/types untouched when replacing one tuple', async () => {
    const ws = createWorkspaceId('ws-1')
    await repo.saveSignals([
      signal('sig-TESTING-ADOPTION-1', 'TESTING', 'ADOPTION'),
      signal('sig-CICD-ADOPTION-1', 'CI_CD', 'ADOPTION'),
      signal('sig-TESTING-OUTCOME-1', 'TESTING', 'OUTCOME_SUCCESS'),
    ])
    await repo.saveSignals([signal('sig-TESTING-ADOPTION-2', 'TESTING', 'ADOPTION')])

    const signals = await repo.getSignals(ws, 'proj-1')
    expect(signals).toHaveLength(3)
    expect(signals.find((s) => s.category === 'TESTING' && s.type === 'ADOPTION')!.id).toBe(
      'sig-TESTING-ADOPTION-2'
    )
  })
})
