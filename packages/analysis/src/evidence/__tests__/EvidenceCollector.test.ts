import { describe, it, expect } from 'vitest'
import { EvidenceCollector } from '../EvidenceCollector'
import type { RepositorySummary } from '../../repository/RepositorySummary'

const baseSummary: RepositorySummary = {
  name: 'my-app',
  owner: 'acme',
  url: 'https://github.com/acme/my-app',
  languages: ['TypeScript'],
  frameworks: ['React', 'Vite'],
  packageManager: 'pnpm',
  hasDocker: false,
  hasCI: true,
  hasTests: true,
  hasMonorepo: true,
  hasTypeScript: true,
  hasTailwind: true,
  complexity: 'medium',
  score: 75,
}

describe('EvidenceCollector', () => {
  const collector = new EvidenceCollector()

  it('collects evidence for all summary fields', () => {
    const evidence = collector.collect(baseSummary)
    expect(evidence.length).toBeGreaterThan(0)
  })

  it('creates evidence for packageManager', () => {
    const evidence = collector.collect(baseSummary)
    const e = evidence.find((e) => e.key === 'packageManager')
    expect(e).toBeDefined()
    expect(e?.value).toBe('pnpm')
  })

  it('creates evidence for hasTests', () => {
    const evidence = collector.collect(baseSummary)
    const e = evidence.find((e) => e.key === 'hasTests')
    expect(e?.value).toBe(true)
  })

  it('creates evidence for hasCI', () => {
    const evidence = collector.collect(baseSummary)
    const e = evidence.find((e) => e.key === 'hasCI')
    expect(e?.value).toBe(true)
  })

  it('creates evidence for each framework', () => {
    const evidence = collector.collect(baseSummary)
    const reactEvidence = evidence.find((e) => e.key === 'framework:react')
    expect(reactEvidence).toBeDefined()
    expect(reactEvidence?.value).toBe('React')
  })

  it('sets confidence to 1 for all structural evidence', () => {
    const evidence = collector.collect(baseSummary)
    evidence.forEach((e) => expect(e.confidence).toBe(1))
  })

  it('assigns unique ids', () => {
    const evidence = collector.collect(baseSummary)
    const ids = evidence.map((e) => e.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('sets source to github', () => {
    const evidence = collector.collect(baseSummary)
    evidence.forEach((e) => expect(e.source).toBe('github'))
  })
})
