/**
 * UXIntelligencePanel (H10)
 *
 * Displays user journeys (with step completion rates), friction points
 * (sorted by severity), the usability score breakdown, and UX
 * recommendations. Pure display component — data arrives via props and
 * actions are delegated to page-provided callbacks.
 */
import { useState } from 'react'
import type { UserJourney, FrictionPoint, UXAnalysis, UXRecommendation } from '../types'

interface Props {
  journeys: UserJourney[]
  frictionPoints: FrictionPoint[]
  analysis: UXAnalysis | null
  recommendations: UXRecommendation[]
  onRunAnalysis: () => Promise<void>
  onAddJourney: (input: {
    name: string
    description: string
    completionRate?: number | null
  }) => Promise<void>
  onAddFrictionPoint: (input: {
    title: string
    description: string
    severity: 'critical' | 'high' | 'medium' | 'low'
    category: string
    suggestedFix?: string | null
  }) => Promise<void>
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const SEVERITY_STYLE: Record<string, string> = {
  critical: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  high: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  medium: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  low: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
}

export function UXIntelligencePanel({
  journeys,
  frictionPoints,
  analysis,
  recommendations,
  onRunAnalysis,
  onAddJourney,
  onAddFrictionPoint,
}: Props) {
  const [showJourneyForm, setShowJourneyForm] = useState(false)
  const [showFrictionForm, setShowFrictionForm] = useState(false)
  const [journeyName, setJourneyName] = useState('')
  const [journeyDescription, setJourneyDescription] = useState('')
  const [journeyCompletion, setJourneyCompletion] = useState('')
  const [frictionTitle, setFrictionTitle] = useState('')
  const [frictionDescription, setFrictionDescription] = useState('')
  const [frictionSeverity, setFrictionSeverity] = useState<'critical' | 'high' | 'medium' | 'low'>(
    'high'
  )
  const [frictionCategory, setFrictionCategory] = useState('form_design')
  const [frictionFix, setFrictionFix] = useState('')

  async function submitJourney() {
    if (!journeyName.trim() || !journeyDescription.trim()) return
    const completion =
      journeyCompletion.trim() === '' ? null : Math.max(0, Math.min(1, Number(journeyCompletion)))
    await onAddJourney({
      name: journeyName.trim(),
      description: journeyDescription.trim(),
      completionRate: completion,
    })
    setShowJourneyForm(false)
    setJourneyName('')
    setJourneyDescription('')
    setJourneyCompletion('')
  }

  async function submitFriction() {
    if (!frictionTitle.trim() || !frictionDescription.trim()) return
    await onAddFrictionPoint({
      title: frictionTitle.trim(),
      description: frictionDescription.trim(),
      severity: frictionSeverity,
      category: frictionCategory,
      suggestedFix: frictionFix.trim() || null,
    })
    setShowFrictionForm(false)
    setFrictionTitle('')
    setFrictionDescription('')
    setFrictionFix('')
  }

  const sortedFriction = [...frictionPoints].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
  )

  return (
    <div className="flex flex-col gap-8">
      <div className="flex justify-between items-start">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-2xl font-black text-white flex items-center gap-2">
            <span>🧭</span> UX Intelligence (H10)
          </h2>
          <p className="text-sm text-slate-400">
            User journeys, friction points, usability scoring, and task completion analysis.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowJourneyForm((v) => !v)}
            className="rounded-lg border border-slate-700 hover:bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 transition-colors"
          >
            ➕ Add Journey
          </button>
          <button
            onClick={() => setShowFrictionForm((v) => !v)}
            className="rounded-lg border border-slate-700 hover:bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 transition-colors"
          >
            ⚠️ Add Friction
          </button>
          <button
            onClick={onRunAnalysis}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-xs font-bold text-white transition-colors"
          >
            ▶ Run UX Analysis
          </button>
        </div>
      </div>

