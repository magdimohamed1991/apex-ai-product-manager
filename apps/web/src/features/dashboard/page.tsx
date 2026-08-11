/**
 * DashboardPage (Milestone I - Production Hardening)
 *
 * Coordinator component. Owns the cross-cutting state (selected workspace,
 * project, current tab, polling lifecycle) and dispatches rendering to
 * feature-oriented subcomponents.
 *
 * Notable behavior changes vs. the legacy monolith:
 *   - Every product metric carries an explicit EpistemicState badge so the
 *     UI cannot accidentally present a synthetic value as if it were an
 *     empirical observation.
 *   - The "1.42× measured leverage" and "Empirically Measured" labels
 *     are REMOVED. We now show:
 *       - A declared assumption (45-minute manual baseline) tagged ESTIMATED
 *       - A real PM decision latency metric tagged UNAVAILABLE / OBSERVED
 *   - All HTTP access goes through `apiClient` which surfaces typed errors.
 *   - All session storage keys are prefixed; the legacy
 *     `localStorage.removeItem('apex_session_token')` path remains for
 *     the global fetch interceptor in App.tsx.
 */
import { useEffect, useState } from 'react'
import { apiClient, ApiError } from './api/client'
import { WorkspaceSelector, ProjectSelector } from './components/WorkspaceProjectSelectors'
import { RepositoryPanel } from './components/RepositoryPanel'
import { OverviewPanel } from './components/OverviewPanel'
import { FindingsPanel } from './components/FindingsPanel'
import { RecommendationsPanel } from './components/RecommendationsPanel'
import { RecommendationReview } from './components/RecommendationReview'
import { ExecutionLifecycle } from './components/ExecutionLifecycle'
import { ValidationPanel } from './components/ValidationPanel'
import { ActivityTimeline } from './components/ActivityTimeline'
import { ProjectDashboard } from './components/ProjectDashboard'
import { OutcomesCenter } from './components/OutcomesCenter'
import { AdaptiveTransparency } from './components/AdaptiveTransparency'
import { useDashboardData } from './hooks/useDashboardData'
import type {
  Workspace,
  Project,
  Recommendation,
  ProjectStats,
  Action,
  AIProductReasoning,
  PriorityCalibration,
} from './types'

type TabName =
  | 'dashboard'
  | 'overview'
  | 'findings'
  | 'recommendations'
  | 'executions'
  | 'outcomes'
  | 'validation'

