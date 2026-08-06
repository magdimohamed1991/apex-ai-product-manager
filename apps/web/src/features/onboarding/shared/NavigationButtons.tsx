import { Button } from '@apex/ui'

interface NavigationButtonsProps {
  step: number
  totalSteps: number
  canProceed: boolean
  onNext: () => void
  onPrev: () => void
  nextLabel?: string
}

export function NavigationButtons({
  step,
  totalSteps,
  canProceed,
  onNext,
  onPrev,
  nextLabel,
}: NavigationButtonsProps) {
  const isFirst = step === 1
  const isLast = step === totalSteps - 1

  return (
    <div className="flex items-center justify-between">
      {!isFirst ? (
        <Button variant="ghost" onClick={onPrev}>
          ← Back
        </Button>
      ) : (
        <div />
      )}

      <Button onClick={onNext} disabled={!canProceed}>
        {nextLabel ?? (isLast ? 'Create Workspace →' : 'Continue →')}
      </Button>
    </div>
  )
}
