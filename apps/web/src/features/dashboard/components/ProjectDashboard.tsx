import type { ProjectStats } from '../types'

interface ProjectDashboardProps {
  stats: ProjectStats | null
  loading: boolean
  error: string | null
}

export function ProjectDashboard({ stats, loading, error }: ProjectDashboardProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 animate-pulse"
          >
            <div className="h-3 w-20 bg-slate-800 rounded mb-2" />
            <div className="h-7 w-12 bg-slate-800 rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 px-4 py-3 text-xs">
        {error}
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center">
        <p className="text-slate-500 text-sm">No project data available</p>
      </div>
    )
  }

  const evidenceLabel: Record<string, string> = {
    no_data: 'No data',
    early: 'Early evidence',
    limited: 'Limited evidence',
    established: 'Established pattern',
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Recommendations"
          value={stats.recommendations.total}
          detail={`${stats.recommendations.byPriority.critical} critical, ${stats.recommendations.byPriority.high} high`}
          color="indigo"
        />
        <StatCard
          label="Outcomes Verified"
          value={stats.outcomes.verified}
          detail={`${stats.outcomes.pending} pending verification`}
          color="emerald"
        />
        <StatCard
          label="Outcomes Failed"
          value={stats.outcomes.failed}
          detail={
            stats.outcomes.total > 0
              ? `${Math.round((stats.outcomes.failed / stats.outcomes.total) * 100)}% failure rate`
              : 'No outcomes'
          }
          color="rose"
        />
        <StatCard
          label="Decisions Observed"
          value={stats.learning.totalDecisionsObserved}
          detail={evidenceLabel[stats.learning.evidenceState] || stats.learning.evidenceState}
          color="amber"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
            Analysis Status
          </h3>
          {stats.project.latestAnalysis ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                    stats.project.latestAnalysis.status === 'completed'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : stats.project.latestAnalysis.status === 'failed'
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}
                >
                  {stats.project.latestAnalysis.status}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Started: {new Date(stats.project.latestAnalysis.startedAt).toLocaleString()}
              </p>
              {stats.project.latestAnalysis.completedAt && (
                <p className="text-[11px] text-slate-500">
                  Completed: {new Date(stats.project.latestAnalysis.completedAt).toLocaleString()}
                </p>
              )}
              {stats.project.latestAnalysis.error && (
                <p className="text-[11px] text-rose-400">{stats.project.latestAnalysis.error}</p>
              )}
            </div>
          ) : (
            <p className="text-slate-500 text-xs">No analysis run yet</p>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
            Adaptive Intelligence
          </h3>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  stats.learning.profileStatus === 'active'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                }`}
              >
                {stats.learning.profileStatus === 'active' ? 'Profile active' : 'Not compiled'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              {stats.learning.signalCount} learning signals
            </p>
            {stats.learning.favoredCategories.length > 0 && (
              <p className="text-[11px] text-emerald-400">
                Favored: {stats.learning.favoredCategories.join(', ')}
              </p>
            )}
            {stats.learning.ignoredCategories.length > 0 && (
              <p className="text-[11px] text-amber-400">
                Ignored: {stats.learning.ignoredCategories.join(', ')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  detail,
  color,
}: {
  label: string
  value: number
  detail: string
  color: 'indigo' | 'emerald' | 'rose' | 'amber'
}) {
  const colorClasses = {
    indigo: 'text-indigo-400 border-indigo-500/20',
    emerald: 'text-emerald-400 border-emerald-500/20',
    rose: 'text-rose-400 border-rose-500/20',
    amber: 'text-amber-400 border-amber-500/20',
  }

  return (
    <div className={`rounded-xl border ${colorClasses[color]} bg-slate-900/50 p-4`}>
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-extrabold mt-1 ${colorClasses[color].split(' ')[0]}`}>{value}</p>
      <p className="text-[11px] text-slate-500 mt-1">{detail}</p>
    </div>
  )
}
