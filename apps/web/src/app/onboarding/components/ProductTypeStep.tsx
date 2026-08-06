import { cn } from '@apex/ui'
import type { ProductType } from '../types'
import { PRODUCT_TYPES } from '../constants'

interface ProductTypeStepProps {
  selected: ProductType | null
  onSelect: (type: ProductType) => void
}

export function ProductTypeStep({ selected, onSelect }: ProductTypeStepProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold text-white">What are you building?</h2>
        <p className="text-slate-400">Select the type that best describes your product.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PRODUCT_TYPES.map((type) => (
          <button
            key={type.id}
            onClick={() => onSelect(type.id)}
            className={cn(
              'flex items-center gap-3 rounded-xl border p-4 text-left transition-all duration-200',
              'hover:border-indigo-500/50 hover:bg-indigo-600/5',
              selected === type.id
                ? 'border-indigo-500 bg-indigo-600/10 text-white'
                : 'border-slate-700/50 bg-slate-800/50 text-slate-300'
            )}
          >
            <span className="text-2xl">{type.emoji}</span>
            <span className="font-medium">{type.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
