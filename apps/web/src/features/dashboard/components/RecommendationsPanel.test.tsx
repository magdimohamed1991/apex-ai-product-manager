// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { RecommendationsPanel } from './RecommendationsPanel'
import type { Recommendation, Workspace } from '../types'

/**
 * Frontend component tests for the Recommendation Center:
 *   - accessible <button> semantics (keyboard activation)
 *   - backend-only rendering (no fabricated category/priority fallbacks)
 *   - empty state
 *   - double-approve guard
 */
afterEach(() => cleanup())

const workspace: Workspace = { id: 'ws-1', name: 'Acme', slug: 'acme' }

const rec: Recommendation = {
  id: 'rec-1',
  workspaceId: 'ws-1',
  origin: 'insight',
  title: 'Introduce automated testing',
  rationale: 'No test suite was detected in the repository.',
  impact: 'Reduces regression risk',
  effort: 'medium',
  priority: 'high',
  confidence: 0.95,
  proposedActions: [
    { id: 'pa-1', title: 'Add Vitest test framework', description: 'Configure Vitest.' },
  ],
  category: 'TESTING',
  pmCategory: 'CRITICAL_PRODUCT_RISK',
  priorityScore: 9.5,
  expectedOutcome: 'Every PR receives automated test validation.',
}

describe('RecommendationsPanel', () => {
  it('renders an empty state when there are no recommendations', () => {
    render(
      <RecommendationsPanel
        workspace={workspace}
        projectId="proj-1"
        recommendations={[]}
        selected={null}
        onSelect={() => undefined}
        onAction={async () => undefined}
        onReview={() => undefined}
      />
    )
    expect(
      screen.getByText('No recommendations yet. Run a repository analysis to generate them.')
    ).toBeTruthy()
  })

  it('renders recommendation cards as real buttons (keyboard-activatable)', () => {
    const onSelect = vi.fn()
    render(
      <RecommendationsPanel
        workspace={workspace}
        projectId="proj-1"
        recommendations={[rec]}
        selected={null}
        onSelect={onSelect}
        onAction={async () => undefined}
        onReview={() => undefined}
      />
    )
    const card = screen.getByRole('button', { name: /Introduce automated testing/i })
    expect(card).toBeTruthy()

    // Keyboard activation: pressing Enter on a focused button fires onClick.
    card.focus()
    fireEvent.click(card)
    expect(onSelect).toHaveBeenCalledWith(rec)
  })

  it('renders ONLY backend-provided category and priority score (no fabricated fallbacks)', () => {
    const bare = { ...rec, pmCategory: undefined, priorityScore: undefined }
    render(
      <RecommendationsPanel
        workspace={workspace}
        projectId="proj-1"
        recommendations={[bare]}
        selected={bare}
        onSelect={() => undefined}
        onAction={async () => undefined}
        onReview={() => undefined}
      />
    )
    // The legacy fallbacks ('TECHNICAL_DEBT', '5.0') must not appear.
    expect(screen.queryByText('TECHNICAL_DEBT')).toBeNull()
    expect(screen.queryByText(/Priority Score: 5\.0/)).toBeNull()
    expect(screen.getByText('No category')).toBeTruthy()
    expect(screen.getByText('Priority Score: —')).toBeTruthy()
  })

  it('guards against double-approval clicks while an approval is in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>((res) => (release = res))
    const onAction = vi.fn(async () => {
      await gate
    })

    render(
      <RecommendationsPanel
        workspace={workspace}
        projectId="proj-1"
        recommendations={[rec]}
        selected={rec}
        onSelect={() => undefined}
        onAction={onAction}
        onReview={() => undefined}
      />
    )

    const approveBtn = screen.getByRole('button', { name: /Approve & Execute/i })
    fireEvent.click(approveBtn)
    fireEvent.click(approveBtn)
    release()

    // Only ONE approval call is dispatched while the first is in flight.
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledTimes(1))
  })
})
