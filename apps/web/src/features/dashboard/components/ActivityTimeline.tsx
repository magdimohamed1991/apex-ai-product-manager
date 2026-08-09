import type { ActivityEvent } from '../types'

export function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-lg font-bold text-white flex items-center gap-2">
        <span>📋</span> Operational Activity Log
      </h3>
      {events.length === 0 ? (
        <p className="text-xs text-slate-500 italic">No activity logged.</p>
      ) : (
        <div className="flex flex-col gap-4 max-h-[340px] overflow-y-auto pr-2">
          {events.slice(0, 5).map((event, idx) => {
            let color = 'bg-slate-700'
            if (event.type === 'pipeline') color = 'bg-indigo-600'
            if (event.type === 'action') color = 'bg-amber-600'
            if (event.type === 'execution') color = 'bg-emerald-600'
            return (
              <div key={idx} className="flex gap-3 text-xs">
                <div className="flex flex-col items-center shrink-0">
                  <div className={`h-2 w-2 rounded-full ${color} ring-4 ring-slate-950`} />
                  <div className="w-0.5 flex-1 bg-slate-800 mt-1" />
                </div>
                <div className="flex flex-col gap-0.5 pb-2">
                  <span className="font-bold text-white leading-none">{event.title}</span>
                  <span className="text-slate-400 text-[11px] leading-relaxed">
                    {event.description}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
