import type { OnboardingState } from '../types'
import { PRODUCT_TYPES } from '../constants'

interface ReviewStepProps {
  state: OnboardingState
}

export function ReviewStep({ state }: ReviewStepProps) {
  const productTypeLabel = PRODUCT_TYPES.find((t) => t.id === state.productType)
  const connectedIntegrations = state.integrations.filter((i) => i.status === 'connected')

  const aiCapabilities = [
    'Store Reviews Analysis',
    'Issue Tracking & Bugs',
    'Analytics & Funnels',
    'User Feedback Patterns',
    'Release Impact Analysis',
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold text-white">Everything looks good</h2>
        <p className="text-slate-400">Review your workspace setup before we begin.</p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Product</p>
          <p className="mt-1 text-lg font-semibold text-white">{state.productName}</p>
          <p className="text-sm text-slate-400">{state.companyName}</p>
          {state.website && <p className="mt-1 text-xs text-indigo-400">{state.website}</p>}
        </div>

        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Product Type
          </p>
          <p className="mt-1 text-white">
            {productTypeLabel?.emoji} {productTypeLabel?.label}
          </p>
        </div>

        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Connected Integrations ({connectedIntegrations.length})
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {connectedIntegrations.map((i) => (
              <span
                key={i.id}
                className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400 ring-1 ring-emerald-500/20"
              >
                ✓ {i.name}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-indigo-500/20 bg-indigo-600/5 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-indigo-400">
            AI Will Analyze
          </p>
          <div className="mt-2 flex flex-col gap-1">
            {aiCapabilities.map((cap) => (
              <p key={cap} className="text-sm text-slate-300">
                ✓ {cap}
              </p>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">Estimated setup: ~2 minutes</p>
        </div>
      </div>
    </div>
  )
}
