import type { TrackedMetric, EpistemicState } from '../types'

const epistemicLabels: Record<
  EpistemicState,
  { label: string; color: string; description: string }
> = {
  unavailable: {
    label: 'UNAVAILABLE',
    color: 'bg-slate-700 text-slate-300 border-slate-600',
    description: 'No real observation data exists yet. The metric is honest about its absence.',
  },
  estimated: {
    label: 'ESTIMATED',
    color: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    description: 'Derived from declared assumptions (e.g. 45-minute manual baseline).',
  },
  observed: {
    label: 'OBSERVED',
    color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    description: 'Derived from real PM decisions / execution outcomes.',
  },
  derived: {
    label: 'DERIVED',
    color: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    description: 'Computed from other observed metrics. The math is auditable.',
  },
  validated: {
    label: 'VALIDATED',
    color: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
    description: 'Sufficient data and consistent cross-checks. H7 N >= 20.',
  },
  insufficient_evidence: {
    label: 'INSUFFICIENT EVIDENCE',
    color: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    description: 'Below the minimum-observation threshold. H6 must not influence the calibrator.',
  },
}

export function EpistemicBadge({ state }: { state: EpistemicState }) {
  const meta = epistemicLabels[state]
  return (
    <span
      title={meta.description}
      className={`text-[10px] font-extrabold px-2 py-0.5 rounded border uppercase tracking-wider ${meta.color}`}
    >
      {meta.label}
    </span>
  )
}

export function MetricCard({ metric }: { metric: TrackedMetric }) {
  const value = metric.value
  const valueDisplay =
    value === null || value === undefined
      ? '—'
      : typeof value === 'number'
        ? Number.isInteger(value)
          ? value.toString()
          : value.toFixed(2)
        : String(value)

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/10 p-5 flex flex-col gap-2">
      <div className="flex justify-between items-start">
        <span className="text-[10px] text-slate-500 font-black uppercase tracking-wider">
          {metric.name}
        </span>
        <EpistemicBadge state={metric.epistemicState} />
      </div>
      <span className="text-2xl font-extrabold text-white">{valueDisplay}</span>
      <p className="text-xs text-slate-400 leading-normal">{metric.description}</p>
      <div className="text-[10px] text-slate-500 font-mono">
        n = {metric.observationCount} • {metric.calculation}
      </div>
    </div>
  )
}
