/**
 * ScheduledIntelligencePanel (V2.1)
 *
 * Displays scheduled intelligence jobs, their execution history, and metrics.
 * Supports creating, pausing, resuming, triggering, and deleting jobs.
 */
import { useState } from 'react'
import type { ScheduledJob, JobExecution, JobMetrics, JobType, ScheduleConfig } from '../types'

interface Props {
  jobs: ScheduledJob[]
  metrics: JobMetrics[]
  executions: JobExecution[]
  selectedJobId: string | null
  onSelectJob: (jobId: string | null) => void
  onCreateJob: (input: {
    name: string
    jobType: JobType
    schedule: ScheduleConfig
  }) => Promise<void>
  onTriggerJob: (jobId: string) => Promise<void>
  onPauseJob: (jobId: string) => Promise<void>
  onResumeJob: (jobId: string) => Promise<void>
  onDeleteJob: (jobId: string) => Promise<void>
  onLoadExecutions: (jobId: string) => Promise<void>
  onLoadMetrics: (jobId: string) => Promise<void>
}

const JOB_TYPE_LABELS: Record<JobType, string> = {
  competitor_crawl: 'Competitor Crawl',
  ux_analysis: 'UX Analysis',
  documentation_scan: 'Documentation Scan',
  pricing_scan: 'Pricing Scan',
  changelog_scan: 'Changelog Scan',
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  paused: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  completed: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  failed: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
}

const EXEC_STATUS_STYLE: Record<string, string> = {
  pending: 'text-slate-400',
  running: 'text-sky-400',
  completed: 'text-emerald-400',
  failed: 'text-rose-400',
  cancelled: 'text-amber-400',
  retry_pending: 'text-amber-400',
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return `${Math.floor(diff / 86400_000)}d ago`
}

