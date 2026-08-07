import { useEffect, useState } from 'react'
import { RepositoryDiscoveryAgent, agentRegistry, createWorkspaceId } from '@apex/ai-core'
import type { Insight } from '@apex/ai-core'
import { MOCK_APEX_REPOSITORY } from '../../mock/repository'
import { cn } from '@apex/ui'

const SEVERITY_COLORS: Record<Insight['severity'], string> = {
  critical: 'text-rose-400 bg-rose-500/10 ring-rose-500/20',
  high: 'text-orange-400 bg-orange-500/10 ring-orange-500/20',
  medium: 'text-amber-400 bg-amber-500/10 ring-amber-500/20',
  low: 'text-sky-400 bg-sky-500/10 ring-sky-500/20',
  info: 'text-emerald-400 bg-emerald-500/10 ring-emerald-500/20',
}

export function DashboardPage() {
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)
  const [score, setScore] = useState<number | null>(null)

  useEffect(() => {
    // Register agent once
    if (!agentRegistry.has('repository-discovery')) {
      agentRegistry.register(new RepositoryDiscoveryAgent())
    }

    const run = async () => {
      const result = await agentRegistry.execute<
        { repositoryUrl: string; files: typeof MOCK_APEX_REPOSITORY },
        { insights: Insight[]; summary: { score: number } }
      >(
        'repository-discovery',
        {
          repositoryUrl: MOCK_APEX_REPOSITORY.url,
          files: MOCK_APEX_REPOSITORY,
        },
        {
          workspaceId: createWorkspaceId('mock-workspace-001'),
          correlationId: crypto.randomUUID(),
          startedAt: new Date(),
        }
      )

      if (result.success && result.data) {
        setInsights(result.data.insights)
        setScore(result.data.summary.score)
      }

      setLoading(false)
    }

    run()
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-indigo-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 p-8">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">APEX Dashboard</h1>
            <p className="mt-1 text-sm text-slate-400">
              Repository Discovery Agent · {insights.length} insights generated
            </p>
          </div>
          {score !== null && (
            <div className="flex flex-col items-center rounded-xl border border-slate-700/50 bg-slate-800/50 px-5 py-3">
              <span className="text-3xl font-bold text-white">{score}</span>
              <span className="text-xs text-slate-500">Readiness Score</span>
            </div>
          )}
        </div>

        {/* Insights */}
        <div className="flex flex-col gap-3">
          {insights.map((insight) => (
            <div
              key={insight.id}
              className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <p className="font-medium text-white">{insight.title}</p>
                  <p className="text-sm text-slate-400">{insight.description}</p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1',
                    SEVERITY_COLORS[insight.severity]
                  )}
                >
                  {insight.severity}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className="h-full rounded-full bg-indigo-600"
                    style={{ width: `${insight.confidence * 100}%` }}
                  />
                </div>
                <span className="text-xs text-slate-500">
                  {Math.round(insight.confidence * 100)}% confidence
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
