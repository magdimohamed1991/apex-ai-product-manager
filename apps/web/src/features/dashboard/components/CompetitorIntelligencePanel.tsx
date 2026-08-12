/**
 * CompetitorIntelligencePanel (H9)
 *
 * Displays competitor profiles, the feature matrix, the positioning matrix
 * (text-based summary), differentiation factors, market opportunities, and
 * competitor recommendations. Pure display component — all data arrives via
 * props; actions are delegated to callbacks provided by the page.
 */
import { useState } from 'react'
import type {
  Competitor,
  CompetitorAnalysis,
  FeatureMatrix,
  PositioningMatrix,
  DifferentiationAnalysis,
  MarketOpportunity,
  CompetitorRecommendation,
} from '../types'

interface Props {
  competitors: Competitor[]
  analysis: CompetitorAnalysis | null
  featureMatrix: FeatureMatrix | null
  positioningMatrix: PositioningMatrix | null
  differentiation: DifferentiationAnalysis | null
  opportunities: MarketOpportunity[]
  recommendations: CompetitorRecommendation[]
  onRunAnalysis: () => Promise<void>
  onAddCompetitor: (input: {
    name: string
    slug: string
    tier: 'direct' | 'indirect' | 'aspirational' | 'emerging'
    websiteUrl: string
    description?: string | null
  }) => Promise<void>
}

const PRIORITY_STYLE: Record<string, string> = {
  critical: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  high: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  medium: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  low: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
}

