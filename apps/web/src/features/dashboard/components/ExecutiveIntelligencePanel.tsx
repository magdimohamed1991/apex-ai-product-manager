/**
 * ExecutiveIntelligencePanel (H12)
 *
 * Displays the product health KPI grid, trend detections with direction
 * indicators, market signals, investment opportunities, risk forecasts, and
 * roadmap insights, plus report generation. Pure display component — data
 * arrives via props and actions are delegated to page-provided callbacks.
 */
import { useState } from 'react'
import { MarkdownPreview } from './MarkdownPreview'
import type {
  ExecutiveDashboard,
  ExecutiveReport,
  ProductHealthSnapshot,
  TrendDetection,
  ReportPeriod,
  ReportFormat,
} from '../types'

interface Props {
  dashboard: ExecutiveDashboard | null
  snapshot: ProductHealthSnapshot | null
  reports: ExecutiveReport[]
  trends: TrendDetection[]
  onGenerateDashboard: () => Promise<void>
  onGenerateReport: (period: ReportPeriod) => Promise<void>
  onExportReport: (reportId: string, format: ReportFormat) => Promise<void>
}

const STATUS_STYLE: Record<string, string> = {
  healthy: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  at_risk: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  critical: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  unknown: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
}

const TREND_ICON: Record<string, string> = {
  improving: '📈',
  degrading: '📉',
  stable: '➖',
  volatile: '〰️',
}

