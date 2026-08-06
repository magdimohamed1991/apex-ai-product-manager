import { Button } from '@apex/ui'

interface WelcomeStepProps {
  onStart: () => void
}

export function WelcomeStep({ onStart }: WelcomeStepProps) {
  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600/10 text-4xl ring-1 ring-indigo-500/30">
          ⚡
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold tracking-tight text-white">Welcome to APEX</h1>
          <p className="text-lg text-slate-400">Your Autonomous Product Manager</p>
        </div>
      </div>

      <p className="max-w-md text-slate-400">
        We'll build your AI workspace in less than 3 minutes. Connect your tools and let APEX start
        discovering opportunities automatically.
      </p>

      <div className="flex flex-col items-center gap-3">
        <Button size="lg" onClick={onStart} className="px-8">
          Get Started →
        </Button>
        <p className="text-xs text-slate-600">No credit card required</p>
      </div>
    </div>
  )
}