export function ScheduledIntelligencePanel({
  jobs,
  metrics,
  executions,
  selectedJobId,
  onSelectJob,
  onCreateJob,
  onTriggerJob,
  onPauseJob,
  onResumeJob,
  onDeleteJob,
  onLoadExecutions,
  onLoadMetrics,
}: Props) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [jobType, setJobType] = useState<JobType>('competitor_crawl')
  const [scheduleMode, setScheduleMode] = useState<'cron' | 'interval'>('cron')
  const [cronExpr, setCronExpr] = useState('0 */6 * * *')
  const [intervalMinutes, setIntervalMinutes] = useState(60)

  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null
  const selectedMetrics = selectedJobId
    ? (metrics.find((m) => m.jobId === selectedJobId) ?? null)
    : null
  const selectedExecutions = selectedJobId
    ? executions.filter((e) => e.jobId === selectedJobId)
    : []

  const handleCreate = async () => {
    if (!name.trim()) return
    const schedule: ScheduleConfig =
      scheduleMode === 'cron'
        ? { cronExpression: cronExpr, intervalMs: null, oneTimeAt: null }
        : { cronExpression: null, intervalMs: intervalMinutes * 60_000, oneTimeAt: null }
    await onCreateJob({ name: name.trim(), jobType, schedule })
    setShowForm(false)
    setName('')
  }

  const handleSelect = async (jobId: string) => {
    onSelectJob(jobId)
    await Promise.all([onLoadExecutions(jobId), onLoadMetrics(jobId)])
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-100">Scheduled Intelligence</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 transition-colors"
        >
          {showForm ? 'Cancel' : '+ New Job'}
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Daily competitor pricing scan"
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Job Type</label>
              <select
                value={jobType}
                onChange={(e) => setJobType(e.target.value as JobType)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              >
                {Object.entries(JOB_TYPE_LABELS).map(([type, label]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Schedule</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setScheduleMode('cron')}
                  className={`rounded px-2 py-1 text-xs ${scheduleMode === 'cron' ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300'}`}
                >
                  Cron
                </button>
                <button
                  onClick={() => setScheduleMode('interval')}
                  className={`rounded px-2 py-1 text-xs ${scheduleMode === 'interval' ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300'}`}
                >
                  Interval
                </button>
              </div>
            </div>
            <div>
              {scheduleMode === 'cron' ? (
                <>
                  <label className="block text-xs text-slate-400 mb-1">Cron Expression</label>
                  <input
                    value={cronExpr}
                    onChange={(e) => setCronExpr(e.target.value)}
                    placeholder="0 */6 * * *"
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 font-mono focus:border-sky-500 focus:outline-none"
                  />
                </>
              ) : (
                <>
                  <label className="block text-xs text-slate-400 mb-1">Interval (minutes)</label>
                  <input
                    type="number"
                    value={intervalMinutes}
                    onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                    min={1}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </>
              )}
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={!name.trim()}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
          >
            Create Job
          </button>
        </div>
      )}

      {/* Jobs Table */}
      {jobs.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-slate-800/30 p-8 text-center text-slate-400">
          No scheduled jobs yet. Create one to start automated intelligence collection.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700 bg-slate-800/30 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs text-slate-400 uppercase tracking-wider">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Runs</th>
                <th className="px-4 py-2">Last Run</th>
                <th className="px-4 py-2">Next Run</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  className={`border-b border-slate-700/50 cursor-pointer transition-colors ${
                    selectedJobId === job.id ? 'bg-sky-500/5' : 'hover:bg-slate-800/50'
                  }`}
                  onClick={() => handleSelect(job.id)}
                >
                  <td className="px-4 py-2 text-slate-100 font-medium">{job.name}</td>
                  <td className="px-4 py-2 text-slate-300 text-xs">
                    {JOB_TYPE_LABELS[job.jobType]}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[job.status] ?? 'text-slate-400'}`}
                    >
                      {job.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-300">{job.totalExecutions}</td>
                  <td className="px-4 py-2 text-slate-400 text-xs">
                    {formatRelative(job.lastExecutedAt)}
                  </td>
                  <td className="px-4 py-2 text-slate-400 text-xs">
                    {job.nextRunAt ? formatRelative(job.nextRunAt) : '—'}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => onTriggerJob(job.id)}
                        className="rounded bg-sky-600/20 px-2 py-0.5 text-xs text-sky-400 hover:bg-sky-600/30"
                        title="Trigger now"
                      >
                        ▶
                      </button>
                      {job.status === 'active' ? (
                        <button
                          onClick={() => onPauseJob(job.id)}
                          className="rounded bg-amber-600/20 px-2 py-0.5 text-xs text-amber-400 hover:bg-amber-600/30"
                          title="Pause"
                        >
                          ⏸
                        </button>
                      ) : job.status === 'paused' ? (
                        <button
                          onClick={() => onResumeJob(job.id)}
                          className="rounded bg-emerald-600/20 px-2 py-0.5 text-xs text-emerald-400 hover:bg-emerald-600/30"
                          title="Resume"
                        >
                          ⏵
                        </button>
                      ) : null}
                      <button
                        onClick={() => onDeleteJob(job.id)}
                        className="rounded bg-rose-600/20 px-2 py-0.5 text-xs text-rose-400 hover:bg-rose-600/30"
                        title="Delete"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Selected Job Details */}
      {selectedJob && (
        <div className="space-y-4">
          {/* Metrics */}
          {selectedMetrics && (
            <div className="grid grid-cols-4 gap-3">
              <div className="rounded-xl border border-slate-700 bg-slate-800/30 p-3 text-center">
                <div className="text-2xl font-bold text-slate-100">
                  {selectedMetrics.totalExecutions}
                </div>
                <div className="text-xs text-slate-400">Total Runs</div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-800/30 p-3 text-center">
                <div className="text-2xl font-bold text-emerald-400">
                  {selectedMetrics.successfulExecutions}
                </div>
                <div className="text-xs text-slate-400">Succeeded</div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-800/30 p-3 text-center">
                <div className="text-2xl font-bold text-rose-400">
                  {selectedMetrics.failedExecutions}
                </div>
                <div className="text-xs text-slate-400">Failed</div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-800/30 p-3 text-center">
                <div className="text-2xl font-bold text-slate-100">
                  {formatDuration(selectedMetrics.averageDurationMs)}
                </div>
                <div className="text-xs text-slate-400">Avg Duration</div>
              </div>
            </div>
          )}

          {/* Execution History */}
          <div className="rounded-xl border border-slate-700 bg-slate-800/30 overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-700 text-xs font-medium text-slate-400 uppercase tracking-wider">
              Execution History
            </div>
            {selectedExecutions.length === 0 ? (
              <div className="px-4 py-6 text-center text-slate-500 text-sm">No executions yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50 text-left text-xs text-slate-500">
                    <th className="px-4 py-1.5">Status</th>
                    <th className="px-4 py-1.5">Trigger</th>
                    <th className="px-4 py-1.5">Duration</th>
                    <th className="px-4 py-1.5">Attempt</th>
                    <th className="px-4 py-1.5">Started</th>
                    <th className="px-4 py-1.5">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedExecutions.map((exec) => (
                    <tr key={exec.id} className="border-b border-slate-700/30">
                      <td className="px-4 py-1.5">
                        <span
                          className={`text-xs font-medium ${EXEC_STATUS_STYLE[exec.status] ?? 'text-slate-400'}`}
                        >
                          {exec.status}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 text-slate-400 text-xs">{exec.trigger}</td>
                      <td className="px-4 py-1.5 text-slate-300 text-xs">
                        {formatDuration(exec.durationMs)}
                      </td>
                      <td className="px-4 py-1.5 text-slate-400 text-xs">#{exec.attemptNumber}</td>
                      <td className="px-4 py-1.5 text-slate-400 text-xs">
                        {formatRelative(exec.startedAt)}
                      </td>
                      <td className="px-4 py-1.5 text-rose-400 text-xs max-w-[200px] truncate">
                        {exec.error ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
