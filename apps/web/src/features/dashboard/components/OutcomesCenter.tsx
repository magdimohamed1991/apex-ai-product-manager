import type { Outcome, Recommendation } from '../types'

interface OutcomesCenterProps {
  outcomes: Outcome[]
  recommendations: Recommendation[]
  loading: boolean
}

export function OutcomesCenter({ outcomes, recommendations, loading }: OutcomesCenterProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 animate-pulse"
          >
            <div className="h-4 w-40 bg-slate-800 rounded mb-3" />
            <div className="h-3 w-64 bg-slate-800 rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (outcomes.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center">
        <p className="text-slate-500 text-sm">No outcomes yet</p>
        <p className="text-slate-600 text-xs mt-1">
          Outcomes are created when recommendations are approved and executed
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-300">Outcomes</h3>
        <div className="flex gap-3 text-[10px]">
          <span className="text-emerald-400">
            {outcomes.filter((o) => o.status === 'VERIFIED_SUCCESS').length} verified
          </span>
          <span className="text-amber-400">
            {outcomes.filter((o) => o.status === 'PENDING').length} pending
          </span>
          <span className="text-rose-400">
            {outcomes.filter((o) => o.status === 'FAILED').length} failed
          </span>
        </div>
      </div>

      {outcomes.map((outcome) => {
        const rec = recommendations.find((r) => r.id === outcome.recommendationId)
        return (
          <div key={outcome.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-sm font-bold text-white">
                  {rec?.title || outcome.recommendationId}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">{outcome.outcomeSummary}</p>
              </div>
              <OutcomeStatusBadge status={outcome.status} />
            </div>

            <div className="flex flex-col gap-1 mt-3">
              <p className="text-[10px] text-slate-500">
                Detected: {new Date(outcome.detectedAt).toLocaleString()}
              </p>
              {outcome.resolvedAt && (
                <p className="text-[10px] text-slate-500">
                  Resolved: {new Date(outcome.resolvedAt).toLocaleString()}
                </p>
              )}
              <p className="text-[10px] text-slate-500">
                Verification: {outcome.verificationStatus}
              </p>
              {outcome.verificationEvidence.length > 0 && (
                <div className="mt-1">
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Evidence</p>
                  {outcome.verificationEvidence.map((e, i) => (
                    <p key={i} className="text-[11px] text-slate-400">
                      • {e}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function OutcomeStatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; border: string; label: string }> = {
    VERIFIED_SUCCESS: {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-400',
      border: 'border-emerald-500/20',
      label: 'Verified',
    },
    PENDING: {
      bg: 'bg-amber-500/10',
      text: 'text-amber-400',
      border: 'border-amber-500/20',
      label: 'Pending',
    },
    FAILED: {
      bg: 'bg-rose-500/10',
      text: 'text-rose-400',
      border: 'border-rose-500/20',
      label: 'Failed',
    },
    NOT_VERIFIABLE: {
      bg: 'bg-slate-500/10',
      text: 'text-slate-400',
      border: 'border-slate-500/20',
      label: 'Not verifiable',
    },
    PARTIALLY_SUCCESSFUL: {
      bg: 'bg-amber-500/10',
      text: 'text-amber-400',
      border: 'border-amber-500/20',
      label: 'Partial',
    },
    REVERTED: {
      bg: 'bg-rose-500/10',
      text: 'text-rose-400',
      border: 'border-rose-500/20',
      label: 'Reverted',
    },
  }
  const c = config[status] || config.PENDING
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${c.bg} ${c.text} ${c.border}`}
    >
      {c.label}
    </span>
  )
}
