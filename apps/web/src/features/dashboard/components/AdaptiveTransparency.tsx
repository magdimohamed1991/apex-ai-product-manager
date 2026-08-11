import type { LearningProfile, LearningSignal, PriorityCalibration } from '../types'

interface AdaptiveTransparencyProps {
  profile: LearningProfile | null
  signals: LearningSignal[]
  calibration: PriorityCalibration | null
}

export function AdaptiveTransparency({ profile, signals, calibration }: AdaptiveTransparencyProps) {
  const evidenceState = getEvidenceState(signals)
  const hasProfile = profile !== null

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
        Adaptive Intelligence
      </h3>

      <div className="flex flex-col gap-3">
        <EvidenceIndicator state={evidenceState} signalCount={signals.length} />

        {hasProfile && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Profile</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Active
              </span>
            </div>

            {profile.totalDecisionsObserved > 0 && (
              <p className="text-[11px] text-slate-400">
                {profile.totalDecisionsObserved} decision
                {profile.totalDecisionsObserved !== 1 ? 's' : ''} observed
              </p>
            )}

            {profile.PMPreferences.favoredCategories.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Influencing recommendations
                </p>
                <div className="flex flex-wrap gap-1">
                  {profile.PMPreferences.favoredCategories.map((cat) => (
                    <span
                      key={cat}
                      className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    >
                      {cat}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {profile.PMPreferences.ignoredCategories.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Lower priority
                </p>
                <div className="flex flex-wrap gap-1">
                  {profile.PMPreferences.ignoredCategories.map((cat) => (
                    <span
                      key={cat}
                      className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    >
                      {cat}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {profile.categoryCoefficients.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Category behavior
                </p>
                <div className="flex flex-col gap-1">
                  {profile.categoryCoefficients.map((cc) => (
                    <div key={cc.category} className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-400 w-20">{cc.category}</span>
                      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full"
                          style={{ width: `${Math.min(cc.pmCalibrationWeight * 100, 100)}%` }}
                        />
                      </div>
                      <span className="text-slate-500 w-12 text-right">
                        {cc.pmCalibrationWeight.toFixed(2)}x
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {!hasProfile && (
          <p className="text-[11px] text-slate-500">
            Adaptive profile not yet compiled. Run analysis and make decisions to build learning
            data.
          </p>
        )}

        {calibration && (
          <div className="mt-2 pt-3 border-t border-slate-800">
            <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">
              Latest calibration
            </p>
            <p className="text-[11px] text-slate-400">{calibration.explanation}</p>
            {calibration.safetyFloorEnforced && (
              <p className="text-[10px] text-amber-400 mt-1">
                Safety floor was enforced on this recommendation
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function getEvidenceState(signals: LearningSignal[]): string {
  if (signals.length === 0) return 'no_data'
  const minObs = Math.min(...signals.map((s) => s.observationCount))
  if (minObs < 5) return 'early'
  if (minObs < 20) return 'limited'
  return 'established'
}

function EvidenceIndicator({ state, signalCount }: { state: string; signalCount: number }) {
  const config: Record<string, { label: string; description: string; color: string }> = {
    no_data: {
      label: 'No data',
      description: 'No learning signals yet',
      color: 'text-slate-400',
    },
    early: {
      label: 'Early evidence',
      description: `${signalCount} signal${signalCount !== 1 ? 's' : ''} with limited observations`,
      color: 'text-amber-400',
    },
    limited: {
      label: 'Limited evidence',
      description: `${signalCount} signals — patterns emerging but not yet established`,
      color: 'text-blue-400',
    },
    established: {
      label: 'Established pattern',
      description: `${signalCount} signals with sufficient observations`,
      color: 'text-emerald-400',
    },
  }
  const c = config[state] || config.no_data
  return (
    <div className="flex items-center gap-2">
      <span className={`text-[10px] font-bold uppercase ${c.color}`}>{c.label}</span>
      <span className="text-[10px] text-slate-500">— {c.description}</span>
    </div>
  )
}