export function ExecutiveIntelligencePanel({
  dashboard,
  snapshot,
  reports,
  trends,
  onGenerateDashboard,
  onGenerateReport,
  onExportReport,
}: Props) {
  const [period, setPeriod] = useState<ReportPeriod>('weekly')
  const [busy, setBusy] = useState(false)
  const [previewReportId, setPreviewReportId] = useState<string | null>(null)

  async function generateReport() {
    setBusy(true)
    try {
      await onGenerateReport(period)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex justify-between items-start">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-2xl font-black text-white flex items-center gap-2">
            <span>🏛️</span> Executive Intelligence (H12)
          </h2>
          <p className="text-sm text-slate-400">
            Product health KPIs, trend detection, investment opportunities, risk forecasts, and
            exportable executive reports — every value derived from persisted data.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onGenerateDashboard}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-xs font-bold text-white transition-colors"
          >
            🔄 Refresh Dashboard
          </button>
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as ReportPeriod)}
              className="bg-transparent text-xs font-bold text-slate-300 py-2 outline-none"
            >
              <option value="weekly" className="bg-slate-900">
                weekly
              </option>
              <option value="monthly" className="bg-slate-900">
                monthly
              </option>
              <option value="quarterly" className="bg-slate-900">
                quarterly
              </option>
            </select>
            <button
              onClick={generateReport}
              disabled={busy}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-2 text-xs font-bold text-white"
            >
              {busy ? '…' : '📄 Generate Report'}
            </button>
          </div>
        </div>
      </div>

      {snapshot ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span
              className={`text-[10px] px-2.5 py-1 rounded-full border font-bold uppercase ${
                STATUS_STYLE[snapshot.status]
              }`}
            >
              {snapshot.status}
            </span>
            <span className="text-2xl font-black text-white">
              {snapshot.overallScore === null ? '—' : snapshot.overallScore.toFixed(1)}
              <span className="text-xs text-slate-500 font-bold">/100</span>
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              snapshot {new Date(snapshot.snapshotAt).toLocaleString()}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {snapshot.kpis.map((kpi) => (
              <div
                key={kpi.name}
                className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 flex flex-col gap-1.5"
              >
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-mono">
                    {kpi.name}
                  </span>
                  <span className="text-sm">{TREND_ICON[kpi.trend] ?? '➖'}</span>
                </div>
                <div className="text-xl font-extrabold text-white">
                  {kpi.value === null ? (
                    <span className="text-slate-600 text-sm">unavailable</span>
                  ) : (
                    kpi.value
                  )}
                  <span className="text-[10px] text-slate-500 font-bold ml-1">{kpi.unit}</span>
                </div>
                <div className="text-[10px] text-slate-600">
                  {kpi.source}
                  {kpi.previousValue !== null && (
                    <span className="ml-1">prev {kpi.previousValue}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-800 p-12 text-center text-slate-500 text-sm">
          No product health snapshot yet — refresh the dashboard to generate one.
        </div>
      )}

      {dashboard && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-3">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Trend Detections ({trends.length})
              </span>
              {trends.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No trends yet — a second snapshot is required to compare.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {trends.map((t) => (
                    <div
                      key={t.id}
                      className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5 flex flex-col gap-1"
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-300 font-mono uppercase">
                          {TREND_ICON[t.direction]} {t.metricName}
                        </span>
                        <span
                          className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${
                            t.significance === 'high'
                              ? 'bg-amber-500/10 text-amber-400'
                              : 'bg-slate-700/40 text-slate-400'
                          }`}
                        >
                          {t.significance}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">{t.interpretation}</p>
                      <div className="text-[10px] text-slate-600 font-mono">
                        {t.direction} • Δ {t.magnitude}
                        {t.percentageChange !== null && ` • ${t.percentageChange}%`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-3">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Roadmap Insights
              </span>
              <div className="flex flex-col gap-1.5">
                {dashboard.roadmapInsights.map((insight, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-slate-800/60 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-400 leading-relaxed"
                  >
                    {insight}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-3">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Investment Opportunities ({dashboard.investmentOpportunities.length})
              </span>
              {dashboard.investmentOpportunities.length === 0 ? (
                <p className="text-xs text-slate-500">None identified.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {dashboard.investmentOpportunities.map((o) => (
                    <div
                      key={o.id}
                      className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5 flex flex-col gap-1.5"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <span className="text-xs font-bold text-white">{o.title}</span>
                        <span
                          className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase ${
                            o.priority === 'critical' || o.priority === 'high'
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                              : 'bg-slate-700/40 text-slate-400'
                          }`}
                        >
                          {o.priority}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">{o.description}</p>
                      <div className="text-[10px] text-slate-600 font-mono">
                        confidence {o.confidence} • effort {o.effort}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-3">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Risk Forecasts ({dashboard.riskForecasts.length})
              </span>
              {dashboard.riskForecasts.length === 0 ? (
                <p className="text-xs text-slate-500">No risks forecast.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {dashboard.riskForecasts.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5 flex flex-col gap-1.5"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <span className="text-xs font-bold text-white">{r.title}</span>
                        <span
                          className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase ${
                            r.level === 'critical' || r.level === 'high'
                              ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                              : 'bg-slate-700/40 text-slate-400'
                          }`}
                        >
                          {r.level}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">{r.description}</p>
                      <div className="text-[10px] text-slate-600 font-mono">
                        probability {r.probability} • {r.timeHorizon}
                      </div>
                      {r.mitigations.length > 0 && (
                        <div className="text-[10px] text-indigo-400">
                          🛡️ {r.mitigations.join(' • ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-3">
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
          Executive Reports ({reports.length})
        </span>
        {reports.length === 0 ? (
          <p className="text-xs text-slate-500">Generate a report to export markdown or JSON.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {reports.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5 flex flex-col gap-2"
              >
                <div className="flex justify-between items-center gap-2">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-xs font-bold text-white truncate">{r.title}</span>
                    <span className="text-[10px] text-slate-600 font-mono">
                      {r.period} • {new Date(r.periodStart).toLocaleDateString()} →{' '}
                      {new Date(r.periodEnd).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() =>
                        setPreviewReportId((current) => (current === r.id ? null : r.id))
                      }
                      className={`rounded-md border px-2.5 py-1 text-[10px] font-bold transition-colors ${
                        previewReportId === r.id
                          ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/30'
                          : 'border-slate-700 hover:bg-slate-800 text-slate-300'
                      }`}
                    >
                      {previewReportId === r.id ? 'Close' : 'Preview'}
                    </button>
                    <button
                      onClick={() => onExportReport(r.id, 'markdown')}
                      className="rounded-md border border-slate-700 hover:bg-slate-800 px-2.5 py-1 text-[10px] font-bold text-slate-300"
                    >
                      MD
                    </button>
                    <button
                      onClick={() => onExportReport(r.id, 'json')}
                      className="rounded-md border border-slate-700 hover:bg-slate-800 px-2.5 py-1 text-[10px] font-bold text-slate-300"
                    >
                      JSON
                    </button>
                    <button
                      onClick={() => onExportReport(r.id, 'pdf')}
                      className="rounded-md border border-slate-700 hover:bg-slate-800 px-2.5 py-1 text-[10px] font-bold text-slate-300"
                    >
                      PDF
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">{r.executiveSummary}</p>
                {previewReportId === r.id && (
                  <div className="mt-2 rounded-xl border border-indigo-500/20 bg-slate-950/60 p-4 overflow-x-auto">
                    {r.markdownExport ? (
                      <MarkdownPreview content={r.markdownExport} />
                    ) : (
                      <p className="text-xs text-slate-500 italic">
                        No markdown export on this report — regenerate it to preview.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
