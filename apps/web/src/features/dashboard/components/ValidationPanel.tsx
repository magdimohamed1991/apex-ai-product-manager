import type { ProductValidationMetrics, LearningProfile, LearningSignal } from '../types'
import { MetricCard, EpistemicBadge } from './MetricCard'

interface Props {
  metrics: ProductValidationMetrics | null
  profile: LearningProfile | null
  signals: LearningSignal[]
  onCompileProfile: () => Promise<void>
}

const H7_BUCKET_LABEL: Record<string, string> = {
  awaiting_pm_telemetry: 'N < 5 — Awaiting PM Telemetry',
  early_convergence: '5 ≤ N < 20 — Early Convergence',
  high_within_apex_framework: 'N ≥ 20 — High within the APEX operational measurement framework',
}

export function ValidationPanel({ metrics, profile, signals, onCompileProfile }: Props) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex justify-between items-start">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-2xl font-black text-white flex items-center gap-2">
            <span>📈</span> Product Leverage &amp; Validation (H7)
          </h2>
          <p className="text-sm text-slate-400">
            Every metric below is tagged with an epistemic state so the UI cannot accidentally
            present a synthetic value as empirical.
          </p>
        </div>
        <button
          onClick={onCompileProfile}
          className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-xs font-bold text-white transition-colors"
        >
          🔄 Recompile Profile
        </button>
      </div>

      {metrics ? (
        <div className="flex flex-col gap-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                H7 Confidence Bucket
              </span>
              <EpistemicBadge
                state={
                  metrics.confidence.bucket === 'high_within_apex_framework'
                    ? 'validated'
                    : 'estimated'
                }
              />
            </div>
            <div className="text-xl font-extrabold text-white">
              {H7_BUCKET_LABEL[metrics.confidence.bucket]}
            </div>
            <p className="text-xs text-slate-400">{metrics.confidence.rationale}</p>
            <p className="text-[10px] text-slate-500 font-mono">
              total observations = {metrics.observationCount}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <MetricCard metric={metrics.decisionAcceptanceRate} />
            <MetricCard metric={metrics.outcomeSuccessRate} />
            <MetricCard metric={metrics.unverifiableRate} />
            <MetricCard metric={metrics.executionSuccessRate} />
            <MetricCard metric={metrics.measuredDecisionLatencySeconds} />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-6 flex flex-col gap-3">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <span>📐</span> Manual Baseline (Declared Assumption)
            </h3>
            <p className="text-xs text-slate-400">
              The 45-minute manual baseline is a declared assumption used for the comparative
              workflow study below. It is NOT an empirical measurement.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-2">
              <ManualBaseline />
              <APEXWorkflow metrics={metrics} />
            </div>
            <div className="text-[10px] text-slate-500 italic bg-slate-900/40 border border-slate-800/40 rounded-lg p-3 leading-relaxed">
              <strong>Formula Specification:</strong> Decision Leverage is calculated as:{' '}
              <code>
                Baseline PM Decision Cost (2700s) / (APEX Scan + Reasoning + Observed Decision
                Latency (s))
              </code>
              . The 'leverage' figure is shown only when empirical PM decision latency is available.
            </div>
          </div>

          {profile && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/10 p-4 flex flex-col gap-1 text-xs">
              <div className="flex justify-between items-center text-slate-400 font-bold">
                <span>Adaptive Profile Status:</span>
                <span className="text-emerald-400 font-bold">
                  ✓ Compiled from {profile.totalDecisionsObserved} Decisions
                </span>
              </div>
              <div className="text-[10px] text-slate-500 font-mono mt-1">
                Last calculated: {new Date(profile.lastCalculatedAt).toLocaleTimeString()} •
                calibration version: {profile.calibrationVersion ?? 'legacy'}
              </div>
              <div className="text-[11px] text-slate-400 mt-2">
                Favored:{' '}
                {profile.PMPreferences.favoredCategories.join(', ') || '— (insufficient data)'}
              </div>
              <div className="text-[11px] text-slate-400">
                Ignored:{' '}
                {profile.PMPreferences.ignoredCategories.join(', ') || '— (insufficient data)'}
              </div>
            </div>
          )}

          {signals.length > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <span>🧠</span> Calibration Signals (H6)
              </h3>
              <p className="text-xs text-slate-400 leading-normal">
                These signals are auditable per-tenant and only influence prioritization when their
                evidence state is 'observed' (above the minimum-observation threshold).
              </p>
              <div className="flex flex-col gap-3 max-h-[440px] overflow-y-auto pr-1">
                {signals.map((sig) => (
                  <div
                    key={sig.id}
                    className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 flex flex-col gap-1.5"
                  >
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-white uppercase tracking-wider text-[10px]">
                        {sig.category} - {sig.type}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-indigo-400 font-extrabold text-xs">
                          {(sig.value * 100).toFixed(0)}% rate
                        </span>
                        {sig.evidenceState && <EpistemicBadge state={sig.evidenceState} />}
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      n = {sig.observationCount} → confidence {(sig.confidence * 100).toFixed(0)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-800 p-12 text-center text-slate-500 text-sm mt-4">
          Product validation metrics are currently empty. Approve recommendations and run outcome
          verifications to begin tracking.
        </div>
      )}
    </div>
  )
}

function ManualBaseline() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/5 p-5 flex flex-col gap-3">
      <div className="flex justify-between items-center border-b border-slate-800/60 pb-2">
        <h4 className="font-extrabold text-xs text-slate-400 uppercase tracking-wider">
          Without APEX
        </h4>
        <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-bold">
          DECLARED
        </span>
      </div>
      <ul className="text-xs text-slate-400 flex flex-col gap-2">
        <li className="flex justify-between">
          <span>🔍 Manual Repository Investigation</span>
          <span className="text-slate-300 font-semibold">25 mins</span>
        </li>
        <li className="flex justify-between">
          <span>⚖️ Manual Rule Analysis &amp; Scoping</span>
          <span className="text-slate-300 font-semibold">12 mins</span>
        </li>
        <li className="flex justify-between">
          <span>✍️ Manual Ticket/Issue Drafting</span>
          <span className="text-slate-300 font-semibold">8 mins</span>
        </li>
        <li className="border-t border-slate-800/40 pt-2 flex justify-between font-bold text-slate-300">
          <span>Total Baseline Cost (Declared)</span>
          <span>2,700 seconds</span>
        </li>
      </ul>
    </div>
  )
}

