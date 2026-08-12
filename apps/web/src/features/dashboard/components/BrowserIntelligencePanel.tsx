/**
 * BrowserIntelligencePanel (H11)
 *
 * Displays crawl jobs, crawled pages, and the per-project browser
 * intelligence session, including the last incremental-update timestamp.
 * Pure display component — data arrives via props and crawling is delegated
 * to a page-provided callback.
 */
import { useState } from 'react'
import type { CrawlJob, CrawledPage, BrowserIntelligenceSession, CrawlPageType } from '../types'

interface Props {
  jobs: CrawlJob[]
  pages: CrawledPage[]
  session: BrowserIntelligenceSession | null
  onStartCrawl: (targets: { url: string; pageType: CrawlPageType }[]) => Promise<void>
}

const STATUS_STYLE: Record<string, string> = {
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  running: 'bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse',
  queued: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  failed: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  rate_limited: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  robots_blocked: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
}

const PAGE_TYPES: CrawlPageType[] = [
  'homepage',
  'pricing',
  'features',
  'documentation',
  'changelog',
  'blog',
  'about',
  'api_reference',
  'other',
]

export function BrowserIntelligencePanel({ jobs, pages, session, onStartCrawl }: Props) {
  const [url, setUrl] = useState('')
  const [pageType, setPageType] = useState<CrawlPageType>('pricing')
  const [busy, setBusy] = useState(false)

  async function submitCrawl() {
    if (!url.trim() || busy) return
    setBusy(true)
    try {
      await onStartCrawl([{ url: url.trim(), pageType }])
      setUrl('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-2xl font-black text-white flex items-center gap-2">
          <span>🕷️</span> Browser Intelligence (H11)
        </h2>
        <p className="text-sm text-slate-400">
          Crawl jobs, crawled pages, robots.txt compliance records, rate-limit state, and
          incremental update detection.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 flex flex-col gap-3">
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
          Start a crawl
        </span>
        <div className="flex flex-col md:flex-row gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://competitor.example/pricing"
            className="flex-1 rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-600"
          />
          <select
            value={pageType}
            onChange={(e) => setPageType(e.target.value as CrawlPageType)}
            className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-white"
          >
            {PAGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            onClick={submitCrawl}
            disabled={busy}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-5 py-2.5 text-xs font-bold text-white transition-colors"
          >
            {busy ? 'Crawling…' : '▶ Start Crawl'}
          </button>
        </div>
        <p className="text-[10px] text-slate-600 italic">
          Extraction in this runtime is labeled as requiring a browser engine; content hashes are
          real and drive incremental-update detection.
        </p>
      </div>

      {session && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <SessionStat label="Total Pages Crawled" value={session.totalPagesCrawled} />
          <SessionStat label="Total Data Points" value={session.totalDataPoints} />
          <SessionStat label="Crawl Jobs" value={session.crawlJobIds.length} />
          <SessionStat
            label="Last Incremental Update"
            value={
              session.lastIncrementalUpdateAt
                ? new Date(session.lastIncrementalUpdateAt).toLocaleString()
                : 'None yet'
            }
          />
        </div>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-3">
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
          Crawl Jobs ({jobs.length})
        </span>
        {jobs.length === 0 ? (
          <p className="text-xs text-slate-500">No crawl jobs recorded yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5 flex flex-col gap-1.5"
              >
                <div className="flex justify-between items-center gap-2">
                  <span className="text-xs font-bold text-white font-mono">
                    {job.targets.length} target(s) • origin {job.origin}
                  </span>
                  <span
                    className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase ${
                      STATUS_STYLE[job.status]
                    }`}
                  >
                    {job.status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-500 font-mono">
                  {job.targets.map((t) => (
                    <span key={t.url} className="px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                      {t.pageType}: {t.url}
                    </span>
                  ))}
                </div>
                <div className="text-[10px] text-slate-600 font-mono">
                  discovered {job.pagesDiscovered} • crawled {job.pagesCrawled} • skipped{' '}
                  {job.pagesSkipped} • errored {job.pagesErrored} • robots respected{' '}
                  {job.respectRobots ? 'yes' : 'no'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col gap-3 overflow-x-auto">
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
          Crawled Pages ({pages.length})
        </span>
        {pages.length === 0 ? (
          <p className="text-xs text-slate-500">No pages crawled yet.</p>
        ) : (
          <table className="text-xs w-full min-w-[560px]">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-800">
                <th className="py-2 pr-4 font-bold">URL</th>
                <th className="py-2 pr-4 font-bold">Type</th>
                <th className="py-2 pr-4 font-bold">Status</th>
                <th className="py-2 pr-4 font-bold">Changed</th>
                <th className="py-2 pr-4 font-bold">Extracted</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.id} className="border-b border-slate-800/50">
                  <td className="py-2 pr-4 text-slate-300 font-medium truncate max-w-[220px]">
                    {p.url}
                  </td>
                  <td className="py-2 pr-4 text-slate-400 font-mono">{p.pageType}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`font-bold ${
                        p.statusCode === 200 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {p.statusCode}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    {p.changedAt ? (
                      <span className="text-amber-400 font-bold">✓ changed</span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-slate-500 font-mono">
                    {p.extractedData.map((d) => d.type).join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function SessionStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
        {label}
      </span>
      <span className="text-lg font-extrabold text-white">{value}</span>
    </div>
  )
}
