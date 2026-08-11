import { useState } from 'react'
import type { Recommendation, AIProductReasoning, Finding, PriorityCalibration } from '../types'

interface RecommendationReviewProps {
  recommendation: Recommendation
  reasoning: AIProductReasoning | null
  findings: Finding[]
  calibration: PriorityCalibration | null
  isReasoningLoading: boolean
  onFetchReasoning: (recId: string) => Promise<void>
  onDecision: (
    recId: string,
    decision: string,
    paId?: string,
    pmSelectedPriority?: number
  ) => Promise<void>
  onBack: () => void
}

export function RecommendationReview({
  recommendation: rec,
  reasoning,
  findings,
  calibration,
  isReasoningLoading,
  onFetchReasoning,
  onDecision,
  onBack,
}: RecommendationReviewProps) {
  const [decisionPending, setDecisionPending] = useState(false)
  const [overridePriority, setOverridePriority] = useState('')
  const [showOverride, setShowOverride] = useState(false)

  function confidenceLabel(c: number): string {
    if (c >= 0.8) return 'Strong — multiple sources confirm this finding'
    if (c >= 0.6) return 'Moderate — consistent signals but limited data points'
    if (c >= 0.4) return 'Weak — early signals, needs more data to confirm'
    return 'Insufficient — preliminary assessment only'
  }

  function riskLabel(rec: Recommendation): string {
    const parts: string[] = []
    if (rec.effort === 'high') parts.push('High implementation effort')
    if (rec.confidence < 0.5) parts.push('Low confidence — evidence is preliminary')
    if (rec.priorityScore !== undefined && rec.priorityScore < 4)
      parts.push('Low priority score — may not justify the investment')
    if (parts.length === 0) parts.push('Standard risk — moderate effort with reasonable confidence')
    return parts.join('; ')
  }

  const relatedFindings = findings.filter((f) => rec.findingIds?.includes(f.id))

  async function handleDecision(decision: string) {
    setDecisionPending(true)
    try {
      await onDecision(rec.id, decision)
    } finally {
      setDecisionPending(false)
    }
  }

  async function handleOverride() {
    const value = Number(overridePriority)
    if (!Number.isFinite(value) || value < 0 || value > 10) return
    setDecisionPending(true)
    try {
      await onDecision(rec.id, 'OVERRIDE', undefined, Math.round(value * 10) / 10)
    } finally {
      setDecisionPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <button
        onClick={onBack}
        className="self-start text-xs text-slate-400 hover:text-white transition-colors"
      >
        Back to recommendations
      </button>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  rec.priority === 'critical'
                    ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                    : rec.priority === 'high'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      : rec.priority === 'medium'
                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                        : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                }`}
              >
                {rec.priority}
              </span>
              {rec.category && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  {rec.category}
                </span>
              )}
              <span className="text-[10px] text-slate-500">
                Confidence: {Math.round(rec.confidence * 100)}% — {confidenceLabel(rec.confidence)}
              </span>
            </div>
            <h2 className="text-xl font-extrabold text-white">{rec.title}</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex flex-col gap-4">
            <Section title="Recommendation">
              <p className="text-sm text-slate-300">{rec.title}</p>
            </Section>
            <Section title="Rationale">
              <p className="text-sm text-slate-300">{rec.rationale}</p>
            </Section>
            <Section title="Expected Impact">
              <p className="text-sm text-slate-300">{rec.impact}</p>
            </Section>
            <Section title="Effort">
              <span className="text-sm text-slate-300 capitalize">{rec.effort}</span>
            </Section>
          </div>

          <div className="flex flex-col gap-4">
            <Section title="Evidence">
              {relatedFindings.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {relatedFindings.map((f) => (
                    <div key={f.id} className="rounded-lg bg-slate-800/50 p-3">
                      <p className="text-xs font-bold text-white">{f.title}</p>
                      <p className="text-[11px] text-slate-400 mt-1">{f.description}</p>
                      <div className="flex gap-2 mt-1">
                        <span className="text-[10px] text-slate-500">{f.severity}</span>
                        <span className="text-[10px] text-slate-500">{f.type}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500">No findings linked</p>
              )}
            </Section>

            {calibration && (
              <Section title="Priority Calibration">
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-slate-400">
                    Base: {calibration.baseScore.toFixed(2)} → Calibrated:{' '}
                    {calibration.calibratedScore.toFixed(2)}
                  </p>
                  {calibration.safetyFloorEnforced && (
                    <p className="text-[10px] text-amber-400">Safety floor enforced</p>
                  )}
                  <p className="text-[11px] text-slate-500">{calibration.explanation}</p>
                </div>
              </Section>
            )}

            <Section title="Why This Priority">
              <div className="text-xs text-slate-400 space-y-1">
                {rec.priorityScore !== undefined && (
                  <p>
                    H3 deterministic score:{' '}
                    <span className="text-white font-bold">{rec.priorityScore.toFixed(1)}</span>
                  </p>
                )}
                {relatedFindings.length > 0 && (
                  <p>
                    Backed by <span className="text-white font-bold">{relatedFindings.length}</span>{' '}
                    linked finding{relatedFindings.length !== 1 ? 's' : ''}
                  </p>
                )}
                <p>
                  Confidence:{' '}
                  <span className="text-white font-bold">{Math.round(rec.confidence * 100)}%</span>
                </p>
                {calibration && (
                  <p>
                    Post-calibration adjustment:{' '}
                    <span className="text-white font-bold">
                      {calibration.calibratedScore > calibration.baseScore ? '+' : ''}
                      {(calibration.calibratedScore - calibration.baseScore).toFixed(2)}
                    </span>
                  </p>
                )}
              </div>
            </Section>

            <Section title="Risk">
              <p className="text-sm text-slate-300">{riskLabel(rec)}</p>
            </Section>
          </div>
        </div>
      </div>

      {/* AI Reasoning (H8-ACTION-4: Explainability) */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-300">AI Reasoning</h3>
          <button
            onClick={() => onFetchReasoning(rec.id)}
            disabled={isReasoningLoading}
            className="text-[10px] text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
          >
            {isReasoningLoading ? 'Loading...' : reasoning ? 'Refresh' : 'Generate'}
          </button>
        </div>

        {reasoning && !reasoning.unavailable ? (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">
                Strategic Rationale
              </p>
              <p className="text-sm text-slate-300 italic">&ldquo;{reasoning.rationale}&rdquo;</p>
            </div>

            {reasoning.impactExplanation && (
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Impact</p>
                <p className="text-xs text-slate-400">{reasoning.impactExplanation}</p>
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase">AI Confidence</span>
              <span className="text-xs text-white font-bold">
                {Math.round(reasoning.confidence * 100)}%
              </span>
              {reasoning.recommendedDecision && (
                <>
                  <span className="text-slate-600">·</span>
                  <span className="text-[10px] text-slate-500">Recommended:</span>
                  <span className="text-xs font-bold text-indigo-400">
                    {reasoning.recommendedDecision}
                  </span>
                </>
              )}
            </div>

            {reasoning.tradeoffs.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Trade-offs</p>
                <ul className="list-disc list-inside text-xs text-slate-400 flex flex-col gap-1">
                  {reasoning.tradeoffs.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            )}

            {reasoning.alternatives.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Alternatives Considered
                </p>
                <div className="flex flex-col gap-2">
                  {reasoning.alternatives.map((alt, i) => (
                    <div key={i} className="rounded-lg bg-slate-800/50 p-3">
                      <div className="flex justify-between items-center text-xs mb-1">
                        <span className="font-bold text-white">{alt.label}</span>
                        <span className="text-[10px] text-slate-500">
                          Effort: {alt.effort} · Impact: {alt.impact}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">{alt.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {reasoning.knowns.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Knowns</p>
                <ul className="list-disc list-inside text-xs text-slate-400 flex flex-col gap-1">
                  {reasoning.knowns.map((k, i) => (
                    <li key={i}>{k}</li>
                  ))}
                </ul>
              </div>
            )}

            {reasoning.inferences.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-indigo-400 uppercase mb-1">Inferences</p>
                <ul className="list-disc list-inside text-xs text-slate-400 flex flex-col gap-1">
                  {reasoning.inferences.map((inf, i) => (
                    <li key={i}>{inf}</li>
                  ))}
                </ul>
              </div>
            )}

            {reasoning.unknowns.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-amber-500 uppercase mb-1">Unknowns</p>
                <ul className="list-disc list-inside text-xs text-slate-400 flex flex-col gap-1">
                  {reasoning.unknowns.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : reasoning?.unavailable ? (
          <p className="text-xs text-slate-500">
            Reasoning unavailable: {reasoning.failureReason || 'provider error'}
          </p>
        ) : isReasoningLoading ? (
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 animate-spin rounded-full border border-slate-700 border-t-indigo-500" />
            <p className="text-xs text-slate-500">Generating reasoning...</p>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Click "Generate" to view AI reasoning</p>
        )}
      </div>

      {/* PM Decision (H8-ACTION-3: Recommendation Review) */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <h3 className="text-sm font-bold text-slate-300 mb-4">PM Decision</h3>
        <div className="flex flex-wrap gap-3">
          <DecisionButton
            label="Accept"
            color="emerald"
            disabled={decisionPending}
            onClick={() => handleDecision('ACCEPT')}
          />
          <DecisionButton
            label="Accept & Execute"
            color="indigo"
            disabled={decisionPending}
            onClick={() => handleDecision('ACCEPT_EXECUTE')}
          />
          <DecisionButton
            label="Reject"
            color="rose"
            disabled={decisionPending}
            onClick={() => handleDecision('REJECT')}
          />
          <DecisionButton
            label="Defer"
            color="amber"
            disabled={decisionPending}
            onClick={() => handleDecision('DEFER')}
          />
          <DecisionButton
            label="Override"
            color="purple"
            disabled={decisionPending}
            onClick={() => setShowOverride(!showOverride)}
          />
        </div>

        {showOverride && (
          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4 flex flex-col gap-3">
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
                placeholder={`APEX H6: ${rec.priorityScore?.toFixed(1) ?? '—'}`}
                className="flex-1 min-w-0 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
              <button
                onClick={handleOverride}
                disabled={!overridePriority || decisionPending}
                className="rounded-lg bg-purple-600 hover:bg-purple-500 px-4 py-2 text-xs font-bold text-white transition-colors disabled:opacity-50"
              >
                {decisionPending ? 'Recording...' : 'Record Override'}
              </button>
            </div>
            <p className="text-[10px] text-slate-500">
              The recorded delta is |H6 calibrated score − PM priority|, computed server-side.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">{title}</p>
      {children}
    </div>
  )
}

function DecisionButton({
  label,
  color,
  disabled,
  onClick,
}: {
  label: string
  color: 'emerald' | 'indigo' | 'rose' | 'amber' | 'purple'
  disabled: boolean
  onClick: () => void
}) {
  const colorClasses = {
    emerald: 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10',
    indigo: 'border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10',
    rose: 'border-rose-500/30 text-rose-400 hover:bg-rose-500/10',
    amber: 'border-amber-500/30 text-amber-400 hover:bg-amber-500/10',
    purple: 'border-purple-500/30 text-purple-400 hover:bg-purple-500/10',
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-4 py-2 text-xs font-bold transition-colors disabled:opacity-50 ${colorClasses[color]}`}
    >
      {label}
    </button>
  )
}
