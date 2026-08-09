/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState } from 'react'
import type { Recommendation, Workspace, AIProductReasoning } from '../types'
import { ReasoningPanel } from './ReasoningPanel'

interface Props {
  workspace: Workspace | null
  recommendations: Recommendation[]
  selected: Recommendation | null
  onSelect: (r: Recommendation) => void
  onAction: (recId: string, paId: string) => Promise<void>
}

export function RecommendationsPanel({
  workspace,
  recommendations,
  selected,
  onSelect,
  onAction,
}: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
      <div className="lg:col-span-2 flex flex-col gap-4">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">
          Select Recommendation
        </span>
        <div className="flex flex-col gap-3 max-h-[580px] overflow-y-auto pr-2">
          {recommendations.map((rec) => {
            const isActive = selected?.id === rec.id
            return (
              <div
                key={rec.id}
                onClick={() => onSelect(rec)}
                className={`p-4 rounded-xl border transition-all text-left cursor-pointer flex flex-col gap-1.5 ${
                  isActive
                    ? 'bg-indigo-600/10 border-indigo-500 text-indigo-300 ring-1 ring-indigo-500/20'
                    : 'bg-slate-900/10 border-slate-800 text-slate-300 hover:bg-slate-900/30'
                }`}
              >
                <div className="flex justify-between items-center text-[10px]">
                  <span className="uppercase font-extrabold tracking-wider">{rec.priority}</span>
                  <span>{Math.round(rec.confidence * 100)}% match</span>
                </div>
                <h4 className="font-bold text-sm truncate text-white">{rec.title}</h4>
              </div>
            )
          })}
        </div>
      </div>

      <div className="lg:col-span-3">
        {selected ? (
          <RecommendationDetail
            workspace={workspace}
            recommendation={selected}
            onAction={onAction}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-slate-500 text-sm">
            Please select a recommendation from the left panel.
          </div>
        )}
      </div>
    </div>
  )
}

function RecommendationDetail({
  workspace,
  recommendation,
  onAction,
}: {
  workspace: Workspace | null
  recommendation: Recommendation
  onAction: (recId: string, paId: string) => Promise<void>
}) {
  const [reasoning, setReasoning] = useState<AIProductReasoning | null>(null)
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState('')
  const [activeRecId, setActiveRecId] = useState(recommendation.id)

  useEffect(() => {
    if (!workspace) {
      setReasoning(null)
      return
    }
    let active = true
    setLoading(true)
    setActiveRecId(recommendation.id)
    fetch(`/api/recommendations/${recommendation.id}/reasoning?workspaceId=${workspace.id}`)
      .then(async (r) => {
        if (!r.ok) return null
        return (await r.json()) as AIProductReasoning
      })
      .then((data) => {
        if (!active) return
        setReasoning(data)
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [workspace?.id, recommendation.id])

  async function submitContext(e: React.FormEvent) {
    e.preventDefault()
    if (!workspace || !answer.trim()) return
    setLoading(true)
    try {
      const r = await fetch(`/api/recommendations/${activeRecId}/reasoning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id, projectContext: answer }),
      })
      if (r.ok) {
        const data = (await r.json()) as AIProductReasoning
        setReasoning(data)
        setAnswer('')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/20 flex flex-col overflow-hidden">
      <div className="p-6 bg-slate-900/50 border-b border-slate-800 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-widest">
            {recommendation.pmCategory || 'TECHNICAL_DEBT'}
          </span>
          <span className="text-xs font-bold text-white">
            Priority Score: {(recommendation.priorityScore ?? 5.0).toFixed(1)}
          </span>
          <span className="text-[10px] text-slate-400">empirical (H3)</span>
        </div>
        <h3 className="text-xl font-black text-white">{recommendation.title}</h3>
        <p className="text-xs text-slate-400 leading-relaxed">{recommendation.rationale}</p>
      </div>

      <ReasoningPanel
        reasoning={reasoning}
        loading={loading}
        unavailable={!!reasoning?.unavailable}
      />

      {reasoning?.clarifyingQuestions && reasoning.clarifyingQuestions.length > 0 && (
        <form
          onSubmit={submitContext}
          className="p-6 flex flex-col gap-3 bg-slate-900/30 border-b border-slate-800"
        >
          <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block">
            ➔ AI PM Clarifying Question
          </span>
          <p className="text-xs text-slate-300 font-bold">
            &ldquo;{reasoning.clarifyingQuestions[0]}&rdquo;
          </p>
          <div className="flex gap-2 mt-1">
            <input
              type="text"
              placeholder="Answer clarifying question..."
              className="flex-1 min-w-0 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-bold text-white transition-colors"
            >
              Submit Context
            </button>
          </div>
        </form>
      )}

      <div className="p-6 flex flex-col gap-4">
        <span className="text-xs font-extrabold text-slate-400 uppercase tracking-widest block">
          Proposed Action
        </span>
        <div className="flex flex-col gap-3">
          {recommendation.proposedActions.map((pa) => (
            <div
              key={pa.id}
              className="rounded-xl border border-slate-800 bg-slate-950 p-4 flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1">
                <span className="font-bold text-sm text-white">{pa.title}</span>
                <p className="text-xs text-slate-400">{pa.description}</p>
              </div>
              <button
                onClick={() => onAction(recommendation.id, pa.id)}
                className="w-full rounded-lg py-3 text-xs font-bold text-white transition-colors flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-600/10"
              >
                Approve &amp; Execute
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
