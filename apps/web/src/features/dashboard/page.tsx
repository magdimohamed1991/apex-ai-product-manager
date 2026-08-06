export function DashboardPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-4xl ring-1 ring-emerald-500/20">
          ✓
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-white">Workspace Ready</h1>
          <p className="text-slate-400">Your AI Product Manager is preparing today's report.</p>
        </div>
        <div className="mt-4 rounded-xl border border-slate-700/50 bg-slate-800/50 px-6 py-4">
          <p className="text-sm text-slate-500">🚀 Dashboard coming in Sprint 4</p>
        </div>
      </div>
    </div>
  )
}
