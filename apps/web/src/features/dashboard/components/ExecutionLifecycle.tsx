import type { Action, ActivityEvent, Outcome, Recommendation } from '../types'

interface ExecutionLifecycleProps {
  actions: Action[]
  activityLog: ActivityEvent[]
  outcomes: Outcome[]
  recommendations: Recommendation[]
  loading: boolean
}

export function ExecutionLifecycle({
  actions,
  activityLog,
  outcomes,
  recommendations,
  loading,
}: ExecutionLifecycleProps) {
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

  if (actions.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center">
        <p className="text-slate-500 text-sm">No executions yet</p>
        <p className="text-slate-600 text-xs mt-1">Approve a recommendation to start execution</p>
      </div>
    )
  }

  const statusOrder = [
    'in-progress',
    'queued',
    'approved',
    'proposed',
    'completed',
    'failed',
  ] as const
  const sorted = [...actions].sort((a, b) => {
    const ai = statusOrder.indexOf(a.status as (typeof statusOrder)[number])
    const bi = statusOrder.indexOf(b.status as (typeof statusOrder)[number])
    return ai - bi
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-300">Execution Lifecycle</h3>
        <div className="flex gap-3 text-[10px]">
          <span className="text-emerald-400">
            {actions.filter((a) => a.status === 'completed').length} succeeded
          </span>
          <span className="text-amber-400">
            {actions.filter((a) => ['in-progress', 'queued'].includes(a.status)).length} running
          </span>
          <span className="text-rose-400">
            {actions.filter((a) => a.status === 'failed').length} failed
          </span>
        </div>
      </div>

      {sorted.map((action) => {
        const outcome = outcomes.find((o) => o.actionId === action.id)
        const executionEvents = activityLog.filter(
          (e) => e.type === 'execution' && e.metadata?.actionId === action.id
        )
        const recommendation = recommendations.find((r) => r.id === action.relatedRecommendationId)

        return (
          <div key={action.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <p className="text-sm font-bold text-white">{action.title}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{action.description}</p>
                {action.target && (
                  <p className="text-[10px] text-slate-600 mt-1">Target: {action.target}</p>
                )}
              </div>
              <ActionStatusBadge status={action.status} />
            </div>

            {/* Lifecycle visualization */}
            <div className="flex items-center gap-1 mb-3">
              {['proposed', 'approved', 'queued', 'in-progress', 'completed'].map((step, i) => {
                const isActive = getStepIndex(action.status) >= i
                const isCurrent = getStepIndex(action.status) === i
                const isFailed = action.status === 'failed' && step === 'completed'
                return (
                  <div key={step} className="flex items-center">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        isFailed
                          ? 'bg-rose-500 ring-2 ring-rose-500/30'
                          : isCurrent
                            ? 'bg-indigo-500 ring-2 ring-indigo-500/30'
                            : isActive
                              ? 'bg-emerald-500'
                              : 'bg-slate-700'
                      }`}
                    />
                    {i < 4 && (
                      <div
                        className={`w-6 h-0.5 ${
                          getStepIndex(action.status) > i ? 'bg-emerald-500' : 'bg-slate-700'
                        }`}
                      />
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex flex-col gap-1.5 text-[11px]">
              {action.externalId && (
                <p className="text-slate-500">External ID: {action.externalId}</p>
              )}
              {recommendation && (
                <p className="text-slate-500">
                  Recommendation: <span className="text-slate-400">{recommendation.title}</span>
                </p>
              )}
              {outcome && (
                <div className="mt-1 rounded-lg bg-slate-800/50 p-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">Outcome</span>
                    <OutcomeStatusInline status={outcome.status} />
                  </div>
                  {outcome.outcomeSummary && (
                    <p className="text-[11px] text-slate-400">{outcome.outcomeSummary}</p>
                  )}
                  <div className="flex gap-3 mt-1 text-[10px] text-slate-600">
                    <span>Detected: {new Date(outcome.detectedAt).toLocaleDateString()}</span>
                    {outcome.resolvedAt && (
                      <span>Resolved: {new Date(outcome.resolvedAt).toLocaleDateString()}</span>
                    )}
                  </div>
                  {outcome.verificationEvidence.length > 0 && (
                    <p className="text-[10px] text-slate-600 mt-1">
                      {outcome.verificationEvidence.length} verification evidence
                      {outcome.verificationEvidence.length !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              )}
              {executionEvents.length > 0 && (
                <p className="text-slate-500">
                  {executionEvents.length} execution event{executionEvents.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function getStepIndex(status: string): number {
  const map: Record<string, number> = {
    proposed: 0,
    approved: 1,
    queued: 2,
    'in-progress': 3,
    completed: 4,
    failed: 3,
  }
  return map[status] ?? 0
}

function ActionStatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; border: string; label: string }> = {
    proposed: {
      bg: 'bg-slate-500/10',
      text: 'text-slate-400',
      border: 'border-slate-500/20',
      label: 'Proposed',
    },
    approved: {
      bg: 'bg-blue-500/10',
      text: 'text-blue-400',
      border: 'border-blue-500/20',
      label: 'Approved',
    },
    queued: {
      bg: 'bg-amber-500/10',
      text: 'text-amber-400',
      border: 'border-amber-500/20',
      label: 'Queued',
    },
    'in-progress': {
      bg: 'bg-indigo-500/10',
      text: 'text-indigo-400',
      border: 'border-indigo-500/20',
      label: 'Executing',
    },
    completed: {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-400',
      border: 'border-emerald-500/20',
      label: 'Completed',
    },
    failed: {
      bg: 'bg-rose-500/10',
      text: 'text-rose-400',
      border: 'border-rose-500/20',
      label: 'Failed',
    },
  }
  const c = config[status] || config.proposed
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${c.bg} ${c.text} ${c.border}`}
    >
      {c.label}
    </span>
  )
}

function OutcomeStatusInline({ status }: { status: string }) {
  const labels: Record<string, string> = {
    VERIFIED_SUCCESS: 'Verified success',
    PENDING: 'Outcome not yet verified',
    FAILED: 'Outcome verification failed',
    NOT_VERIFIABLE: 'Not verifiable',
    PARTIALLY_SUCCESSFUL: 'Partially successful',
    REVERTED: 'Reverted',
  }
  return <span className="text-slate-400">{labels[status] || status}</span>
}
