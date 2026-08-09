// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { FindingsPanel } from './FindingsPanel'
import type { Finding } from '../types'

afterEach(() => cleanup())

/**
 * Frontend component tests (first harness in the repo).
 * The audit's coverage matrix previously had an empty "Frontend" row;
 * these tests validate REAL rendering behavior: real evidence provenance
 * (no fabricated paths), empty states, and accessible markup.
 */
describe('FindingsPanel', () => {
  const finding: Finding = {
    id: 'finding-1',
    workspaceId: 'ws-1',
    type: 'risk',
    title: 'Correlated signals detected across 2 sources',
    description: 'Signals overlap between github and slack.',
    priority: 'high',
    severity: 'medium',
    evidenceIds: ['ci:hasCI', 'testing:hasTests'],
    correlationId: 'corr-1',
    createdAt: '2026-08-09T10:00:00.000Z',
  }

  it('renders the real evidence provenance, never fabricated file paths', () => {
    render(<FindingsPanel findings={[finding]} />)

    expect(screen.getByText('Correlated signals detected across 2 sources')).toBeTruthy()
    expect(screen.getByText('➔ Evidence: ci:hasCI')).toBeTruthy()
    expect(screen.getByText('➔ Evidence: testing:hasTests')).toBeTruthy()
    expect(screen.getByText('Correlation: corr-1')).toBeTruthy()
    // The legacy fabricated block ("Detected Status: Unconfigured or
    // disabled", guessed paths like vitest.config.ts) must not exist.
    expect(screen.queryByText(/Unconfigured or disabled/)).toBeNull()
    expect(screen.queryByText(/vitest\.config\.ts/)).toBeNull()
  })

  it('renders an honest empty state when no findings exist', () => {
    render(<FindingsPanel findings={[]} />)
    expect(
      screen.getByText('No findings currently recorded. Please trigger a repository analysis!')
    ).toBeTruthy()
  })

  it('shows "no evidence recorded" instead of inventing evidence when evidenceIds is empty', () => {
    render(<FindingsPanel findings={[{ ...finding, evidenceIds: [] }]} />)
    expect(screen.getByText('No evidence recorded.')).toBeTruthy()
  })
})
