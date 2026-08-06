import { cn } from '@apex/ui'
import { TOTAL_STEPS } from '../constants'

interface ProgressIndicatorProps {
  currentStep: number
}

export function ProgressIndicator({ currentStep }: ProgressIndicatorProps) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: TOTAL_STEPS - 1 }, (_, i) => {
        const step = i + 1
        const isCompleted = step < currentStep
        const isCurrent = step === currentStep

        return (
          <div key={step} className="flex items-center gap-2">
            <div
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-all duration-300',
                isCompleted && 'bg-indigo-600 text-white',
                isCurrent && 'bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500',
                !isCompleted && !isCurrent && 'bg-slate-800 text-slate-500'
              )}
            >
              {isCompleted ? '✓' : step}
            </div>
            {step < TOTAL_STEPS - 1 && (
              <div
                className={cn(
                  'h-px w-8 transition-all duration-300',
                  isCompleted ? 'bg-indigo-600' : 'bg-slate-700'
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
