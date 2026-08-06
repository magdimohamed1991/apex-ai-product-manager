import { cn } from '@apex/ui'
import type { Integration } from '../types'

interface IntegrationsStepProps {
  integrations: Integration[]
  onChange: (id: string, value: string) => void
}

export function IntegrationsStep({ integrations, onChange }: IntegrationsStepProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold text-white">Connect your tools</h2>
        <p className="text-slate-400">
          Connect at least one integration. APEX will start analyzing automatically.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {integrations.map((integration) => (
          <div
            key={integration.id}
            className={cn(
              'rounded-xl border p-4 transition-all duration-200',
              integration.status === 'connected'
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : 'border-slate-700/50 bg-slate-800/50'
            )}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">{integration.name}</span>
                  {integration.status === 'connected' && (
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-400">
                      Connected
                    </span>
                  )}
                </div>
                <span className="text-xs text-slate-500">{integration.description}</span>
              </div>
            </div>

            <input
              type="text"
              placeholder={integration.placeholder}
              value={integration.value}
              onChange={(e) => onChange(integration.id, e.target.value)}
              className={cn(
                'mt-3 w-full rounded-lg border bg-slate-900/50 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none transition-colors',
                'focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500',
                integration.status === 'connected' ? 'border-emerald-500/30' : 'border-slate-700'
              )}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
