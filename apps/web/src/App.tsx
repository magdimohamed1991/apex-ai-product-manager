import { useEffect, useState } from 'react'
import { DashboardPage } from './features/dashboard/page'
import type { Workspace } from './features/dashboard/types'

// Intercept global fetch to transparently inject the session token into all requests (Item I.1 & Item 17)
const originalFetch = window.fetch
window.fetch = async (input, init) => {
  const token = localStorage.getItem('apex_session_token')
  const headers = new Headers(init?.headers || {})

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (!headers.has('Content-Type') && !(init?.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await originalFetch(input, { ...init, headers })
  if (response.status === 401) {
    localStorage.removeItem('apex_session_token')
    // Trigger custom event so React can reset state on session expiration
    window.dispatchEvent(new Event('apex_unauthorized'))
  }
  return response
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('apex_session_token'))
  const [user, setUser] = useState<{ id: string; email: string } | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])

  // Auth view: 'login' | 'signup'
  const [authMode, setAuthView] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(false)

  // Workspace Onboarding states (Item I.2)
  const [onboardingStep, setOnboardingStep] = useState<number>(0) // 0 = not onboarding, 1 = welcome, 2 = project, 3 = github, 4 = analysis run
  const [projectName, setProjectName] = useState('My Core Project')
  const [repoOwner, setRepoOwner] = useState('magdimohamed1991')
  const [repoName, setRepoName] = useState('apex-ai-product-manager')
  const [repoBranch, setRepoBranch] = useState('main')

  // Analysis progression — states mirror REAL server state only:
  // 'idle' → 'running' (request in flight) → 'ready' | 'failed'.
  // The legacy flow fabricated intermediate stages ('scanning',
  // 'analyzing', 'reasoning') on timers and force-advanced to 'ready'
  // with a fixed 6s delay, even before the server answered. That was
  // fake progress; it has been removed.
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'running' | 'ready' | 'failed'>(
    'idle'
  )
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [isAnalysisRunning, setIsAnalysisRunning] = useState(false)

  // Listen to session expiry events
  useEffect(() => {
    const handleUnauthorized = () => {
      setToken(null)
      setUser(null)
    }
    window.addEventListener('apex_unauthorized', handleUnauthorized)
    return () => window.removeEventListener('apex_unauthorized', handleUnauthorized)
  }, [])

  // Load active session details if token is present
  const checkSession = async (currToken: string) => {
    try {
      const res = await originalFetch('/api/auth/session', {
        headers: { Authorization: `Bearer ${currToken}` },
      })
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
        setWorkspaces(data.workspaces)
      } else {
        localStorage.removeItem('apex_session_token')
        setToken(null)
      }
    } catch {
      localStorage.removeItem('apex_session_token')
      setToken(null)
    }
  }

  useEffect(() => {
    if (token) {
      // Session rehydration: the async checkSession call resolves the
      // session token against the server and restores user state. The
      // suppression is scoped to this single effect (external-system sync).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      checkSession(token)
    }
  }, [token])

  // Handlers
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError(null)
    setIsAuthLoading(true)

    const endpoint = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login'
    try {
      const res = await originalFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (res.ok) {
        localStorage.setItem('apex_session_token', data.token)
        setToken(data.token)
        setUser(data.user)

        if (authMode === 'signup') {
          // New user signup triggers onboarding workflow
          setOnboardingStep(1)
        } else {
          // Direct entrance for existing session
          setOnboardingStep(0)
        }
      } else {
        setAuthError(data.error || 'Authentication failed. Please verify credentials.')
      }
    } catch {
      setAuthError('Connection failure. Verify the API server status.')
    } finally {
      setIsAuthLoading(false)
    }
  }

  // Onboarding Progression handler — drives REAL server state only.
  // Every intermediate stage ('scanning'/'analyzing'/'reasoning') and the
  // fixed 6-second completion delay were timer-fabricated; the API call is
  // synchronous and returns 'completed' or 'failed', so the UI now reflects
  // exactly that.
  const startAnalysisProgress = async () => {
    if (isAnalysisRunning) return // prevent duplicate concurrent runs
    setIsAnalysisRunning(true)
    setAnalysisStatus('running')
    setAnalysisError(null)

    try {
      const workspaceId = workspaces[0]?.id || `ws-${email.split('@')[0].toLowerCase()}`

      // Create project first. The project id is generated SERVER-SIDE and
      // returned — the client must use the returned id for all subsequent
      // calls (client-supplied ids are ignored by the API).
      const pRes = await fetch('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          name: projectName,
        }),
      })
      const pData = await pRes.json().catch(() => ({}))
      if (!pRes.ok) {
        throw new Error(pData?.error?.message || 'Failed to create project')
      }
      const projectId = (pData as { id?: string }).id
      if (!projectId) {
        throw new Error('Server did not return a project id')
      }

      // Connect repository connections securely (Item I.3)
      const rRes = await fetch(`/api/projects/${projectId}/repository`, {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          provider: 'github',
          owner: repoOwner,
          repository: repoName,
          defaultBranch: repoBranch,
        }),
      })
      if (!rRes.ok) {
        const errData = await rRes.json().catch(() => ({}))
        throw new Error(errData?.error?.message || 'Failed to connect repository')
      }

      // Run analysis (synchronous server call)
      const runRes = await fetch(`/api/projects/${projectId}/analysis`, {
        method: 'POST',
        body: JSON.stringify({ workspaceId }),
      })
      const runData = await runRes.json()

      if (runRes.ok && runData.status === 'completed') {
        setAnalysisStatus('ready')
      } else {
        setAnalysisStatus('failed')
        setAnalysisError(
          runData?.error?.message || runData?.error || 'Repository analysis pipeline aborted.'
        )
      }
    } catch (err) {
      setAnalysisStatus('failed')
      setAnalysisError(
        err instanceof Error ? err.message : 'Network failure occurred during analysis.'
      )
    } finally {
      setIsAnalysisRunning(false)
    }
  }

  // --- RENDER VIEWS ---

  // Onboarding Flow
  if (token && onboardingStep > 0) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl p-8 flex flex-col gap-6 shadow-2xl">
          {/* Welcome Step */}
          {onboardingStep === 1 && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  APEX ONBOARDING
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  STEP 1/3
                </span>
              </div>
              <h2 className="text-xl font-bold text-white">
                Welcome {user?.email} to your APEX Product Manager Workspace
              </h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                APEX scans your codebase configurations to produce objective, trace-backed
                recommendations on testing, linting parameters, Docker, and CI rules.
              </p>
              <div className="bg-indigo-950/20 rounded-xl p-4 border border-indigo-500/10 text-xs flex flex-col gap-2 text-slate-400">
                <strong className="text-white block">🔎 What APEX will inspect:</strong>
                <div>• Static configurations: tsconfig, workflows, Dockerfile</div>
                <div>
                  • Zero active production codebase modification without explicit user execution
                  click!
                </div>
              </div>
              <button
                onClick={() => setOnboardingStep(2)}
                className="mt-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 py-3 text-sm font-bold text-white transition-colors"
              >
                Get Started ➔
              </button>
            </div>
          )}

          {/* Project Configuration Step */}
          {onboardingStep === 2 && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">Create your first Project</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  STEP 2/3
                </span>
              </div>
              <p className="text-sm text-slate-400">
                A project acts as a single operational plane linked to a specific code repository.
              </p>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                  Project Name
                </label>
                <input
                  type="text"
                  required
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="rounded-lg bg-slate-850 border border-slate-700 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-between gap-3 mt-2">
                <button
                  onClick={() => setOnboardingStep(1)}
                  className="px-5 py-2.5 rounded-lg border border-slate-750 text-xs text-slate-400 hover:bg-slate-800"
                >
                  Back
                </button>
                <button
                  onClick={() => setOnboardingStep(3)}
                  className="flex-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 py-2.5 text-sm font-bold text-white transition-colors"
                >
                  Configure Repository Connection ➔
                </button>
              </div>
            </div>
          )}

          {/* GitHub Connection Step */}
          {onboardingStep === 3 && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">Connect GitHub Repository</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  STEP 3/3
                </span>
              </div>
              <p className="text-sm text-slate-400 leading-relaxed">
                Connect your repository connection parameters. To allow local test discovery of our
                monorepo files, we pre-seed with the active monorepo branch.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                    Owner / Organization
                  </label>
                  <input
                    type="text"
                    required
                    value={repoOwner}
                    onChange={(e) => setRepoOwner(e.target.value)}
                    className="rounded-lg bg-slate-850 border border-slate-700 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                    Repository Name
                  </label>
                  <input
                    type="text"
                    required
                    value={repoName}
                    onChange={(e) => setRepoName(e.target.value)}
                    className="rounded-lg bg-slate-850 border border-slate-700 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                  Target Branch
                </label>
                <input
                  type="text"
                  required
                  value={repoBranch}
                  onChange={(e) => setRepoBranch(e.target.value)}
                  className="rounded-lg bg-slate-850 border border-slate-700 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="flex flex-col gap-2 bg-slate-950 p-4 rounded-xl border border-slate-800">
                <span className="text-xs font-bold text-indigo-400 block mb-1">
                  🔒 Access Credentials Policy
                </span>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Your GitHub Access token is safely isolated at runtime. It is never exposed to the
                  frontend, never stored inside domain models, and never logged.
                </p>
              </div>

              <div className="flex justify-between gap-3 mt-2">
                <button
                  onClick={() => setOnboardingStep(2)}
                  className="px-5 py-2.5 rounded-lg border border-slate-750 text-xs text-slate-400 hover:bg-slate-800"
                >
                  Back
                </button>
                <button
                  disabled={isAnalysisRunning}
                  onClick={() => {
                    setOnboardingStep(4)
                    void startAnalysisProgress()
                  }}
                  className="flex-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-50"
                >
                  Run First Discovery Scan 🚀
                </button>
              </div>
            </div>
          )}

          {/* Live Analysis Progress Step */}
          {onboardingStep === 4 && (
            <div className="flex flex-col gap-6 text-center py-6">
              <h2 className="text-xl font-bold text-white">Discovery Scan Progress</h2>

              <div className="flex flex-col items-center gap-4 py-4">
                {analysisStatus === 'running' ? (
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-850 border-t-indigo-500" />
                ) : analysisStatus === 'ready' ? (
                  <span className="text-5xl">✅</span>
                ) : (
                  <span className="text-5xl">❌</span>
                )}

                <div className="flex flex-col gap-1 mt-2">
                  <span className="text-sm font-bold uppercase text-indigo-400 tracking-wider">
                    Pipeline: {analysisStatus}
                  </span>
                  <p className="text-xs text-slate-400 max-w-sm">
                    {analysisStatus === 'running' &&
                      'Repository analysis is running on the server...'}
                    {analysisStatus === 'ready' &&
                      'Analysis completed. Your Product Workspace is compiled and ready!'}
                    {analysisStatus === 'failed' && `Pipeline error: ${analysisError}`}
                  </p>
                </div>
              </div>

              {analysisStatus === 'ready' && (
                <button
                  onClick={async () => {
                    await checkSession(token)
                    setOnboardingStep(0)
                  }}
                  className="rounded-lg bg-indigo-600 hover:bg-indigo-500 py-3 text-sm font-bold text-white transition-colors mt-2"
                >
                  Enter Control Plane Dashboard ➔
                </button>
              )}

              {analysisStatus === 'failed' && (
                <button
                  onClick={() => setOnboardingStep(3)}
                  className="rounded-lg border border-slate-750 hover:bg-slate-800 py-2.5 text-xs text-slate-300 font-bold transition-colors mt-2"
                >
                  Configure and Retry
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Active Authenticated Session View -> Main Control Plane
  if (token) {
    return <DashboardPage />
  }

  // Unauthenticated / Auth Screen (Login vs Signup)
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row font-sans">
      {/* Brand & Marketing Column */}
      <div className="flex-1 bg-gradient-to-br from-indigo-950 via-slate-950 to-slate-900 p-12 flex flex-col justify-between border-b md:border-b-0 md:border-r border-slate-900">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-3xl font-black bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent tracking-tight">
              APEX
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              PRODUCTION WORKSPACE
            </span>
          </div>
          <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">
            The AI Product Manager Daily OS
          </p>
        </div>

        <div className="flex flex-col gap-6 py-12">
          <h1 className="text-4xl font-extrabold text-white leading-tight">
            Turn codebase configuration gaps into clear product leverage.
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed max-w-lg">
            Empower your PM teams to scan repositories, review grounding alternatives, schedule
            automated GitHub execution, and verify resolutions in real-time.
          </p>

          <div className="flex flex-col gap-3 mt-4 text-xs font-semibold text-slate-400">
            <div className="flex items-center gap-3">
              <span className="text-indigo-400 text-lg">🔒</span>
              <span>
                <strong>Double-Key Tenant Isolation</strong>: every workspace-scoped read and write
                is gated by (id, workspaceId).
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-indigo-400 text-lg">💾</span>
              <span>
                <strong>Durable Single-Process Persistence</strong>: atomic file-swap commits with
                deterministic migrations (see docs/DATABASE.md).
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-indigo-400 text-lg">🔎</span>
              <span>
                <strong>Code-Level Fact Grounding</strong>: Only trace-backed evidence, zero
                synthetic fabrications.
              </span>
            </div>
          </div>
        </div>

        <div className="text-[11px] text-slate-600 font-medium">
          APEX Operational OS — Version 1.2.0 • In-Repo Security Audit Pass
        </div>
      </div>

      {/* Interactive Form Column */}
      <div className="w-full md:w-[480px] shrink-0 bg-slate-950 p-12 flex flex-col justify-center">
        <div className="max-w-sm w-full mx-auto flex flex-col gap-6">
          <div className="flex flex-col gap-1.5 text-center md:text-left">
            <h2 className="text-2xl font-black text-white">
              {authMode === 'login' ? 'Welcome back' : 'Create Account'}
            </h2>
            <p className="text-xs text-slate-400">
              {authMode === 'login'
                ? 'Sign in to access your secure PM workspaces'
                : 'Register a secure developer account with APEX'}
            </p>
          </div>

          {authError && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg p-3.5 text-xs font-semibold">
              {authError}
            </div>
          )}

          <form onSubmit={handleAuth} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                Email Address
              </label>
              <input
                type="email"
                required
                placeholder="e.g. pm@acme.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg bg-slate-900 border border-slate-800 px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                Secure Password
              </label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-lg bg-slate-900 border border-slate-800 px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={isAuthLoading}
              className="mt-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 py-3.5 text-sm font-bold text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isAuthLoading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                  Authenticating...
                </>
              ) : authMode === 'login' ? (
                'Sign In ➔'
              ) : (
                'Register Workspace ➔'
              )}
            </button>
          </form>

          <div className="text-center text-xs text-slate-500 mt-2 font-medium">
            {authMode === 'login' ? (
              <p>
                First time using APEX?{' '}
                <button
                  onClick={() => {
                    setAuthView('signup')
                    setAuthError(null)
                  }}
                  className="text-indigo-400 hover:text-indigo-300 font-bold"
                >
                  Register an account
                </button>
              </p>
            ) : (
              <p>
                Already have an account?{' '}
                <button
                  onClick={() => {
                    setAuthView('login')
                    setAuthError(null)
                  }}
                  className="text-indigo-400 hover:text-indigo-300 font-bold"
                >
                  Sign in here
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
