import type { AIProductReasoning } from '../types'
import { EpistemicBadge } from './MetricCard'

export function ReasoningPanel({
  reasoning,
  loading,
  unavailable,
}: {
  reasoning: AIProductReasoning | null
  loading: boolean
  unavailable: boolean
}) {
  if (loading) {
    return (
      <div className="p-12 flex flex-col items-center justify-center gap-2 border-b border-slate-800">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-indigo-500" />
        <span className="text-xs text-slate-500 font-medium">AI PM is reasoning...</span>
      </div>
    )
  }

  if (!reasoning) {
    return (
      <div className="p-6 text-center text-xs text-slate-500 border-b border-slate-800">
        Reasoning not yet generated.
      </div>
    )
  }

  if (unavailable || reasoning.unavailable) {
    return (
      <div className="p-6 border-b border-slate-800 bg-slate-900/30 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">
            Reasoning Unavailable
          </span>
          <span className="text-[10px] font-mono text-slate-500">
            {reasoning.failureReason ?? 'unknown'}
          </span>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          The reasoning engine was unable to produce a verified, grounded response. The H3 evidence
          still applies. PMs must rely on the deterministic priority score and known facts until
          reasoning is restored.
        </p>
        <p className="text-[11px] text-slate-500 italic">
          No facts were fabricated to fill this section.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col border-b border-slate-800 bg-indigo-950/5">
      <div className="p-6 border-b border-slate-800/60 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block">
            AI PM Strategic Rationale
          </span>
          <EpistemicBadge state="observed" />
        </div>
        <p className="text-sm text-slate-300 leading-relaxed italic">
          &ldquo;{reasoning.rationale}&rdquo;
        </p>
      </div>

      <div className="p-6 border-b border-slate-800/60 flex flex-col gap-3">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
          Product Trade-offs
        </span>
        <ul className="list-disc list-inside text-xs text-slate-300 flex flex-col gap-1.5 font-medium">
          {reasoning.tradeoffs.map((t, idx) => (
            <li key={idx} className="leading-relaxed">
              {t}
            </li>
          ))}
        </ul>
      </div>

      <div className="p-6 border-b border-slate-800/60 flex flex-col gap-3.5">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
          Scoping Alternatives
        </span>
        <div className="flex flex-col gap-3">
          {reasoning.alternatives.map((alt, idx) => (
            <div
              key={idx}
              className="bg-slate-950/40 border border-slate-800 rounded-xl p-3.5 flex flex-col gap-1.5 font-medium"
            >
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-white">{alt.label}</span>
                <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-400">
                  Effort: {alt.effort}
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{alt.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="p-6 border-b border-slate-800/60 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-semibold">
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">
            Known Facts
          </span>
          {reasoning.knowns.length === 0 ? (
            <div className="text-slate-500 italic">No grounded facts available.</div>
          ) : (
            <div className="text-slate-300 flex flex-col gap-1">
              {reasoning.knowns.map((k, idx) => (
                <div key={idx}>• {k}</div>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block">
            Inferences
          </span>
          <div className="text-slate-300 flex flex-col gap-1">
            {reasoning.inferences.map((inf, idx) => (
              <div key={idx}>• {inf}</div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest block">
            Gaps & Unknowns
          </span>
          <div className="text-slate-300 flex flex-col gap-1">
            {reasoning.unknowns.map((u, idx) => (
              <div key={idx}>• {u}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
