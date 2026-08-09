import type { Recommendation, ActivityEvent, Outcome, DecisionMetrics } from '../types'
import { EpistemicBadge } from './MetricCard'

interface OverviewData {
  connection: { owner: string; repository: string } | null
  recommendations: Recommendation[]
  activityLog: ActivityEvent[]
  outcomes: Outcome[]
  decisionMetrics: DecisionMetrics | null
  runAnalysis: () => Promise<void>
  compileProfile: () => Promise<void>
}

interface Props {
  data: OverviewData
  onSelectRecommendation: (rec: Recommendation) => void
}

export function OverviewPanel({ data, onSelectRecommendation }: Props) {
  const criticalFindingsCount = data.recommendations.filter(
    (r) => r.priority === 'critical' || r.priority === 'high'
  ).length
  const inProgressExecs = data.activityLog.filter(
    (e) => e.type === 'execution' && /in-progress|queued/i.test(e.title)
  ).length
  const completedExecs = data.activityLog.filter(
    (e) => e.type === 'execution' && /completed/i.test(e.title)
  ).length

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-5 flex flex-col gap-2">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            Connected Repository
          </span>
          <span className="text-md font-bold text-white truncate">
            {data.connection ? `${data.connection.owner}/${data.connection.repository}` : '—'}
          </span>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-5 flex flex-col gap-2">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            Active Recommendations
          </span>
          <span className="text-2xl font-black text-amber-400">{data.recommendations.length}</span>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-5 flex flex-col gap-2">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            Urgent Findings
          </span>
          <span className="text-2xl font-black text-rose-500">{criticalFindingsCount}</span>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-5 flex flex-col gap-2">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            Completed Actions
          </span>
          <span className="text-2xl font-black text-emerald-400">{completedExecs}</span>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 to-slate-950 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h3 className="font-extrabold text-lg text-white">Repository Discovery & Analysis</h3>
          <p className="text-sm text-slate-400 max-w-2xl">
            APEX executes depth-1 cloning and scanning against test matrices, TypeScript strict
            parameters, CI rules, and Docker compilation parameters to build code evidence.
          </p>
        </div>
        <button
          onClick={() => data.runAnalysis()}
          className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-bold text-white hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-600/10 flex items-center gap-2"
        >
          🚀 Run Analysis
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <span>💡</span> Recommendations Feed
          </h3>
          {data.recommendations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-slate-500 text-sm">
              No active recommendations found. Trigger an analysis above!
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {data.recommendations.slice(0, 3).map((rec) => (
                <div
                  key={rec.id}
                  onClick={() => onSelectRecommendation(rec)}
                  className="rounded-xl border border-slate-800 bg-slate-900/10 p-5 hover:bg-slate-900/30 transition-all cursor-pointer flex justify-between items-start"
                >
                  <div className="flex flex-col gap-1.5 min-w-0 pr-4">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-indigo-400">
                      Priority: {rec.priority}
                    </span>
                    <h4 className="font-bold text-white text-sm truncate">{rec.title}</h4>
                    <p className="text-xs text-slate-400 line-clamp-2">{rec.rationale}</p>
                  </div>
                  <span className="text-xs font-bold text-indigo-400 flex items-center gap-1 shrink-0">
                    Review Center ➔
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <span>🎯</span> PM Decision Quality (H5)
          </h3>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/10 p-5 flex flex-col gap-3 text-xs">
            <Row
              label="Acceptance Rate"
              value={data.decisionMetrics?.acceptanceRate ?? null}
              unit="%"
            />
            <Row
              label="Outcome Success Rate"
              value={data.decisionMetrics?.successRate ?? null}
              unit="%"
            />
            <Row
              label="False Positive Rate"
              value={data.decisionMetrics?.falsePositiveRate ?? null}
              unit="%"
            />
            <Row label="Tracked Decisions" value={data.decisionMetrics?.totalOutcomes ?? null} />
            <div className="flex items-center justify-between text-slate-500 font-mono text-[10px] pt-1 border-t border-slate-800/40">
              <span>active executions: {inProgressExecs}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/10 p-6 flex flex-col gap-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <span>🔄</span> Closed-Loop Codebase Verification
          <EpistemicBadge state="observed" />
        </h3>
        <p className="text-xs text-slate-400">
          Outcomes verified against the codebase. The verification status reflects real repository
          state — observed outcomes are marked OBSERVED, simulated verifications are no longer
          displayed.
        </p>
        {data.outcomes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-slate-500 text-xs mt-2">
            No approved decisions under outcome tracking yet. Approve a recommendation to begin
            tracking.
          </div>
        ) : (
          <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto mt-2 pr-1">
            {data.outcomes.map((o) => {
              const badge = outcomeBadge(o.status)
              return (
                <div
                  key={o.id}
                  className="bg-slate-950/40 border border-slate-800 rounded-xl p-3.5 flex flex-col gap-2"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-slate-500 font-mono">
                        ID: {o.id.substring(0, 8)}…
                      </span>
                      <span className="font-bold text-white text-xs">{o.outcomeSummary}</span>
                    </div>
                    {badge}
                  </div>
                  <div className="text-[11px] text-slate-400 font-medium">
                    {o.verificationStatus}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, unit }: { label: string; value: number | null; unit?: string }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-slate-400 font-medium">{label}:</span>
      {/* null (metrics not tracked yet) renders as an em dash — never a
          fabricated 0% that could be read as a measured value. */}
      <span className="font-extrabold text-indigo-400 text-sm">
        {value === null || value === undefined ? '—' : `${value}${unit ?? ''}`}
      </span>
    </div>
  )
}

function outcomeBadge(status: string) {
  if (status === 'VERIFIED_SUCCESS')
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        VERIFIED SUCCESS ✓
      </span>
    )
  if (status === 'PENDING')
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse">
        PENDING SCAN
      </span>
    )
  if (status === 'FAILED')
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
        VERIFICATION FAILED ✗
      </span>
    )
  return (
    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
      {status}
    </span>
  )
}