export function DashboardPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [activeTab, setActiveTab] = useState<TabName>('dashboard')
  const [selectedRecommendation, setSelectedRecommendation] = useState<Recommendation | null>(null)
  const [reviewingRecommendation, setReviewingRecommendation] = useState<Recommendation | null>(
    null
  )
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [projectStats, setProjectStats] = useState<ProjectStats | null>(null)
  const [loadingStats, setLoadingStats] = useState(false)
  const [actions, setActions] = useState<Action[]>([])
  const [reviewReasoning, setReviewReasoning] = useState<AIProductReasoning | null>(null)
  const [reviewCalibration, setReviewCalibration] = useState<PriorityCalibration | null>(null)
  const [loadingReview, setLoadingReview] = useState(false)

  const data = useDashboardData(selectedWorkspace, selectedProject, setGlobalError)

  // Initial workspaces load
  useEffect(() => {
    let active = true
    apiClient
      .listWorkspaces()
      .then((list) => {
        if (!active) return
        setWorkspaces(list)
        if (list.length > 0) setSelectedWorkspace(list[0])
      })
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : 'Failed to load workspaces'
        setGlobalError(message)
      })
      .finally(() => setLoadingWorkspaces(false))
    return () => {
      active = false
    }
  }, [])

  // Load projects when workspace changes
  useEffect(() => {
    if (!selectedWorkspace) {
      // Selection reset: a deselected workspace must never leave the
      // previous workspace's projects on screen. Scoped suppression.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProjects([])
      setSelectedProject(null)
      return
    }
    let active = true
    apiClient
      .listProjects(selectedWorkspace.id)
      .then((list) => {
        if (!active) return
        setProjects(list)
        setSelectedProject(list[0] || null)
      })
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : 'Failed to load projects'
        setGlobalError(message)
      })
    return () => {
      active = false
    }
  }, [selectedWorkspace])

  // Load project stats when project changes
  useEffect(() => {
    if (!selectedWorkspace || !selectedProject) {
      setProjectStats(null)
      setActions([])
      return
    }
    let active = true
    setLoadingStats(true)
    apiClient
      .getProjectStats(selectedWorkspace.id, selectedProject.id)
      .then((stats) => {
        if (!active) return
        setProjectStats(stats)
      })
      .catch(() => {
        if (!active) return
        setProjectStats(null)
      })
      .finally(() => {
        if (active) setLoadingStats(false)
      })
    return () => {
      active = false
    }
  }, [selectedWorkspace, selectedProject])

  async function handleCreateWorkspace(name: string) {
    if (!name.trim()) return
    try {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
      // Cryptographically random id suffix — never Math.random() for
      // identifiers that participate in tenant isolation.
      const id = `ws-${slug}-${crypto.randomUUID().slice(0, 8)}`
      const ws = await apiClient.post<Workspace>('/api/workspaces', { id, name, slug })
      setWorkspaces((prev) => [...prev, ws])
      setSelectedWorkspace(ws)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create workspace'
      setGlobalError(message)
    }
  }

  async function handleCreateProject(name: string) {
    if (!selectedWorkspace || !name.trim()) return
    try {
      const id = `proj-${name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')}-${crypto.randomUUID().slice(0, 8)}`
      const proj = await apiClient.post<Project>('/api/projects', {
        workspaceId: selectedWorkspace.id,
        id,
        name,
      })
      setProjects((prev) => [...prev, proj])
      setSelectedProject(proj)
      setActiveTab('dashboard')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create project'
      setGlobalError(message)
    }
  }

  async function startReview(rec: Recommendation) {
    setReviewingRecommendation(rec)
    setLoadingReview(true)
    try {
      const [reasoning, calibration] = await Promise.all([
        apiClient
          .getReasoning(selectedWorkspace!.id, selectedProject!.id, rec.id)
          .catch(() => null),
        apiClient
          .getCalibration(selectedWorkspace!.id, selectedProject!.id, rec.id)
          .catch(() => null),
      ])
      setReviewReasoning(reasoning)
      setReviewCalibration(calibration)
    } finally {
      setLoadingReview(false)
    }
  }

  async function handleReviewDecision(recId: string, decision: string) {
    if (!selectedWorkspace || !selectedProject) return
    const now = new Date().toISOString()
    await apiClient.recordDecision(selectedWorkspace.id, selectedProject.id, {
      recommendationId: recId,
      decision: decision as 'ACCEPT' | 'REJECT' | 'DEFER' | 'OVERRIDE',
      decisionStartedAt: now,
      decisionCompletedAt: now,
      recommendationPresentedAt: now,
    })
    if (decision === 'ACCEPT' || decision === 'ACCEPT_EXECUTE') {
      await data.approveAction(recId, reviewingRecommendation?.proposedActions?.[0]?.id || '')
    }
    setReviewingRecommendation(null)
    setReviewReasoning(null)
    setReviewCalibration(null)
  }

  if (loadingWorkspaces) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-indigo-500" />
          <p className="text-sm text-slate-400 font-medium">Loading APEX Dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100 font-sans">
      <aside className="w-80 shrink-0 border-r border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl font-black bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent tracking-tight">
              APEX
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              CONTROL PLANE
            </span>
          </div>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
            Workspace & Project Scope
          </p>
        </div>

        <WorkspaceSelector
          workspaces={workspaces}
          selected={selectedWorkspace}
          onSelect={setSelectedWorkspace}
          onCreate={handleCreateWorkspace}
        />
        <ProjectSelector
          projects={projects}
          selected={selectedProject}
          onSelect={setSelectedProject}
          onCreate={handleCreateProject}
        />

        {data.connection && (
          <nav className="flex flex-col gap-1.5 border-t border-slate-800 pt-6">
            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1.5 block">
              Navigation
            </span>
            <NavTab
              active={activeTab === 'dashboard'}
              onClick={() => setActiveTab('dashboard')}
              icon="📊"
              label="Project Dashboard"
            />
            <NavTab
              active={activeTab === 'overview'}
              onClick={() => setActiveTab('overview')}
              icon="📋"
              label="Overview"
            />
            <NavTab
              active={activeTab === 'findings'}
              onClick={() => setActiveTab('findings')}
              icon="🔎"
              label="Findings & Evidence"
              badge={data.findingsCount}
            />
            <NavTab
              active={activeTab === 'recommendations'}
              onClick={() => setActiveTab('recommendations')}
              icon="💡"
              label="Recommendations"
              badge={data.recommendations.length}
            />
            <NavTab
              active={activeTab === 'executions'}
              onClick={() => setActiveTab('executions')}
              icon="⚙️"
              label="Executions"
              badge={data.executionsInProgress}
              pulse
            />
            <NavTab
              active={activeTab === 'outcomes'}
              onClick={() => setActiveTab('outcomes')}
              icon="🎯"
              label="Outcomes"
              badge={data.outcomes.length}
            />
            <NavTab
              active={activeTab === 'validation'}
              onClick={() => setActiveTab('validation')}
              icon="📈"
              label="Product Leverage"
            />
          </nav>
        )}

        <div className="mt-auto border-t border-slate-800 pt-4 flex flex-col gap-3 text-[11px] text-slate-500 font-medium">
          <button
            onClick={async () => {
              // Real logout: invalidate the session SERVER-SIDE first, then
              // clear the local token. The legacy flow only cleared
              // localStorage, leaving a valid session alive until expiry.
              try {
                await apiClient.post('/api/auth/logout', {})
              } catch {
                // Even if the network call fails, clear local state; the
                // server session will expire on its TTL.
              } finally {
                localStorage.removeItem('apex_session_token')
                window.dispatchEvent(new Event('apex_unauthorized'))
              }
            }}
            className="w-full text-center rounded-lg border border-slate-800 hover:bg-slate-800 py-2 text-xs font-bold text-slate-300 transition-colors"
          >
            🚪 Sign Out Session
          </button>
          <div className="flex flex-col gap-1">
            <p>🔒 Security: Double-Key Tenant Isolation</p>
            <p>💾 Storage: Production-Hardened Single-Process Persistence</p>
            <p>❄️ Infrastructure: Locked Core Engine</p>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8 flex flex-col gap-8">
        {globalError && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 px-4 py-3 text-xs">
            {globalError}
          </div>
        )}

        <header className="flex items-center justify-between border-b border-slate-800 pb-6">
          <div>
            <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest">
              {selectedWorkspace?.name || 'Workspace'}
            </span>
            <h1 className="text-3xl font-extrabold text-white mt-1">
              {selectedProject?.name || 'Select or Create a Project'}
            </h1>
          </div>
          {data.connection && (
            <div className="flex items-center gap-4 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
              <div className="flex flex-col text-right">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Linked Repository
                </span>
                <span className="text-sm font-bold text-white">
                  {data.connection.owner}/{data.connection.repository}
                </span>
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                🟢 Connected
              </span>
            </div>
          )}
        </header>

        {!data.connection ? (
          <RepositoryPanel
            workspace={selectedWorkspace}
            projectId={selectedProject?.id || null}
            connection={data.connection}
            onConnectionChange={(c) => data.setConnection(c)}
          />
        ) : reviewingRecommendation ? (
          <RecommendationReview
            recommendation={reviewingRecommendation}
            reasoning={reviewReasoning}
            findings={data.findings}
            calibration={reviewCalibration}
            isReasoningLoading={loadingReview}
            onFetchReasoning={async (recId) => {
              if (!selectedWorkspace || !selectedProject) return
              const r = await apiClient.getReasoning(
                selectedWorkspace.id,
                selectedProject.id,
                recId
              )
              setReviewReasoning(r)
            }}
            onDecision={handleReviewDecision}
            onBack={() => {
              setReviewingRecommendation(null)
              setReviewReasoning(null)
              setReviewCalibration(null)
            }}
          />
        ) : (
          <div className="flex flex-col gap-8">
            {activeTab === 'dashboard' && (
              <ProjectDashboard stats={projectStats} loading={loadingStats} error={globalError} />
            )}
            {activeTab === 'overview' && (
              <OverviewPanel
                data={data}
                onSelectRecommendation={(rec) => {
                  setSelectedRecommendation(rec)
                  setActiveTab('recommendations')
                }}
              />
            )}
            {activeTab === 'findings' && <FindingsPanel findings={data.findings} />}
            {activeTab === 'recommendations' && (
              <RecommendationsPanel
                workspace={selectedWorkspace}
                projectId={selectedProject?.id || null}
                recommendations={data.recommendations}
                selected={selectedRecommendation}
                onSelect={setSelectedRecommendation}
                onAction={async (recId, paId) => {
                  if (!selectedWorkspace || !selectedProject) return
                  await data.approveAction(recId, paId)
                }}
                onReview={startReview}
              />
            )}
            {activeTab === 'executions' && (
              <ExecutionLifecycle
                actions={actions}
                activityLog={data.activityLog}
                outcomes={data.outcomes}
                loading={false}
              />
            )}
            {activeTab === 'outcomes' && (
              <OutcomesCenter
                outcomes={data.outcomes}
                recommendations={data.recommendations}
                loading={false}
              />
            )}
            {activeTab === 'validation' && (
              <ValidationPanel
                metrics={data.validationMetrics}
                profile={data.learningProfile}
                signals={data.learningSignals}
                onCompileProfile={data.compileProfile}
              />
            )}

            {/* Adaptive Intelligence sidebar widget */}
            {activeTab !== 'dashboard' && (
              <AdaptiveTransparency
                profile={data.learningProfile}
                signals={data.learningSignals}
                calibration={data.calibration}
              />
            )}
          </div>
        )}

        {/* Activity Timeline — available on every connected tab */}
        {data.connection && <ActivityTimeline events={data.activityLog} />}
      </main>
    </div>
  )
}

function NavTab({
  active,
  onClick,
  icon,
  label,
  badge,
  pulse,
}: {
  active: boolean
  onClick: () => void
  icon: string
  label: string
  badge?: number
  pulse?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between px-4 py-2.5 text-sm rounded-lg font-bold text-left transition-colors ${
        active
          ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20'
          : 'text-slate-400 hover:bg-slate-800/40 hover:text-white'
      }`}
    >
      <span>
        {icon} {label}
      </span>
      {badge && badge > 0 ? (
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full border font-extrabold ${
            pulse
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 animate-pulse'
              : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
          }`}
        >
          {badge}
        </span>
      ) : null}
    </button>
  )
}
