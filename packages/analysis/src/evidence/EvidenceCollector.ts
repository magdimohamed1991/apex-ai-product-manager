import type { RepositorySummary } from '../repository/RepositorySummary'
import type { Evidence } from './Evidence'
import { createEvidence } from './Evidence'

/**
 * Converts a RepositorySummary into a flat list of Evidence facts.
 * Each evidence item is deterministic and independently testable.
 */
export class EvidenceCollector {
  collect(summary: RepositorySummary): Evidence[] {
    const now = new Date()
    const evidence: Evidence[] = []

    const add = (type: Evidence['type'], key: string, value: unknown, confidence = 1): void => {
      evidence.push(
        createEvidence({
          id: `${type}:${key}`,
          type,
          source: 'github',
          key,
          value,
          confidence,
          collectedAt: now,
        })
      )
    }

    add('package_manager', 'packageManager', summary.packageManager)
    add('testing', 'hasTests', summary.hasTests)
    add('ci', 'hasCI', summary.hasCI)
    add('docker', 'hasDocker', summary.hasDocker)
    add('monorepo', 'hasMonorepo', summary.hasMonorepo)
    add('typescript', 'hasTypeScript', summary.hasTypeScript)
    add('complexity', 'complexity', summary.complexity)
    add('score', 'readinessScore', summary.score)

    summary.frameworks.forEach((f) => {
      add('framework', `framework:${f.toLowerCase()}`, f)
    })

    summary.languages.forEach((l) => {
      add('language', `language:${l.toLowerCase()}`, l)
    })

    return evidence
  }
}