export function CompetitorIntelligencePanel({
  competitors,
  analysis,
  featureMatrix,
  positioningMatrix,
  differentiation,
  opportunities,
  recommendations,
  onRunAnalysis,
  onAddCompetitor,
}: Props) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [tier, setTier] = useState<'direct' | 'indirect' | 'aspirational' | 'emerging'>('direct')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [description, setDescription] = useState('')

  async function submitCompetitor() {
    if (!name.trim() || !slug.trim() || !websiteUrl.trim()) return
    await onAddCompetitor({
      name: name.trim(),
      slug: slug.trim(),
      tier,
      websiteUrl: websiteUrl.trim(),
      description: description.trim() || null,
    })
    setShowForm(false)
    setName('')
    setSlug('')
    setWebsiteUrl('')
    setDescription('')
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex justify-between items-start">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-2xl font-black text-white flex items-center gap-2">
            <span>🛰️</span> Competitor Intelligence (H9)
          </h2>
          <p className="text-sm text-slate-400">
            Feature matrix, positioning, differentiation, gaps, and market opportunities — all
            derived from registered competitor profiles.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg border border-slate-700 hover:bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 transition-colors"
          >
            ➕ Add Competitor
          </button>
          <button
            onClick={onRunAnalysis}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-xs font-bold text-white transition-colors"
          >
            ▶ Run Competitive Analysis
          </button>
        </div>
      </div>

      {analysis?.status === 'failed' && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 px-4 py-3 text-xs">
          Analysis failed: {analysis.error}
        </div>
      )}

      {showForm && (
        <div className="rounded-2xl border border-indigo-500/20 bg-indigo-950/10 p-5 flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Competitor name"
              className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-600"
            />
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="slug (e.g. acme-ai)"
              className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-600"
            />
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value as typeof tier)}
              className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-white"
            >
              <option value="direct">direct</option>
              <option value="indirect">indirect</option>
              <option value="aspirational">aspirational</option>
              <option value="emerging">emerging</option>
            </select>
            <input
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://competitor.example"
              className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-600"
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-600 md:col-span-2"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-400"
            >
              Cancel
            </button>
            <button
              onClick={submitCompetitor}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-bold text-white"
            >
              Save Competitor
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-3">
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
          Tracked Competitors ({competitors.length})
        </span>
        {competitors.length === 0 ? (
          <p className="text-xs text-slate-500">
            No competitors registered yet — add a competitor and run an analysis.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {competitors.map((c) => (
              <div
                key={c.id}
                className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 flex flex-col gap-2"
              >
                <div className="flex justify-between items-start gap-2">
                  <span className="font-bold text-white text-sm">{c.name}</span>
                  <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-bold uppercase">
                    {c.tier}
                  </span>
                </div>
                <a
                  href={c.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-indigo-400 truncate"
                >
                  {c.websiteUrl}
                </a>
                {c.description && (
                  <p className="text-[11px] text-slate-500 line-clamp-2">{c.description}</p>
                )}
                <div className="text-[10px] text-slate-600 font-mono">
                  {c.features.length} feature(s) • {c.strengthsWeaknesses.length} S/W record(s)
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {analysis && <FeatureMatrixCard featureMatrix={featureMatrix} competitors={competitors} />}

      {positioningMatrix && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              Positioning Matrix
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">
              YOUR SCORES = BASELINE ASSUMPTION
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {positioningMatrix.dimensions.map((dim) => (
              <div
                key={dim.name}
                className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 flex flex-col gap-1.5"
              >
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-white">{dim.name}</span>
                  <span className="text-xs font-extrabold text-indigo-400">
                    You: {dim.yourScore.toFixed(1)}/10
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(dim.competitorScores).map(([cid, score]) => {
                    const comp = competitors.find((c) => c.id === cid)
                    return (
                      <span
                        key={cid}
                        className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono"
                      >
                        {comp?.name ?? cid.slice(0, 6)}: {score.toFixed(1)}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {differentiation && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-3">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
            Differentiation Analysis
          </span>
          {differentiation.uniqueAdvantages.length > 0 && (
            <div className="text-xs text-emerald-400">
              ✅ Unique advantages: {differentiation.uniqueAdvantages.join(', ')}
            </div>
          )}
          {differentiation.uniqueDisadvantages.length > 0 && (
            <div className="text-xs text-rose-400">
              ⚠️ Unique disadvantages: {differentiation.uniqueDisadvantages.join(', ')}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {differentiation.factors.map((f) => (
              <div
                key={f.factor}
                className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-400 flex justify-between items-center"
              >
                <span>{f.factor}</span>
                <span
                  className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${
                    f.significance === 'high'
                      ? 'bg-amber-500/10 text-amber-400'
                      : f.significance === 'medium'
                        ? 'bg-sky-500/10 text-sky-400'
                        : 'bg-slate-700/40 text-slate-400'
                  }`}
                >
                  {f.significance}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-3">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
            Market Opportunities ({opportunities.length})
          </span>
          {opportunities.length === 0 ? (
            <p className="text-xs text-slate-500">No opportunities detected.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {opportunities.map((o) => (
                <div
                  key={o.id}
                  className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5 flex flex-col gap-1.5"
                >
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-xs font-bold text-white">{o.title}</span>
                    <span className="text-xs font-extrabold text-indigo-400">
                      {o.opportunityScore.toFixed(1)}/10
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">{o.description}</p>
                  <div className="text-[10px] text-slate-600 font-mono">
                    {o.addressableCompetitors.length} competitor(s) addressable
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-3">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
            Recommendations ({recommendations.length})
          </span>
          {recommendations.length === 0 ? (
            <p className="text-xs text-slate-500">No recommendations generated.</p>
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
                        PRIORITY_STYLE[r.priority]
                      }`}
                    >
                      {r.priority}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">{r.description}</p>
                  <div className="text-[10px] text-slate-600 font-mono">
                    {r.type} • score {r.opportunityScore.toFixed(1)} • effort {r.effort}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FeatureMatrixCard({
  featureMatrix,
  competitors,
}: {
  featureMatrix: FeatureMatrix | null
  competitors: Competitor[]
}) {
  if (!featureMatrix) return null
  const cellFor = (competitorId: string, feature: string) =>
    featureMatrix.cells.find((c) => c.competitorId === competitorId && c.featureId === feature)
      ?.value ?? 'no'

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-3 overflow-x-auto">
      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
        Feature Matrix ({featureMatrix.features.length} features)
      </span>
      <table className="text-xs w-full min-w-[480px]">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-800">
            <th className="py-2 pr-4 font-bold">Feature</th>
            {competitors.map((c) => (
              <th key={c.id} className="py-2 pr-4 font-bold whitespace-nowrap">
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {featureMatrix.features.map((feature) => (
            <tr key={feature} className="border-b border-slate-800/50">
              <td className="py-2 pr-4 text-slate-300 font-medium">{feature}</td>
              {competitors.map((c) => {
                const value = cellFor(c.id, feature)
                return (
                  <td key={c.id} className="py-2 pr-4">
                    <span
                      className={`font-bold ${
                        value === 'yes'
                          ? 'text-emerald-400'
                          : value === 'partial'
                            ? 'text-amber-400'
                            : 'text-slate-600'
                      }`}
                    >
                      {value === 'yes' ? '✓' : value === 'partial' ? '◐' : '✗'}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
