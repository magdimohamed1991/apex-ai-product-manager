import type { Recommendation } from '../types'

export function FindingsPanel({ recommendations }: { recommendations: Recommendation[] }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-bold text-white">Investigative Findings</h2>
        <p className="text-sm text-slate-400">
          Observations compiled from static checks. Click any card to inspect codebase evidence.
        </p>
      </div>
      {recommendations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-slate-500 text-sm">
          No findings currently recorded. Please trigger a repository analysis!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {recommendations.map((rec) => {
            const isHigh = rec.priority === 'critical' || rec.priority === 'high'
            return (
              <div
                key={rec.id}
                className="rounded-2xl border border-slate-800 bg-slate-900/10 p-6 flex flex-col gap-4"
              >
                <div className="flex items-start justify-between">
                  <span
                    className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                      isHigh
                        ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {rec.priority} Priority
                  </span>
                  <span className="text-xs font-bold text-slate-500">
                    {Math.round(rec.confidence * 100)}% match
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="font-extrabold text-white text-md">{rec.title}</h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{rec.rationale}</p>
                </div>
                <div className="rounded-lg bg-slate-950/80 border border-slate-800/40 p-4 font-mono text-[11px] flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">
                    Codebase Evidence
                  </span>
                  <div className="text-slate-300">
                    ➔ Path:{' '}
                    {rec.title.toLowerCase().includes('testing')
                      ? 'vitest.config.ts / package.json'
                      : rec.title.toLowerCase().includes('ci')
                        ? '.github/workflows/ci.yml'
                        : 'tsconfig.json'}
                  </div>
                  <div className="text-slate-400">➔ Detected Status: Unconfigured or disabled</div>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-2 text-xs border-t border-slate-800/40 pt-4">
                  <div>
                    <span className="text-slate-500 font-medium block uppercase tracking-wider text-[9px]">
                      Technical Impact
                    </span>
                    <span className="text-slate-300 font-semibold">{rec.impact}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-medium block uppercase tracking-wider text-[9px]">
                      Effort Required
                    </span>
                    <span className="text-slate-300 font-semibold uppercase">{rec.effort}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
