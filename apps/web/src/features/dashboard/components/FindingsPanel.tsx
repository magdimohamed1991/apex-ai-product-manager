import type { Finding } from '../types'

/**
 * Investigative Findings panel — renders REAL correlation-derived findings
 * served by `/api/projects/:id/findings`.
 *
 * The legacy implementation rendered recommendations and FABRICATED a
 * "Codebase Evidence" block (guessing file paths like `vitest.config.ts`
 * and printing "Detected Status: Unconfigured or disabled" from the title
 * alone). Neither the paths nor the status were backed by any data in the
 * recommendation record, so the block was removed entirely. Evidence IDs
 * shown here are the actual provenance links recorded by the pipeline.
 */
export function FindingsPanel({ findings }: { findings: Finding[] }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-bold text-white">Investigative Findings</h2>
        <p className="text-sm text-slate-400">
          Correlation-derived observations. Each finding carries traceable evidence provenance.
        </p>
      </div>
      {findings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-slate-500 text-sm">
          No findings currently recorded. Please trigger a repository analysis!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {findings.map((f) => {
            const isHigh = f.priority === 'critical' || f.priority === 'high'
            return (
              <div
                key={f.id}
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
                    {f.priority} Priority
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {f.severity} severity • {f.type}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="font-extrabold text-white text-md">{f.title}</h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed whitespace-pre-line">
                    {f.description}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-950/80 border border-slate-800/40 p-4 font-mono text-[11px] flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">
                    Evidence Provenance
                  </span>
                  <div className="text-slate-400">
                    {f.evidenceIds.length > 0 ? (
                      f.evidenceIds.map((id) => <div key={id}>➔ Evidence: {id}</div>)
                    ) : (
                      <div className="text-slate-500 italic">No evidence recorded.</div>
                    )}
                  </div>
                  <div className="text-slate-500">Correlation: {f.correlationId}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