      {analysis?.status === 'failed' && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 px-4 py-3 text-xs">
          UX analysis failed: {analysis.error}
        </div>
      )}

      {showJourneyForm && (
        <div className="rounded-2xl border border-indigo-500/20 bg-indigo-950/10 p-5 flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={journeyName}
              onChange={(e) => setJourneyName(e.target.value)}
              placeholder="Journey name (e.g. Onboarding)"
              className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-600"
            />
            <input
              value={journeyCompletion}
              onChange={(e) => setJourneyCompletion(e.target.value)}
              placeholder="Completion rate 0–1 (optional)"
              type="number"
              min={0}
              max={1}
              step={0.05}
              className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-600"
            />
            <input
              value={journeyDescription}
              onChange={(e) => setJourneyDescription(e.target.value)}
              placeholder="Description"
              className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-600 md:col-span-2"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowJourneyForm(false)}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-400"
            >
              Cancel
            </button>
            <button
              onClick={submitJourney}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-bold text-white"
            >
              Save Journey
            </button>
          </div>
        </div>
      )}

      {showFrictionForm && (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-950/10 p-5 flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={frictionTitle}
              onChange={(e) => setFrictionTitle(e.target.value)}
              placeholder="Friction title"
              className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-600"
            />
            <select
              value={frictionSeverity}
              onChange={(e) => setFrictionSeverity(e.target.value as typeof frictionSeverity)}
              className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-white"
            >
              <option value="critical">critical</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
            <input
              value={frictionDescription}
              onChange={(e) => setFrictionDescription(e.target.value)}
              placeholder="Description"
              className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-600"
            />
            <select
              value={frictionCategory}
              onChange={(e) => setFrictionCategory(e.target.value)}
              className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-white"
            >
              <option value="form_design">form_design</option>
              <option value="navigation">navigation</option>
              <option value="content_clarity">content_clarity</option>
              <option value="performance">performance</option>
              <option value="accessibility">accessibility</option>
              <option value="feedback">feedback</option>
              <option value="other">other</option>
            </select>
            <input
              value={frictionFix}
              onChange={(e) => setFrictionFix(e.target.value)}
              placeholder="Suggested fix (optional)"
              className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-600 md:col-span-2"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowFrictionForm(false)}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-400"
            >
              Cancel
            </button>
            <button
              onClick={submitFriction}
              className="rounded-lg bg-rose-600 hover:bg-rose-500 px-4 py-2 text-xs font-bold text-white"
            >
              Save Friction
            </button>
          </div>
        </div>
      )}

      {analysis?.usabilityScore && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              Usability Score
            </span>
            <span className="text-2xl font-black text-white">
              {analysis.usabilityScore.overallScore.toFixed(1)}
              <span className="text-xs text-slate-500 font-bold">/10</span>
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {analysis.usabilityScore.dimensions.map((d) => (
              <div
                key={d.dimension}
                className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 flex flex-col gap-1"
              >
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    {d.dimension}
                  </span>
                  <span
                    className={`font-extrabold text-xs ${
                      d.score >= 7
                        ? 'text-emerald-400'
                        : d.score >= 4
                          ? 'text-amber-400'
                          : 'text-rose-400'
                    }`}
                  >
                    {d.score.toFixed(1)}
                  </span>
                </div>
                <p className="text-[10px] text-slate-600 leading-snug">{d.rationale}</p>
              </div>
            ))}
          </div>
          {analysis.usabilityScore.accessibilityIssues.length > 0 && (
            <div className="text-[11px] text-rose-400">
              ♿ {analysis.usabilityScore.accessibilityIssues.length} accessibility issue(s)
              detected
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-3">
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
          User Journeys ({journeys.length})
        </span>
        {journeys.length === 0 ? (
          <p className="text-xs text-slate-500">No journeys recorded yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {journeys.map((j) => (
              <div
                key={j.id}
                className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 flex flex-col gap-2"
              >
                <div className="flex justify-between items-start gap-2">
                  <span className="text-sm font-bold text-white">{j.name}</span>
                  {j.completionRate !== null && (
                    <span
                      className={`text-xs font-extrabold ${
                        j.completionRate >= 0.5 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {Math.round(j.completionRate * 100)}%
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">{j.description}</p>
                <div className="flex flex-col gap-1">
                  {j.steps.map((s) => (
                    <div
                      key={s.order}
                      className="flex justify-between items-center text-[10px] text-slate-500"
                    >
                      <span>
                        {s.order}. {s.name}
                      </span>
                      <span
                        className={
                          s.status === 'completed'
                            ? 'text-emerald-500'
                            : s.status === 'error' || s.status === 'abandoned'
                              ? 'text-rose-500'
                              : 'text-slate-600'
                        }
                      >
                        {s.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-3">
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
          Friction Points ({frictionPoints.length}) — sorted by severity
        </span>
        {sortedFriction.length === 0 ? (
          <p className="text-xs text-slate-500">No friction points recorded yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sortedFriction.map((fp) => (
              <div
                key={fp.id}
                className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5 flex flex-col gap-1.5"
              >
                <div className="flex justify-between items-start gap-2">
                  <span className="text-xs font-bold text-white">{fp.title}</span>
                  <span
                    className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase ${
                      SEVERITY_STYLE[fp.severity]
                    }`}
                  >
                    {fp.severity}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">{fp.description}</p>
                <div className="flex justify-between items-center text-[10px] text-slate-600 font-mono">
                  <span>{fp.category}</span>
                  {fp.suggestedFix && <span className="text-indigo-400">💡 {fp.suggestedFix}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-3">
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
          UX Recommendations ({recommendations.length})
        </span>
        {recommendations.length === 0 ? (
          <p className="text-xs text-slate-500">Run a UX analysis to generate recommendations.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {recommendations.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5 flex flex-col gap-1.5"
              >
                <div className="flex justify-between items-start gap-2">
                  <span className="text-xs font-bold text-white">{r.title}</span>
                  <span
                    className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase ${
                      SEVERITY_STYLE[r.priority]
                    }`}
                  >
                    {r.priority}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">{r.description}</p>
                <div className="text-[10px] text-slate-600 font-mono">
                  {r.type} • effort {r.effort}
                  {r.wcagCriteria.length > 0 && ` • ${r.wcagCriteria.join(', ')}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