function APEXWorkflow({ metrics }: { metrics: ProductValidationMetrics }) {
  const latency = metrics.measuredDecisionLatencySeconds.value
  const hasLatency = latency !== null && latency !== undefined
  const apexSeconds = 120 + (hasLatency ? Number(latency) : 0)
  const leverage = hasLatency ? 2700 / apexSeconds : null
  return (
    <div className="rounded-xl border border-indigo-500/10 bg-indigo-950/5 p-5 flex flex-col gap-3">
      <div className="flex justify-between items-center border-b border-indigo-500/20 pb-2">
        <h4 className="font-extrabold text-xs text-indigo-400 uppercase tracking-wider">
          With APEX
        </h4>
        <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded font-bold">
          {hasLatency ? `${(apexSeconds / 60).toFixed(1)} min` : '2.0 min ESTIMATED'}
        </span>
      </div>
      <ul className="text-xs text-slate-400 flex flex-col gap-2">
        <li className="flex justify-between">
          <span>🚀 APEX Discovery scan (assumed)</span>
          <span className="text-slate-300 font-semibold">1.5 mins (90s)</span>
        </li>
        <li className="flex justify-between">
          <span>🧠 AI Prioritization &amp; Reasoning (assumed)</span>
          <span className="text-slate-300 font-semibold">0.5 mins (30s)</span>
        </li>
        <li className="flex justify-between">
          <span>⏱️ Measured PM Decision Latency</span>
          <span className="text-indigo-400 font-bold">
            {hasLatency ? `${Number(latency).toFixed(1)}s` : '— (awaiting PM telemetry)'}
          </span>
        </li>
        <li className="border-t border-indigo-500/10 pt-2 flex justify-between font-bold text-indigo-300">
          <span>Total APEX-Assisted Cost</span>
          <span>{hasLatency ? `${apexSeconds.toFixed(1)} seconds` : '— (awaiting telemetry)'}</span>
        </li>
      </ul>
      {leverage !== null ? (
        <div className="mt-2 text-center text-2xl font-black text-indigo-300">
          {leverage.toFixed(2)}×
          <div className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">
            Measured Decision Leverage
          </div>
        </div>
      ) : (
        <div className="mt-2 text-center text-xs text-slate-500 italic">
          Decision leverage will be shown once the PMDecisionTelemetry stream records decisions.
        </div>
      )}
    </div>
  )
}
