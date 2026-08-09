import { describe, it, expect } from 'vitest'
import { PMDecisionTelemetryService } from '../PMDecisionTelemetryService'
import type { PMDecisionTelemetryStore } from '../PMDecisionTelemetryService'
import type { PMDecisionTelemetry } from '../../../domain/entities'
import { createWorkspaceId } from '../../../domain/value-objects'

/**
 * H7 telemetry stream tests: real persistence, idempotent dedup, tenant
 * scoping, and strict timestamp/schema validation. Fabricated or malformed
 * telemetry must never enter the store.
 */
function fakeStore(): { store: PMDecisionTelemetryStore; rows: PMDecisionTelemetry[] } {
  const rows: PMDecisionTelemetry[] = []
  const store: PMDecisionTelemetryStore = {
    async savePMDecisionTelemetry(t) {
      // Upsert by id (mirrors the repository implementation).
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].id === t.id) rows.splice(i, 1)
      }
      rows.push(t)
    },
    async getPMDecisionTelemetryByProject(projectId, workspaceId) {
      return rows.filter((r) => r.projectId === projectId && r.workspaceId === workspaceId)
    },
  }
  return { store, rows }
}

const WS_A = createWorkspaceId('ws-a')
const WS_B = createWorkspaceId('ws-b')

function input(
  overrides: Partial<Parameters<PMDecisionTelemetryService['recordDecision']>[0]> = {}
) {
  const startedAt = new Date('2026-08-09T10:00:00Z')
  return {
    workspaceId: WS_A,
    projectId: 'proj-1',
    recommendationId: 'rec-1',
    category: 'TESTING',
    originalH3Score: 9.5,
    calibratedH6Score: 9.5,
    decision: 'ACCEPT' as const,
    decisionStartedAt: startedAt,
    decisionCompletedAt: new Date('2026-08-09T10:01:30Z'), // 90s window
    recommendationPresentedAt: new Date('2026-08-09T09:59:00Z'),
    ...overrides,
  }
}

describe('PMDecisionTelemetryService (H7)', () => {
  it('persists a real decision record with server-provided scores', async () => {
    const { store, rows } = fakeStore()
    const service = new PMDecisionTelemetryService(store)

    const recorded = await service.recordDecision(input())

    expect(recorded.id).toMatch(/^pmd-/)
    expect(recorded.originalH3Score).toBe(9.5)
    expect(recorded.calibratedH6Score).toBe(9.5)
    expect(recorded.overrideOccurred).toBe(false)
    expect(recorded.decision).toBe('ACCEPT')
    expect(rows).toHaveLength(1)
  })

  it('is idempotent: re-submitting the same decision window does not duplicate the record', async () => {
    const { store, rows } = fakeStore()
    const service = new PMDecisionTelemetryService(store)

    const first = await service.recordDecision(input())
    const second = await service.recordDecision(input())

    expect(second.id).toBe(first.id)
    expect(rows).toHaveLength(1)
  })

  it('scopes telemetry to (project, workspace): workspace B never sees workspace A records', async () => {
    const { store } = fakeStore()
    const service = new PMDecisionTelemetryService(store)

    await service.recordDecision(input())
    await service.recordDecision(input({ workspaceId: WS_B, projectId: 'proj-2' }))

    expect((await service.listForProject(WS_A, 'proj-1')).length).toBe(1)
    expect((await service.listForProject(WS_B, 'proj-2')).length).toBe(1)
    expect(await service.listForProject(WS_A, 'proj-2')).toHaveLength(0)
    expect(await service.listForProject(WS_B, 'proj-1')).toHaveLength(0)
  })

  it('computes the measured decision latency from the real decision window', async () => {
    const { store } = fakeStore()
    const service = new PMDecisionTelemetryService(store)

    expect(await service.measuredDecisionLatency(WS_A, 'proj-1')).toBeNull()

    await service.recordDecision(input())
    const latency = await service.measuredDecisionLatency(WS_A, 'proj-1')
    expect(latency).toBeCloseTo(90, 5) // 90 seconds
  })

  it('rejects records whose completion precedes their start (no fabricated windows)', async () => {
    const { store, rows } = fakeStore()
    const service = new PMDecisionTelemetryService(store)

    await expect(
      service.recordDecision(
        input({
          decisionCompletedAt: new Date('2026-08-09T09:58:00Z'), // before start
        })
      )
    ).rejects.toThrow(/must not precede/)
    expect(rows).toHaveLength(0)
  })

  it('rejects unknown decision kinds and non-finite scores', async () => {
    const { store } = fakeStore()
    const service = new PMDecisionTelemetryService(store)

    await expect(service.recordDecision(input({ decision: 'MAYBE' as never }))).rejects.toThrow(
      /decision must be one of/
    )
    await expect(service.recordDecision(input({ originalH3Score: Number.NaN }))).rejects.toThrow(
      /originalH3Score must be a finite number/
    )
  })

  it('records overrides with the correct delta semantics', async () => {
    const { store } = fakeStore()
    const service = new PMDecisionTelemetryService(store)

    const recorded = await service.recordDecision(
      input({ pmSelectedPriority: 4.0, apexRank: 1, pmRank: 2 })
    )
    expect(recorded.overrideOccurred).toBe(true)
    expect(recorded.overrideDelta).toBeCloseTo(5.5, 5) // |9.5 - 4.0|
    expect(recorded.rankDisplacement).toBe(1)
  })
})
