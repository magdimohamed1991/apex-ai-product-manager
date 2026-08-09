import { describe, it, expect } from 'vitest'
import { ALL_SOURCE_TYPES, SOURCE_LABELS } from '../SourceType'
import type { Source } from '../Source'
import { validatePersistenceSourceReference } from '../SourceReference'
import type { SourceReference } from '../SourceReference'
import type { Evidence } from '@apex/analysis'
import { createWorkspaceId } from '../../value-objects'

const WORKSPACE_ID = createWorkspaceId('ws-sources-test')

describe('SourceType', () => {
  it('contains all expected source types', () => {
    expect(ALL_SOURCE_TYPES).toContain('github')
    expect(ALL_SOURCE_TYPES).toContain('slack')
    expect(ALL_SOURCE_TYPES).toContain('linear')
    expect(ALL_SOURCE_TYPES).toContain('jira')
    expect(ALL_SOURCE_TYPES).toContain('amplitude')
    expect(ALL_SOURCE_TYPES).toContain('google_play')
    expect(ALL_SOURCE_TYPES).toContain('app_store')
    expect(ALL_SOURCE_TYPES).toContain('website')
  })

  it('has 8 source types', () => {
    expect(ALL_SOURCE_TYPES).toHaveLength(8)
  })

  it('has human-readable labels for all types', () => {
    ALL_SOURCE_TYPES.forEach((type) => {
      expect(SOURCE_LABELS[type]).toBeTruthy()
    })
  })

  it('github label is GitHub', () => {
    expect(SOURCE_LABELS['github']).toBe('GitHub')
  })

  it('google_play label is Google Play', () => {
    expect(SOURCE_LABELS['google_play']).toBe('Google Play')
  })
})

describe('Source entity', () => {
  const source: Source = {
    id: 'src-001',
    workspaceId: WORKSPACE_ID,
    type: 'github',
    name: 'apex-ai-product-manager',
    status: 'active',
    connectedAt: new Date('2026-01-01'),
    lastSyncedAt: new Date('2026-08-07'),
    metadata: {
      url: 'https://github.com/acme/apex',
      identifier: 'acme/apex',
    },
  }

  it('has correct type', () => {
    expect(source.type).toBe('github')
  })

  it('has active status', () => {
    expect(source.status).toBe('active')
  })

  it('has workspaceId', () => {
    expect(source.workspaceId).toBe(WORKSPACE_ID)
  })

  it('has metadata url', () => {
    expect(source.metadata.url).toBeTruthy()
  })

  it('allows null lastSyncedAt', () => {
    const unsynced: Source = { ...source, lastSyncedAt: null }
    expect(unsynced.lastSyncedAt).toBeNull()
  })
})

describe('SourceReference', () => {
  const ref: SourceReference = {
    sourceId: 'src-001',
    sourceType: 'github',
    externalId: 'pr-42',
    url: 'https://github.com/acme/apex/pull/42',
    title: 'Fix checkout flow',
    capturedAt: new Date('2026-08-07'),
  }

  it('has sourceId', () => {
    expect(ref.sourceId).toBe('src-001')
  })

  it('has sourceType', () => {
    expect(ref.sourceType).toBe('github')
  })

  it('has externalId', () => {
    expect(ref.externalId).toBe('pr-42')
  })

  it('has url', () => {
    expect(ref.url).toContain('github.com')
  })

  it('allows null url', () => {
    const noUrl: SourceReference = { ...ref, url: null }
    expect(noUrl.url).toBeNull()
  })

  it('has title', () => {
    expect(ref.title).toBeTruthy()
  })

  it('has capturedAt date', () => {
    expect(ref.capturedAt).toBeInstanceOf(Date)
  })
})

describe('Evidence with SourceReference', () => {
  it('sourceReference is optional on Evidence', () => {
    // Evidence without sourceReference (static analysis)
    const staticEvidence: Evidence = {
      id: 'testing:hasTests',
      type: 'testing',
      source: 'github',
      key: 'hasTests',
      value: false,
      confidence: 1,
      collectedAt: new Date(),
    }
    expect(staticEvidence.sourceReference).toBeUndefined()
  })

  it('sourceReference links Evidence to exact origin', () => {
    const evidenceWithRef = {
      id: 'reviews:checkout-complaint',
      type: 'testing' as const,
      source: 'google_play' as const,
      key: 'checkoutComplaintCount',
      value: 27,
      confidence: 0.9,
      collectedAt: new Date(),
      sourceReference: {
        sourceId: 'src-gplay-001',
        sourceType: 'google_play' as const,
        externalId: 'review-batch-2026-08',
        url: null,
        title: '27 reviews mentioning checkout failure',
        capturedAt: new Date(),
      },
    }
    expect(evidenceWithRef.sourceReference?.sourceType).toBe('google_play')
    expect(evidenceWithRef.sourceReference?.title).toContain('checkout')
  })
})

describe('validatePersistenceSourceReference contract', () => {
  const source: Source = {
    id: 'src-001',
    workspaceId: WORKSPACE_ID,
    type: 'github',
    name: 'apex-ai-product-manager',
    status: 'active',
    connectedAt: new Date('2026-01-01'),
    lastSyncedAt: new Date('2026-08-07'),
    metadata: {},
  }

  const validRef: SourceReference = {
    sourceId: 'src-001',
    sourceType: 'github',
    externalId: 'pr-42',
    url: 'https://github.com/acme/apex/pull/42',
    title: 'Fix checkout flow',
    capturedAt: new Date('2026-08-07'),
  }

  it('passes when sourceId and sourceType match Source exactly', () => {
    expect(() => validatePersistenceSourceReference(validRef, source)).not.toThrow()
  })

  it('rejects when sourceId does not match Source.id', () => {
    const invalidRef = { ...validRef, sourceId: 'src-mismatch' }
    expect(() => validatePersistenceSourceReference(invalidRef, source)).toThrow(
      /Persistence validation failed: SourceReference.sourceId "src-mismatch" does not match/
    )
  })

  it('rejects when sourceType does not match Source.type', () => {
    const invalidRef = { ...validRef, sourceType: 'slack' as const }
    expect(() => validatePersistenceSourceReference(invalidRef, source)).toThrow(
      /Persistence validation failed: SourceReference.sourceType "slack" does not match/
    )
  })
})
