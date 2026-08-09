import type { ActivityEvent } from '../types'

export function ExecutionsPanel({ activityLog }: { activityLog: ActivityEvent[] }) {
  const executions = activityLog.filter((e) => e.type === 'execution')
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-xl font-bold text-white">Execution Command Center</h2>
          <p className="text-sm text-slate-400">
            Monitor live statuses, exponential retries, failure classifications, and captured issue
            IDs.
          </p>
        </div>
        {executions.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No execution jobs actively running.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {executions.map((exec, idx) => {
              const isSuccess = /completed|success/i.test(exec.title)
              const externalId = (exec.metadata?.externalId as string | undefined) ?? null
              return (
                <div
                  key={idx}
                  className="bg-slate-900/20 border border-slate-800 rounded-xl p-4 flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-extrabold text-white text-sm">{exec.title}</span>
                    <span
                      className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${
                        isSuccess
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}
                    >
                      {isSuccess ? 'Completed ✓' : 'Failed / Retry Scheduled'}
                    </span>
                  </div>
                  <p className="text-slate-300 text-xs leading-relaxed">{exec.description}</p>
                  {externalId && (
                    <div className="flex items-center justify-between text-[11px] bg-slate-950 p-3 rounded-lg border border-slate-800 mt-1">
                      <span className="text-slate-500 font-mono">External ID: {externalId}</span>
                      {externalId.startsWith('http') && (
                        <a
                          href={externalId}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-400 hover:text-indigo-300 font-bold"
                        >
                          View issue ➔
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <span>📋</span> Action Audit Trail
        </h3>
        {activityLog.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No activity recorded yet.</p>
        ) : (
          <div className="flex flex-col gap-4 max-h-[580px] overflow-y-auto pr-2">
            {activityLog.map((event, idx) => {
              let color = 'bg-slate-700'
              if (event.type === 'pipeline') color = 'bg-indigo-600'
              if (event.type === 'action') color = 'bg-amber-600'
              if (event.type === 'execution') color = 'bg-emerald-600'
              return (
                <div key={idx} className="flex gap-3 text-xs">
                  <div className="flex flex-col items-center shrink-0">
                    <div className={`h-2.5 w-2.5 rounded-full ${color} ring-4 ring-slate-950`} />
                    <div className="w-0.5 flex-1 bg-slate-800 mt-1" />
                  </div>
                  <div className="flex flex-col gap-0.5 pb-2">
                    <span className="font-bold text-white">{event.title}</span>
                    <span className="text-slate-400 text-[11px] leading-relaxed">
                      {event.description}
                    </span>
                    <span className="text-[10px] text-slate-500 mt-1 font-semibold">
                      {new Date(event.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
