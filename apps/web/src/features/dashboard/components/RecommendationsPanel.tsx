import { useEffect, useRef, useState } from 'react'
import type { Recommendation, Workspace, AIProductReasoning } from '../types'
import { ReasoningPanel } from './ReasoningPanel'
import { apiClient, ApiError } from '../api/client'

interface Props {
  workspace: Workspace | null
  projectId: string | null
  recommendations: Recommendation[]
  selected: Recommendation | null
  onSelect: (r: Recommendation) => void
  onAction: (recId: string, paId: string) => Promise<void>
}

export function RecommendationsPanel({
  workspace,
  projectId,
  recommendations,
  selected,
  onSelect,
  onAction,
}: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
      <div className="lg:col-span-2 flex flex-col gap-4">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">
          Select Recommendation
        </span>
        {recommendations.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-slate-500 text-sm">
            No recommendations yet. Run a repository analysis to generate them.
          </div>
        )}
        <div className="flex flex-col gap-3 max-h-[580px] overflow-y-auto pr-2">
          {recommendations.map((rec) => {
            const isActive = selected?.id === rec.id
            return (
              // Real <button>: keyboard-focusable, Enter/Space activates,
              // and screen readers announce it as an action.
              <button
                key={rec.id}
                type="button"
                onClick={() => onSelect(rec)}
                className={`p-4 rounded-xl border transition-all text-left cursor-pointer flex flex-col gap-1.5 ${
                  isActive
                    ? 'bg-indigo-600/10 border-indigo-500 text-indigo-300 ring-1 ring-indigo-500/20'
                    : 'bg-slate-900/10 border-slate-800 text-slate-300 hover:bg-slate-900/30'
                } focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
              >
                <div className="flex justify-between items-center text-[10px]">
                  <span className="uppercase font-extrabold tracking-wider">{rec.priority}</span>
                  <span>{Math.round(rec.confidence * 100)}% match</span>
                </div>
                <h4 className="font-bold text-sm truncate text-white">{rec.title}</h4>
              </button>
            )
          })}
        </div>
      </div>

      <div className="lg:col-span-3">
        {selected ? (
          // key={id} remounts the detail view on selection change so all
          // per-recommendation state (reasoning, loading) resets naturally
          // instead of being reset via setState inside an effect.
          <RecommendationDetail
            key={selected.id}
            workspace={workspace}
            projectId={projectId}
            recommendation={selected}
            onAction={onAction}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-slate-500 text-sm">
            Please select a recommendation from the left panel.
          </div>
        )}
      </div>
    </div>
  )
}

type DecisionKind = 'ACCEPT' | 'REJECT' | 'DEFER' | 'OVERRIDE'

function RecommendationDetail({
  workspace,
  projectId,
  recommendation,
  onAction,
}: {
  workspace: Workspace | null
  projectId: string | null
  recommendation: Recommendation
  onAction: (recId: string, paId: string) => Promise<void>
}) {
  // All per-recommendation state starts fresh on every selection because the
  // parent remounts this component with key={recommendation.id}. No state is
  // reset synchronously inside effects.
  const [reasoning, setReasoning] = useState<AIProductReasoning | null>(null)
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(false)
  const [reasoningError, setReasoningError] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [decisionBusy, setDecisionBusy] = useState<DecisionKind | null>(null)
  const [decisionStatus, setDecisionStatus] = useState<{
    kind: DecisionKind
    ok: boolean
    message: string
  } | null>(null)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overridePriority, setOverridePriority] = useState('')
  // The REAL decision window: recorded when the detail view opens (the PM
  // cannot decide before the recommendation is presented), sent to the H7
  // telemetry stream on every decision. Both timestamps share the client
  // clock, so the measured latency is skew-free. Captured in the mount
  // effect (NOT during render — Date.now() is impure and would violate the
  // render-purity rule).
  const decisionWindowRef = useRef<{ presentedAt: number; startedAt: number } | null>(null)

  useEffect(() => {
    if (decisionWindowRef.current === null) {
      decisionWindowRef.current = { presentedAt: Date.now(), startedAt: Date.now() }
    }
    if (!workspace) return
    let active = true
    apiClient
      .getReasoning(workspace.id, recommendation.id)
      .then((data) => {
        if (!active) return
        setReasoning(data)
      })
      .catch((err: unknown) => {
        if (!active) return
        setReasoningError(err instanceof ApiError ? err.message : 'Reasoning unavailable')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [workspace, recommendation.id])

  async function submitContext(e: React.FormEvent) {
    e.preventDefault()
    if (!workspace || !answer.trim()) return
    setLoading(true)
    setReasoningError(null)
    try {
      const data = await apiClient.submitContext(workspace.id, recommendation.id, answer)
      setReasoning(data)
      setAnswer('')
    } catch (err) {
      setReasoningError(err instanceof ApiError ? err.message : 'Reasoning unavailable')
    } finally {
      setLoading(false)
    }
  }

  /**
   * Records a REAL PM decision into the H7 telemetry stream (the H7
   * observation experiment). The server computes the H3/H6 scores; the
   * client only supplies the decision kind, the PM override priority (for
   * OVERRIDE), and the real decision-window timestamps. The client NEVER
   * sends originalH3Score / calibratedH6Score.
   */
  async function recordDecision(kind: DecisionKind, pmSelectedPriority?: number) {
    if (!workspace || !projectId) return
    const window = decisionWindowRef.current ?? {
      presentedAt: Date.now(),
      startedAt: Date.now(),
    }
    await apiClient.recordDecision(workspace.id, projectId, {
      recommendationId: recommendation.id,
      decision: kind,
      pmSelectedPriority,
      recommendationPresentedAt: new Date(window.presentedAt).toISOString(),
      decisionStartedAt: new Date(window.startedAt).toISOString(),
      decisionCompletedAt: new Date().toISOString(),
    })
  }

  async function handleDecision(kind: DecisionKind, pmSelectedPriority?: number) {
    if (decisionBusy) return
    setDecisionBusy(kind)
    setDecisionStatus(null)
    try {
      await recordDecision(kind, pmSelectedPriority)
      setDecisionStatus({
        kind,
        ok: true,
        message: `Decision recorded: ${kind}${kind === 'OVERRIDE' ? ` (priority ${pmSelectedPriority})` : ''}`,
      })
    } catch (err) {
      setDecisionStatus({
        kind,
        ok: false,
        message: err instanceof ApiError ? err.message : 'Failed to record decision telemetry',
      })
    } finally {
      setDecisionBusy(null)
    }
  }

  async function handleApprove(paId: string) {
    if (approving) return
    setApproving(true)
    try {
      await onAction(recommendation.id, paId)
      // Accept & Execute: approve the action AND record the ACCEPT
      // decision. Telemetry failure must never block the approval flow.
      if (workspace && projectId) {
        try {
          await handleDecision('ACCEPT')
        } catch {
          // handled inside handleDecision
        }
      }
    } finally {
      setApproving(false)
    }
  }

  function submitOverride() {
    const value = Number(overridePriority)
    if (!Number.isFinite(value) || value < 0 || value > 10) return
    void handleDecision('OVERRIDE', Math.round(value * 10) / 10)
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/20 flex flex-col overflow-hidden">
      <div className="p-6 bg-slate-900/50 border-b border-slate-800 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          {/* Render ONLY backend-provided values. The legacy fallbacks
              (`|| 'TECHNICAL_DEBT'` and `?? 5.0`) fabricated a category and
              a priority score when the row lacked them. */}
          {recommendation.pmCategory ? (
            <span className="px-2.5 py-1 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-widest">
              {recommendation.pmCategory}
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded text-[10px] font-bold bg-slate-800 text-slate-500 uppercase tracking-widest">
              No category
            </span>
          )}
          {recommendation.priorityScore !== undefined ? (
            <span className="text-xs font-bold text-white">
              Priority Score: {recommendation.priorityScore.toFixed(1)}
            </span>
          ) : (
            <span className="text-xs text-slate-500">Priority Score: —</span>
          )}
          <span className="text-[10px] text-slate-400">deterministic (H3)</span>
        </div>
        <h3 className="text-xl font-black text-white">{recommendation.title}</h3>
        <p className="text-xs text-slate-400 leading-relaxed">{recommendation.rationale}</p>
      </div>

      {reasoningError && (
        <div className="p-4 border-b border-slate-800 bg-rose-500/5 text-xs text-rose-300">
          {reasoningError}
        </div>
      )}
      <ReasoningPanel
        reasoning={reasoning}
        loading={loading}
        unavailable={!!reasoning?.unavailable}
      />

      {reasoning?.clarifyingQuestions && reasoning.clarifyingQuestions.length > 0 && (
        <form
          onSubmit={submitContext}
          className="p-6 flex flex-col gap-3 bg-slate-900/30 border-b border-slate-800"
        >
          <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block">
            ➔ AI PM Clarifying Question
          </span>
          <p className="text-xs text-slate-300 font-bold">
            &ldquo;{reasoning.clarifyingQuestions[0]}&rdquo;
          </p>
          <div className="flex gap-2 mt-1">
            <input
              type="text"
              placeholder="Answer clarifying question..."
              className="flex-1 min-w-0 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-bold text-white transition-colors"
            >
              Submit Context
            </button>
          </div>
        </form>
      )}

      <div className="p-6 flex flex-col gap-4">
        <span className="text-xs font-extrabold text-slate-400 uppercase tracking-widest block">
          PM Decision (H7 observation)
        </span>

        {/* Every decision records REAL telemetry: kind, window timestamps,
            and (for OVERRIDE) the PM's numeric priority. The client never
            sends H3/H6 scores — the server computes them. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => void handleDecision('ACCEPT')}
            disabled={decisionBusy !== null}
            className="rounded-lg py-2.5 text-xs font-bold text-white transition-colors bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => void handleDecision('REJECT')}
            disabled={decisionBusy !== null}
            className="rounded-lg py-2.5 text-xs font-bold text-white transition-colors bg-rose-600 hover:bg-rose-500 disabled:opacity-50"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => void handleDecision('DEFER')}
            disabled={decisionBusy !== null}
            className="rounded-lg py-2.5 text-xs font-bold text-white transition-colors bg-amber-600 hover:bg-amber-500 disabled:opacity-50"
          >
            Defer
          </button>
          <button
            type="button"
            onClick={() => setOverrideOpen((v) => !v)}
            disabled={decisionBusy !== null}
            className="rounded-lg py-2.5 text-xs font-bold text-white transition-colors bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
          >
            Override
          </button>
        </div>

        {overrideOpen && (
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 flex flex-col gap-3">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Override — PM numeric priority (0–10)
            </span>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={overridePriority}
                onChange={(e) => setOverridePriority(e.target.value)}
                placeholder={`APEX H6: ${recommendation.priorityScore?.toFixed(1) ?? '—'}`}
                className="flex-1 min-w-0 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={submitOverride}
                disabled={decisionBusy !== null || overridePriority === ''}
                className="rounded-lg bg-slate-600 hover:bg-slate-500 px-4 py-2 text-xs font-bold text-white transition-colors disabled:opacity-50"
              >
                {decisionBusy === 'OVERRIDE' ? 'Recording...' : 'Record Override'}
              </button>
            </div>
            <p className="text-[10px] text-slate-500">
              The recorded delta is |H6 calibrated score − PM priority|, computed server-side from
              the persisted H6 calibration.
            </p>
          </div>
        )}

        {decisionStatus && (
          <div
            className={`rounded-lg px-3 py-2 text-[11px] font-bold border ${
              decisionStatus.ok
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-300 border-rose-500/20'
            }`}
          >
            {decisionStatus.ok ? '✓ ' : '✕ '}
            {decisionStatus.message}
          </div>
        )}

        <span className="text-xs font-extrabold text-slate-400 uppercase tracking-widest block pt-2">
          Accept &amp; Execute — Proposed Action
        </span>
        <div className="flex flex-col gap-3">
          {recommendation.proposedActions.map((pa) => (
            <div
              key={pa.id}
              className="rounded-xl border border-slate-800 bg-slate-950 p-4 flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1">
                <span className="font-bold text-sm text-white">{pa.title}</span>
                <p className="text-xs text-slate-400">{pa.description}</p>
              </div>
              <button
                onClick={() => handleApprove(pa.id)}
                disabled={approving}
                className="w-full rounded-lg py-3 text-xs font-bold text-white transition-colors flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-600/10 disabled:opacity-50"
              >
                {approving ? 'Approving...' : 'Approve & Execute'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
